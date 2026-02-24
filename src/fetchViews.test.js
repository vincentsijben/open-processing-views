import { strict as assert } from "assert";
import { test } from "node:test";
import { mapSketch, todayUTC, loadData, saveData, fetchAllSketches, buildRequestHeaders } from "./fetchViews.js";
import { readFileSync, unlinkSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "..", "data", "views.json");

test("mapSketch converts API object to compact entry", () => {
  const raw = { visualID: "123", title: "My Sketch", views: "456" };
  const result = mapSketch(raw);
  assert.deepStrictEqual(result, { id: 123, title: "My Sketch", views: 456 });
});

test("mapSketch handles missing fields gracefully", () => {
  const result = mapSketch({});
  assert.deepStrictEqual(result, { id: NaN, title: "", views: 0 });
});

test("todayUTC returns a YYYY-MM-DD string", () => {
  const today = todayUTC();
  assert.match(today, /^\d{4}-\d{2}-\d{2}$/);
});

test("saveData and loadData round-trip JSON", () => {
  const original = existsSync(DATA_FILE)
    ? JSON.parse(readFileSync(DATA_FILE, "utf8"))
    : null;

  const testData = [
    { date: "2024-01-01", fetched_at: "2024-01-01T00:00:00.000Z", sketches: [{ id: 1, title: "Test", views: 10 }] },
  ];
  saveData(testData);
  const loaded = loadData();
  assert.deepStrictEqual(loaded, testData);

  // Restore or clean up
  if (original !== null) {
    saveData(original);
  } else {
    unlinkSync(DATA_FILE);
  }
});

test("fetchAllSketches sends browser-like headers to avoid 403", async (t) => {
  const capturedOptions = [];

  t.mock.method(globalThis, "fetch", async (_url, options) => {
    capturedOptions.push(options);
    return {
      ok: true,
      json: async () => [], // empty page → loop exits immediately
    };
  });

  await fetchAllSketches();

  assert.ok(capturedOptions.length > 0, "fetch should have been called");
  const headers = capturedOptions[0]?.headers ?? {};
  assert.ok(headers["User-Agent"], "User-Agent header must be present");
  assert.ok(headers["Accept"], "Accept header must be present");
  assert.ok(headers["Referer"], "Referer header must be present");
});

test("buildRequestHeaders adds Cookie when OPENPROCESSING_COOKIE is set", () => {
  const original = process.env.OPENPROCESSING_COOKIE;
  process.env.OPENPROCESSING_COOKIE = "cf_clearance=abc123; __cf_bm=def456";

  const headers = buildRequestHeaders();
  assert.equal(headers.Cookie, "cf_clearance=abc123; __cf_bm=def456");

  if (original === undefined) {
    delete process.env.OPENPROCESSING_COOKIE;
  } else {
    process.env.OPENPROCESSING_COOKIE = original;
  }
});

test("fetchAllSketches throws actionable message on Cloudflare 403", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({
    ok: false,
    status: 403,
    headers: {
      get: (name) => (name.toLowerCase() === "server" ? "cloudflare" : null),
    },
    text: async () => "<title>Attention Required!</title><h1>Sorry, you have been blocked</h1>",
  }));

  await assert.rejects(
    fetchAllSketches(),
    (error) =>
      error instanceof Error &&
      error.message.includes("Cloudflare block page") &&
      error.message.includes("OPENPROCESSING_COOKIE")
  );
});
