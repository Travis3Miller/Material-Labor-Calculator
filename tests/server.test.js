const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

let server;
let baseUrl;
let tempDir;
let app;
let memberSession;
let paidSession;
const nativeFetch = global.fetch;

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "material-labor-test-"));
  process.env.CALCULATOR_STORE_FILE = path.join(tempDir, "store.json");
  await fs.writeFile(process.env.CALCULATOR_STORE_FILE, JSON.stringify({
    constructionAssumptionCatalog: [
      { type: "faceFrame", lowerHeight: 34.5, tallDepth: 24, topDrawerHeight: 5, middleDrawerHeight: 10, bottomDrawerHeight: 10 },
      { type: "frameless", lowerHeight: 34.5, tallDepth: 24, topDrawerHeight: 5, middleDrawerHeight: 10, bottomDrawerHeight: 10 }
    ]
  }));
  process.env.DATABASE_URL = "";
  process.env.SESSION_SECRET = "test-session-secret";
  process.env.MATERIAL_LABOR_BRIDGE_SECRET = "test-bridge-secret";
  process.env.WIX_CLIENT_ID = "test-client";
  process.env.WIX_CLIENT_SECRET = "test-client-secret";
  process.env.WIX_PAID_PLAN_IDS = "paid-plan";
  global.fetch = (input, options) => {
    const url = new URL(input && input.url ? input.url : String(input));
    if (url.hostname === "www.wixapis.com" && url.pathname === "/oauth2/token") {
      return Promise.resolve(new Response(JSON.stringify({
        access_token: "mock-wix-token",
        expires_in: 300
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (url.hostname === "www.wixapis.com" && url.pathname === "/pricing-plans/v2/orders") {
      const orders = url.searchParams.get("buyerIds") === "member-paid"
        ? [{ status: "ACTIVE", planId: "paid-plan" }]
        : [];
      return Promise.resolve(new Response(JSON.stringify({ orders }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }));
    }
    return nativeFetch(input, options);
  };
  ({ app } = require("../server"));
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  global.fetch = nativeFetch;
  if (server) {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("client-supplied plan flags never grant paid access", async () => {
  const catalog = await (await fetch(`${baseUrl}/api/catalog`)).json();
  assert.deepEqual(catalog.constructionAssumptions.map((item) => item.tallDepth), [25, 25]);
  assert.deepEqual(catalog.constructionAssumptions.map((item) => item.lowerHeight), [35.25, 34.5]);
  assert.deepEqual(catalog.materials.map(({ category, name, thickness, length, width, costPerSheet, wasteFactorPercent }) => ({
    category, name, thickness, length, width, costPerSheet, wasteFactorPercent
  })), [
    { category: "carcass", name: "3/4 Maple Melamine", thickness: 0.75, length: 96, width: 48, costPerSheet: 50, wasteFactorPercent: 15 },
    { category: "back", name: "1/4 Maple Melamine", thickness: 0.25, length: 96, width: 48, costPerSheet: 20, wasteFactorPercent: 15 },
    { category: "drawerBox", name: "1/2 Baltic Birch Ply", thickness: 0.5, length: 96, width: 48, costPerSheet: 85, wasteFactorPercent: 15 },
    { category: "drawerBottom", name: "1/4 Prefinished Maple Ply", thickness: 0.25, length: 96, width: 48, costPerSheet: 27, wasteFactorPercent: 15 },
    { category: "finishedEnd", name: "3/4 1s Melamine 1s PG", thickness: 0.75, length: 96, width: 48, costPerSheet: 55, wasteFactorPercent: 15 },
    { category: "nailer", name: "1/2 Particle Board", thickness: 0.5, length: 96, width: 48, costPerSheet: 24, wasteFactorPercent: 15 },
    { category: "toeKick", name: "3/4 TOE PLY", thickness: 0.75, length: 96, width: 48, costPerSheet: 30, wasteFactorPercent: 15 }
  ]);
  assert.ok(catalog.materials.every((item) => item.wasteMultiplier === 1.15));
  assert.deepEqual(catalog.boardStocks[0], {
    id: "default-poplar-s2s",
    name: "4/4 Poplar S2S",
    costPerBdFt: 2.75,
    wasteFactorPercent: 15,
    wasteMultiplier: 1.15,
    usedFor: "Face Frames, Fillers"
  });
  assert.deepEqual(catalog.slides[0], {
    id: "default-blum-tandem-21",
    name: "21\" Blum Tandem Slides",
    costPerPair: 30,
    wasteFactorPercent: 0,
    wasteMultiplier: 1
  });
  assert.deepEqual(catalog.doorStyles[0], { id: "default-pg-shaker-door", name: "PG Shaker Door", costPerSqFt: 12 });
  assert.deepEqual(catalog.paintTypes[0], {
    id: "default-sw-proclassic",
    name: "Sherwin Williams ProClassic Paint",
    primerCostPerGallon: 90,
    topcoatCostPerGallon: 90
  });
  assert.deepEqual(catalog.hingeTypes[0], {
    id: "default-blum-110-soft-close",
    name: "Blum 110 Soft Close",
    costEach: 4,
    wasteFactorPercent: 0,
    wasteMultiplier: 1
  });
  assert.deepEqual(catalog.basePlateTypes, [
    {
      id: "default-blum-cast-face-frame-plate",
      name: "Blum Cast Face Frame Plate",
      costEach: 0.8,
      wasteFactorPercent: 0,
      wasteMultiplier: 1
    },
    {
      id: "default-frameless-blum-cam-adj-base-plate",
      name: "Frameless Blum Cam Adj Base Plates",
      costEach: 0.8,
      wasteFactorPercent: 0,
      wasteMultiplier: 1
    }
  ]);
  assert.deepEqual(catalog.crownMouldings[0], {
    id: "default-pg-traditional-crown",
    name: "3-1/2 Inch Traditional Crown, PG",
    costPerLf: 3,
    wasteFactorPercent: 15,
    wasteMultiplier: 1.15,
    usedFor: "Crown Moulding"
  });
  assert.deepEqual(catalog.edgeBandings[0], {
    id: "default-alder-edgeband-13-16",
    name: "13/16 Alder Edgeband Roll",
    lengthPerRoll: 320,
    costPerRoll: 60
  });
  const response = await fetch(`${baseUrl}/api/config?plan=pro`, {
    headers: { "x-plan": "pro", "x-plan-type": "pro" }
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).plan, "free");
});

test("Wix bridge requires the shared secret and returns a signed member session", async () => {
  const rejected = await fetch(`${baseUrl}/api/auth/wix/bridge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ externalMemberId: "member-1" })
  });
  assert.equal(rejected.status, 401);

  const accepted = await fetch(`${baseUrl}/api/auth/wix/bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wix-bridge-secret": "test-bridge-secret"
    },
    body: JSON.stringify({
      externalMemberId: "member-1",
      email: "member@example.test",
      name: "Test Member"
    })
  });
  assert.equal(accepted.status, 200);
  memberSession = (await accepted.json()).sessionToken;
  assert.equal(typeof memberSession, "string");

  const paid = await fetch(`${baseUrl}/api/auth/wix/bridge`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wix-bridge-secret": "test-bridge-secret"
    },
    body: JSON.stringify({ externalMemberId: "member-paid", name: "Paid Member" })
  });
  assert.equal(paid.status, 200);
  paidSession = (await paid.json()).sessionToken;
});

test("construction assumption saves drawer height standards", async () => {
  const catalog = await (await fetch(`${baseUrl}/api/catalog`)).json();
  const assumption = catalog.constructionAssumptions.find((item) => item.type === "frameless");
  assert.deepEqual(
    [assumption.topDrawerHeight, assumption.middleDrawerHeight, assumption.bottomDrawerHeight],
    [5, 10, 10]
  );

  const saved = await fetch(`${baseUrl}/api/catalog/construction-assumptions/frameless`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${paidSession}`
    },
    body: JSON.stringify({
      ...assumption,
      tallDepth: 24,
      topDrawerHeight: 6,
      middleDrawerHeight: 11,
      bottomDrawerHeight: 12
    })
  });
  assert.equal(saved.status, 200);
  const savedAssumption = await saved.json();
  assert.deepEqual(
    [savedAssumption.topDrawerHeight, savedAssumption.middleDrawerHeight, savedAssumption.bottomDrawerHeight],
    [6, 11, 12]
  );
  const updatedCatalog = await (await fetch(`${baseUrl}/api/catalog`, {
    headers: { Authorization: `Bearer ${paidSession}` }
  })).json();
  const updatedAssumption = updatedCatalog.constructionAssumptions.find((item) => item.type === "frameless");
  assert.equal(updatedAssumption.tallDepth, 24);
  assert.deepEqual(
    [updatedAssumption.topDrawerHeight, updatedAssumption.middleDrawerHeight, updatedAssumption.bottomDrawerHeight],
    [6, 11, 12]
  );
  const faceFrame = updatedCatalog.constructionAssumptions.find((item) => item.type === "faceFrame");
  const savedFaceFrame = await fetch(`${baseUrl}/api/catalog/construction-assumptions/faceFrame`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${paidSession}`
    },
    body: JSON.stringify({ ...faceFrame, lowerHeight: 34.5 })
  });
  assert.equal(savedFaceFrame.status, 200);
  const personalCatalog = await (await fetch(`${baseUrl}/api/catalog`, {
    headers: { Authorization: `Bearer ${paidSession}` }
  })).json();
  assert.equal(personalCatalog.constructionAssumptions.find((item) => item.type === "faceFrame").lowerHeight, 34.5);
});

test("project and catalog writes require paid entitlement on the server", async () => {
  const projectResponse = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Spoofed project" })
  });
  assert.equal(projectResponse.status, 401);

  const catalogResponse = await fetch(`${baseUrl}/api/catalog/materials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${memberSession}`,
      "x-plan": "pro"
    },
    body: JSON.stringify({ name: "Spoofed material" })
  });
  assert.equal(catalogResponse.status, 403);

  const paidProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${paidSession}`
    },
    body: JSON.stringify({ name: "Paid member project" })
  });
  assert.equal(paidProject.status, 201);

  const paidProjects = await fetch(`${baseUrl}/api/projects`, {
    headers: { Authorization: `Bearer ${paidSession}` }
  });
  assert.equal((await paidProjects.json()).length, 1);
  const otherMemberProjects = await fetch(`${baseUrl}/api/projects`, {
    headers: { Authorization: `Bearer ${memberSession}` }
  });
  assert.equal((await otherMemberProjects.json()).length, 0);

  const paidMaterial = await fetch(`${baseUrl}/api/catalog/materials`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${paidSession}`
    },
    body: JSON.stringify({ category: "carcass", name: "Member-only plywood" })
  });
  assert.equal(paidMaterial.status, 201);
  const paidCatalog = await fetch(`${baseUrl}/api/catalog`, {
    headers: { Authorization: `Bearer ${paidSession}` }
  });
  const paidMaterials = (await paidCatalog.json()).materials;
  assert.equal(paidMaterials.length, 8);
  assert.ok(paidMaterials.some((item) => item.name === "1/2 Baltic Birch Ply"));
  assert.ok(paidMaterials.some((item) => item.name === "Member-only plywood"));
  const otherMemberCatalog = await fetch(`${baseUrl}/api/catalog`, {
    headers: { Authorization: `Bearer ${memberSession}` }
  });
  const otherMemberMaterials = (await otherMemberCatalog.json()).materials;
  assert.equal(otherMemberMaterials.length, 7);
  assert.ok(!otherMemberMaterials.some((item) => item.name === "Member-only plywood"));

  const paidSettings = await fetch(`${baseUrl}/api/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${paidSession}`
    },
    body: JSON.stringify({
      shopCostPerHour: 90,
      standards: {
        standardsVersion: 2,
        profileNames: {
          faceFrame: "Custom Paint Grade Face Frame",
          frameless: "Custom Paint Grade Frameless"
        }
      }
    })
  });
  assert.equal(paidSettings.status, 200);
  const savedSettings = await (await fetch(`${baseUrl}/api/settings`, {
    headers: { Authorization: "Bearer " + paidSession }
  })).json();
  assert.equal(savedSettings.standards.profileNames.frameless, "Custom Paint Grade Frameless");
  const otherMemberSettings = await fetch(`${baseUrl}/api/settings`, {
    headers: { Authorization: `Bearer ${memberSession}` }
  });
  assert.deepEqual(await otherMemberSettings.json(), {});

  const freeSettings = await fetch(`${baseUrl}/api/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${memberSession}`
    },
    body: JSON.stringify({ shopCostPerHour: 100 })
  });
  assert.equal(freeSettings.status, 403);
});

test("only admins can edit the shared default catalog everyone else reads", async () => {
  process.env.ADMIN_MEMBER_IDS = "member-admin";
  const bridge = (externalMemberId) => fetch(`${baseUrl}/api/auth/wix/bridge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wix-bridge-secret": "test-bridge-secret" },
    body: JSON.stringify({ externalMemberId })
  }).then((response) => response.json());
  const adminToken = (await bridge("member-admin")).sessionToken;
  const bearer = (token) => ({ "Content-Type": "application/json", Authorization: "Bearer " + token });

  const denied = await fetch(`${baseUrl}/api/catalog/materials?scope=shared`, {
    method: "POST",
    headers: bearer(paidSession),
    body: JSON.stringify({ category: "carcass", name: "Not allowed" })
  });
  assert.equal(denied.status, 403);

  const created = await fetch(`${baseUrl}/api/catalog/materials?scope=shared`, {
    method: "POST",
    headers: bearer(adminToken),
    body: JSON.stringify({ category: "carcass", name: "Shared default plywood" })
  });
  assert.equal(created.status, 201);

  const invalidEdgeBanding = await fetch(`${baseUrl}/api/catalog/edge-bandings?scope=shared`, {
    method: "POST",
    headers: bearer(adminToken),
    body: JSON.stringify({ name: "Invalid roll", lengthPerRoll: 0, costPerRoll: 60 })
  });
  assert.equal(invalidEdgeBanding.status, 400);

  const edgeBandingResponse = await fetch(`${baseUrl}/api/catalog/edge-bandings?scope=shared`, {
    method: "POST",
    headers: bearer(adminToken),
    body: JSON.stringify({ name: "Test Alder Roll", lengthPerRoll: 320, costPerRoll: 60 })
  });
  assert.equal(edgeBandingResponse.status, 201);
  const edgeBanding = await edgeBandingResponse.json();
  const updatedEdgeBanding = await fetch(`${baseUrl}/api/catalog/edge-bandings/${edgeBanding.id}?scope=shared`, {
    method: "PUT",
    headers: bearer(adminToken),
    body: JSON.stringify({ name: "Updated Alder Roll", lengthPerRoll: 300, costPerRoll: 66 })
  });
  assert.equal(updatedEdgeBanding.status, 200);
  assert.deepEqual(await updatedEdgeBanding.json(), {
    ...edgeBanding,
    name: "Updated Alder Roll",
    lengthPerRoll: 300,
    costPerRoll: 66
  });
  const deletedEdgeBanding = await fetch(`${baseUrl}/api/catalog/edge-bandings/${edgeBanding.id}?scope=shared`, {
    method: "DELETE",
    headers: bearer(adminToken)
  });
  assert.equal(deletedEdgeBanding.status, 204);

  const anonymous = await (await fetch(`${baseUrl}/api/catalog`)).json();
  assert.ok(anonymous.materials.some((item) => item.name === "Shared default plywood"));
  const free = await (await fetch(`${baseUrl}/api/catalog`, { headers: bearer(memberSession) })).json();
  assert.ok(free.materials.some((item) => item.name === "Shared default plywood"));
  const sharedAssumption = anonymous.constructionAssumptions.find((item) => item.type === "frameless");
  const updatedAssumption = await fetch(`${baseUrl}/api/catalog/construction-assumptions/frameless?scope=shared`, {
    method: "PUT",
    headers: bearer(adminToken),
    body: JSON.stringify({ ...sharedAssumption, tallDepth: 24 })
  });
  assert.equal(updatedAssumption.status, 200);
  const sharedCatalog = await (await fetch(`${baseUrl}/api/catalog`)).json();
  assert.equal(sharedCatalog.constructionAssumptions.find((item) => item.type === "frameless").tallDepth, 24);
  const sharedFaceFrame = sharedCatalog.constructionAssumptions.find((item) => item.type === "faceFrame");
  const savedSharedFaceFrame = await fetch(`${baseUrl}/api/catalog/construction-assumptions/faceFrame?scope=shared`, {
    method: "PUT",
    headers: bearer(adminToken),
    body: JSON.stringify({ ...sharedFaceFrame, lowerHeight: 34.5 })
  });
  assert.equal(savedSharedFaceFrame.status, 200);
  const updatedSharedCatalog = await (await fetch(`${baseUrl}/api/catalog`)).json();
  assert.equal(updatedSharedCatalog.constructionAssumptions.find((item) => item.type === "faceFrame").lowerHeight, 34.5);
  delete process.env.ADMIN_MEMBER_IDS;
});

test("admin can also be recognized by email", async () => {
  process.env.ADMIN_EMAILS = "Owner@Example.com";
  const login = (externalMemberId, email) => fetch(`${baseUrl}/api/auth/wix/bridge`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-wix-bridge-secret": "test-bridge-secret" },
    body: JSON.stringify({ externalMemberId, email })
  }).then((response) => response.json());
  const config = async (token) => (await fetch(`${baseUrl}/api/config`, {
    headers: { Authorization: "Bearer " + token }
  })).json();
  assert.equal((await config((await login("m-owner", "owner@example.com")).sessionToken)).admin, true);
  assert.equal((await config((await login("m-other", "other@example.com")).sessionToken)).admin, undefined);
  delete process.env.ADMIN_EMAILS;
});
