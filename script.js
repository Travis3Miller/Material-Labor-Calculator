function byId(id) {
  return document.getElementById(id);
}

const LOCAL_PROJECTS_KEY = "cabinet.projects.v1";
const LOCAL_CATALOG_KEY = "cabinet.catalog.v1";
const LOCAL_STANDARDS_KEY = "cabinet.standards.v1";
const DOOR_GALLONS_PER_SQFT = 0.03;
const FRAME_MEMBER_WIDTH_IN = 2;
const FRAME_MEMBER_THICKNESS_IN = 0.75;


const CATEGORY_LABELS = {
  carcass: "Carcass",
  back: "Back",
  finishedEnd: "Finished Ends",
  drawerBox: "Drawer Box",
  drawerBottom: "Drawer Bottom",
  toeKick: "Toe Kick",
  nailer: "Nailers"
};

const HARDWARE_USE_LABELS = {
  slides: "Drawer Slides",
  hinges: "Hinges",
  basePlates: "Base Plates"
};

const state = {
  catalog: {
    materials: [],
    slides: [],
    accessories: [],
    doorStyles: [],
    paintTypes: [],
    hingeTypes: [],
    basePlateTypes: [],
    boardStocks: [],
    crownMouldings: []
  },
  jobAccessories: [],
  dataMode: "unknown",
  plan: "free",
  config: null
};

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function nowIso() {
  return new Date().toISOString();
}

function formatPrintDate(value = new Date()) {
  return value.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function updatePrintHeader() {
  const projectName = byId("projectName").value.trim();
  const nameText = projectName ? `Project: ${projectName}` : "Project: (unnamed)";
  byId("printProjectName").textContent = nameText;
  byId("printDate").textContent = `Date: ${formatPrintDate()}`;
}

function readLocalJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch (_err) {
    return fallback;
  }
}

function writeLocalJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function defaultStandardsSet() {
  return {
    sheetMaterials: {},
    crownMouldingId: "",
    boardStockId: "",
    drawerSlideId: "",
    hingeTypeId: "",
    basePlateTypeId: "",
    doorStyleId: "",
    paintTypeId: "",
    accessoryIds: []
  };
}

function defaultStandards() {
  return {
    faceFrame: defaultStandardsSet(),
    frameless: defaultStandardsSet()
  };
}

function getStandardSelections(profile = "faceFrame") {
  const raw = readLocalJson(LOCAL_STANDARDS_KEY, defaultStandards());
  const legacy = raw && raw.sheetMaterials ? { faceFrame: raw, frameless: raw } : null;
  const merged = legacy ? { ...defaultStandards(), ...legacy } : { ...defaultStandards(), ...raw };
  return { ...defaultStandardsSet(), ...(merged[profile] || {}) };
}

function saveStandardSelections(profile, standards) {
  const current = readLocalJson(LOCAL_STANDARDS_KEY, defaultStandards());
  writeLocalJson(LOCAL_STANDARDS_KEY, {
    ...defaultStandards(),
    ...current,
    [profile]: standards
  });
}

function updateStandardSelection({ profile, type, id, category, checked }) {
  const standards = getStandardSelections(profile);

  if (type === "sheet") {
    if (checked) {
      standards.sheetMaterials[category] = id;
    } else if (standards.sheetMaterials[category] === id) {
      delete standards.sheetMaterials[category];
    }
  }

  if (type === "crown") {
    standards.crownMouldingId = checked ? id : "";
  }

  if (type === "boardStock") {
    standards.boardStockId = checked ? id : "";
  }

  if (type === "slide") {
    standards.drawerSlideId = checked ? id : "";
  }

  if (type === "hinge") {
    standards.hingeTypeId = checked ? id : "";
  }

  if (type === "basePlate") {
    standards.basePlateTypeId = checked ? id : "";
  }

  if (type === "doorStyle") {
    standards.doorStyleId = checked ? id : "";
  }

  if (type === "paint") {
    standards.paintTypeId = checked ? id : "";
  }

  if (type === "accessory") {
    const next = new Set(Array.isArray(standards.accessoryIds) ? standards.accessoryIds : []);
    if (checked) {
      next.add(id);
    } else {
      next.delete(id);
    }
    standards.accessoryIds = Array.from(next);
  }

  saveStandardSelections(profile, standards);

  if (byId("useStandardMaterialsSelect") && byId("useStandardMaterialsSelect").value === "yes") {
    applyStandardMaterials();
  }
}

function handleStandardToggle(event) {
  const target = event.target;
  if (!target || !target.dataset || !target.dataset.standardType) {
    return;
  }

  const profile = target.dataset.standardProfile || "faceFrame";

  if (target.type === "radio" && !target.checked) {
    return;
  }

  updateStandardSelection({
    profile,
    type: target.dataset.standardType,
    id: target.dataset.standardId,
    category: target.dataset.category,
    checked: target.checked
  });
}

async function updateCatalogItem({ listKey, id, updates, apiPath }) {
  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(apiPath, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      if (!res.ok) {
        throw new Error("Could not update item");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    const list = catalog[listKey] || [];
    const idx = list.findIndex((item) => item.id === id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...updates };
      catalog[listKey] = list;
      saveLocalCatalog(catalog);
    }
  }

  await refreshCatalogUi();
}

async function editMaterial(id) {
  const material = getMaterialById(id);
  if (!material) {
    return;
  }

  const name = prompt("Material name", material.name);
  if (!name) {
    return;
  }

  const thicknessRaw = prompt("Thickness (in)", String(material.thickness || ""));
  if (thicknessRaw === null) {
    return;
  }
  const thickness = parseDecimalOrFractionInches(thicknessRaw);
  if (thickness === null) {
    alert("Enter a valid thickness in inches.");
    return;
  }

  const lengthRaw = prompt("Sheet length (in)", String(material.length || ""));
  if (lengthRaw === null) {
    return;
  }
  const widthRaw = prompt("Sheet width (in)", String(material.width || ""));
  if (widthRaw === null) {
    return;
  }
  const costRaw = prompt("Cost per sheet", String(material.costPerSheet || ""));
  if (costRaw === null) {
    return;
  }

  const wasteRaw = prompt("Waste factor (%)", String(wastePercentForItem(material)));
  if (wasteRaw === null) {
    return;
  }
  const usedForRaw = prompt("Used for (carcass, back, finished end, toe kick, nailer, drawer box, drawer bottom)", panelUsedForLabel(material.category));
  if (usedForRaw === null) {
    return;
  }
  const wasteFactor = Math.max(0, toNumber(wasteRaw));
  const updatedCategory = normalizeCategoryInput(usedForRaw, material.category);

  await updateCatalogItem({
    listKey: "materials",
    id,
    apiPath: `/api/catalog/materials/${id}`,
    updates: {
      name: name.trim(),
      category: updatedCategory,
      thickness,
      length: Math.max(1, toNumber(lengthRaw)),
      width: Math.max(1, toNumber(widthRaw)),
      costPerSheet: Math.max(0, toNumber(costRaw)),
      wasteFactorPercent: wasteFactor,
      wasteMultiplier: 1 + (wasteFactor / 100)
    }
  });
}

async function editCrownMoulding(id) {
  const item = getCrownMouldingById(id);
  if (!item) {
    return;
  }

  const name = prompt("Crown moulding name", item.name);
  if (!name) {
    return;
  }
  const costRaw = prompt("Cost per LF", String(item.costPerLf || ""));
  if (costRaw === null) {
    return;
  }
  const wasteRaw = prompt("Waste factor (%)", String(item.wasteFactorPercent ?? round2(((item.wasteMultiplier || 1) - 1) * 100)));
  if (wasteRaw === null) {
    return;
  }
  const usedForRaw = prompt("Used for", String(item.usedFor || "Crown Moulding"));
  if (usedForRaw === null) {
    return;
  }

  const wasteFactor = Math.max(0, toNumber(wasteRaw));

  await updateCatalogItem({
    listKey: "crownMouldings",
    id,
    apiPath: `/api/catalog/crown-mouldings/${id}`,
    updates: {
      name: name.trim(),
      costPerLf: Math.max(0, toNumber(costRaw)),
      wasteFactorPercent: wasteFactor,
      wasteMultiplier: 1 + (wasteFactor / 100),
      usedFor: usedForRaw.trim() || "Crown Moulding"
    }
  });
}

async function editSlide(id) {
  const slide = getSlideById(id);
  if (!slide) {
    return;
  }
  const name = prompt("Slide name", slide.name);
  if (!name) {
    return;
  }
  const costRaw = prompt("Cost per pair", String(slide.costPerPair || ""));
  if (costRaw === null) {
    return;
  }
  const wasteRaw = prompt("Waste factor (%)", String(wastePercentForItem(slide)));
  if (wasteRaw === null) {
    return;
  }
  const wasteFactor = Math.max(0, toNumber(wasteRaw));

  await updateCatalogItem({
    listKey: "slides",
    id,
    apiPath: `/api/catalog/slides/${id}`,
    updates: {
      name: name.trim(),
      costPerPair: Math.max(0, toNumber(costRaw)),
      wasteFactorPercent: wasteFactor,
      wasteMultiplier: 1 + (wasteFactor / 100)
    }
  });
}

async function editAccessory(id) {
  const accessory = getAccessoryById(id);
  if (!accessory) {
    return;
  }
  const name = prompt("Accessory name", accessory.name);
  if (!name) {
    return;
  }
  const costRaw = prompt("Cost each", String(accessory.costEach || ""));
  if (costRaw === null) {
    return;
  }

  await updateCatalogItem({
    listKey: "accessories",
    id,
    apiPath: `/api/catalog/accessories/${id}`,
    updates: { name: name.trim(), costEach: Math.max(0, toNumber(costRaw)) }
  });
}

async function editDoorStyle(id) {
  const style = getDoorStyleById(id);
  if (!style) {
    return;
  }
  const name = prompt("Door style name", style.name);
  if (!name) {
    return;
  }
  const costRaw = prompt("Cost per sq ft", String(style.costPerSqFt || ""));
  if (costRaw === null) {
    return;
  }

  await updateCatalogItem({
    listKey: "doorStyles",
    id,
    apiPath: `/api/catalog/door-styles/${id}`,
    updates: { name: name.trim(), costPerSqFt: Math.max(0, toNumber(costRaw)) }
  });
}

async function editPaintType(id) {
  const paint = getPaintTypeById(id);
  if (!paint) {
    return;
  }
  const name = prompt("Paint type name", paint.name);
  if (!name) {
    return;
  }
  const primerRaw = prompt("Primer cost per gallon", String(paint.primerCostPerGallon || ""));
  if (primerRaw === null) {
    return;
  }
  const topRaw = prompt("Top coat cost per gallon", String(paint.topcoatCostPerGallon || ""));
  if (topRaw === null) {
    return;
  }

  await updateCatalogItem({
    listKey: "paintTypes",
    id,
    apiPath: `/api/catalog/paint-types/${id}`,
    updates: {
      name: name.trim(),
      primerCostPerGallon: Math.max(0, toNumber(primerRaw)),
      topcoatCostPerGallon: Math.max(0, toNumber(topRaw))
    }
  });
}

async function editHingeType(id) {
  const hinge = getHingeTypeById(id);
  if (!hinge) {
    return;
  }
  const name = prompt("Hinge type name", hinge.name);
  if (!name) {
    return;
  }
  const costRaw = prompt("Cost each", String(hinge.costEach || ""));
  if (costRaw === null) {
    return;
  }
  const wasteRaw = prompt("Waste factor (%)", String(wastePercentForItem(hinge)));
  if (wasteRaw === null) {
    return;
  }
  const wasteFactor = Math.max(0, toNumber(wasteRaw));

  await updateCatalogItem({
    listKey: "hingeTypes",
    id,
    apiPath: `/api/catalog/hinge-types/${id}`,
    updates: {
      name: name.trim(),
      costEach: Math.max(0, toNumber(costRaw)),
      wasteFactorPercent: wasteFactor,
      wasteMultiplier: 1 + (wasteFactor / 100)
    }
  });
}

async function editBasePlateType(id) {
  const basePlate = getBasePlateTypeById(id);
  if (!basePlate) {
    return;
  }
  const name = prompt("Base plate type name", basePlate.name);
  if (!name) {
    return;
  }
  const costRaw = prompt("Cost each", String(basePlate.costEach || ""));
  if (costRaw === null) {
    return;
  }
  const wasteRaw = prompt("Waste factor (%)", String(wastePercentForItem(basePlate)));
  if (wasteRaw === null) {
    return;
  }
  const wasteFactor = Math.max(0, toNumber(wasteRaw));

  await updateCatalogItem({
    listKey: "basePlateTypes",
    id,
    apiPath: `/api/catalog/base-plate-types/${id}`,
    updates: {
      name: name.trim(),
      costEach: Math.max(0, toNumber(costRaw)),
      wasteFactorPercent: wasteFactor,
      wasteMultiplier: 1 + (wasteFactor / 100)
    }
  });
}

async function editBoardStock(id) {
  const stock = getBoardStockById(id);
  if (!stock) {
    return;
  }
  const name = prompt("Board stock name", stock.name);
  if (!name) {
    return;
  }
  const costRaw = prompt("Cost per board foot", String(stock.costPerBdFt || ""));
  if (costRaw === null) {
    return;
  }
  const wasteRaw = prompt("Waste factor (%)", String(round2(Number(stock.wasteFactorPercent) || ((Number(stock.wasteMultiplier) || 1) - 1) * 100)));
  if (wasteRaw === null) {
    return;
  }
  const usedForRaw = prompt("Used for", String(stock.usedFor || "Face Frames"));
  if (usedForRaw === null) {
    return;
  }
  const wasteFactor = Math.max(0, toNumber(wasteRaw));

  await updateCatalogItem({
    listKey: "boardStocks",
    id,
    apiPath: `/api/catalog/board-stocks/${id}`,
    updates: {
      name: name.trim(),
      costPerBdFt: Math.max(0, toNumber(costRaw)),
      wasteFactorPercent: wasteFactor,
      wasteMultiplier: 1 + (wasteFactor / 100),
      usedFor: usedForRaw.trim() || "Face Frames"
    }
  });
}

function normalizeCatalog(catalog) {
  return {
    materials: Array.isArray(catalog.materials) ? catalog.materials : [],
    slides: Array.isArray(catalog.slides) ? catalog.slides : [],
    accessories: Array.isArray(catalog.accessories) ? catalog.accessories : [],
    doorStyles: Array.isArray(catalog.doorStyles) ? catalog.doorStyles : [],
    paintTypes: Array.isArray(catalog.paintTypes) ? catalog.paintTypes : [],
    hingeTypes: Array.isArray(catalog.hingeTypes) ? catalog.hingeTypes : [],
    basePlateTypes: Array.isArray(catalog.basePlateTypes) ? catalog.basePlateTypes : [],
    boardStocks: Array.isArray(catalog.boardStocks) ? catalog.boardStocks : [],
    crownMouldings: Array.isArray(catalog.crownMouldings) ? catalog.crownMouldings : [],
    constructionAssumptions: Array.isArray(catalog.constructionAssumptions) ? catalog.constructionAssumptions : []
  };
}

function defaultConstructionAssumptions() {
  return [
    {
      type: "faceFrame",
      name: "Face Frame",
      lowerHeight: 34.5,
      lowerDepth: 24,
      lowerTopType: "full",
      stretcherWidth: 4,
      upperHeight: 30,
      upperDepth: 12,
      tallHeight: 90,
      tallDepth: 24,
      avgWidth: 18,
      toeKickHeight: 4,
      nailerRipSize: 3
    },
    {
      type: "frameless",
      name: "Frameless / Euro",
      lowerHeight: 34.5,
      lowerDepth: 24,
      lowerTopType: "full",
      stretcherWidth: 4,
      upperHeight: 30,
      upperDepth: 12,
      tallHeight: 90,
      tallDepth: 24,
      avgWidth: 18,
      toeKickHeight: 4,
      nailerRipSize: 3
    }
  ];
}

function withDefaultConstructionAssumptions(catalog) {
  const defaults = defaultConstructionAssumptions();
  const existing = Array.isArray(catalog.constructionAssumptions) ? catalog.constructionAssumptions : [];

  return {
    ...catalog,
    constructionAssumptions: defaults.map((item) => ({
      ...item,
      ...(existing.find((x) => x.type === item.type) || {})
    }))
  };
}

function defaultBoardStocks() {
  return [
    { id: "default-alder", name: "Alder", costPerBdFt: 4.5, wasteFactorPercent: 0, wasteMultiplier: 1.0, usedFor: "Face Frames" },
    { id: "default-poplar", name: "Poplar", costPerBdFt: 3.5, wasteFactorPercent: 0, wasteMultiplier: 1.0, usedFor: "Face Frames" }
  ];
}

function localProjects() {
  const projects = readLocalJson(LOCAL_PROJECTS_KEY, []);
  return Array.isArray(projects) ? projects : [];
}

function saveLocalProjects(projects) {
  writeLocalJson(LOCAL_PROJECTS_KEY, projects);
}

function localCatalog() {
  let catalog = normalizeCatalog(readLocalJson(LOCAL_CATALOG_KEY, {
    materials: [],
    slides: [],
    accessories: [],
    doorStyles: [],
    paintTypes: [],
    hingeTypes: [],
    basePlateTypes: [],
    boardStocks: [],
    crownMouldings: [],
    constructionAssumptions: []
  }));

  catalog = withDefaultConstructionAssumptions(catalog);

  if (!catalog.boardStocks.length) {
    catalog.boardStocks = defaultBoardStocks();
  }

  saveLocalCatalog(catalog);

  return catalog;
}

function saveLocalCatalog(catalog) {
  writeLocalJson(LOCAL_CATALOG_KEY, normalizeCatalog(catalog));
}

async function ensureDataMode() {
  if (state.dataMode !== "unknown") {
    return state.dataMode;
  }

  try {
    const res = await fetch("/api/catalog");
    state.dataMode = res.ok ? "api" : "local";
  } catch (_err) {
    state.dataMode = "local";
  }

  return state.dataMode;
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseDecimalOrFractionInches(rawValue) {
  const raw = String(rawValue || "").trim();
  if (!raw) {
    return null;
  }

  const fractionToNumber = (text) => {
    const cleaned = text.replace(/\s+/g, "");
    const parts = cleaned.split("/");
    if (parts.length !== 2) {
      return null;
    }

    const numerator = Number(parts[0]);
    const denominator = Number(parts[1]);
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return null;
    }

    return numerator / denominator;
  };

  const mixedMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s+(-?\d+\s*\/\s*-?\d+)$/);
  if (mixedMatch) {
    const whole = Number(mixedMatch[1]);
    const frac = fractionToNumber(mixedMatch[2]);
    if (!Number.isFinite(whole) || frac === null) {
      return null;
    }
    const value = whole < 0 ? whole - Math.abs(frac) : whole + frac;
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  if (raw.includes("/")) {
    const fracValue = fractionToNumber(raw);
    return Number.isFinite(fracValue) && fracValue > 0 ? fracValue : null;
  }

  const decimalValue = Number(raw);
  return Number.isFinite(decimalValue) && decimalValue > 0 ? decimalValue : null;
}

function thicknessLabelInches(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  return `${round2(value)} in`;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function dollars(value) {
  return `$${round2(value).toFixed(2)}`;
}

function wastePercentForItem(item) {
  if (!item) {
    return 0;
  }
  if (Number.isFinite(Number(item.wasteFactorPercent))) {
    return Number(item.wasteFactorPercent);
  }
  if (Number.isFinite(Number(item.wasteMultiplier)) && Number(item.wasteMultiplier) > 0) {
    return round2((Number(item.wasteMultiplier) - 1) * 100);
  }
  return 0;
}

function panelUsedForLabel(category) {
  return CATEGORY_LABELS[category] || "-";
}

function normalizeCategoryInput(rawValue, fallback) {
  const raw = String(rawValue || "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  const map = {
    carcass: "carcass",
    back: "back",
    "finished end": "finishedEnd",
    "finished ends": "finishedEnd",
    toe: "toeKick",
    "toe kick": "toeKick",
    nailer: "nailer",
    nailers: "nailer",
    "drawer box": "drawerBox",
    "drawer bottom": "drawerBottom"
  };

  return map[raw] || fallback;
}

function defaultDrawerLinealInches() {
  return Math.max(0, toNumber(byId("lowerLF").value) * 12);
}

function drawerSetRowTemplate(set) {
  return `
    <div class="drawer-set-row" data-drawer-set-id="${set.id}" data-user-overridden="${set.userOverridden ? "true" : "false"}">
      <div class="drawer-set-grid">
        <label>Set Name
          <input class="drawer-set-name" type="text" value="${set.name}">
        </label>
        <label>Height (3-30 in)
          <input class="drawer-set-height" type="number" min="3" max="30" step="1" value="${set.height}">
        </label>
        <label>Lineal Inches
          <input class="drawer-set-lineal" type="number" min="0" step="0.01" value="${set.linealInches}">
        </label>
      </div>
      <div class="drawer-set-footer">
        <button type="button" class="mini-btn" data-remove-drawer-set="${set.id}">Remove</button>
      </div>
    </div>
  `;
}

function createDrawerSet(overrides = {}) {
  return {
    id: overrides.id || newId(),
    name: overrides.name || "Drawer Set",
    height: overrides.height !== undefined ? overrides.height : 5,
    linealInches: overrides.linealInches !== undefined ? overrides.linealInches : defaultDrawerLinealInches(),
    userOverridden: overrides.userOverridden === true
  };
}

function renderDrawerSets(sets) {
  const wrap = byId("drawerSetsWrap");
  wrap.innerHTML = sets.map((set) => drawerSetRowTemplate(set)).join("");
}

function ensureDrawerSetsWhenEnabled() {
  if (byId("hasDrawersSelect").value !== "yes") {
    return;
  }

  const sets = collectDrawerSets();
  if (!sets.length) {
    renderDrawerSets([createDrawerSet({ name: "Top Drawer", height: 5 })]);
  }
}

function handleDrawerModeChange() {
  const hasDrawers = byId("hasDrawersSelect").value === "yes";
  byId("howManyDrawersWrap").classList.toggle("hidden", !hasDrawers);
  byId("jobDrawerMaterialsHead").classList.toggle("hidden", !hasDrawers);
  byId("jobDrawerMaterialsWrap").classList.toggle("hidden", !hasDrawers);
  byId("drawerDepth").disabled = !hasDrawers;
  byId("addDrawerSetBtn").disabled = !hasDrawers;
  byId("drawerSetsWrap").classList.toggle("hidden", !hasDrawers);
  byId("addDrawerSetBtn").classList.toggle("hidden", !hasDrawers);

  if (!hasDrawers) {
    renderDrawerSets([]);
  } else {
    ensureDrawerSetsWhenEnabled();
    refreshAutoDrawerLineal();
  }
}

function collectDrawerSets() {
  const rows = Array.from(document.querySelectorAll("[data-drawer-set-id]"));
  return rows.map((row) => {
    const linealInput = row.querySelector(".drawer-set-lineal");
    const linealValue = Math.max(0, toNumber(linealInput.value));

    return {
      id: row.dataset.drawerSetId,
      name: row.querySelector(".drawer-set-name").value || "Drawer Set",
      height: Math.min(30, Math.max(3, toNumber(row.querySelector(".drawer-set-height").value))),
      linealInches: linealValue,
      userOverridden: row.dataset.userOverridden === "true"
    };
  });
}

function refreshAutoDrawerLineal() {
  if (byId("hasDrawersSelect").value !== "yes") {
    return;
  }

  const rows = Array.from(document.querySelectorAll("[data-drawer-set-id]"));
  const defaultLineal = defaultDrawerLinealInches();

  rows.forEach((row) => {
    const linealInput = row.querySelector(".drawer-set-lineal");
    const isOverridden = row.dataset.userOverridden === "true";
    if (!isOverridden || !linealInput.value) {
      linealInput.value = String(round2(defaultLineal));
    }
  });
}

function collectConstructionAssumptionFromInputs(type) {
  return {
    type,
    name: type === "faceFrame" ? "Face Frame" : "Frameless / Euro",
    lowerHeight: toNumber(byId("lowerHeight").value),
    lowerDepth: toNumber(byId("lowerDepth").value),
    lowerTopType: byId("lowerTopType").value,
    stretcherWidth: toNumber(byId("stretcherWidth").value),
    upperHeight: toNumber(byId("upperHeight").value),
    upperDepth: toNumber(byId("upperDepth").value),
    tallHeight: toNumber(byId("tallHeight").value),
    tallDepth: toNumber(byId("tallDepth").value),
    avgWidth: Math.max(1, toNumber(byId("avgWidth").value)),
    toeKickHeight: Math.max(1, toNumber(byId("toeKickHeight").value)),
    nailerRipSize: Math.max(1, toNumber(byId("nailerRipSize").value))
  };
}

function getConstructionAssumptionByType(type) {
  return state.catalog.constructionAssumptions.find((item) => item.type === type);
}

function applyConstructionAssumption(type) {
  const assumption = getConstructionAssumptionByType(type);
  if (!assumption) {
    return;
  }

  const map = {
    lowerHeight: assumption.lowerHeight,
    lowerDepth: assumption.lowerDepth,
    lowerTopType: assumption.lowerTopType,
    stretcherWidth: assumption.stretcherWidth,
    upperHeight: assumption.upperHeight,
    upperDepth: assumption.upperDepth,
    tallHeight: assumption.tallHeight,
    tallDepth: assumption.tallDepth,
    avgWidth: assumption.avgWidth,
    toeKickHeight: assumption.toeKickHeight,
    nailerRipSize: assumption.nailerRipSize
  };

  Object.keys(map).forEach((id) => {
    if (byId(id) && map[id] !== undefined) {
      byId(id).value = map[id];
    }
  });

  toggleStretcherField();
}

function updateConstructionTypeUi(type) {
  const isFaceFrame = type === "faceFrame";
  const boardStockWrap = byId("boardStockLabelWrap");
  if (boardStockWrap) {
    boardStockWrap.classList.toggle("hidden", !isFaceFrame);
  }
}

function setConstructionType(type, applyAssumption = true) {
  if (byId("constructionTypeSelect")) {
    byId("constructionTypeSelect").value = type;
  }
  if (byId("jobConstructionTypeSelect")) {
    byId("jobConstructionTypeSelect").value = type;
  }

  updateConstructionTypeUi(type);

  if (applyAssumption) {
    applyConstructionAssumption(type);
  }

  if (byId("useStandardMaterialsSelect") && byId("useStandardMaterialsSelect").value === "yes") {
    applyStandardMaterials();
  }
}

async function saveConstructionAssumption() {
  const type = byId("constructionTypeSelect").value;
  const payload = collectConstructionAssumptionFromInputs(type);

  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(`/api/catalog/construction-assumptions/${type}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error("Could not save construction assumption");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.constructionAssumptions = catalog.constructionAssumptions.filter((item) => item.type !== type);
    catalog.constructionAssumptions.push(payload);
    catalog.constructionAssumptions = withDefaultConstructionAssumptions(catalog).constructionAssumptions;
    saveLocalCatalog(catalog);
  }

  await refreshCatalogUi();
  applyConstructionAssumption(type);
  calculate();
  alert("Construction assumption saved.");
}

function collectSettings() {
  const hasDrawers = byId("hasDrawersSelect").value === "yes";
  const constructionTypeInput = byId("jobConstructionTypeSelect") || byId("constructionTypeSelect");

  return {
    lowerHeight: toNumber(byId("lowerHeight").value),
    lowerDepth: toNumber(byId("lowerDepth").value),
    lowerTopType: byId("lowerTopType").value,
    stretcherWidth: toNumber(byId("stretcherWidth").value),
    lowerLF: toNumber(byId("lowerLF").value),
    lowerFinishedEndsQty: Math.max(0, toNumber(byId("lowerFinishedEndsQty").value)),
    upperHeight: toNumber(byId("upperHeight").value),
    upperDepth: toNumber(byId("upperDepth").value),
    upperLF: toNumber(byId("upperLF").value),
    upperFinishedEndsQty: Math.max(0, toNumber(byId("upperFinishedEndsQty").value)),
    tallHeight: toNumber(byId("tallHeight").value),
    tallDepth: toNumber(byId("tallDepth").value),
    tallLF: toNumber(byId("tallLF").value),
    tallFinishedEndsQty: Math.max(0, toNumber(byId("tallFinishedEndsQty").value)),
    constructionType: constructionTypeInput ? constructionTypeInput.value : "faceFrame",
    avgWidth: Math.max(1, toNumber(byId("avgWidth").value)),
    hasDrawers,
    totalDrawerCount: hasDrawers ? Math.max(0, toNumber(byId("howManyDrawers").value)) : 0,
    totalDoorCount: Math.max(0, toNumber(byId("totalDoorCount").value)),
    drawerDepth: Math.max(1, toNumber(byId("drawerDepth").value)),
    drawerSets: hasDrawers ? collectDrawerSets() : [],
    jobAccessories: state.jobAccessories,
    wasteFactorPercent: Math.max(0, toNumber(byId("wasteFactorPercent").value)),
    buildLfPerHour: Math.max(0.01, toNumber(byId("buildLfPerHour").value)),
    installLfPerHour: Math.max(0.01, toNumber(byId("installLfPerHour").value)),
    finishLfPerHour: Math.max(0.01, toNumber(byId("finishLfPerHour").value)),
    shopCostPerHour: Math.max(0, toNumber(byId("shopCostPerHour").value)),
    includeBuild: byId("includeBuildSelect").value === "yes",
    includeInstall: byId("includeInstallSelect").value === "yes",
    includeFinish: byId("includeFinishSelect").value === "yes",
    useStandardMaterials: byId("useStandardMaterialsSelect").value === "yes",
    toeKickHeight: Math.max(1, toNumber(byId("toeKickHeight").value)),
    toeKickSleeperSpacing: Math.max(1, toNumber(byId("toeKickSleeperSpacing").value)),
    nailerRipSize: Math.max(1, toNumber(byId("nailerRipSize").value))
  };
}

function collectSelections() {
  return {
    carcassMaterialId: byId("carcassMaterialSelect").value || "",
    backMaterialId: byId("backMaterialSelect").value || "",
    finishedEndMaterialId: byId("finishedEndMaterialSelect").value || "",
    drawerBoxMaterialId: byId("drawerBoxMaterialSelect").value || "",
    drawerBottomMaterialId: byId("drawerBottomMaterialSelect").value || "",
    drawerSlideId: byId("drawerSlideSelect").value || "",
    doorStyleId: byId("doorStyleSelect").value || "",
    paintTypeId: byId("paintTypeSelect").value || "",
    hingeTypeId: byId("hingeTypeSelect").value || "",
    basePlateTypeId: byId("basePlateTypeSelect").value || "",
    boardStockId: byId("boardStockSelect").value || "",
    toeKickMaterialId: byId("toeKickMaterialSelect").value || "",
    nailerMaterialId: byId("nailerMaterialSelect").value || "",
    crownMaterialId: byId("crownMaterialSelect").value || ""
  };
}

function applyProject(project) {
  const settings = project.settings || {};
  const selections = project.selections || {};

  const map = {
    lowerHeight: settings.lowerHeight,
    lowerDepth: settings.lowerDepth,
    lowerTopType: settings.lowerTopType,
    stretcherWidth: settings.stretcherWidth,
    lowerLF: settings.lowerLF,
    lowerFinishedEndsQty: settings.lowerFinishedEndsQty,
    upperHeight: settings.upperHeight,
    upperDepth: settings.upperDepth,
    upperLF: settings.upperLF,
    upperFinishedEndsQty: settings.upperFinishedEndsQty,
    tallHeight: settings.tallHeight,
    tallDepth: settings.tallDepth,
    tallLF: settings.tallLF,
    tallFinishedEndsQty: settings.tallFinishedEndsQty,
    constructionTypeSelect: settings.constructionType || "faceFrame",
    jobConstructionTypeSelect: settings.constructionType || "faceFrame",
    avgWidth: settings.avgWidth,
    hasDrawersSelect: settings.hasDrawers === false ? "no" : "yes",
    howManyDrawers: settings.totalDrawerCount,
    totalDoorCount: settings.totalDoorCount,
    drawerDepth: settings.drawerDepth,
    wasteFactorPercent: settings.wasteFactorPercent,
    buildLfPerHour: settings.buildLfPerHour,
    installLfPerHour: settings.installLfPerHour,
    finishLfPerHour: settings.finishLfPerHour,
    shopCostPerHour: settings.shopCostPerHour,
    includeBuildSelect: settings.includeBuild === false ? "no" : "yes",
    includeInstallSelect: settings.includeInstall === false ? "no" : "yes",
    includeFinishSelect: settings.includeFinish === false ? "no" : "yes",
    useStandardMaterialsSelect: settings.useStandardMaterials === true ? "yes" : "no",
    carcassMaterialSelect: selections.carcassMaterialId,
    backMaterialSelect: selections.backMaterialId,
    finishedEndMaterialSelect: selections.finishedEndMaterialId,
    drawerBoxMaterialSelect: selections.drawerBoxMaterialId,
    drawerBottomMaterialSelect: selections.drawerBottomMaterialId,
    drawerSlideSelect: selections.drawerSlideId,
    doorStyleSelect: selections.doorStyleId,
    paintTypeSelect: selections.paintTypeId,
    hingeTypeSelect: selections.hingeTypeId,
    basePlateTypeSelect: selections.basePlateTypeId,
    boardStockSelect: selections.boardStockId,
    toeKickMaterialSelect: selections.toeKickMaterialId,
    nailerMaterialSelect: selections.nailerMaterialId,
    crownMaterialSelect: selections.crownMaterialId
  };

  Object.keys(map).forEach((id) => {
    if (map[id] !== undefined && byId(id)) {
      if (typeof map[id] === "boolean") {
        byId(id).checked = map[id];
      } else {
        byId(id).value = map[id];
      }
    }
  });

  const savedSets = Array.isArray(settings.drawerSets) ? settings.drawerSets : [];
  if (savedSets.length) {
    renderDrawerSets(savedSets.map((s) => createDrawerSet(s)));
  } else if (settings.hasDrawers !== false) {
    // Backward compatibility for older projects that stored one drawer profile.
    const legacySet = createDrawerSet({
      name: "Drawer Set",
      height: settings.drawerHeight || 5,
      linealInches: settings.drawerLinealInches !== undefined ? settings.drawerLinealInches : defaultDrawerLinealInches(),
      userOverridden: true
    });
    renderDrawerSets([legacySet]);
  } else {
    renderDrawerSets([]);
  }

  state.jobAccessories = Array.isArray(settings.jobAccessories) ? settings.jobAccessories : [];
  renderJobAccessoryList();

  refreshAutoDrawerLineal();

  byId("projectName").value = project.name || "";
  setConstructionType(settings.constructionType || "faceFrame", true);
  if (byId("useStandardMaterialsSelect").value === "yes") {
    applyStandardMaterials();
  }
  toggleStretcherField();
  handleDrawerModeChange();
  calculate();
}

function applyStandardMaterials() {
  const profile = (byId("jobConstructionTypeSelect") && byId("jobConstructionTypeSelect").value)
    || (byId("constructionTypeSelect") && byId("constructionTypeSelect").value)
    || "faceFrame";
  const standards = getStandardSelections(profile);
  const sheetMap = {
    carcassMaterialSelect: standards.sheetMaterials.carcass,
    backMaterialSelect: standards.sheetMaterials.back,
    finishedEndMaterialSelect: standards.sheetMaterials.finishedEnd,
    toeKickMaterialSelect: standards.sheetMaterials.toeKick,
    nailerMaterialSelect: standards.sheetMaterials.nailer,
    drawerBoxMaterialSelect: standards.sheetMaterials.drawerBox,
    drawerBottomMaterialSelect: standards.sheetMaterials.drawerBottom
  };

  Object.keys(sheetMap).forEach((id) => {
    if (sheetMap[id] && byId(id)) {
      byId(id).value = sheetMap[id];
    }
  });

  if (standards.crownMouldingId && byId("crownMaterialSelect")) {
    byId("crownMaterialSelect").value = standards.crownMouldingId;
  }
  if (standards.boardStockId && byId("boardStockSelect")) {
    byId("boardStockSelect").value = standards.boardStockId;
  }
  if (standards.drawerSlideId && byId("drawerSlideSelect")) {
    byId("drawerSlideSelect").value = standards.drawerSlideId;
  }
  if (standards.hingeTypeId && byId("hingeTypeSelect")) {
    byId("hingeTypeSelect").value = standards.hingeTypeId;
  }
  if (standards.basePlateTypeId && byId("basePlateTypeSelect")) {
    byId("basePlateTypeSelect").value = standards.basePlateTypeId;
  }
  if (standards.doorStyleId && byId("doorStyleSelect")) {
    byId("doorStyleSelect").value = standards.doorStyleId;
  }
  if (standards.paintTypeId && byId("paintTypeSelect")) {
    byId("paintTypeSelect").value = standards.paintTypeId;
  }

  if (Array.isArray(standards.accessoryIds) && standards.accessoryIds.length) {
    standards.accessoryIds.forEach((accessoryId) => {
      if (!state.jobAccessories.some((row) => row.accessoryId === accessoryId)) {
        state.jobAccessories.push({ rowId: newId(), accessoryId, qty: 1 });
      }
    });
    renderJobAccessoryList();
  }

  calculate();
}

function switchTab(tabName) {
  const isCalc = tabName === "calculator";
  const isStandards = tabName === "cabinetStandards";
  const isMaterial = tabName === "material";
  const isLabor = tabName === "labor";

  byId("calculatorTab").classList.toggle("hidden", !isCalc);
  byId("cabinetStandardsTab").classList.toggle("hidden", !isStandards);
  byId("materialSetupTab").classList.toggle("hidden", !isMaterial);
  byId("laborSetupTab").classList.toggle("hidden", !isLabor);
  byId("resultsSection").classList.toggle("hidden", !isCalc);

  byId("calculatorTabBtn").classList.toggle("active", isCalc);
  byId("cabinetStandardsTabBtn").classList.toggle("active", isStandards);
  byId("materialSetupTabBtn").classList.toggle("active", isMaterial);
  byId("laborSetupTabBtn").classList.toggle("active", isLabor);
}

function switchMaterialSubTab(tabName) {
  const map = {
    panelStock: "panelStockTab",
    boardStock: "boardStockTab",
    hardware: "hardwareTab",
    doors: "doorsTab",
    paint: "paintTab",
    moulding: "mouldingTab",
    accessories: "accessoriesTab",
    defaults: "defaultsTab"
  };

  Object.keys(map).forEach((key) => {
    const panel = byId(map[key]);
    const btn = byId(`${key}TabBtn`);
    if (panel) {
      panel.classList.toggle("hidden", key !== tabName);
    }
    if (btn) {
      btn.classList.toggle("active", key === tabName);
    }
  });
}

async function fetchProjects() {
  if (await ensureDataMode() === "local") {
    return localProjects();
  }

  try {
    const res = await fetch("/api/projects");
    if (!res.ok) {
      throw new Error("Failed to load projects");
    }
    return res.json();
  } catch (_err) {
    state.dataMode = "local";
    return localProjects();
  }
}

async function fetchCatalog() {
  if (await ensureDataMode() === "local") {
    return localCatalog();
  }

  try {
    const res = await fetch("/api/catalog");
    if (!res.ok) {
      throw new Error("Failed to load catalog");
    }
    return res.json();
  } catch (_err) {
    state.dataMode = "local";
    return localCatalog();
  }
}

async function populateProjects() {
  const select = byId("projectSelect");
  const projects = await fetchProjects();

  select.innerHTML = '<option value="">Select a saved project</option>';
  projects.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name} (${new Date(p.updatedAt).toLocaleDateString()})`;
    select.appendChild(opt);
  });
}

function materialOptionLabel(m) {
  return `${m.name} - ${thicknessLabelInches(m.thickness)} thick - ${m.length}x${m.width} in - ${dollars(m.costPerSheet)}/sheet`;
}

function fillMaterialSelect(selectId, category, selectedValue) {
  const select = byId(selectId);
  const items = state.catalog.materials.filter((m) => m.category === category);

  if (items.length === 0) {
    select.innerHTML = `<option value="">⚠ Add ${CATEGORY_LABELS[category].toLowerCase()} in Material Setup</option>`;
    return;
  }

  select.innerHTML = `<option value="">Select ${CATEGORY_LABELS[category].toLowerCase()} material</option>`;
  items.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = materialOptionLabel(m);
    if (selectedValue && selectedValue === m.id) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function fillCrownMouldingSelect(selectedValue) {
  const select = byId("crownMaterialSelect");
  if (!select) {
    return;
  }

  if (state.catalog.crownMouldings.length === 0) {
    select.innerHTML = '<option value="">⚠ Add crown moulding in Material Setup</option>';
    return;
  }

  select.innerHTML = '<option value="">Select crown moulding material</option>';
  state.catalog.crownMouldings.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = `${item.name} - ${dollars(item.costPerLf)}/LF`;
    if (selectedValue && selectedValue === item.id) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

function populateSelectionDropdowns() {
  const previous = collectSelections();

  fillMaterialSelect("carcassMaterialSelect", "carcass", previous.carcassMaterialId);
  fillMaterialSelect("backMaterialSelect", "back", previous.backMaterialId);
  fillMaterialSelect("finishedEndMaterialSelect", "finishedEnd", previous.finishedEndMaterialId);
  fillMaterialSelect("drawerBoxMaterialSelect", "drawerBox", previous.drawerBoxMaterialId);
  fillMaterialSelect("drawerBottomMaterialSelect", "drawerBottom", previous.drawerBottomMaterialId);
  fillMaterialSelect("toeKickMaterialSelect", "toeKick", previous.toeKickMaterialId);
  fillMaterialSelect("nailerMaterialSelect", "nailer", previous.nailerMaterialId);
  fillCrownMouldingSelect(previous.crownMaterialId);

  const slideSelect = byId("drawerSlideSelect");
  if (state.catalog.slides.length === 0) {
    slideSelect.innerHTML = '<option value="">⚠ Add drawer slides in Material Setup</option>';
  } else {
    slideSelect.innerHTML = '<option value="">Select drawer slide</option>';
    state.catalog.slides.forEach((slide) => {
      const opt = document.createElement("option");
      opt.value = slide.id;
      opt.textContent = `${slide.name} - ${dollars(slide.costPerPair)} total/pair`;
      if (previous.drawerSlideId && previous.drawerSlideId === slide.id) {
        opt.selected = true;
      }
      slideSelect.appendChild(opt);
    });
  }

  const accessorySelect = byId("jobAccessorySelect");
  accessorySelect.innerHTML = '<option value="">Select accessory</option>';
  state.catalog.accessories.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.id;
    opt.textContent = `${item.name} - ${dollars(item.costEach)} each`;
    accessorySelect.appendChild(opt);
  });

  const doorStyleSelect = byId("doorStyleSelect");
  if (state.catalog.doorStyles.length === 0) {
    doorStyleSelect.innerHTML = '<option value="">⚠ Add door styles in Material Setup</option>';
  } else {
    doorStyleSelect.innerHTML = '<option value="">Select door style</option>';
    state.catalog.doorStyles.forEach((style) => {
      const opt = document.createElement("option");
      opt.value = style.id;
      opt.textContent = `${style.name} - ${dollars(style.costPerSqFt)}/sq ft`;
      if (previous.doorStyleId && previous.doorStyleId === style.id) {
        opt.selected = true;
      }
      doorStyleSelect.appendChild(opt);
    });
  }

  const paintTypeSelect = byId("paintTypeSelect");
  if (state.catalog.paintTypes.length === 0) {
    paintTypeSelect.innerHTML = '<option value="">⚠ Add paint types in Material Setup</option>';
  } else {
    paintTypeSelect.innerHTML = '<option value="">Select paint type</option>';
    state.catalog.paintTypes.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.name} - Primer ${dollars(item.primerCostPerGallon)}/gal, Top ${dollars(item.topcoatCostPerGallon)}/gal`;
      if (previous.paintTypeId && previous.paintTypeId === item.id) {
        opt.selected = true;
      }
      paintTypeSelect.appendChild(opt);
    });
  }

  const hingeTypeSelect = byId("hingeTypeSelect");
  if (state.catalog.hingeTypes.length === 0) {
    hingeTypeSelect.innerHTML = '<option value="">⚠ Add hinge types in Material Setup</option>';
  } else {
    hingeTypeSelect.innerHTML = '<option value="">Select hinge type</option>';
    state.catalog.hingeTypes.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.name} - ${dollars(item.costEach)} each`;
      if (previous.hingeTypeId && previous.hingeTypeId === item.id) {
        opt.selected = true;
      }
      hingeTypeSelect.appendChild(opt);
    });
  }

  const basePlateTypeSelect = byId("basePlateTypeSelect");
  if (state.catalog.basePlateTypes.length === 0) {
    basePlateTypeSelect.innerHTML = '<option value="">⚠ Add base plate types in Material Setup</option>';
  } else {
    basePlateTypeSelect.innerHTML = '<option value="">Select base plate type</option>';
    state.catalog.basePlateTypes.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.name} - ${dollars(item.costEach)} each`;
      if (previous.basePlateTypeId && previous.basePlateTypeId === item.id) {
        opt.selected = true;
      }
      basePlateTypeSelect.appendChild(opt);
    });
  }

  const boardStockSelect = byId("boardStockSelect");
  if (state.catalog.boardStocks.length === 0) {
    boardStockSelect.innerHTML = '<option value="">⚠ Add board stock in Material Setup</option>';
  } else {
    boardStockSelect.innerHTML = '<option value="">Select board stock</option>';
    state.catalog.boardStocks.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item.id;
      opt.textContent = `${item.name} - ${dollars(item.costPerBdFt)}/bd ft`;
      if (previous.boardStockId && previous.boardStockId === item.id) {
        opt.selected = true;
      }
      boardStockSelect.appendChild(opt);
    });
  }
}

function renderPanelStockTable() {
  const body = byId("panelStockTableBody");
  const items = state.catalog.materials.filter((m) => CATEGORY_LABELS[m.category]);

  if (!items.length) {
    body.innerHTML = '<tr><td colspan="8" class="meta">No panel stock added yet.</td></tr>';
    return;
  }

  body.innerHTML = items.map((m) => `
    <tr>
      <td><strong>${m.name}</strong></td>
      <td>${thicknessLabelInches(m.thickness)}</td>
      <td>${round2(m.width)} in</td>
      <td>${round2(m.length)} in</td>
      <td>${dollars(m.costPerSheet)}</td>
      <td>${round2(wastePercentForItem(m))}%</td>
      <td>${panelUsedForLabel(m.category)}</td>
      <td>
        <div class="action-cell">
          <button type="button" class="mini-btn" data-edit-panel-id="${m.id}">Edit</button>
          <button type="button" class="mini-btn" data-panel-id="${m.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderMouldingTable() {
  const body = byId("mouldingTableBody");
  if (!body) {
    return;
  }

  if (!state.catalog.crownMouldings.length) {
    body.innerHTML = '<tr><td colspan="5" class="meta">No moulding added yet.</td></tr>';
    return;
  }

  body.innerHTML = state.catalog.crownMouldings.map((item) => `
    <tr>
      <td><strong>${item.name}</strong></td>
      <td>${dollars(item.costPerLf)}/LF</td>
      <td>${round2(wastePercentForItem(item))}%</td>
      <td>${item.usedFor ? String(item.usedFor) : "Crown Moulding"}</td>
      <td>
        <div class="action-cell">
          <button type="button" class="mini-btn" data-edit-moulding-id="${item.id}">Edit</button>
          <button type="button" class="mini-btn" data-moulding-id="${item.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderHardwareTable() {
  const body = byId("hardwareTableBody");
  const rows = [];

  state.catalog.slides.forEach((item) => {
    rows.push({
      id: item.id,
      type: "slides",
      name: item.name,
      price: `${dollars(item.costPerPair)}/pair`,
      waste: `${round2(wastePercentForItem(item))}%`,
      usedFor: HARDWARE_USE_LABELS.slides
    });
  });

  state.catalog.hingeTypes.forEach((item) => {
    rows.push({
      id: item.id,
      type: "hinges",
      name: item.name,
      price: `${dollars(item.costEach)}/each`,
      waste: `${round2(wastePercentForItem(item))}%`,
      usedFor: HARDWARE_USE_LABELS.hinges
    });
  });

  state.catalog.basePlateTypes.forEach((item) => {
    rows.push({
      id: item.id,
      type: "basePlates",
      name: item.name,
      price: `${dollars(item.costEach)}/each`,
      waste: `${round2(wastePercentForItem(item))}%`,
      usedFor: HARDWARE_USE_LABELS.basePlates
    });
  });

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="meta">No hardware added yet.</td></tr>';
    return;
  }

  body.innerHTML = rows.map((row) => `
    <tr>
      <td><strong>${row.name}</strong></td>
      <td>${row.price}</td>
      <td>${row.waste}</td>
      <td>${row.usedFor}</td>
      <td>
        <div class="action-cell">
          <button type="button" class="mini-btn" data-edit-hardware-id="${row.id}" data-hardware-type="${row.type}">Edit</button>
          <button type="button" class="mini-btn" data-hardware-id="${row.id}" data-hardware-type="${row.type}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderAccessoryTable() {
  const body = byId("accessoryTableBody");
  if (!state.catalog.accessories.length) {
    body.innerHTML = '<tr><td colspan="3" class="meta">No accessories added yet.</td></tr>';
    return;
  }

  body.innerHTML = state.catalog.accessories.map((item) => `
    <tr>
      <td><strong>${item.name}</strong></td>
      <td>${dollars(item.costEach)}</td>
      <td>
        <div class="action-cell">
          <button type="button" class="mini-btn" data-edit-accessory-id="${item.id}">Edit</button>
          <button type="button" class="mini-btn" data-accessory-id="${item.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}


function renderDoorTable() {
  const body = byId("doorTableBody");
  if (!state.catalog.doorStyles.length) {
    body.innerHTML = '<tr><td colspan="3" class="meta">No door styles added yet.</td></tr>';
    return;
  }

  body.innerHTML = state.catalog.doorStyles.map((style) => `
    <tr>
      <td><strong>${style.name}</strong></td>
      <td>${dollars(style.costPerSqFt)}/sq ft</td>
      <td>
        <div class="action-cell">
          <button type="button" class="mini-btn" data-edit-door-style-id="${style.id}">Edit</button>
          <button type="button" class="mini-btn" data-door-style-id="${style.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderPaintTable() {
  const body = byId("paintTableBody");
  if (!state.catalog.paintTypes.length) {
    body.innerHTML = '<tr><td colspan="4" class="meta">No paint types added yet.</td></tr>';
    return;
  }

  body.innerHTML = state.catalog.paintTypes.map((item) => `
    <tr>
      <td><strong>${item.name}</strong></td>
      <td>${dollars(item.primerCostPerGallon)}/gal</td>
      <td>${dollars(item.topcoatCostPerGallon)}/gal</td>
      <td>
        <div class="action-cell">
          <button type="button" class="mini-btn" data-edit-paint-type-id="${item.id}">Edit</button>
          <button type="button" class="mini-btn" data-paint-type-id="${item.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderBoardStockTable() {
  const body = byId("boardStockTableBody");
  if (!state.catalog.boardStocks.length) {
    body.innerHTML = '<tr><td colspan="5" class="meta">No board stock added yet.</td></tr>';
    return;
  }

  body.innerHTML = state.catalog.boardStocks.map((item) => `
    <tr>
      <td><strong>${item.name}</strong></td>
      <td>${dollars(item.costPerBdFt)}/bd ft</td>
      <td>${round2(wastePercentForItem(item))}%</td>
      <td>${item.usedFor || "Face Frames"}</td>
      <td>
        <div class="action-cell">
          <button type="button" class="mini-btn" data-edit-board-stock-id="${item.id}">Edit</button>
          <button type="button" class="mini-btn" data-board-stock-id="${item.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function getAccessoryById(id) {
  return state.catalog.accessories.find((a) => a.id === id);
}

function getCrownMouldingById(id) {
  return state.catalog.crownMouldings.find((item) => item.id === id);
}

function renderJobAccessoryList() {
  const wrap = byId("jobAccessoryList");
  if (!state.jobAccessories.length) {
    wrap.innerHTML = '<p class="meta">No accessories added to this job.</p>';
    return;
  }

  wrap.innerHTML = state.jobAccessories.map((item) => {
    const accessory = getAccessoryById(item.accessoryId);
    const name = accessory ? accessory.name : "Unknown Accessory";
    const unitCost = accessory ? accessory.costEach : 0;
    const lineCost = unitCost * item.qty;

    return `
      <div class="list-item">
        <div class="list-item-row"><strong>${name}</strong><button type="button" class="mini-btn" data-remove-job-accessory="${item.rowId}">Remove</button></div>
        <div class="meta">Qty ${round2(item.qty)} x ${dollars(unitCost)} = ${dollars(lineCost)}</div>
      </div>
    `;
  }).join("");
}

function renderDefaultsPanelStock(profile, standards) {
  const wrap = byId("defaultPanelStockList");
  if (!wrap) {
    return;
  }

  const categories = Object.keys(CATEGORY_LABELS);
  wrap.innerHTML = categories.map((category) => {
    const items = state.catalog.materials.filter((m) => m.category === category);
    const options = items.length
      ? items.map((item) => `
          <option value="${item.id}">${item.name}</option>
        `).join("")
      : "";

    return `
      <label class="list-item">
        <strong>${CATEGORY_LABELS[category]}</strong>
        <select data-standard-profile="${profile}" data-standard-type="sheet" data-category="${category}" ${items.length ? "" : "disabled"}>
          <option value="">${items.length ? "Select" : "No materials yet"}</option>
          ${options}
        </select>
      </label>
    `;
  }).join("");

  categories.forEach((category) => {
    const select = wrap.querySelector(`select[data-category="${category}"]`);
    if (select) {
      select.value = standards.sheetMaterials[category] || "";
    }
  });
}

function renderDefaultsBoardStock(profile, standards) {
  const wrap = byId("defaultBoardStockList");
  if (!wrap) {
    return;
  }

  if (!state.catalog.boardStocks.length) {
    wrap.innerHTML = '<p class="meta">No board stock yet.</p>';
    return;
  }

  wrap.innerHTML = `
    <label class="list-item">
      <strong>Board Stock</strong>
      <select data-standard-profile="${profile}" data-standard-type="boardStock">
        <option value="">Select</option>
        ${state.catalog.boardStocks.map((item) => `
          <option value="${item.id}">${item.name} - ${dollars(item.costPerBdFt)}/bd ft</option>
        `).join("")}
      </select>
    </label>
  `;

  const select = wrap.querySelector("select");
  if (select) {
    select.value = standards.boardStockId || "";
  }
}

function renderDefaultsHardware(profile, standards) {
  const wrap = byId("defaultHardwareList");
  if (!wrap) {
    return;
  }

  wrap.innerHTML = `
    <label class="list-item">
      <strong>${HARDWARE_USE_LABELS.slides}</strong>
      <select data-standard-profile="${profile}" data-standard-type="slide" ${state.catalog.slides.length ? "" : "disabled"}>
        <option value="">${state.catalog.slides.length ? "Select" : "No drawer slides yet"}</option>
        ${state.catalog.slides.map((item) => `
          <option value="${item.id}">${item.name}</option>
        `).join("")}
      </select>
    </label>
    <label class="list-item">
      <strong>${HARDWARE_USE_LABELS.hinges}</strong>
      <select data-standard-profile="${profile}" data-standard-type="hinge" ${state.catalog.hingeTypes.length ? "" : "disabled"}>
        <option value="">${state.catalog.hingeTypes.length ? "Select" : "No hinges yet"}</option>
        ${state.catalog.hingeTypes.map((item) => `
          <option value="${item.id}">${item.name}</option>
        `).join("")}
      </select>
    </label>
    <label class="list-item">
      <strong>${HARDWARE_USE_LABELS.basePlates}</strong>
      <select data-standard-profile="${profile}" data-standard-type="basePlate" ${state.catalog.basePlateTypes.length ? "" : "disabled"}>
        <option value="">${state.catalog.basePlateTypes.length ? "Select" : "No base plates yet"}</option>
        ${state.catalog.basePlateTypes.map((item) => `
          <option value="${item.id}">${item.name}</option>
        `).join("")}
      </select>
    </label>
  `;

  const slideSelect = wrap.querySelector('select[data-standard-type="slide"]');
  if (slideSelect) {
    slideSelect.value = standards.drawerSlideId || "";
  }
  const hingeSelect = wrap.querySelector('select[data-standard-type="hinge"]');
  if (hingeSelect) {
    hingeSelect.value = standards.hingeTypeId || "";
  }
  const baseSelect = wrap.querySelector('select[data-standard-type="basePlate"]');
  if (baseSelect) {
    baseSelect.value = standards.basePlateTypeId || "";
  }
}

function renderDefaultsDoorPaint(profile, standards) {
  const doorWrap = byId("defaultDoorList");
  const paintWrap = byId("defaultPaintList");
  if (!doorWrap || !paintWrap) {
    return;
  }

  if (!state.catalog.doorStyles.length) {
    doorWrap.innerHTML = '<p class="meta">No door styles yet.</p>';
  } else {
    doorWrap.innerHTML = `
      <label class="list-item">
        <strong>Door Style</strong>
        <select data-standard-profile="${profile}" data-standard-type="doorStyle">
          <option value="">Select</option>
          ${state.catalog.doorStyles.map((item) => `
            <option value="${item.id}">${item.name} - ${dollars(item.costPerSqFt)}/sq ft</option>
          `).join("")}
        </select>
      </label>
    `;
    const select = doorWrap.querySelector("select");
    if (select) {
      select.value = standards.doorStyleId || "";
    }
  }

  if (!state.catalog.paintTypes.length) {
    paintWrap.innerHTML = '<p class="meta">No paint types yet.</p>';
  } else {
    paintWrap.innerHTML = `
      <label class="list-item">
        <strong>Paint Type</strong>
        <select data-standard-profile="${profile}" data-standard-type="paint">
          <option value="">Select</option>
          ${state.catalog.paintTypes.map((item) => `
            <option value="${item.id}">${item.name} - Primer ${dollars(item.primerCostPerGallon)}/gal, Top ${dollars(item.topcoatCostPerGallon)}/gal</option>
          `).join("")}
        </select>
      </label>
    `;
    const select = paintWrap.querySelector("select");
    if (select) {
      select.value = standards.paintTypeId || "";
    }
  }
}

function renderDefaultsMoulding(profile, standards) {
  const wrap = byId("defaultMouldingList");
  if (!wrap) {
    return;
  }

  if (!state.catalog.crownMouldings.length) {
    wrap.innerHTML = '<p class="meta">No moulding yet.</p>';
    return;
  }

  wrap.innerHTML = `
    <label class="list-item">
      <strong>Moulding</strong>
      <select data-standard-profile="${profile}" data-standard-type="crown">
        <option value="">Select</option>
        ${state.catalog.crownMouldings.map((item) => `
          <option value="${item.id}">${item.name} - ${dollars(item.costPerLf)}/LF</option>
        `).join("")}
      </select>
    </label>
  `;

  const select = wrap.querySelector("select");
  if (select) {
    select.value = standards.crownMouldingId || "";
  }
}

function renderDefaultsUi() {
  const profileSelect = byId("defaultsProfileSelect");
  const profile = profileSelect ? profileSelect.value : "faceFrame";
  const standards = getStandardSelections(profile);

  renderDefaultsPanelStock(profile, standards);
  renderDefaultsBoardStock(profile, standards);
  renderDefaultsHardware(profile, standards);
  renderDefaultsDoorPaint(profile, standards);
  renderDefaultsMoulding(profile, standards);
}

function getMaterialById(id) {
  return state.catalog.materials.find((m) => m.id === id);
}

function getSlideById(id) {
  return state.catalog.slides.find((s) => s.id === id);
}

function getDoorStyleById(id) {
  return state.catalog.doorStyles.find((style) => style.id === id);
}

function getPaintTypeById(id) {
  return state.catalog.paintTypes.find((item) => item.id === id);
}

function getHingeTypeById(id) {
  return state.catalog.hingeTypes.find((item) => item.id === id);
}

function getBasePlateTypeById(id) {
  return state.catalog.basePlateTypes.find((item) => item.id === id);
}

function getBoardStockById(id) {
  return state.catalog.boardStocks.find((item) => item.id === id);
}

async function refreshCatalogUi() {
  state.catalog = withDefaultConstructionAssumptions(normalizeCatalog(await fetchCatalog()));
  populateSelectionDropdowns();
  renderPanelStockTable();
  renderBoardStockTable();
  renderHardwareTable();
  renderDoorTable();
  renderPaintTable();
  renderMouldingTable();
  renderAccessoryTable();
  renderDefaultsUi();
  renderJobAccessoryList();
  calculate();
}

async function addMaterial() {
  const thicknessValue = parseDecimalOrFractionInches(byId("newPanelThickness").value);

  if (thicknessValue === null) {
    alert("Enter a valid material thickness in inches (examples: 0.75, 3/4, 1 1/8).");
    return;
  }

  const wasteFactor = Math.max(0, toNumber(byId("newPanelWaste").value));

  const payload = {
    category: byId("newPanelUsedFor").value,
    name: byId("newPanelName").value.trim(),
    thickness: thicknessValue,
    length: Math.max(1, toNumber(byId("newPanelLength").value)),
    width: Math.max(1, toNumber(byId("newPanelWidth").value)),
    costPerSheet: Math.max(0, toNumber(byId("newPanelCost").value)),
    wasteFactorPercent: wasteFactor,
    wasteMultiplier: 1 + (wasteFactor / 100)
  };

  if (!payload.name) {
    alert("Enter a material name.");
    return;
  }

  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch("/api/catalog/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error("Could not add material");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.materials.push({
      id: newId(),
      ...payload
    });
    saveLocalCatalog(catalog);
  }

  byId("newPanelName").value = "";
  byId("newPanelThickness").value = "";
  byId("newPanelCost").value = "0";
  byId("newPanelWaste").value = "15";
  await refreshCatalogUi();
}

async function addSlide() {
  const payload = {
    name: byId("newSlideName").value.trim(),
    costPerPair: Math.max(0, toNumber(byId("newSlideCost").value))
  };

  if (!payload.name) {
    alert("Enter a drawer slide name.");
    return;
  }

  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch("/api/catalog/slides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error("Could not add slide");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.slides.push({
      id: newId(),
      ...payload
    });
    saveLocalCatalog(catalog);
  }

  byId("newSlideName").value = "";
  byId("newSlideCost").value = "0";
  await refreshCatalogUi();
}

async function addAccessory() {
  const payload = {
    name: byId("newAccessoryName").value.trim(),
    costEach: Math.max(0, toNumber(byId("newAccessoryCost").value))
  };

  if (!payload.name) {
    alert("Enter an accessory name.");
    return;
  }

  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch("/api/catalog/accessories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error("Could not add accessory");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.accessories.push({ id: newId(), ...payload });
    saveLocalCatalog(catalog);
  }

  byId("newAccessoryName").value = "";
  byId("newAccessoryCost").value = "0";
  await refreshCatalogUi();
}

async function addDoorStyle() {
  const payload = {
    name: byId("newDoorStyleName").value.trim(),
    costPerSqFt: Math.max(0, toNumber(byId("newDoorStyleCost").value))
  };

  if (!payload.name) {
    alert("Enter a door style name.");
    return;
  }

  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch("/api/catalog/door-styles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error("Could not add door style");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.doorStyles.push({ id: newId(), ...payload });
    saveLocalCatalog(catalog);
  }

  byId("newDoorStyleName").value = "";
  byId("newDoorStyleCost").value = "15";
  await refreshCatalogUi();
}

async function addPaintType() {
  const payload = {
    name: byId("newPaintTypeName").value.trim(),
    primerCostPerGallon: Math.max(0, toNumber(byId("newPaintPrimerCost").value)),
    topcoatCostPerGallon: Math.max(0, toNumber(byId("newPaintTopcoatCost").value))
  };

  if (!payload.name) {
    alert("Enter a paint type name.");
    return;
  }

  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch("/api/catalog/paint-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error("Could not add paint type");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.paintTypes.push({ id: newId(), ...payload });
    saveLocalCatalog(catalog);
  }

  byId("newPaintTypeName").value = "";
  byId("newPaintPrimerCost").value = "35";
  byId("newPaintTopcoatCost").value = "55";
  await refreshCatalogUi();
}

async function addHingeType() {
  const payload = {
    name: byId("newHingeTypeName").value.trim(),
    costEach: Math.max(0, toNumber(byId("newHingeTypeCost").value))
  };

  if (!payload.name) {
    alert("Enter a hinge type name.");
    return;
  }

  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch("/api/catalog/hinge-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error("Could not add hinge type");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.hingeTypes.push({ id: newId(), ...payload });
    saveLocalCatalog(catalog);
  }

  byId("newHingeTypeName").value = "";
  byId("newHingeTypeCost").value = "3.25";
  await refreshCatalogUi();
}

async function addBasePlateType() {
  const payload = {
    name: byId("newBasePlateTypeName").value.trim(),
    costEach: Math.max(0, toNumber(byId("newBasePlateTypeCost").value))
  };

  if (!payload.name) {
    alert("Enter a base plate type name.");
    return;
  }

  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch("/api/catalog/base-plate-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error("Could not add base plate type");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.basePlateTypes.push({ id: newId(), ...payload });
    saveLocalCatalog(catalog);
  }

  byId("newBasePlateTypeName").value = "";
  byId("newBasePlateTypeCost").value = "1.5";
  await refreshCatalogUi();
}

async function addHardware() {
  const usedFor = byId("newHardwareUsedFor").value;
  const name = byId("newHardwareName").value.trim();
  const costValue = Math.max(0, toNumber(byId("newHardwareCost").value));
  const wasteFactor = Math.max(0, toNumber(byId("newHardwareWasteFactor").value));

  if (!name) {
    alert("Enter a hardware name.");
    return;
  }

  if (usedFor === "slides") {
    const payload = {
      name,
      costPerPair: costValue,
      wasteFactorPercent: wasteFactor,
      wasteMultiplier: 1 + (wasteFactor / 100)
    };

    if (await ensureDataMode() === "api") {
      try {
        const res = await fetch("/api/catalog/slides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          throw new Error("Could not add slide");
        }
      } catch (_err) {
        state.dataMode = "local";
      }
    }

    if (state.dataMode === "local") {
      const catalog = localCatalog();
      catalog.slides.push({ id: newId(), ...payload });
      saveLocalCatalog(catalog);
    }
  } else if (usedFor === "hinges") {
    const payload = {
      name,
      costEach: costValue,
      wasteFactorPercent: wasteFactor,
      wasteMultiplier: 1 + (wasteFactor / 100)
    };

    if (await ensureDataMode() === "api") {
      try {
        const res = await fetch("/api/catalog/hinge-types", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          throw new Error("Could not add hinge type");
        }
      } catch (_err) {
        state.dataMode = "local";
      }
    }

    if (state.dataMode === "local") {
      const catalog = localCatalog();
      catalog.hingeTypes.push({ id: newId(), ...payload });
      saveLocalCatalog(catalog);
    }
  } else {
    const payload = {
      name,
      costEach: costValue,
      wasteFactorPercent: wasteFactor,
      wasteMultiplier: 1 + (wasteFactor / 100)
    };

    if (await ensureDataMode() === "api") {
      try {
        const res = await fetch("/api/catalog/base-plate-types", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) {
          throw new Error("Could not add base plate type");
        }
      } catch (_err) {
        state.dataMode = "local";
      }
    }

    if (state.dataMode === "local") {
      const catalog = localCatalog();
      catalog.basePlateTypes.push({ id: newId(), ...payload });
      saveLocalCatalog(catalog);
    }
  }

  byId("newHardwareName").value = "";
  byId("newHardwareCost").value = "0";
  byId("newHardwareWasteFactor").value = "0";
  await refreshCatalogUi();
}

async function addBoardStock() {
  const wasteFactor = Math.max(0, toNumber(byId("newBoardStockWasteFactor").value));
  const usedForValue = byId("newBoardStockUsedFor").value;
  const usedForLabel = usedForValue === "faceFrame" ? "Face Frames" : usedForValue;
  const payload = {
    name: byId("newBoardStockName").value.trim(),
    costPerBdFt: Math.max(0, toNumber(byId("newBoardStockCost").value)),
    wasteFactorPercent: wasteFactor,
    wasteMultiplier: 1 + (wasteFactor / 100),
    usedFor: usedForLabel
  };

  if (!payload.name) {
    alert("Enter a board stock name.");
    return;
  }

  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch("/api/catalog/board-stocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        throw new Error("Could not add board stock");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.boardStocks.push({ id: newId(), ...payload });
    saveLocalCatalog(catalog);
  }

  byId("newBoardStockName").value = "";
  byId("newBoardStockCost").value = "0";
  byId("newBoardStockWasteFactor").value = "0";
  await refreshCatalogUi();
}

async function addCrownMoulding() {
  const wasteFactor = Math.max(0, toNumber(byId("newCrownWasteFactor").value));
  const usedForValue = byId("newCrownUsedFor").value;
  const usedForLabel = usedForValue === "crown" ? "Crown Moulding" : usedForValue;
  const payload = {
    name: byId("newCrownName").value.trim(),
    costPerLf: Math.max(0, toNumber(byId("newCrownCost").value)),
    wasteFactorPercent: wasteFactor,
    wasteMultiplier: 1 + (wasteFactor / 100),
    usedFor: usedForLabel
  };

  if (!payload.name) {
    alert("Enter a crown moulding name.");
    return;
  }

  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch("/api/catalog/crown-mouldings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error("Could not add crown moulding");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.crownMouldings.push({ id: newId(), ...payload });
    saveLocalCatalog(catalog);
  }

  byId("newCrownName").value = "";
  byId("newCrownCost").value = "0";
  byId("newCrownWasteFactor").value = "15";
  await refreshCatalogUi();
}

async function deleteMaterial(id) {
  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(`/api/catalog/materials/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Could not delete material");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.materials = catalog.materials.filter((m) => m.id !== id);
    saveLocalCatalog(catalog);
  }

  await refreshCatalogUi();
}

async function deleteSlide(id) {
  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(`/api/catalog/slides/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Could not delete slide");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.slides = catalog.slides.filter((s) => s.id !== id);
    saveLocalCatalog(catalog);
  }

  await refreshCatalogUi();
}

async function deleteAccessory(id) {
  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(`/api/catalog/accessories/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Could not delete accessory");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.accessories = catalog.accessories.filter((a) => a.id !== id);
    saveLocalCatalog(catalog);
  }

  state.jobAccessories = state.jobAccessories.filter((a) => a.accessoryId !== id);
  await refreshCatalogUi();
}

async function deleteDoorStyle(id) {
  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(`/api/catalog/door-styles/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Could not delete door style");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.doorStyles = catalog.doorStyles.filter((style) => style.id !== id);
    saveLocalCatalog(catalog);
  }

  await refreshCatalogUi();
}

async function deletePaintType(id) {
  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(`/api/catalog/paint-types/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Could not delete paint type");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.paintTypes = catalog.paintTypes.filter((item) => item.id !== id);
    saveLocalCatalog(catalog);
  }

  await refreshCatalogUi();
}

async function deleteHingeType(id) {
  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(`/api/catalog/hinge-types/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Could not delete hinge type");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.hingeTypes = catalog.hingeTypes.filter((item) => item.id !== id);
    saveLocalCatalog(catalog);
  }

  await refreshCatalogUi();
}

async function deleteBasePlateType(id) {
  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(`/api/catalog/base-plate-types/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Could not delete base plate type");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.basePlateTypes = catalog.basePlateTypes.filter((item) => item.id !== id);
    saveLocalCatalog(catalog);
  }

  await refreshCatalogUi();
}

async function deleteBoardStock(id) {
  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(`/api/catalog/board-stocks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Could not delete board stock");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.boardStocks = catalog.boardStocks.filter((item) => item.id !== id);

    if (!catalog.boardStocks.length) {
      catalog.boardStocks = defaultBoardStocks();
    }

    saveLocalCatalog(catalog);
  }

  await refreshCatalogUi();
}

async function deleteCrownMoulding(id) {
  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(`/api/catalog/crown-mouldings/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Could not delete crown moulding");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const catalog = localCatalog();
    catalog.crownMouldings = catalog.crownMouldings.filter((item) => item.id !== id);
    saveLocalCatalog(catalog);
  }

  await refreshCatalogUi();
}

function addJobAccessory() {
  const accessoryId = byId("jobAccessorySelect").value;
  const qty = Math.max(1, toNumber(byId("jobAccessoryQty").value));

  if (!accessoryId) {
    return;
  }

  state.jobAccessories.push({
    rowId: newId(),
    accessoryId,
    qty
  });

  byId("jobAccessoryQty").value = "1";
  renderJobAccessoryList();
  calculate();
}

async function saveProject() {
  const name = byId("projectName").value.trim();
  if (!name) {
    alert("Please enter a project name before saving.");
    return;
  }

  const payload = {
    name,
    settings: collectSettings(),
    selections: collectSelections()
  };

  const selectedId = byId("projectSelect").value;

  if (await ensureDataMode() === "api") {
    const endpoint = selectedId ? `/api/projects/${selectedId}` : "/api/projects";
    const method = selectedId ? "PUT" : "POST";

    try {
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        throw new Error("Could not save project");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const projects = localProjects();
    const now = nowIso();

    if (selectedId) {
      const idx = projects.findIndex((p) => p.id === selectedId);
      if (idx >= 0) {
        projects[idx] = {
          ...projects[idx],
          ...payload,
          updatedAt: now
        };
      } else {
        projects.push({
          id: selectedId,
          ...payload,
          createdAt: now,
          updatedAt: now
        });
      }
    } else {
      projects.push({
        id: newId(),
        ...payload,
        createdAt: now,
        updatedAt: now
      });
    }

    saveLocalProjects(projects);
  }

  await populateProjects();
  alert("Project saved.");
}

async function loadSelectedProject() {
  const id = byId("projectSelect").value;
  if (!id) {
    return;
  }

  const projects = await fetchProjects();
  const project = projects.find((p) => p.id === id);
  if (project) {
    applyProject(project);
  }
}

async function deleteSelectedProject() {
  const id = byId("projectSelect").value;
  if (!id) {
    return;
  }

  const proceed = confirm("Delete selected project?");
  if (!proceed) {
    return;
  }

  if (await ensureDataMode() === "api") {
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) {
        throw new Error("Could not delete project");
      }
    } catch (_err) {
      state.dataMode = "local";
    }
  }

  if (state.dataMode === "local") {
    const projects = localProjects().filter((p) => p.id !== id);
    saveLocalProjects(projects);
  }

  byId("projectName").value = "";
  await populateProjects();
}

function calcCabinetPerLF(height, depth, avgWidth, topMode, stretcherWidth) {
  const boxesPerLF = 12 / avgWidth;
  const endsIn2PerBox = 2 * height * depth;
  const bottomIn2PerBox = avgWidth * depth;
  const fullTopIn2PerBox = avgWidth * depth;
  const stretcherTopIn2PerBox = 2 * stretcherWidth * avgWidth;
  const topIn2PerBox = topMode === "stretchers" ? stretcherTopIn2PerBox : fullTopIn2PerBox;
  const carcassIn2PerBox = endsIn2PerBox + bottomIn2PerBox + topIn2PerBox;

  return {
    carcassSqFtPerLF: (carcassIn2PerBox * boxesPerLF) / 144,
    backSqFtPerLF: ((avgWidth * height) * boxesPerLF) / 144
  };
}

function calcSheetUsage(areaSqFt, material, wasteMultiplier) {
  if (!material) {
    return {
      areaWithWaste: areaSqFt * wasteMultiplier,
      sheets: 0,
      cost: 0
    };
  }

  const materialWaste = Number.isFinite(Number(material.wasteMultiplier))
    ? Number(material.wasteMultiplier)
    : (Number.isFinite(Number(material.wasteFactorPercent))
      ? 1 + (Number(material.wasteFactorPercent) / 100)
      : null);
  const effectiveWaste = materialWaste || wasteMultiplier || 1;
  const sheetSqFt = (material.length * material.width) / 144;
  const areaWithWaste = areaSqFt * effectiveWaste;
  const sheets = sheetSqFt > 0 ? areaWithWaste / sheetSqFt : 0;

  return {
    areaWithWaste,
    sheets,
    cost: sheets * material.costPerSheet
  };
}

function boardFeetFromLinearInches(linearInches, widthIn, thicknessIn) {
  return (linearInches * widthIn * thicknessIn) / 144;
}

function calcFrameOrEdgebandByType(linealFeet, heightIn, avgWidthIn, railCountPerLf) {
  const runIn = Math.max(0, linealFeet * 12);
  const estimatedBoxCount = avgWidthIn > 0 ? runIn / avgWidthIn : 0;

  const railLinearIn = runIn * railCountPerLf;
  const stileLinearIn = estimatedBoxCount * 2 * Math.max(0, heightIn);
  const boardFeet = boardFeetFromLinearInches(railLinearIn + stileLinearIn, FRAME_MEMBER_WIDTH_IN, FRAME_MEMBER_THICKNESS_IN);

  // Frameless/Euro: horizontal plus vertical edges per estimated box.
  const edgeBandLf = (2 * linealFeet) + (2 * (Math.max(0, heightIn) / 12) * estimatedBoxCount);

  return {
    estimatedBoxCount,
    railLinearIn,
    stileLinearIn,
    boardFeet,
    edgeBandLf
  };
}

function resultTile(title, perLFCarcass, perLFBack, lf) {
  const carcassTotal = perLFCarcass * lf;
  const backTotal = perLFBack * lf;

  return `
    <article class="result-tile">
      <h3>${title}</h3>
      <div class="result-line"><span>Carcass / LF</span><span class="result-value">${round2(perLFCarcass)} sq ft</span></div>
      <div class="result-line"><span>Back / LF</span><span class="result-value">${round2(perLFBack)} sq ft</span></div>
      <div class="result-line"><span>Carcass Total</span><span class="result-value">${round2(carcassTotal)} sq ft</span></div>
      <div class="result-line"><span>Back Total</span><span class="result-value">${round2(backTotal)} sq ft</span></div>
    </article>
  `;
}

function calculate() {
  const settings = collectSettings();
  const selections = collectSelections();
  const wasteMultiplier = 1 + settings.wasteFactorPercent / 100;

    // --- Toe Kick Material Calculation ---
    // Applies to lower and tall cabinets only.
    const toeKickLF = settings.lowerLF + settings.tallLF;
    const toeKickFrontBackLF = toeKickLF * 2;
    const sleeperLengthByDepth = (depthIn) => Math.max(0, (depthIn - 2) / 12);
    const sleeperCountForRun = (runLf) => {
      if (runLf <= 0) {
        return 0;
      }
      // At least two sleepers for each run, plus intermediate sleepers by spacing.
      return Math.ceil((runLf * 12) / settings.toeKickSleeperSpacing) + 2;
    };
    const lowerSleeperLF = sleeperCountForRun(settings.lowerLF) * sleeperLengthByDepth(settings.lowerDepth || 24);
    const tallSleeperLF = sleeperCountForRun(settings.tallLF) * sleeperLengthByDepth(settings.tallDepth || 24);
    const totalSleeperLF = lowerSleeperLF + tallSleeperLF;
    const totalToeKickLF = toeKickFrontBackLF + totalSleeperLF;
    const toeKickHeightFt = settings.toeKickHeight / 12;
    const toeKickAreaSqFt = totalToeKickLF * toeKickHeightFt;
    const toeKickMaterial = getMaterialById(selections.toeKickMaterialId);
    const toeKickUsage = calcSheetUsage(toeKickAreaSqFt, toeKickMaterial, wasteMultiplier);
    const toeKickCost = toeKickUsage.cost;

    // --- Nailer Calculation ---
    // Applies to all cabinets, top and bottom
    const nailerLF = (settings.lowerLF + settings.upperLF + settings.tallLF) * 2;
    const nailerRipFt = settings.nailerRipSize / 12;
    const nailerAreaSqFt = nailerLF * nailerRipFt;
    const nailerMaterial = getMaterialById(selections.nailerMaterialId);
    const nailerUsage = calcSheetUsage(nailerAreaSqFt, nailerMaterial, wasteMultiplier);
    const nailerCost = nailerUsage.cost;

    // --- Crown Moulding Calculation ---
    // Upper + tall runs, plus finished ends converted from cabinet depth to LF.
    const crownBaseLF = settings.upperLF + settings.tallLF;
    const crownUpperEndLF = (settings.upperFinishedEndsQty * settings.upperDepth) / 12;
    const crownTallEndLF = (settings.tallFinishedEndsQty * settings.tallDepth) / 12;
    const crownTotalLF = crownBaseLF + crownUpperEndLF + crownTallEndLF;
    const crownMaterial = getCrownMouldingById(selections.crownMaterialId);
    const crownWastePercent = crownMaterial ? Number(crownMaterial.wasteFactorPercent) : 0;
    const crownWasteMultiplier = crownMaterial
      ? (Number(crownMaterial.wasteMultiplier) || (crownWastePercent ? 1 + (crownWastePercent / 100) : 1.0))
      : 1.0;
    const crownLfWithWaste = crownTotalLF * crownWasteMultiplier;
    const crownCost = crownMaterial ? crownLfWithWaste * crownMaterial.costPerLf : 0;

  const lower = calcCabinetPerLF(settings.lowerHeight, settings.lowerDepth, settings.avgWidth, settings.lowerTopType, settings.stretcherWidth);
  const upper = calcCabinetPerLF(settings.upperHeight, settings.upperDepth, settings.avgWidth, "full", settings.stretcherWidth);
  const tall = calcCabinetPerLF(settings.tallHeight, settings.tallDepth, settings.avgWidth, "full", settings.stretcherWidth);

  const totalCarcassSqFt = lower.carcassSqFtPerLF * settings.lowerLF + upper.carcassSqFtPerLF * settings.upperLF + tall.carcassSqFtPerLF * settings.tallLF;
  const totalBackSqFt = lower.backSqFtPerLF * settings.lowerLF + upper.backSqFtPerLF * settings.upperLF + tall.backSqFtPerLF * settings.tallLF;

  const drawerTotals = settings.drawerSets.reduce((acc, set) => {
    const estimatedDrawerCount = settings.avgWidth > 0 ? set.linealInches / settings.avgWidth : 0;
    acc.estimatedCount += estimatedDrawerCount;
    acc.linealInches += set.linealInches;
    acc.sidesIn2 += 2 * estimatedDrawerCount * set.height * settings.drawerDepth;
    acc.frontBackIn2 += 2 * set.height * set.linealInches;
    acc.bottomIn2 += set.linealInches * settings.drawerDepth;
    return acc;
  }, {
    estimatedCount: 0,
    linealInches: 0,
    sidesIn2: 0,
    frontBackIn2: 0,
    bottomIn2: 0
  });

  const drawerBoxSqFt = (drawerTotals.sidesIn2 + drawerTotals.frontBackIn2) / 144;
  const drawerBottomSqFt = drawerTotals.bottomIn2 / 144;
  const slidesNeeded = settings.totalDrawerCount;

  const carcassMaterial = getMaterialById(selections.carcassMaterialId);
  const backMaterial = getMaterialById(selections.backMaterialId);
  const drawerBoxMaterial = getMaterialById(selections.drawerBoxMaterialId);
  const drawerBottomMaterial = getMaterialById(selections.drawerBottomMaterialId);
  const finishedEndMaterial = getMaterialById(selections.finishedEndMaterialId);
  const slideType = getSlideById(selections.drawerSlideId);
  const doorStyle = getDoorStyleById(selections.doorStyleId);
  const paintType = getPaintTypeById(selections.paintTypeId);
  const hingeType = getHingeTypeById(selections.hingeTypeId);
  const basePlateType = getBasePlateTypeById(selections.basePlateTypeId);
  const boardStock = getBoardStockById(selections.boardStockId);

  const carcassUsage = calcSheetUsage(totalCarcassSqFt, carcassMaterial, wasteMultiplier);
  const backUsage = calcSheetUsage(totalBackSqFt, backMaterial, wasteMultiplier);
  const lowerFinishedEndsSqFt = (settings.lowerDepth * settings.lowerHeight * settings.lowerFinishedEndsQty) / 144;
  const upperFinishedEndsSqFt = (settings.upperDepth * settings.upperHeight * settings.upperFinishedEndsQty) / 144;
  const tallFinishedEndsSqFt = (settings.tallDepth * settings.tallHeight * settings.tallFinishedEndsQty) / 144;
  const totalFinishedEndsSqFt = lowerFinishedEndsSqFt + upperFinishedEndsSqFt + tallFinishedEndsSqFt;
  const finishedEndUsage = calcSheetUsage(totalFinishedEndsSqFt, finishedEndMaterial, wasteMultiplier);
  const drawerBoxUsage = calcSheetUsage(drawerBoxSqFt, drawerBoxMaterial, wasteMultiplier);
  const drawerBottomUsage = calcSheetUsage(drawerBottomSqFt, drawerBottomMaterial, wasteMultiplier);
  const slideCost = slideType ? slideType.costPerPair * slidesNeeded : 0;

  const lowerFrame = calcFrameOrEdgebandByType(settings.lowerLF, settings.lowerHeight, settings.avgWidth, 3);
  const upperFrame = calcFrameOrEdgebandByType(settings.upperLF, settings.upperHeight, settings.avgWidth, 2);
  const tallFrame = calcFrameOrEdgebandByType(settings.tallLF, settings.tallHeight, settings.avgWidth, 3);
  const faceFrameBoardFeet = lowerFrame.boardFeet + upperFrame.boardFeet + tallFrame.boardFeet;
  const framelessEdgebandLf = lowerFrame.edgeBandLf + upperFrame.edgeBandLf + tallFrame.edgeBandLf;
  const boardStockWasteMultiplier = boardStock && boardStock.wasteMultiplier ? boardStock.wasteMultiplier : 1.0;
  const boardFeetWithWaste = faceFrameBoardFeet * boardStockWasteMultiplier;
  const boardStockCost = settings.constructionType === "faceFrame" && boardStock ? boardFeetWithWaste * boardStock.costPerBdFt : 0;

  const estimatedDoorSqFt = ((settings.lowerLF * 12 * settings.lowerHeight) + (settings.upperLF * 12 * settings.upperHeight) + (settings.tallLF * 12 * settings.tallHeight)) / 144;
  const finishDoorSqFt = settings.includeFinish ? estimatedDoorSqFt : 0;
  const doorStyleCost = doorStyle ? doorStyle.costPerSqFt * estimatedDoorSqFt : 0;
  const hingeCount = settings.totalDoorCount * 2;
  const basePlateCount = settings.totalDoorCount * 2;
  const hingeCost = hingeCount * (hingeType ? hingeType.costEach : 0);
  const basePlateCost = basePlateCount * (basePlateType ? basePlateType.costEach : 0);

  const primerGallons = finishDoorSqFt * DOOR_GALLONS_PER_SQFT;
  const topcoatGallons = finishDoorSqFt * DOOR_GALLONS_PER_SQFT;
  const primerCost = primerGallons * (paintType ? paintType.primerCostPerGallon : 0);
  const topcoatCost = topcoatGallons * (paintType ? paintType.topcoatCostPerGallon : 0);
  const paintCostTotal = primerCost + topcoatCost;

  const totalLfForLabor = settings.lowerLF + settings.upperLF + settings.tallLF;
  const buildHours = settings.includeBuild ? totalLfForLabor / settings.buildLfPerHour : 0;
  const installHours = settings.includeInstall ? totalLfForLabor / settings.installLfPerHour : 0;
  const finishHours = settings.includeFinish ? totalLfForLabor / settings.finishLfPerHour : 0;

  const buildLaborCost = buildHours * settings.shopCostPerHour;
  const installLaborCost = installHours * settings.shopCostPerHour;
  const finishLaborCost = finishHours * settings.shopCostPerHour;
  const totalLaborCost = buildLaborCost + installLaborCost + finishLaborCost;

  const combinedSqFt = totalCarcassSqFt + totalBackSqFt + totalFinishedEndsSqFt + drawerBoxSqFt + drawerBottomSqFt + estimatedDoorSqFt + toeKickAreaSqFt + nailerAreaSqFt;
  const cabinetBoxSheetGoodsCost = carcassUsage.cost + backUsage.cost + finishedEndUsage.cost + toeKickCost + nailerCost + crownCost + boardStockCost;
  const cabinetBoxHardwareCost = 0;
  const cabinetBoxTotalCost = cabinetBoxSheetGoodsCost + cabinetBoxHardwareCost;

  const drawerSheetGoodsCost = drawerBoxUsage.cost + drawerBottomUsage.cost;
  const drawerHardwareCost = slideCost;
  const drawerTotalCost = drawerSheetGoodsCost + drawerHardwareCost;

  const doorMaterialCost = doorStyleCost;
  const doorHardwareCost = hingeCost + basePlateCost;
  const doorTotalCost = doorMaterialCost + doorHardwareCost;

  const accessoryLines = state.jobAccessories.map((row) => {
    const accessory = getAccessoryById(row.accessoryId);
    const unitCost = accessory ? accessory.costEach : 0;
    const lineCost = unitCost * row.qty;
    return { ...row, name: accessory ? accessory.name : "Unknown", unitCost, lineCost };
  });

  const accessorySheetGoodsCost = 0;
  const accessoryHardwareCost = accessoryLines.reduce((sum, line) => sum + line.lineCost, 0);
  const accessoryTotalCost = accessorySheetGoodsCost + accessoryHardwareCost;

  const totalMaterialCost = cabinetBoxTotalCost + drawerTotalCost + doorTotalCost + accessoryTotalCost + paintCostTotal;
  const grandTotalCost = totalMaterialCost + totalLaborCost;

  byId("resultsGrid").innerHTML = [
    resultTile("Lower Cabinets", lower.carcassSqFtPerLF, lower.backSqFtPerLF, settings.lowerLF),
    resultTile("Upper Cabinets", upper.carcassSqFtPerLF, upper.backSqFtPerLF, settings.upperLF),
    resultTile("Tall Cabinets", tall.carcassSqFtPerLF, tall.backSqFtPerLF, settings.tallLF),
    `
      <article class="result-tile">
        <h3>Drawers</h3>
        <div class="result-line"><span>Total Drawer Count (slides)</span><span class="result-value">${round2(settings.totalDrawerCount)}</span></div>
        <div class="result-line"><span>Estimated Drawer Count (material)</span><span class="result-value">${round2(drawerTotals.estimatedCount)}</span></div>
        <div class="result-line"><span>Total Drawer Lineal Inches</span><span class="result-value">${round2(drawerTotals.linealInches)} in</span></div>
        <div class="result-line"><span>Drawer Box Material</span><span class="result-value">${round2(drawerBoxSqFt)} sq ft</span></div>
        <div class="result-line"><span>Drawer Bottom Material</span><span class="result-value">${round2(drawerBottomSqFt)} sq ft</span></div>
        <div class="result-line"><span>Slides Needed (pairs)</span><span class="result-value">${round2(slidesNeeded)}</span></div>
      </article>
    `,
    `
      <article class="result-tile">
        <h3>Project Totals</h3>
        <div class="result-line"><span>Total Box Material</span><span class="result-value">${round2(totalCarcassSqFt)} sq ft</span></div>
        <div class="result-line"><span>Total Back Material</span><span class="result-value">${round2(totalBackSqFt)} sq ft</span></div>
        <div class="result-line"><span>Lower Finished Ends</span><span class="result-value">${round2(settings.lowerFinishedEndsQty)} (${round2(lowerFinishedEndsSqFt)} sq ft)</span></div>
        <div class="result-line"><span>Upper Finished Ends</span><span class="result-value">${round2(settings.upperFinishedEndsQty)} (${round2(upperFinishedEndsSqFt)} sq ft)</span></div>
        <div class="result-line"><span>Tall Finished Ends</span><span class="result-value">${round2(settings.tallFinishedEndsQty)} (${round2(tallFinishedEndsSqFt)} sq ft)</span></div>
        <div class="result-line"><span>Total Finished End Material</span><span class="result-value">${round2(totalFinishedEndsSqFt)} sq ft</span></div>
        <div class="result-line"><span>Total Drawer Material</span><span class="result-value">${round2(drawerBoxSqFt + drawerBottomSqFt)} sq ft</span></div>
        <div class="result-line"><span>Estimated Door Area</span><span class="result-value">${round2(estimatedDoorSqFt)} sq ft</span></div>
        <div class="result-line"><span>Crown Moulding LF</span><span class="result-value">${round2(crownTotalLF)} LF (${round2(crownLfWithWaste)} LF with ${round2(crownWastePercent || ((crownWasteMultiplier - 1) * 100))}% waste)</span></div>
        <div class="result-line"><span>Construction Type</span><span class="result-value">${settings.constructionType === "faceFrame" ? "Face Frame" : "Frameless / Euro"}</span></div>
        ${settings.constructionType === "faceFrame" ? `<div class="result-line"><span>Face Frame Board Stock</span><span class="result-value">${round2(faceFrameBoardFeet)} bd ft (design) → ${round2(boardFeetWithWaste)} bd ft (with ${round2((boardStockWasteMultiplier - 1) * 100)}% waste)</span></div>` : `<div class="result-line"><span>Edgebanding</span><span class="result-value">${round2(framelessEdgebandLf)} LF</span></div>`}
        <div class="result-line"><span>Combined Material</span><span class="result-value">${round2(combinedSqFt)} sq ft</span></div>
      </article>
    `
  ].join("");

  const formatSheetSize = (material) => `${round2(material.width / 12)}x${round2(material.length / 12)} ft`;
  const panelStockLine = (label, material, usage) => {
    if (!material) {
      return `<div class="result-line"><span>${label}</span><span class="result-value">Not selected</span></div>`;
    }

    return `<div class="result-line"><span>${label}</span><span class="result-value">${round2(usage.sheets)} sheets (${thicknessLabelInches(material.thickness)} ${formatSheetSize(material)} ${material.name}) for ${dollars(usage.cost)}</span></div>`;
  };

  const accessoryOrderLines = accessoryLines.length
    ? accessoryLines.map((line) => `<div class="result-line"><span>${line.name}</span><span class="result-value">${round2(line.qty)} @ ${dollars(line.unitCost)} = ${dollars(line.lineCost)}</span></div>`).join("")
    : '<div class="result-line"><span>Accessories</span><span class="result-value">None selected</span></div>';

  byId("pricingGrid").innerHTML = `
    <article class="result-tile order-sheet-tile">
      <h3>Order Sheet</h3>
      <div class="result-line result-separator"><span>Panel Stock (Sheets)</span><span class="result-value"></span></div>
      ${panelStockLine("Carcass Panels", carcassMaterial, carcassUsage)}
      ${panelStockLine("Back Panels", backMaterial, backUsage)}
      ${panelStockLine("Finished End Panels", finishedEndMaterial, finishedEndUsage)}
      ${panelStockLine("Drawer Box Panels", drawerBoxMaterial, drawerBoxUsage)}
      ${panelStockLine("Drawer Bottom Panels", drawerBottomMaterial, drawerBottomUsage)}
      ${panelStockLine("Toe Kick Material", toeKickMaterial, toeKickUsage)}
      ${panelStockLine("Nailer Material", nailerMaterial, nailerUsage)}

      <div class="result-line result-separator"><span>Board Stock</span><span class="result-value"></span></div>
      ${settings.constructionType === "faceFrame"
        ? `<div class="result-line"><span>${boardStock ? boardStock.name : "Board Stock"}</span><span class="result-value">${round2(boardFeetWithWaste)} bd ft (${round2(faceFrameBoardFeet)} design + waste) for ${dollars(boardStockCost)}</span></div>`
        : `<div class="result-line"><span>Edgebanding</span><span class="result-value">${round2(framelessEdgebandLf)} LF (reference only)</span></div>`}
      <div class="result-line"><span>Crown Moulding</span><span class="result-value">${crownMaterial ? `${round2(crownLfWithWaste)} LF (${round2(crownTotalLF)} LF + ${round2(crownWastePercent || ((crownWasteMultiplier - 1) * 100))}% waste) at ${dollars(crownMaterial.costPerLf)}/LF = ${dollars(crownCost)}` : "Not selected"}</span></div>

      <div class="result-line result-separator"><span>Hardwares</span><span class="result-value"></span></div>
      <div class="result-line"><span>Drawer Slides</span><span class="result-value">${round2(slidesNeeded)} pair(s) for ${dollars(slideCost)}</span></div>
      <div class="result-line"><span>Hinges</span><span class="result-value">${round2(hingeCount)} each for ${dollars(hingeCost)}</span></div>
      <div class="result-line"><span>Base Plates</span><span class="result-value">${round2(basePlateCount)} each for ${dollars(basePlateCost)}</span></div>

      <div class="result-line result-separator"><span>Accessories</span><span class="result-value"></span></div>
      ${accessoryOrderLines}
    </article>

    <article class="result-tile">
      <h3>Cabinet Box Cost Summary</h3>
      <div class="result-line"><span>Cabinet Box Material Cost</span><span class="result-value">${dollars(carcassUsage.cost)}</span></div>
      <div class="result-line"><span>Cabinet Back Material Cost</span><span class="result-value">${dollars(backUsage.cost)}</span></div>
      <div class="result-line"><span>Finished End Material Cost</span><span class="result-value">${dollars(finishedEndUsage.cost)}</span></div>
      <div class="result-line"><span>Toe Kick Material Cost</span><span class="result-value">${dollars(toeKickCost)}</span></div>
      <div class="result-line"><span>Nailer Material Cost</span><span class="result-value">${dollars(nailerCost)}</span></div>
      <div class="result-line"><span>Crown Moulding Cost</span><span class="result-value">${dollars(crownCost)}</span></div>
      ${settings.constructionType === "faceFrame"
        ? `<div class="result-line"><span>Board Stock Cost</span><span class="result-value">${dollars(boardStockCost)}</span></div>`
        : `<div class="result-line"><span>Edgebanding Qty</span><span class="result-value">${round2(framelessEdgebandLf)} LF</span></div>`}
      <div class="result-line result-separator"><span>Cabinet Box Subtotal</span><span class="result-value total">${dollars(cabinetBoxTotalCost)}</span></div>
    </article>

    <article class="result-tile">
      <h3>Drawers Cost Summary</h3>
      <div class="result-line"><span>Drawer Box Material Cost</span><span class="result-value">${dollars(drawerBoxUsage.cost)}</span></div>
      <div class="result-line"><span>Drawer Bottom Material Cost</span><span class="result-value">${dollars(drawerBottomUsage.cost)}</span></div>
      <div class="result-line"><span>Drawer Slides Cost</span><span class="result-value">${dollars(slideCost)}</span></div>
      <div class="result-line result-separator"><span>Drawers Subtotal</span><span class="result-value total">${dollars(drawerTotalCost)}</span></div>
    </article>

    <article class="result-tile">
      <h3>Doors Cost Summary</h3>
      <div class="result-line"><span>Door Style Material Cost</span><span class="result-value">${dollars(doorStyleCost)}</span></div>
      <div class="result-line"><span>Hinge Cost</span><span class="result-value">${dollars(hingeCost)}</span></div>
      <div class="result-line"><span>Base Plate Cost</span><span class="result-value">${dollars(basePlateCost)}</span></div>
      <div class="result-line result-separator"><span>Doors Subtotal</span><span class="result-value total">${dollars(doorTotalCost)}</span></div>
    </article>

    <article class="result-tile">
      <h3>Paint Cost Summary</h3>
      <div class="result-line"><span>Sealer/Primer Cost</span><span class="result-value">${dollars(primerCost)}</span></div>
      <div class="result-line"><span>Top Coat Cost</span><span class="result-value">${dollars(topcoatCost)}</span></div>
      <div class="result-line result-separator"><span>Paint Subtotal</span><span class="result-value total">${dollars(paintCostTotal)}</span></div>
    </article>

    <article class="result-tile">
      <h3>Accessories Cost Summary</h3>
      <div class="result-line result-separator"><span>Accessories Subtotal</span><span class="result-value total">${dollars(accessoryTotalCost)}</span></div>
      <div class="meta">${accessoryLines.length ? `${accessoryLines.length} accessory line(s) in this job.` : "No accessories added to this job."}</div>
    </article>

    <article class="result-tile">
      <h3>Labor</h3>
      <div class="result-line"><span>Total LF Used for Labor</span><span class="result-value">${round2(totalLfForLabor)} LF</span></div>
      <div class="result-line"><span>Build Hours</span><span class="result-value">${round2(buildHours)}</span></div>
      <div class="result-line"><span>Install Hours</span><span class="result-value">${round2(installHours)}</span></div>
      <div class="result-line"><span>Finish Hours</span><span class="result-value">${round2(finishHours)}</span></div>
      <div class="result-line"><span>Build Labor Cost</span><span class="result-value">${dollars(buildLaborCost)}</span></div>
      <div class="result-line"><span>Install Labor Cost</span><span class="result-value">${dollars(installLaborCost)}</span></div>
      <div class="result-line"><span>Finish Labor Cost</span><span class="result-value">${dollars(finishLaborCost)}</span></div>
      <div class="result-line result-separator"><span>Total Labor Cost</span><span class="result-value total">${dollars(totalLaborCost)}</span></div>
      <div class="result-line"><span>Labor Cost Per LF</span><span class="result-value">${dollars(totalLfForLabor > 0 ? totalLaborCost / totalLfForLabor : 0)}</span></div>
    </article>

    <article class="result-tile">
      <h3>Grand Total</h3>
      <div class="result-line"><span>Cabinet Box</span><span class="result-value">${dollars(cabinetBoxTotalCost)}</span></div>
      <div class="result-line"><span>Drawers</span><span class="result-value">${dollars(drawerTotalCost)}</span></div>
      <div class="result-line"><span>Doors</span><span class="result-value">${dollars(doorTotalCost)}</span></div>
      <div class="result-line"><span>Paint</span><span class="result-value">${dollars(paintCostTotal)}</span></div>
      <div class="result-line"><span>Accessories</span><span class="result-value">${dollars(accessoryTotalCost)}</span></div>
      <div class="result-line"><span>Total Labor</span><span class="result-value">${dollars(totalLaborCost)}</span></div>
      <div class="result-line result-separator"><span>Grand Total</span><span class="result-value total">${dollars(grandTotalCost)}</span></div>
    </article>
  `;
}

function toggleStretcherField() {
  const topType = byId("lowerTopType").value;
  const wrap = byId("stretcherWrap");
  wrap.classList.toggle("hidden", topType !== "stretchers");
}

function bindListDeleteEvents() {
  byId("panelStockTableBody").addEventListener("click", async (event) => {
    const id = event.target.dataset.panelId;
    const editId = event.target.dataset.editPanelId;
    if (editId) {
      await editMaterial(editId);
      return;
    }
    if (!id) {
      return;
    }

    const ok = confirm("Delete this panel stock?");
    if (ok) {
      await deleteMaterial(id);
    }
  });

  byId("boardStockTableBody").addEventListener("click", async (event) => {
    const id = event.target.dataset.boardStockId;
    const editId = event.target.dataset.editBoardStockId;
    if (editId) {
      await editBoardStock(editId);
      return;
    }
    if (!id) {
      return;
    }
    const ok = confirm("Delete this board stock?");
    if (ok) {
      await deleteBoardStock(id);
    }
  });

  byId("hardwareTableBody").addEventListener("click", async (event) => {
    const id = event.target.dataset.hardwareId;
    const editId = event.target.dataset.editHardwareId;
    const type = event.target.dataset.hardwareType;
    if (editId && type) {
      if (type === "slides") {
        await editSlide(editId);
      } else if (type === "hinges") {
        await editHingeType(editId);
      } else {
        await editBasePlateType(editId);
      }
      return;
    }
    if (!id || !type) {
      return;
    }

    const ok = confirm("Delete this hardware item?");
    if (ok) {
      if (type === "slides") {
        await deleteSlide(id);
      } else if (type === "hinges") {
        await deleteHingeType(id);
      } else {
        await deleteBasePlateType(id);
      }
    }
  });

  byId("doorTableBody").addEventListener("click", async (event) => {
    const id = event.target.dataset.doorStyleId;
    const editId = event.target.dataset.editDoorStyleId;
    if (editId) {
      await editDoorStyle(editId);
      return;
    }
    if (!id) {
      return;
    }

    const ok = confirm("Delete this door style?");
    if (ok) {
      await deleteDoorStyle(id);
    }
  });

  byId("paintTableBody").addEventListener("click", async (event) => {
    const id = event.target.dataset.paintTypeId;
    const editId = event.target.dataset.editPaintTypeId;
    if (editId) {
      await editPaintType(editId);
      return;
    }
    if (!id) {
      return;
    }
    const ok = confirm("Delete this paint type?");
    if (ok) {
      await deletePaintType(id);
    }
  });

  byId("mouldingTableBody").addEventListener("click", async (event) => {
    const id = event.target.dataset.mouldingId;
    const editId = event.target.dataset.editMouldingId;
    if (editId) {
      await editCrownMoulding(editId);
      return;
    }
    if (!id) {
      return;
    }
    const ok = confirm("Delete this moulding?");
    if (ok) {
      await deleteCrownMoulding(id);
    }
  });

  byId("accessoryTableBody").addEventListener("click", async (event) => {
    const id = event.target.dataset.accessoryId;
    const editId = event.target.dataset.editAccessoryId;
    if (editId) {
      await editAccessory(editId);
      return;
    }
    if (!id) {
      return;
    }

    const ok = confirm("Delete this accessory?");
    if (ok) {
      await deleteAccessory(id);
    }
  });


  [
    "defaultPanelStockList",
    "defaultBoardStockList",
    "defaultHardwareList",
    "defaultDoorList",
    "defaultPaintList",
    "defaultMouldingList"
  ].forEach((id) => {
    const el = byId(id);
    if (el) {
      el.addEventListener("change", (event) => {
        const target = event.target;
        if (!target || target.tagName !== "SELECT") {
          return;
        }

        updateStandardSelection({
          profile: target.dataset.standardProfile || "faceFrame",
          type: target.dataset.standardType,
          id: target.value,
          category: target.dataset.category,
          checked: Boolean(target.value)
        });
      });
    }
  });

  byId("jobAccessoryList").addEventListener("click", (event) => {
    const rowId = event.target.dataset.removeJobAccessory;
    if (!rowId) {
      return;
    }

    state.jobAccessories = state.jobAccessories.filter((row) => row.rowId !== rowId);
    renderJobAccessoryList();
    calculate();
  });
}

function bindCalculationInputs() {
  const fields = [
    "lowerHeight", "lowerDepth", "stretcherWidth", "lowerLF",
    "upperHeight", "upperDepth", "upperLF",
    "tallHeight", "tallDepth", "tallLF",
    "lowerFinishedEndsQty", "upperFinishedEndsQty", "tallFinishedEndsQty",
    "avgWidth", "howManyDrawers", "totalDoorCount", "drawerDepth", "wasteFactorPercent", "constructionTypeSelect", "jobConstructionTypeSelect", "hasDrawersSelect",
    "buildLfPerHour", "installLfPerHour", "finishLfPerHour", "shopCostPerHour",
    "carcassMaterialSelect", "backMaterialSelect", "finishedEndMaterialSelect", "drawerBoxMaterialSelect", "drawerBottomMaterialSelect", "drawerSlideSelect", "doorStyleSelect", "paintTypeSelect", "hingeTypeSelect", "basePlateTypeSelect", "boardStockSelect",
    "toeKickMaterialSelect", "nailerMaterialSelect", "crownMaterialSelect", "toeKickHeight", "toeKickSleeperSpacing", "nailerRipSize",
    "includeBuildSelect", "includeInstallSelect", "includeFinishSelect", "useStandardMaterialsSelect"
  ];

  fields.forEach((id) => {
    byId(id).addEventListener("input", calculate);
    byId(id).addEventListener("change", calculate);
  });
}

function bindDrawerSetEvents() {
  byId("addDrawerSetBtn").addEventListener("click", () => {
    if (byId("hasDrawersSelect").value !== "yes") {
      return;
    }

    const sets = collectDrawerSets();
    if (!sets.length) {
      sets.push(createDrawerSet({ name: "Top Drawer", height: 5 }));
    }
    sets.push(createDrawerSet({ name: `Drawer Set ${sets.length + 1}`, height: 10 }));
    renderDrawerSets(sets);
    refreshAutoDrawerLineal();
    calculate();
  });

  byId("drawerSetsWrap").addEventListener("click", (event) => {
    const removeId = event.target.dataset.removeDrawerSet;
    if (!removeId) {
      return;
    }

    const sets = collectDrawerSets().filter((s) => s.id !== removeId);
    renderDrawerSets(sets);
    refreshAutoDrawerLineal();
    calculate();
  });

  byId("drawerSetsWrap").addEventListener("change", (event) => {
    if (event.target.classList.contains("drawer-set-lineal")) {
      const row = event.target.closest("[data-drawer-set-id]");
      if (row) {
        row.dataset.userOverridden = "true";
      }
    }
    calculate();
  });

  byId("drawerSetsWrap").addEventListener("input", (event) => {
    if (event.target.classList.contains("drawer-set-lineal")) {
      const row = event.target.closest("[data-drawer-set-id]");
      if (row) {
        row.dataset.userOverridden = "true";
      }
    }
    calculate();
  });
}

async function hydratePlanBanner() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error("Could not load plan config.");
    }

    const config = await response.json();
    state.config = config;
    state.plan = config.plan || "free";

    const badge = byId("planBadge");
    const label = byId("planLabel");
    const link = byId("upgradeLink");

    if (badge) {
      badge.textContent = state.plan === "pro" ? "Pro plan" : "Free plan";
    }

    if (label) {
      label.textContent = state.plan === "pro"
        ? "You have pro access. Premium tools are enabled for this site."
        : "Use the core calculator for free. Upgrade through Wix to unlock premium tools.";
    }

    if (link) {
      link.href = config.upgradeUrl || "https://www.wix.com/";
      link.textContent = state.plan === "pro" ? "Manage pro access" : "Upgrade with Wix";
    }
  } catch (_err) {
    const badge = byId("planBadge");
    if (badge) {
      badge.textContent = "Free plan";
    }
  }
}

function bindUiEvents() {
  byId("lowerTopType").addEventListener("change", () => {
    toggleStretcherField();
    calculate();
  });

  byId("constructionTypeSelect").addEventListener("change", () => {
    setConstructionType(byId("constructionTypeSelect").value, true);
    calculate();
  });

  byId("jobConstructionTypeSelect").addEventListener("change", () => {
    setConstructionType(byId("jobConstructionTypeSelect").value, true);
    calculate();
  });

  byId("useStandardMaterialsSelect").addEventListener("change", () => {
    if (byId("useStandardMaterialsSelect").value === "yes") {
      applyStandardMaterials();
    }
  });

  byId("calculateBtn").addEventListener("click", calculate);
  byId("saveAssumptionBtn").addEventListener("click", saveConstructionAssumption);
  byId("saveProjectBtn").addEventListener("click", saveProject);
  byId("loadProjectBtn").addEventListener("click", loadSelectedProject);
  byId("deleteProjectBtn").addEventListener("click", deleteSelectedProject);
  byId("addPanelStockBtn").addEventListener("click", addMaterial);
  byId("addHardwareBtn").addEventListener("click", addHardware);
  byId("addAccessoryBtn").addEventListener("click", addAccessory);
  byId("addDoorStyleBtn").addEventListener("click", addDoorStyle);
  byId("addPaintTypeBtn").addEventListener("click", addPaintType);
  byId("addBoardStockBtn").addEventListener("click", addBoardStock);
  byId("addCrownBtn").addEventListener("click", addCrownMoulding);
  byId("addJobAccessoryBtn").addEventListener("click", addJobAccessory);
  byId("printOrderSheetBtn").addEventListener("click", () => {
    updatePrintHeader();
    window.print();
  });
  window.addEventListener("beforeprint", updatePrintHeader);
  byId("calculatorTabBtn").addEventListener("click", () => switchTab("calculator"));
  byId("cabinetStandardsTabBtn").addEventListener("click", () => switchTab("cabinetStandards"));
  byId("materialSetupTabBtn").addEventListener("click", () => switchTab("material"));
  byId("laborSetupTabBtn").addEventListener("click", () => switchTab("labor"));

  byId("panelStockTabBtn").addEventListener("click", () => switchMaterialSubTab("panelStock"));
  byId("boardStockTabBtn").addEventListener("click", () => switchMaterialSubTab("boardStock"));
  byId("hardwareTabBtn").addEventListener("click", () => switchMaterialSubTab("hardware"));
  byId("doorsTabBtn").addEventListener("click", () => switchMaterialSubTab("doors"));
  byId("paintTabBtn").addEventListener("click", () => switchMaterialSubTab("paint"));
  byId("mouldingTabBtn").addEventListener("click", () => switchMaterialSubTab("moulding"));
  byId("accessoriesTabBtn").addEventListener("click", () => switchMaterialSubTab("accessories"));
  byId("defaultsTabBtn").addEventListener("click", () => switchMaterialSubTab("defaults"));

  byId("newHardwareUsedFor").addEventListener("change", () => {
    const usedFor = byId("newHardwareUsedFor").value;
    const label = usedFor === "slides" ? "Price Per Pair ($)" : "Price Per Piece ($)";
    byId("newHardwareCostText").textContent = label;
  });

  byId("defaultsProfileSelect").addEventListener("change", () => {
    renderDefaultsUi();
  });

  byId("lowerLF").addEventListener("input", () => {
    refreshAutoDrawerLineal();
    calculate();
  });

  byId("hasDrawersSelect").addEventListener("change", () => {
    handleDrawerModeChange();
    calculate();
  });

  byId("howManyDrawers").addEventListener("input", () => {
    calculate();
  });
}

async function initialize() {
  renderDrawerSets([]);
  ensureDrawerSetsWhenEnabled();
  refreshAutoDrawerLineal();
  bindUiEvents();
  bindCalculationInputs();
  bindDrawerSetEvents();
  bindListDeleteEvents();
  toggleStretcherField();
  handleDrawerModeChange();
  switchMaterialSubTab("panelStock");

  try {
    await hydratePlanBanner();
    await refreshCatalogUi();
    await populateProjects();
    setConstructionType(byId("constructionTypeSelect").value, true);
    if (byId("defaultsProfileSelect")) {
      byId("defaultsProfileSelect").value = byId("constructionTypeSelect").value;
      renderDefaultsUi();
    }
  } catch (_err) {
    // API calls fail if backend is not running.
  }

  calculate();
}

initialize();
