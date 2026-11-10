const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8")
  .replace(/\ninitialize\(\);\s*$/, "\n");
const context = vm.createContext({ window: {}, document: {} });
vm.runInContext(source, context);

const setup = {
  mpg: "10", fuelPrice: "4", roadFactor: "1.5",
  trips: "3", tripsPerLf: "50", tripsNoInstall: "1", tripsPerLfNoInstall: "0"
};

test("haversine distance matches a known city pair", () => {
  const miles = context.haversineMiles(40.7128, -74.006, 34.0522, -118.2437);
  assert.ok(Math.abs(miles - 2445) < 15);
  assert.equal(context.haversineMiles(10, 10, 10, 10), 0);
});

test("install jobs use base trips plus extra trips per lineal feet", () => {
  const small = context.calcTravel(setup, { includeInstall: true, totalLf: 5, straightMiles: 20 });
  assert.equal(small.trips, 3);
  assert.equal(small.oneWayMiles, 30);
  assert.equal(small.totalMiles, 180);
  assert.equal(small.gallons, 18);
  assert.equal(small.cost, 72);
  assert.equal(context.calcTravel(setup, { includeInstall: true, totalLf: 120, straightMiles: 20 }).trips, 5);
});

test("jobs without install use their own trip count", () => {
  const result = context.calcTravel(setup, { includeInstall: false, totalLf: 200, straightMiles: 20 });
  assert.equal(result.trips, 1);
  assert.equal(result.totalMiles, 60);
});

test("zero MPG or blank values never produce NaN", () => {
  const result = context.calcTravel({ ...setup, mpg: "0", fuelPrice: "" }, { includeInstall: true, totalLf: 10, straightMiles: 5 });
  assert.equal(result.cost, 0);
  assert.equal(result.gallons, 0);
});
