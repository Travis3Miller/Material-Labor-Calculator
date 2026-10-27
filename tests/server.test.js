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
  assert.equal((await paidCatalog.json()).materials.length, 1);
  const otherMemberCatalog = await fetch(`${baseUrl}/api/catalog`, {
    headers: { Authorization: `Bearer ${memberSession}` }
  });
  assert.equal((await otherMemberCatalog.json()).materials.length, 0);

  const paidSettings = await fetch(`${baseUrl}/api/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${paidSession}`
    },
    body: JSON.stringify({ shopCostPerHour: 90 })
  });
  assert.equal(paidSettings.status, 200);
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
