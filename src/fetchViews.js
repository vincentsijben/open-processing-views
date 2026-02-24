#!/usr/bin/env node
/**
 * Fetches view counts for all sketches of an OpenProcessing user and appends
 * a daily snapshot to data/views.json.
 *
 * Usage: node src/fetchViews.js
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const USER_ID = 78298;
const API_BASE = "https://openprocessing.org/api";
const PAGE_LIMIT = 10; // Number of sketches to request per page; increase if the API allows larger pages
const DATA_FILE = join(__dirname, "..", "data", "views.json");

// Headers that mimic a regular browser request. Without these the
// OpenProcessing server returns 403 Forbidden for automated clients.
const BASE_REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  Referer: "https://openprocessing.org/",
};

const CLOUDFLARE_HINT = [
  "OpenProcessing is returning a Cloudflare block page.",
  "If your browser can open openprocessing.org, export your browser session cookie and retry:",
  "  export OPENPROCESSING_COOKIE='cf_clearance=...; __cf_bm=...; ...'",
  "  npm run fetch",
].join("\n");

export function buildRequestHeaders() {
  const cookie = process.env.OPENPROCESSING_COOKIE?.trim();
  if (!cookie) {
    return BASE_REQUEST_HEADERS;
  }
  return {
    ...BASE_REQUEST_HEADERS,
    Cookie: cookie,
  };
}

function isCloudflareBlock(response, bodyText) {
  const serverHeader = response.headers.get("server")?.toLowerCase() ?? "";
  const body = bodyText.toLowerCase();
  return (
    serverHeader.includes("cloudflare") &&
    (body.includes("sorry, you have been blocked") || body.includes("attention required"))
  );
}

/**
 * Fetches a single page of sketches for the given user.
 * @param {number} offset - Pagination offset.
 * @returns {Promise<object[]>} Array of sketch objects.
 */
async function fetchSketchPage(offset) {
  const url = `${API_BASE}/sketch?userID=${USER_ID}&limit=${PAGE_LIMIT}&offset=${offset}&isPublic=1`;
  const response = await fetch(url, { headers: buildRequestHeaders() });
  if (!response.ok) {
    const bodyText = await response.text();
    if (response.status === 403 && isCloudflareBlock(response, bodyText)) {
      throw new Error(`HTTP 403 fetching ${url}\n${CLOUDFLARE_HINT}`);
    }
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
  return response.json();
}

/**
 * Fetches all sketches for the configured user, handling pagination.
 * @returns {Promise<object[]>} Full list of sketch objects.
 */
export async function fetchAllSketches() {
  const sketches = [];
  let offset = 0;

  while (true) {
    const page = await fetchSketchPage(offset);
    if (!Array.isArray(page) || page.length === 0) {
      break;
    }
    sketches.push(...page);
    if (page.length < PAGE_LIMIT) {
      break;
    }
    offset += PAGE_LIMIT;
  }

  return sketches;
}

/**
 * Maps a raw API sketch object to a compact snapshot entry.
 * @param {object} sketch - Raw sketch from the API.
 * @returns {{ id: number, title: string, views: number }}
 */
export function mapSketch(sketch) {
  return {
    id: Number(sketch.visualID),
    title: String(sketch.title ?? ""),
    views: Number(sketch.views ?? 0),
  };
}

/**
 * Reads the existing data file or returns an empty array if it doesn't exist.
 * @returns {object[]} Existing snapshots.
 */
export function loadData() {
  if (!existsSync(DATA_FILE)) {
    return [];
  }
  const raw = readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

/**
 * Writes snapshots to the data file, creating the directory if needed.
 * @param {object[]} data - Array of daily snapshots.
 */
export function saveData(data) {
  const dir = dirname(DATA_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(DATA_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

/**
 * Returns today's date string in YYYY-MM-DD format (UTC).
 * @returns {string}
 */
export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Main entry point: fetches sketches and appends today's snapshot.
 */
async function main() {
  const date = todayUTC();
  console.log(`Fetching sketches for user ${USER_ID} on ${date}…`);

  const raw = await fetchAllSketches();
  const sketches = raw.map(mapSketch);

  console.log(`Found ${sketches.length} sketch(es).`);

  const data = loadData();

  // Replace any existing entry for today so re-runs are idempotent.
  const existingIndex = data.findIndex((entry) => entry.date === date);
  const snapshot = { date, fetched_at: new Date().toISOString(), sketches };

  if (existingIndex !== -1) {
    data[existingIndex] = snapshot;
    console.log(`Updated existing snapshot for ${date}.`);
  } else {
    data.push(snapshot);
    console.log(`Appended new snapshot for ${date}.`);
  }

  saveData(data);
  console.log(`Data saved to ${DATA_FILE}`);
}

// Only run main() when executed directly (not when imported in tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
