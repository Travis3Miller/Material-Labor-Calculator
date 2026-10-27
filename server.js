const express = require("express");
const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.CALCULATOR_STORE_FILE || path.join(__dirname, "data", "store.json");
const PUBLIC_SCOPE = "__public__";
const database = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;
const databaseReady = database
  ? database.query(`
      CREATE TABLE IF NOT EXISTS material_labor_stores (
        scope_id TEXT PRIMARY KEY,
        store JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
  : Promise.resolve();
const SESSION_TTL_MS = 30 * 60 * 1000;
const PAID_FEATURES = ["Saved projects", "Cabinetry standards setup", "Material setup", "Labor setup"];
const FREE_FEATURES = ["Core calculator", "Print / export order sheet"];
let wixClientToken = "";
let wixClientTokenExpiresAt = 0;
const entitlementCache = new Map();

function safeCompare(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function encodeTokenPart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function sessionSecret() {
  return String(process.env.SESSION_SECRET || "").trim();
}

function createSessionToken(payload) {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error("SESSION_SECRET is not configured.");
  }
  const body = encodeTokenPart(payload);
  const signature = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifySessionToken(token) {
  const [body, signature, extra] = String(token || "").split(".");
  const secret = sessionSecret();
  if (!body || !signature || extra || !secret) {
    return null;
  }
  const expected = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeCompare(signature, expected)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload || !payload.sub || !Number.isFinite(payload.exp) || payload.exp <= Date.now()) {
      return null;
    }
    return payload;
  } catch (_err) {
    return null;
  }
}

function trustedWixBridge(req) {
  const secret = String(process.env.MATERIAL_LABOR_BRIDGE_SECRET || "").trim();
  return Boolean(secret && safeCompare(req.get("x-wix-bridge-secret"), secret));
}

function paidPlanIds() {
  return new Set(String(process.env.WIX_PAID_PLAN_IDS || "")
    .split(",")
    .map((id) => id.trim().toUpperCase())
    .filter(Boolean));
}

async function getWixClientAccessToken() {
  const clientId = String(process.env.WIX_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.WIX_CLIENT_SECRET || "").trim();
  if (!clientId || !clientSecret) {
    return null;
  }
  if (wixClientToken && wixClientTokenExpiresAt > Date.now() + 30_000) {
    return wixClientToken;
  }
  const response = await fetch("https://www.wixapis.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  if (!response.ok) {
    throw new Error(`Wix token request failed with ${response.status}.`);
  }
  const body = await response.json();
  if (!body || typeof body.access_token !== "string" || !body.access_token.trim()) {
    throw new Error("Wix token response did not include an access token.");
  }
  wixClientToken = body.access_token.trim();
  wixClientTokenExpiresAt = Date.now() + Math.max(60, Number(body.expires_in) || 240) * 1000;
  return wixClientToken;
}

async function hasPaidAccess(memberId) {
  if (!memberId || !paidPlanIds().size) {
    return false;
  }
  const cached = entitlementCache.get(memberId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.allowed;
  }
  const token = await getWixClientAccessToken();
  if (!token) {
    return false;
  }
  const url = new URL("https://www.wixapis.com/pricing-plans/v2/orders");
  url.searchParams.set("buyerIds", memberId);
  url.searchParams.set("orderStatuses", "ACTIVE");
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (process.env.WIX_SITE_ID) {
    headers["wix-site-id"] = process.env.WIX_SITE_ID;
  }
  const response = await fetch(url, {
    headers
  });
  if (!response.ok) {
    throw new Error(`Wix plan verification failed with ${response.status}.`);
  }
  const result = await response.json();
  const orders = Array.isArray(result)
    ? result
    : Array.isArray(result.orders)
      ? result.orders
      : result.orders && Array.isArray(result.orders.results)
        ? result.orders.results
        : result.data && Array.isArray(result.data.orders)
          ? result.data.orders
          : [];
  const allowed = Array.isArray(orders) && orders.some((order) =>
    String(order.status || "").toUpperCase() === "ACTIVE"
      && paidPlanIds().has(String(order.planId || "").toUpperCase())
  );
  entitlementCache.set(memberId, { allowed, expiresAt: Date.now() + 60_000 });
  return allowed;
}

function requireAuth(req, res, next) {
  if (!req.currentUser) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  next();
}

async function requireSubscriber(req, res, next) {
  try {
    if (!req.currentUser) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!(await hasPaidAccess(req.currentUser.sub))) {
      res.status(403).json({ error: "Active paid subscription required." });
      return;
    }
    next();
  } catch (_err) {
    res.status(503).json({ error: "Could not verify subscription access." });
  }
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
app.use((req, _res, next) => {
  const authorization = String(req.get("authorization") || "");
  const bearer = authorization.match(/^Bearer\s+(.+)$/i);
  req.currentUser = bearer ? verifySessionToken(bearer[1].trim()) : null;
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "cabinet-material-calculator" });
});

app.get("/api/config", async (req, res) => {
  let isPro = false;
  try {
    isPro = Boolean(req.currentUser && await hasPaidAccess(req.currentUser.sub));
  } catch (_err) {
    res.status(503).json({ error: "Could not verify subscription access." });
    return;
  }
  res.json({
    authenticated: Boolean(req.currentUser),
    name: req.currentUser ? req.currentUser.name : "",
    plan: isPro ? "pro" : "free",
    upgradeUrl: process.env.WIX_UPGRADE_URL || "",
    freeFeatures: FREE_FEATURES,
    proFeatures: PAID_FEATURES,
    appName: "Cabinet Material Calculator"
  });
});

app.get("/api/auth/session", async (req, res) => {
  let isPro = false;
  try {
    isPro = Boolean(req.currentUser && await hasPaidAccess(req.currentUser.sub));
  } catch (_err) {
    res.status(503).json({ error: "Could not verify subscription access." });
    return;
  }
  res.json({
    authenticated: Boolean(req.currentUser),
    user: req.currentUser ? {
      id: req.currentUser.sub,
      email: req.currentUser.email || "",
      name: req.currentUser.name || ""
    } : null,
    plan: isPro ? "pro" : "free"
  });
});

app.post("/api/auth/wix/bridge", async (req, res) => {
  if (!trustedWixBridge(req)) {
    res.status(401).json({ error: "Untrusted Wix bridge request." });
    return;
  }
  if (!sessionSecret()) {
    res.status(503).json({ error: "SESSION_SECRET is not configured." });
    return;
  }
  const source = req.body && typeof req.body === "object" ? req.body : {};
  const memberId = typeof source.externalMemberId === "string" ? source.externalMemberId.trim().slice(0, 200) : "";
  if (!memberId) {
    res.status(400).json({ error: "Wix member ID is required." });
    return;
  }
  try {
    const paid = await hasPaidAccess(memberId);
    const user = {
      id: memberId,
      email: typeof source.email === "string" ? source.email.trim().slice(0, 320) : "",
      name: typeof source.name === "string" ? source.name.trim().slice(0, 100) : ""
    };
    const sessionToken = createSessionToken({
      sub: memberId,
      email: user.email,
      name: user.name,
      exp: Date.now() + SESSION_TTL_MS
    });
    res.json({ authenticated: true, user, plan: paid ? "pro" : "free", paid, sessionToken });
  } catch (_err) {
    res.status(503).json({ error: "Could not establish Wix member session." });
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api/projects", (req, res, next) => {
  if (req.method === "GET") {
    requireAuth(req, res, next);
    return;
  }
  requireSubscriber(req, res, next);
});

app.use("/api/catalog", (req, res, next) => {
  if (req.method === "GET") {
    next();
    return;
  }
  requireSubscriber(req, res, next);
});

app.use("/api/settings", (req, res, next) => {
  if (req.method === "GET") {
    requireAuth(req, res, next);
    return;
  }
  requireSubscriber(req, res, next);
});

app.get("/api/settings", async (req, res) => {
  try {
    const store = await readStore(req);
    res.json(store.settings || {});
  } catch (_err) {
    res.status(500).json({ error: "Could not load setup settings." });
  }
});

app.put("/api/settings", async (req, res) => {
  try {
    const store = await readStore(req);
    const input = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body
      : {};
    store.settings = {
      wasteFactorPercent: Number.isFinite(Number(input.wasteFactorPercent))
        ? Math.max(0, Number(input.wasteFactorPercent))
        : 15,
      buildLfPerHour: Number.isFinite(Number(input.buildLfPerHour))
        ? Math.max(0.01, Number(input.buildLfPerHour))
        : 1,
      installLfPerHour: Number.isFinite(Number(input.installLfPerHour))
        ? Math.max(0.01, Number(input.installLfPerHour))
        : 1,
      finishLfPerHour: Number.isFinite(Number(input.finishLfPerHour))
        ? Math.max(0.01, Number(input.finishLfPerHour))
        : 2,
      shopCostPerHour: Number.isFinite(Number(input.shopCostPerHour))
        ? Math.max(0, Number(input.shopCostPerHour))
        : 65,
      standards: input.standards && typeof input.standards === "object" && !Array.isArray(input.standards)
        ? input.standards
        : {}
    };
    await writeStore(req, store);
    res.json(store.settings);
  } catch (_err) {
    res.status(500).json({ error: "Could not save setup settings." });
  }
});

async function readStore(req) {
  await databaseReady;
  const userId = req && req.currentUser && req.currentUser.sub;
  if (database) {
    const scopeId = userId || PUBLIC_SCOPE;
    const result = await database.query(
      "SELECT store FROM material_labor_stores WHERE scope_id = $1",
      [scopeId]
    );
    if (result.rows[0]) {
      const store = normalizeStore(result.rows[0].store);
      return userId ? store : { ...store, projects: [] };
    }
    if (userId) {
      const shared = await database.query(
        "SELECT store FROM material_labor_stores WHERE scope_id = $1",
        [PUBLIC_SCOPE]
      );
      if (shared.rows[0]) {
        return { ...normalizeStore(shared.rows[0].store), projects: [] };
      }
    }
  }
  await ensureStoreFile();
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const stored = JSON.parse(raw);
  const globalStore = normalizeStore(stored.global || stored);
  if (!userId) {
    return { ...globalStore, projects: [] };
  }
  if (database) {
    return { ...globalStore, projects: [] };
  }
  const userKey = `member:${Buffer.from(userId).toString("base64url")}`;
  const userStore = stored.users && stored.users[userKey];
  if (userStore) {
    return normalizeStore(userStore);
  }
  return { ...globalStore, projects: [] };
}

async function writeStore(req, store) {
  const userId = req && req.currentUser && req.currentUser.sub;
  if (!userId) {
    throw new Error("Authenticated user required to save app data.");
  }
  await databaseReady;
  if (database) {
    await database.query(
      `INSERT INTO material_labor_stores (scope_id, store, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (scope_id) DO UPDATE
       SET store = EXCLUDED.store, updated_at = NOW()`,
      [userId, JSON.stringify(normalizeStore(store))]
    );
    return;
  }
  await ensureStoreFile();
  const stored = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  const globalStore = normalizeStore(stored.global || stored);
  const users = stored.users && typeof stored.users === "object" ? stored.users : Object.create(null);
  const userKey = `member:${Buffer.from(userId).toString("base64url")}`;
  users[userKey] = normalizeStore(store);
  await fs.writeFile(DATA_FILE, JSON.stringify({ global: globalStore, users }, null, 2), "utf8");
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
    settings: store.settings && typeof store.settings === "object" && !Array.isArray(store.settings)
      ? store.settings
      : {},
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
    const store = await readStore(req);
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

    const store = await readStore(req);
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
    await writeStore(req, store);
    res.status(201).json(project);
  } catch (err) {
    res.status(500).json({ error: "Could not save project." });
  }
});

app.put("/api/projects/:id", async (req, res) => {
  try {
    const store = await readStore(req);
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
    await writeStore(req, store);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Could not update project." });
  }
});

app.get("/api/catalog", async (req, res) => {
  try {
    const store = await readStore(req);
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

    const store = await readStore(req);
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

    const store = await readStore(req);
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
    await writeStore(req, store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save material." });
  }
});

app.put("/api/catalog/materials/:id", async (req, res) => {
  try {
    const { name, category, thickness, length, width, costPerSheet, wasteFactorPercent, wasteMultiplier } = req.body || {};
    const store = await readStore(req);
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

    await writeStore(req, store);
    res.json(store.materialCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update material." });
  }
});

app.delete("/api/catalog/materials/:id", async (req, res) => {
  try {
    const store = await readStore(req);
    const before = store.materialCatalog.length;
    store.materialCatalog = store.materialCatalog.filter((m) => m.id !== req.params.id);

    if (store.materialCatalog.length === before) {
      return res.status(404).json({ error: "Material not found." });
    }

    await writeStore(req, store);
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

    const store = await readStore(req);
    const slide = {
      id: newId(),
      name: name.trim(),
      costPerPair: Number(costPerPair) || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || 0,
      wasteMultiplier: Number(wasteMultiplier) || 1
    };

    store.slideCatalog.push(slide);
    await writeStore(req, store);
    res.status(201).json(slide);
  } catch (err) {
    res.status(500).json({ error: "Could not save drawer slide." });
  }
});

app.put("/api/catalog/slides/:id", async (req, res) => {
  try {
    const { name, costPerPair, wasteFactorPercent, wasteMultiplier } = req.body || {};
    const store = await readStore(req);
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

    await writeStore(req, store);
    res.json(store.slideCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update drawer slide." });
  }
});

app.delete("/api/catalog/slides/:id", async (req, res) => {
  try {
    const store = await readStore(req);
    const before = store.slideCatalog.length;
    store.slideCatalog = store.slideCatalog.filter((s) => s.id !== req.params.id);

    if (store.slideCatalog.length === before) {
      return res.status(404).json({ error: "Slide type not found." });
    }

    await writeStore(req, store);
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

    const store = await readStore(req);
    const accessory = {
      id: newId(),
      name: name.trim(),
      costEach: Number(costEach) || 0
    };

    store.accessoryCatalog.push(accessory);
    await writeStore(req, store);
    res.status(201).json(accessory);
  } catch (err) {
    res.status(500).json({ error: "Could not save accessory." });
  }
});

app.put("/api/catalog/accessories/:id", async (req, res) => {
  try {
    const { name, costEach } = req.body || {};
    const store = await readStore(req);
    const idx = store.accessoryCatalog.findIndex((a) => a.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Accessory not found." });
    }

    store.accessoryCatalog[idx] = {
      ...store.accessoryCatalog[idx],
      name: typeof name === "string" ? name.trim() : store.accessoryCatalog[idx].name,
      costEach: Number(costEach) || store.accessoryCatalog[idx].costEach || 0
    };

    await writeStore(req, store);
    res.json(store.accessoryCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update accessory." });
  }
});

app.delete("/api/catalog/accessories/:id", async (req, res) => {
  try {
    const store = await readStore(req);
    const before = store.accessoryCatalog.length;
    store.accessoryCatalog = store.accessoryCatalog.filter((a) => a.id !== req.params.id);

    if (store.accessoryCatalog.length === before) {
      return res.status(404).json({ error: "Accessory not found." });
    }

    await writeStore(req, store);
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

    const store = await readStore(req);
    const style = {
      id: newId(),
      name: name.trim(),
      costPerSqFt: Number(costPerSqFt) || 0
    };

    store.doorStyleCatalog.push(style);
    await writeStore(req, store);
    res.status(201).json(style);
  } catch (err) {
    res.status(500).json({ error: "Could not save door style." });
  }
});

app.put("/api/catalog/door-styles/:id", async (req, res) => {
  try {
    const { name, costPerSqFt } = req.body || {};
    const store = await readStore(req);
    const idx = store.doorStyleCatalog.findIndex((s) => s.id === req.params.id);

    if (idx < 0) {
      return res.status(404).json({ error: "Door style not found." });
    }

    store.doorStyleCatalog[idx] = {
      ...store.doorStyleCatalog[idx],
      name: typeof name === "string" ? name.trim() : store.doorStyleCatalog[idx].name,
      costPerSqFt: Number(costPerSqFt) || store.doorStyleCatalog[idx].costPerSqFt || 0
    };

    await writeStore(req, store);
    res.json(store.doorStyleCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update door style." });
  }
});

app.delete("/api/catalog/door-styles/:id", async (req, res) => {
  try {
    const store = await readStore(req);
    const before = store.doorStyleCatalog.length;
    store.doorStyleCatalog = store.doorStyleCatalog.filter((d) => d.id !== req.params.id);

    if (store.doorStyleCatalog.length === before) {
      return res.status(404).json({ error: "Door style not found." });
    }

    await writeStore(req, store);
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

    const store = await readStore(req);
    const item = {
      id: newId(),
      name: name.trim(),
      primerCostPerGallon: Number(primerCostPerGallon) || 0,
      topcoatCostPerGallon: Number(topcoatCostPerGallon) || 0
    };

    store.paintTypeCatalog.push(item);
    await writeStore(req, store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save paint type." });
  }
});

app.put("/api/catalog/paint-types/:id", async (req, res) => {
  try {
    const { name, primerCostPerGallon, topcoatCostPerGallon } = req.body || {};
    const store = await readStore(req);
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

    await writeStore(req, store);
    res.json(store.paintTypeCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update paint type." });
  }
});

app.delete("/api/catalog/paint-types/:id", async (req, res) => {
  try {
    const store = await readStore(req);
    const before = store.paintTypeCatalog.length;
    store.paintTypeCatalog = store.paintTypeCatalog.filter((p) => p.id !== req.params.id);

    if (store.paintTypeCatalog.length === before) {
      return res.status(404).json({ error: "Paint type not found." });
    }

    await writeStore(req, store);
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

    const store = await readStore(req);
    const item = {
      id: newId(),
      name: name.trim(),
      costEach: Number(costEach) || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || 0,
      wasteMultiplier: Number(wasteMultiplier) || 1
    };

    store.hingeTypeCatalog.push(item);
    await writeStore(req, store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save hinge type." });
  }
});

app.put("/api/catalog/hinge-types/:id", async (req, res) => {
  try {
    const { name, costEach, wasteFactorPercent, wasteMultiplier } = req.body || {};
    const store = await readStore(req);
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

    await writeStore(req, store);
    res.json(store.hingeTypeCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update hinge type." });
  }
});

app.delete("/api/catalog/hinge-types/:id", async (req, res) => {
  try {
    const store = await readStore(req);
    const before = store.hingeTypeCatalog.length;
    store.hingeTypeCatalog = store.hingeTypeCatalog.filter((h) => h.id !== req.params.id);

    if (store.hingeTypeCatalog.length === before) {
      return res.status(404).json({ error: "Hinge type not found." });
    }

    await writeStore(req, store);
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

    const store = await readStore(req);
    const item = {
      id: newId(),
      name: name.trim(),
      costEach: Number(costEach) || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || 0,
      wasteMultiplier: Number(wasteMultiplier) || 1
    };

    store.basePlateTypeCatalog.push(item);
    await writeStore(req, store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save base plate type." });
  }
});

app.put("/api/catalog/base-plate-types/:id", async (req, res) => {
  try {
    const { name, costEach, wasteFactorPercent, wasteMultiplier } = req.body || {};
    const store = await readStore(req);
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

    await writeStore(req, store);
    res.json(store.basePlateTypeCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update base plate type." });
  }
});

app.delete("/api/catalog/base-plate-types/:id", async (req, res) => {
  try {
    const store = await readStore(req);
    const before = store.basePlateTypeCatalog.length;
    store.basePlateTypeCatalog = store.basePlateTypeCatalog.filter((b) => b.id !== req.params.id);

    if (store.basePlateTypeCatalog.length === before) {
      return res.status(404).json({ error: "Base plate type not found." });
    }

    await writeStore(req, store);
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

    const store = await readStore(req);
    const item = {
      id: newId(),
      name: name.trim(),
      costPerBdFt: Number(costPerBdFt) || 0,
      wasteFactorPercent: Number(wasteFactorPercent) || 0,
      wasteMultiplier: Number(wasteMultiplier) || 1,
      usedFor: typeof usedFor === "string" ? usedFor : "Face Frames"
    };

    store.boardStockCatalog.push(item);
    await writeStore(req, store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save board stock." });
  }
});

app.put("/api/catalog/board-stocks/:id", async (req, res) => {
  try {
    const { name, costPerBdFt, wasteMultiplier, wasteFactorPercent, usedFor } = req.body || {};
    const store = await readStore(req);
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

    await writeStore(req, store);
    res.json(store.boardStockCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update board stock." });
  }
});

app.delete("/api/catalog/board-stocks/:id", async (req, res) => {
  try {
    const store = await readStore(req);
    const before = store.boardStockCatalog.length;
    store.boardStockCatalog = store.boardStockCatalog.filter((b) => b.id !== req.params.id);

    if (store.boardStockCatalog.length === before) {
      return res.status(404).json({ error: "Board stock not found." });
    }

    await writeStore(req, store);
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

    const store = await readStore(req);
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
    await writeStore(req, store);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ error: "Could not save crown moulding." });
  }
});

app.put("/api/catalog/crown-mouldings/:id", async (req, res) => {
  try {
    const { name, costPerLf, wasteMultiplier, wasteFactorPercent, usedFor } = req.body || {};
    const store = await readStore(req);
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

    await writeStore(req, store);
    res.json(store.crownMouldingCatalog[idx]);
  } catch (err) {
    res.status(500).json({ error: "Could not update crown moulding." });
  }
});

app.delete("/api/catalog/crown-mouldings/:id", async (req, res) => {
  try {
    const store = await readStore(req);
    const before = (store.crownMouldingCatalog || []).length;
    store.crownMouldingCatalog = (store.crownMouldingCatalog || []).filter((item) => item.id !== req.params.id);

    if (store.crownMouldingCatalog.length === before) {
      return res.status(404).json({ error: "Crown moulding not found." });
    }

    await writeStore(req, store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete crown moulding." });
  }
});

app.delete("/api/projects/:id", async (req, res) => {
  try {
    const store = await readStore(req);
    const before = (store.projects || []).length;
    store.projects = (store.projects || []).filter((p) => p.id !== req.params.id);

    if (store.projects.length === before) {
      return res.status(404).json({ error: "Project not found." });
    }

    await writeStore(req, store);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Could not delete project." });
  }
});

if (require.main === module) {
  databaseReady
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Cabinet calculator running at http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error("Could not initialize app storage.", err);
      process.exitCode = 1;
    });
}

module.exports = {
  app,
  createApp: () => app
};
