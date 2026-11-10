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
  days: "5", hours: "8", holidays: "10", paidHolidays: false, efficiency: "80",
  employees: [{ name: "One", wage: "20" }, { name: "Two", wage: "30" }],
  expenses: [{ name: "Rent", amount: "1000", period: "monthly" }, { name: "Insurance", amount: "3000", period: "annual" }]
};

test("overhead rate uses productive employee hours, wages, and annualized expenses", () => {
  const result = context.shopOverheadEstimate(setup);
  assert.equal(result.operatingDays, 250);
  assert.equal(result.dailyWages, 400);
  assert.equal(result.annualWages, 100000);
  assert.equal(result.annualOverhead, 15000);
  assert.equal(result.clockHours, 4000);
  assert.equal(result.productiveHours, 3200);
  assert.equal(result.rate, 35.9375);
});

test("paid holidays add wages without adding productive hours", () => {
  const result = context.shopOverheadEstimate({ ...setup, paidHolidays: true });
  assert.equal(result.annualWages, 104000);
  assert.equal(result.productiveHours, 3200);
  assert.equal(result.rate, 37.1875);
});

test("payroll tax burden percent is added to all paid wages", () => {
  const result = context.shopOverheadEstimate({ ...setup, taxBurden: "10" });
  assert.equal(result.annualTaxBurden, 10000);
  assert.equal(result.rate, 39.0625);
  const paid = context.shopOverheadEstimate({ ...setup, taxBurden: "10", paidHolidays: true });
  assert.equal(paid.annualTaxBurden, 10400);
  assert.ok(context.shopOverheadEstimate({ ...setup, taxBurden: "-1" }).error);
});

test("invalid inputs do not produce a usable rate", () => {
  for (const changes of [
    { efficiency: "0" }, { holidays: "260" }, { employees: [] },
    { employees: [{ name: "", wage: "10" }] },
    { expenses: [{ name: "Rent", amount: "", period: "monthly" }] }
  ]) {
    assert.ok(context.shopOverheadEstimate({ ...setup, ...changes }).error);
  }
});
