const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8")
  .replace(/\ninitialize\(\);\s*$/, "\n");

function setup(rows = []) {
  const checkbox = { checked: false };
  const context = vm.createContext({
    window: {},
    document: {
      getElementById: (id) => id === "drawerInchesInput" ? checkbox : null,
      querySelectorAll: () => rows
    }
  });
  vm.runInContext(source, context);
  return { context, checkbox };
}

function drawerRow({ inches, display, value = display, name = "Top Drawer", position = "top" }) {
  const inputs = {
    ".drawer-set-lineal": { value },
    ".drawer-set-name": { value: name },
    ".drawer-set-height": { value: "5" }
  };
  return {
    dataset: { drawerSetId: "test", linealInches: String(inches), displayValue: display, position, userOverridden: "true" },
    querySelector: (selector) => inputs[selector]
  };
}

test("drawer labels and new rows use feet by default", () => {
  const { context } = setup();
  const set = context.createDrawerSet({ name: "Top Drawer", height: 5, linealInches: 18 });
  const html = context.drawerSetRowTemplate(set);
  assert.match(html, /Total lineal feet of all top drawers/);
  assert.match(html, /value="1.5"/);
  assert.equal(context.drawerWidthLabel("middle", false), "Total lineal feet of all middle drawers");
  assert.equal(context.drawerWidthLabel("bottom", false), "Total lineal feet of all bottom drawers");
  assert.equal(context.drawerWidthLabel("top", true), "Total lineal inches of all top drawers");
});

test("edited values convert to inches and saved inch values retain precision", () => {
  const row = drawerRow({ inches: 1, display: "0.0833333333" });
  const { context, checkbox } = setup([row]);
  assert.equal(context.collectDrawerSets()[0].linealInches, 1);
  row.querySelector(".drawer-set-lineal").value = "2.5";
  assert.equal(context.collectDrawerSets()[0].linealInches, 30);
  checkbox.checked = true;
  assert.equal(context.collectDrawerSets()[0].linealInches, 2.5);
  assert.equal(context.collectDrawerSets(false)[0].linealInches, 30);
});
