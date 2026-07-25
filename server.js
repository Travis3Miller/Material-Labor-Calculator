const express = require("express");
const path = require("path");
const fs = require("fs/promises");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "store.json");
const DEFAULT_UPGRADE_URL = process.env.WIX_UPGRADE_URL || "https://www.wix.com/";
const DEFAULT_PRO_FEATURES = [
  "Unlimited saved projects",
  "Advanced reporting tools",
  "Priority support"
];

function getPlanContext(req = {}) {
  const planFromQuery = String(req.query?.plan || "").toLowerCase();
  const planFromHeader = String(req.headers?.["x-plan"] || req.headers?.["x-plan-type"] || "").toLowerCase();
  const token = String(req.headers?.["x-upgrade-token"] || req.query?.token || "");
  const isPro = planFromQuery === "pro" || planFromHeader === "pro" || (token && process.env.WIX_ACCESS_TOKEN && token === process.env.WIX_ACCESS_TOKEN);

  return {
    plan: isPro ? "pro" : "free",
    upgradeUrl: process.env.WIX_UPGRADE_URL || DEFAULT_UPGRADE_URL,
    features: isPro ? DEFAULT_PRO_FEATURES : ["Core calculator", "Saved projects", "Basic quoting"]
  };
}

async function ensureStoreFile() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch (_err) {
    await fs.writeFile(DATA_FILE, JSON.stringify({ projects: [] }, null, 2), "utf8");
  }
}

app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "cabinet-material-calculator" });
});

app.get("/api/config", (req, res) => {
  const plan = getPlanContext(req);
  res.json({
    plan: plan.plan,
    upgradeUrl: plan.upgradeUrl,
    upgradeLink: plan.upgradeUrl,
    freeFeatures: ["Core calculator", "Saved projects", "Basic quoting"],
    proFeatures: DEFAULT_PRO_FEATURES,
    appName: "Cabinet Material Calculator"
  });
});

app.get("/api/plan", (req, res) => {
  res.json(getPlanContext(req));
});

app.post("/api/upgrade/verify", (req, res) => {
  const token = String(req.body?.token || req.query?.token || "");
  const context = getPlanContext(req);

  if (process.env.WIX_ACCESS_TOKEN && token && token === process.env.WIX_ACCESS_TOKEN) {
    return res.json({ plan: "pro", upgradeUrl: context.upgradeUrl, message: "Wix upgrade token accepted." });
  }

  return res.json({ plan: "free", upgradeUrl: context.upgradeUrl, message: "Free access remains active until a Wix-provided upgrade token is verified." });
});

async function readStore() {
  await ensureStoreFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  return normalizeStore(JSON.parse(raw));
}

async function writeStore(store) {
  await ensureStoreFile();
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function normalizeStore(store) {
  const defaultBoardStock = [
    { id: "default-alder", name: "Alder", costPerBdFt: 4.5, wasteFactorPercent: 0, wasteMultiplier: 1, usedFor: "Face Frames" },
    { id: "default-poplar", name: "Poplar", costPerBdFt: 3.5, wasteFactorPercent: 0, wasteMultiplier: 1, usedFor: "Face Frames" }
  ];
  const defaultConstructionAssumptions = [
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
      avgWidth: 18
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
      avgWidth: 18
    }
  ];

  const boardStockCatalog = Array.isArray(store.boardStockCatalog) ? store.boardStockCatalog : [];
  const constructionAssumptionCatalog = Array.isArray(store.constructionAssumptionCatalog) ? store.constructionAssumptionCatalog : [];
  const mergedConstructionAssumptions = defaultConstructionAssumptions.map((item) => {
    return constructionAssumptionCatalog.find((x) => x.type === item.type) || item;
  });

  return {
    projects: Array.isArray(store.projects) ? store.projects : [],
    materialCatalog: Array.isArray(store.materialCatalog) ? store.materialCatalog : [],
    slideCatalog: Array.isArray(store.slideCatalog) ? store.slideCatalog : [],
    accessoryCatalog: Array.isArray(store.accessoryCatalog) ? store.accessoryCatalog : [],
    doorStyleCatalog: Array.isArray(store.doorStyleCatalog) ? store.doorStyleCatalog : [],
    paintTypeCatalog: Array.isArray(store.paintTypeCatalog) ? store.paintTypeCatalog : [],
    hingeTypeCatalog: Array.isArray(store.hingeTypeCatalog) ? store.hingeTypeCatalog : [],
    basePlateTypeCatalog: Array.isArray(store.basePlateTypeCatalog) ? store.basePlateTypeCatalog : [],
    boardStockCatalog: boardStockCatalog.length ? boardStockCatalog : defaultBoardStock,
    crownMouldingCatalog: Array.isArray(store.crownMouldingCatalog) ? store.crownMouldingCatalog : [],
    constructionAssumptionCatalog: mergedConstructionAssumptions
  };
}

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

app.get("/api/projects", async (req, res) => {
  try {
    const store = await readStore();
    res.json(store.projects || []);
  } catch (err) {
    res.status(500).json({ error: "Could not load projects." });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { name, settings, materials, selections } = req.body || {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Project name is required." });
    }

    const store = await readStore();
    const now = new Date().toISOString();
    const project = {
      id: newId(),
      name: name.trim(),
      settings: settings || {},
      materials: materials || {},
      selections: selections || {},
      createdAt: now,
      updatedAt: now
    };

    store.projects = store.projects || [];
    store.projects.push(project);
    await writeStore(store);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: "Could not save project." });
  }
});

app.put("/api/projects/:id", async (req, res) => {
  try {
    const store = await readStore();
    const idx = (store.projects || []).findIndex((p) => p.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Project not found." });
    }

    const existing = store.projects[idx];
    const { name, settings, materials, selections } = req.body || {};

    const updated = {
      ...existing,
      name: typeof name === "string" ? name.trim() : existing.name,
      settings: settings || existing.settings,
      materials: materials || existing.materials,
      selections: selections || existing.selections,
      updatedAt: new Date().toISOString()
    };

    store.projects[idx] = updated;
    await writeStore(store);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Could not update project." });
  }
});

app.get("/api/catalog", async (req, res) => {
  try {
    const store = await readStore();
    res.json({
      materials: store.materialCatalog,
      slides: store.slideCatalog,
      accessories: store.accessoryCatalog,
      doorStyles: store.doorStyleCatalog,
      paintTypes: store.paintTypeCatalog,
      hingeTypes: store.hingeTypeCatalog,
      basePlateTypes: store.basePlateTypeCatalog,
      boardStocks: store.boardStockCatalog,
      crownMouldings: store.crownMouldingCatalog,
      constructionAssumptions: store.constructionAssumptionCatalog
    });
  } catch (err) {
    res.status(500).json({ error: "Could not load material catalog." });
  }
});

app.put("/api/catalog/construction-assumptions/:type", async (req, res) => {
  try {
    const type = req.params.type;
    if (type !== "faceFrame" && type !== "frameless") {
      return res.status(400).json({ error: "Invalid construction assumption type." });
    }

    const body = req.body || {};
    const assumption = {
      type,
      name: type === "faceFrame" ? "Face Frame" : "Frameless / Euro",
      lowerHeight: Number(body.lowerHeight) || 0,
      lowerDepth: Number(body.lowerDepth) || 0,
      lowerTopType: body.lowerTopType === "stretchers" ? "stretchers" : "full",
      stretcherWidth: Number(body.stretcherWidth) || 0,
      upperHeight: Number(body.upperHeight) || 0,
      upperDepth: Number(body.upperDepth) || 0,
      tallHeight: Number(body.tallHeight) || 0,
      tallDepth: Number(body.tallDepth) || 0,
      avgWidth: Number(body.avgWidth) || 18
    };

    const store = await readStore();
    store.constructionAssumptionCatalog = store.constructionAssumptionCatalog.filter((item) => item.type !== type);
    store.constructionAssumptionCatalog.push(assumption);
    await writeStore(normalizeStore(store));
    res.json(assumption);
  } catch (err) {
    res.status(500).json({ error: "Could not save construction assumption." });
  }
});

app.post("/api/catalog/materials", async (req, res) => {
  try {
    const { category, name, thickness, length, width, costPerSheet, wasteFactorPercent, wasteMultiplier } = req.body || {};
    const validCategories = [
      "carcass",
      "back",
      "finishedEnd",
      "toeKick",
      "nailer",
      "drawerBox",
      "drawerBottom"
    ];

    if (!validCategories.includes(category)) {
      return res.status(400).json({ error: "Invalid material category." });
    }

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Material name is required." });
    }

    const store = await readStore();
    const item = {
      id: newId(),
      category,
      name: name.trim(),
      thickness: Number(thickness) || 0,
      length: Number(length) || 0,
      width: Number(width) || 0,
      costPerSheet: Number(costPerSheet) || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || 0,
      wasteMultiplier: Number(wasteMultiplier) || 1
    };

    store.materialCatalog.push(item);
    await writeStore(store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save material." });
  }
});

app.put("/api/catalog/materials/:id", async (req, res) => {
  try {
    const { name, category, thickness, length, width, costPerSheet, wasteFactorPercent, wasteMultiplier } = req.body || {};
    const store = await readStore();
    const idx = store.materialCatalog.findIndex((m) => m.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Material not found." });
    }

    store.materialCatalog[idx] = {
      ...store.materialCatalog[idx],
      category: typeof category === "string" ? category : store.materialCatalog[idx].category,
      name: typeof name === "string" ? name.trim() : store.materialCatalog[idx].name,
      thickness: Number(thickness) || store.materialCatalog[idx].thickness || 0,
      length: Number(length) || store.materialCatalog[idx].length || 0,
      width: Number(width) || store.materialCatalog[idx].width || 0,
      costPerSheet: Number(costPerSheet) || store.materialCatalog[idx].costPerSheet || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || store.materialCatalog[idx].wasteFactorPercent || 0,
      wasteMultiplier: Number(wasteMultiplier) || store.materialCatalog[idx].wasteMultiplier || 1
    };

    await writeStore(store);
    res.json(store.materialCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update material." });
  }
});

app.delete("/api/catalog/materials/:id", async (req, res) => {
  try {
    const store = await readStore();
    const before = store.materialCatalog.length;
    store.materialCatalog = store.materialCatalog.filter((m) => m.id !== req.params.id);

    if (store.materialCatalog.length === before) {
      return res.status(404).json({ error: "Material not found." });
    }

    await writeStore(store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete material." });
  }
});

app.post("/api/catalog/slides", async (req, res) => {
  try {
    const { name, costPerPair, wasteFactorPercent, wasteMultiplier } = req.body || {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Slide name is required." });
    }

    const store = await readStore();
    const slide = {
      id: newId(),
      name: name.trim(),
      costPerPair: Number(costPerPair) || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || 0,
      wasteMultiplier: Number(wasteMultiplier) || 1
    };

    store.slideCatalog.push(slide);
    await writeStore(store);
    res.status(201).json(slide);
  } catch (err) {
    res.status(500).json({ error: "Could not save drawer slide." });
  }
});

app.put("/api/catalog/slides/:id", async (req, res) => {
  try {
    const { name, costPerPair, wasteFactorPercent, wasteMultiplier } = req.body || {};
    const store = await readStore();
    const idx = store.slideCatalog.findIndex((s) => s.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Slide type not found." });
    }

    store.slideCatalog[idx] = {
      ...store.slideCatalog[idx],
      name: typeof name === "string" ? name.trim() : store.slideCatalog[idx].name,
      costPerPair: Number(costPerPair) || store.slideCatalog[idx].costPerPair || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || store.slideCatalog[idx].wasteFactorPercent || 0,
      wasteMultiplier: Number(wasteMultiplier) || store.slideCatalog[idx].wasteMultiplier || 1
    };

    await writeStore(store);
    res.json(store.slideCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update drawer slide." });
  }
});

app.delete("/api/catalog/slides/:id", async (req, res) => {
  try {
    const store = await readStore();
    const before = store.slideCatalog.length;
    store.slideCatalog = store.slideCatalog.filter((s) => s.id !== req.params.id);

    if (store.slideCatalog.length === before) {
      return res.status(404).json({ error: "Slide type not found." });
    }

    await writeStore(store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete drawer slide." });
  }
});

app.post("/api/catalog/accessories", async (req, res) => {
  try {
    const { name, costEach } = req.body || {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Accessory name is required." });
    }

    const store = await readStore();
    const accessory = {
      id: newId(),
      name: name.trim(),
      costEach: Number(costEach) || 0
    };

    store.accessoryCatalog.push(accessory);
    await writeStore(store);
    res.status(201).json(accessory);
  } catch (err) {
    res.status(500).json({ error: "Could not save accessory." });
  }
});

app.put("/api/catalog/accessories/:id", async (req, res) => {
  try {
    const { name, costEach } = req.body || {};
    const store = await readStore();
    const idx = store.accessoryCatalog.findIndex((a) => a.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Accessory not found." });
    }

    store.accessoryCatalog[idx] = {
      ...store.accessoryCatalog[idx],
      name: typeof name === "string" ? name.trim() : store.accessoryCatalog[idx].name,
      costEach: Number(costEach) || store.accessoryCatalog[idx].costEach || 0
    };

    await writeStore(store);
    res.json(store.accessoryCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update accessory." });
  }
});

app.delete("/api/catalog/accessories/:id", async (req, res) => {
  try {
    const store = await readStore();
    const before = store.accessoryCatalog.length;
    store.accessoryCatalog = store.accessoryCatalog.filter((a) => a.id !== req.params.id);

    if (store.accessoryCatalog.length === before) {
      return res.status(404).json({ error: "Accessory not found." });
    }

    await writeStore(store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete accessory." });
  }
});

app.post("/api/catalog/door-styles", async (req, res) => {
  try {
    const { name, costPerSqFt } = req.body || {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Door style name is required." });
    }

    const store = await readStore();
    const style = {
      id: newId(),
      name: name.trim(),
      costPerSqFt: Number(costPerSqFt) || 0
    };

    store.doorStyleCatalog.push(style);
    await writeStore(store);
    res.status(201).json(style);
  } catch (err) {
    res.status(500).json({ error: "Could not save door style." });
  }
});

app.put("/api/catalog/door-styles/:id", async (req, res) => {
  try {
    const { name, costPerSqFt } = req.body || {};
    const store = await readStore();
    const idx = store.doorStyleCatalog.findIndex((s) => s.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Door style not found." });
    }

    store.doorStyleCatalog[idx] = {
      ...store.doorStyleCatalog[idx],
      name: typeof name === "string" ? name.trim() : store.doorStyleCatalog[idx].name,
      costPerSqFt: Number(costPerSqFt) || store.doorStyleCatalog[idx].costPerSqFt || 0
    };

    await writeStore(store);
    res.json(store.doorStyleCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update door style." });
  }
});

app.delete("/api/catalog/door-styles/:id", async (req, res) => {
  try {
    const store = await readStore();
    const before = store.doorStyleCatalog.length;
    store.doorStyleCatalog = store.doorStyleCatalog.filter((d) => d.id !== req.params.id);

    if (store.doorStyleCatalog.length === before) {
      return res.status(404).json({ error: "Door style not found." });
    }

    await writeStore(store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete door style." });
  }
});

app.post("/api/catalog/paint-types", async (req, res) => {
  try {
    const { name, primerCostPerGallon, topcoatCostPerGallon } = req.body || {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Paint type name is required." });
    }

    const store = await readStore();
    const item = {
      id: newId(),
      name: name.trim(),
      primerCostPerGallon: Number(primerCostPerGallon) || 0,
      topcoatCostPerGallon: Number(topcoatCostPerGallon) || 0
    };

    store.paintTypeCatalog.push(item);
    await writeStore(store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save paint type." });
  }
});

app.put("/api/catalog/paint-types/:id", async (req, res) => {
  try {
    const { name, primerCostPerGallon, topcoatCostPerGallon } = req.body || {};
    const store = await readStore();
    const idx = store.paintTypeCatalog.findIndex((p) => p.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Paint type not found." });
    }

    store.paintTypeCatalog[idx] = {
      ...store.paintTypeCatalog[idx],
      name: typeof name === "string" ? name.trim() : store.paintTypeCatalog[idx].name,
      primerCostPerGallon: Number(primerCostPerGallon) || store.paintTypeCatalog[idx].primerCostPerGallon || 0,
      topcoatCostPerGallon: Number(topcoatCostPerGallon) || store.paintTypeCatalog[idx].topcoatCostPerGallon || 0
    };

    await writeStore(store);
    res.json(store.paintTypeCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update paint type." });
  }
});

app.delete("/api/catalog/paint-types/:id", async (req, res) => {
  try {
    const store = await readStore();
    const before = store.paintTypeCatalog.length;
    store.paintTypeCatalog = store.paintTypeCatalog.filter((p) => p.id !== req.params.id);

    if (store.paintTypeCatalog.length === before) {
      return res.status(404).json({ error: "Paint type not found." });
    }

    await writeStore(store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete paint type." });
  }
});

app.post("/api/catalog/hinge-types", async (req, res) => {
  try {
    const { name, costEach, wasteFactorPercent, wasteMultiplier } = req.body || {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Hinge type name is required." });
    }

    const store = await readStore();
    const item = {
      id: newId(),
      name: name.trim(),
      costEach: Number(costEach) || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || 0,
      wasteMultiplier: Number(wasteMultiplier) || 1
    };

    store.hingeTypeCatalog.push(item);
    await writeStore(store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save hinge type." });
  }
});

app.put("/api/catalog/hinge-types/:id", async (req, res) => {
  try {
    const { name, costEach, wasteFactorPercent, wasteMultiplier } = req.body || {};
    const store = await readStore();
    const idx = store.hingeTypeCatalog.findIndex((h) => h.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Hinge type not found." });
    }

    store.hingeTypeCatalog[idx] = {
      ...store.hingeTypeCatalog[idx],
      name: typeof name === "string" ? name.trim() : store.hingeTypeCatalog[idx].name,
      costEach: Number(costEach) || store.hingeTypeCatalog[idx].costEach || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || store.hingeTypeCatalog[idx].wasteFactorPercent || 0,
      wasteMultiplier: Number(wasteMultiplier) || store.hingeTypeCatalog[idx].wasteMultiplier || 1
    };

    await writeStore(store);
    res.json(store.hingeTypeCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update hinge type." });
  }
});

app.delete("/api/catalog/hinge-types/:id", async (req, res) => {
  try {
    const store = await readStore();
    const before = store.hingeTypeCatalog.length;
    store.hingeTypeCatalog = store.hingeTypeCatalog.filter((h) => h.id !== req.params.id);

    if (store.hingeTypeCatalog.length === before) {
      return res.status(404).json({ error: "Hinge type not found." });
    }

    await writeStore(store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete hinge type." });
  }
});

app.post("/api/catalog/base-plate-types", async (req, res) => {
  try {
    const { name, costEach, wasteFactorPercent, wasteMultiplier } = req.body || {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Base plate type name is required." });
    }

    const store = await readStore();
    const item = {
      id: newId(),
      name: name.trim(),
      costEach: Number(costEach) || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || 0,
      wasteMultiplier: Number(wasteMultiplier) || 1
    };

    store.basePlateTypeCatalog.push(item);
    await writeStore(store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save base plate type." });
  }
});

app.put("/api/catalog/base-plate-types/:id", async (req, res) => {
  try {
    const { name, costEach, wasteFactorPercent, wasteMultiplier } = req.body || {};
    const store = await readStore();
    const idx = store.basePlateTypeCatalog.findIndex((b) => b.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Base plate type not found." });
    }

    store.basePlateTypeCatalog[idx] = {
      ...store.basePlateTypeCatalog[idx],
      name: typeof name === "string" ? name.trim() : store.basePlateTypeCatalog[idx].name,
      costEach: Number(costEach) || store.basePlateTypeCatalog[idx].costEach || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || store.basePlateTypeCatalog[idx].wasteFactorPercent || 0,
      wasteMultiplier: Number(wasteMultiplier) || store.basePlateTypeCatalog[idx].wasteMultiplier || 1
    };

    await writeStore(store);
    res.json(store.basePlateTypeCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update base plate type." });
  }
});

app.delete("/api/catalog/base-plate-types/:id", async (req, res) => {
  try {
    const store = await readStore();
    const before = store.basePlateTypeCatalog.length;
    store.basePlateTypeCatalog = store.basePlateTypeCatalog.filter((b) => b.id !== req.params.id);

    if (store.basePlateTypeCatalog.length === before) {
      return res.status(404).json({ error: "Base plate type not found." });
    }

    await writeStore(store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete base plate type." });
  }
});

app.post("/api/catalog/board-stocks", async (req, res) => {
  try {
    const { name, costPerBdFt, wasteMultiplier, wasteFactorPercent, usedFor } = req.body || {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Board stock name is required." });
    }

    const store = await readStore();
    const item = {
      id: newId(),
      name: name.trim(),
      costPerBdFt: Number(costPerBdFt) || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || 0,
      wasteMultiplier: Number(wasteMultiplier) || 1,
      usedFor: typeof usedFor === "string" ? usedFor : "Face Frames"
    };

    store.boardStockCatalog.push(item);
    await writeStore(store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save board stock." });
  }
});

app.put("/api/catalog/board-stocks/:id", async (req, res) => {
  try {
    const { name, costPerBdFt, wasteMultiplier, wasteFactorPercent, usedFor } = req.body || {};
    const store = await readStore();
    const idx = store.boardStockCatalog.findIndex((b) => b.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Board stock not found." });
    }

    store.boardStockCatalog[idx] = {
      ...store.boardStockCatalog[idx],
      name: typeof name === "string" ? name.trim() : store.boardStockCatalog[idx].name,
      costPerBdFt: Number(costPerBdFt) || store.boardStockCatalog[idx].costPerBdFt || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || store.boardStockCatalog[idx].wasteFactorPercent || 0,
      wasteMultiplier: Number(wasteMultiplier) || store.boardStockCatalog[idx].wasteMultiplier || 1,
      usedFor: typeof usedFor === "string" ? usedFor : (store.boardStockCatalog[idx].usedFor || "Face Frames")
    };

    await writeStore(store);
    res.json(store.boardStockCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update board stock." });
  }
});

app.delete("/api/catalog/board-stocks/:id", async (req, res) => {
  try {
    const store = await readStore();
    const before = store.boardStockCatalog.length;
    store.boardStockCatalog = store.boardStockCatalog.filter((b) => b.id !== req.params.id);

    if (store.boardStockCatalog.length === before) {
      return res.status(404).json({ error: "Board stock not found." });
    }

    await writeStore(store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete board stock." });
  }
});

app.post("/api/catalog/crown-mouldings", async (req, res) => {
  try {
    const { name, costPerLf, wasteMultiplier, wasteFactorPercent, usedFor } = req.body || {};

    if (!name || typeof name !== "string") {
      return res.status(400).json({ error: "Crown moulding name is required." });
    }

    const store = await readStore();
    const item = {
      id: newId(),
      name: name.trim(),
      costPerLf: Number(costPerLf) || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || 0,
      wasteMultiplier: Number(wasteMultiplier) || 1,
      usedFor: typeof usedFor === "string" ? usedFor : "Crown Moulding"
    };

    store.crownMouldingCatalog = store.crownMouldingCatalog || [];
    store.crownMouldingCatalog.push(item);
    await writeStore(store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save crown moulding." });
  }
});

app.put("/api/catalog/crown-mouldings/:id", async (req, res) => {
  try {
    const { name, costPerLf, wasteMultiplier, wasteFactorPercent, usedFor } = req.body || {};
    const store = await readStore();
    const idx = (store.crownMouldingCatalog || []).findIndex((c) => c.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Crown moulding not found." });
    }

    store.crownMouldingCatalog[idx] = {
      ...store.crownMouldingCatalog[idx],
      name: typeof name === "string" ? name.trim() : store.crownMouldingCatalog[idx].name,
      costPerLf: Number(costPerLf) || store.crownMouldingCatalog[idx].costPerLf || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || store.crownMouldingCatalog[idx].wasteFactorPercent || 0,
      wasteMultiplier: Number(wasteMultiplier) || store.crownMouldingCatalog[idx].wasteMultiplier || 1,
      usedFor: typeof usedFor === "string" ? usedFor : (store.crownMouldingCatalog[idx].usedFor || "Crown Moulding")
    };

    await writeStore(store);
    res.json(store.crownMouldingCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update crown moulding." });
  }
});

app.delete("/api/catalog/crown-mouldings/:id", async (req, res) => {
  try {
    const store = await readStore();
    const before = (store.crownMouldingCatalog || []).length;
    store.crownMouldingCatalog = (store.crownMouldingCatalog || []).filter((item) => item.id !== req.params.id);

    if (store.crownMouldingCatalog.length === before) {
      return res.status(404).json({ error: "Crown moulding not found." });
    }

    await writeStore(store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete crown moulding." });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    const store = await readStore();
    const before = (store.projects || []).length;
    store.projects = (store.projects || []).filter((p) => p.id !== req.params.id);

    if (store.projects.length === before) {
      return res.status(404).json({ error: "Project not found." });
    }

    await writeStore(store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete project." });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Cabinet calculator running at http://localhost:${PORT}`);
  });
}

module.exports = {
  app,
  createApp: () => app
};
