const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8")
  .replace(/\ninitialize\(\);\s*$/, "\n");
const context = vm.createContext({ window: {}, document: { getElementById: () => null, querySelectorAll: () => [] } });
vm.runInContext(source, context);

const drivers = { cabinetLf: 50, lowerLf: 30, upperLf: 20, tallLf: 0, doorSqFt: 0, drawer: 0, door: 0, filler: 0, cabinet: 100 };
const phases = { build: true, finish: false, install: false };

test("glue pints per LF are priced from a gallon purchase", () => {
  const glue = {
    id: "glue", name: "Glue", purchasePrice: 35, purchaseQty: 1, purchaseUnit: "Gallons", phases: ["build"],
    rules: [{ amount: 1, unit: "Pint", per: 25, driver: "cabinetLf", style: "all" }]
  };
  const [line] = context.calcConsumableLines([glue], { constructionType: "frameless", phases, drivers });
  assert.equal(line.qtyInPurchaseUnit, 0.25);
  assert.equal(line.cost, 8.75);
});

test("staples use the rule for the selected build style", () => {
  const staples = {
    id: "s", name: "Staples", purchasePrice: 40, purchaseQty: 5000, purchaseUnit: "Pieces", phases: ["build"],
    rules: [
      { amount: 30, unit: "Pieces", per: 1, driver: "cabinet", style: "frameless" },
      { amount: 45, unit: "Pieces", per: 1, driver: "cabinet", style: "faceFrame" }
    ]
  };
  const euro = context.calcConsumableLines([staples], { constructionType: "frameless", phases, drivers })[0];
  const face = context.calcConsumableLines([staples], { constructionType: "faceFrame", phases, drivers })[0];
  assert.equal(euro.qtyInPurchaseUnit, 3000);
  assert.equal(euro.cost, 24);
  assert.equal(face.qtyInPurchaseUnit, 4500);
});

test("consumables only count when one of their phases is included", () => {
  const brushes = {
    id: "b", name: "Brushes", purchasePrice: 10, purchaseQty: 10, purchaseUnit: "Pieces", phases: ["finish"],
    rules: [{ amount: 1, unit: "Pieces", per: 10, driver: "cabinetLf", style: "all" }]
  };
  assert.equal(context.calcConsumableLines([brushes], { constructionType: "frameless", phases, drivers }).length, 0);
  const lines = context.calcConsumableLines([brushes], {
    constructionType: "frameless", phases: { ...phases, finish: true }, drivers
  });
  assert.equal(lines[0].qtyInPurchaseUnit, 5);
});
