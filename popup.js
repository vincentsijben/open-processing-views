const captureButton = document.getElementById("capture");
const graphButton = document.getElementById("graph");
const statusEl = document.getElementById("status");
const storedEl = document.getElementById("stored");
const previewEl = document.getElementById("preview");
const STORAGE_KEY = "openprocessingViewHistory";

captureButton.addEventListener("click", captureCurrentPage);
graphButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
refreshStoredCount();

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b91c1c" : "#374151";
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function nowAmsterdamTimestamp() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "shortOffset",
  });

  const parts = formatter.formatToParts(now);
  const valueOf = (type) => parts.find((part) => part.type === type)?.value || "";

  const year = valueOf("year");
  const month = valueOf("month");
  const day = valueOf("day");
  const hour = valueOf("hour");
  const minute = valueOf("minute");
  const second = valueOf("second");
  const zoneText = valueOf("timeZoneName");

  const match = zoneText.match(/([+-]\d{1,2})(?::?(\d{2}))?/);
  const rawHoursOffset = match ? Number(match[1]) : 0;
  const sign = rawHoursOffset >= 0 ? "+" : "-";
  const hoursOffset = String(Math.abs(rawHoursOffset)).padStart(2, "0");
  const minutesOffset = match && match[2] ? match[2] : "00";
  const offset = `${sign}${hoursOffset}:${minutesOffset}`;
  const milliseconds = String(now.getMilliseconds()).padStart(3, "0");

  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${milliseconds}${offset}`;
}

function formatBadgeNumber(value) {
  const number = Number(value || 0);
  if (number <= 0) {
    return "0";
  }
  if (number >= 1000000) {
    return `${Math.round(number / 1000000)}M`;
  }
  if (number >= 1000) {
    return `${Math.round(number / 1000)}K`;
  }
  return String(number);
}

async function updateBadgeForTab(tabId, sketches) {
  const totalViews = sketches.reduce((sum, sketch) => sum + Number(sketch?.views || 0), 0);
  await chrome.action.setBadgeBackgroundColor({ color: "#111827", tabId });
  await chrome.action.setBadgeText({ text: formatBadgeNumber(totalViews), tabId });
  await chrome.action.setTitle({
    title: `OpenProcessing Views Scraper — ${totalViews.toLocaleString()} total views captured`,
    tabId,
  });
}

async function captureCurrentPage() {
  captureButton.disabled = true;
  graphButton.disabled = true;
  setStatus("Scraping page…");
  previewEl.textContent = "";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      throw new Error("No active tab found.");
    }

    if (!tab.url.startsWith("https://openprocessing.org/")) {
      throw new Error("Open an openprocessing.org page first.");
    }

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: scrapeOpenProcessingPage,
    });

    const payload = result?.result;
    if (!payload || !Array.isArray(payload.sketches)) {
      throw new Error("Unexpected scrape result.");
    }

    if (payload.sketches.length === 0) {
      throw new Error("No sketches found on this page. Try your sketch list page and scroll to load entries.");
    }

    const snapshot = {
      date: todayUTC(),
      fetched_at: nowAmsterdamTimestamp(),
      page_url: tab.url,
      sketches: payload.sketches,
    };

    const history = await loadSnapshotHistory();
    appendSnapshot(history, snapshot);
    await saveSnapshotHistory(history);
    await refreshStoredCount();
    await updateBadgeForTab(tab.id, snapshot.sketches);

    setStatus(
      `Captured ${snapshot.sketches.length} sketches. Saved in Chrome storage (${history.length} date snapshots).`
    );
    previewEl.textContent = JSON.stringify(snapshot, null, 2);
  } catch (error) {
    setStatus(error.message || "Failed to capture page.", true);
  } finally {
    captureButton.disabled = false;
    graphButton.disabled = false;
  }
}

async function loadSnapshotHistory() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const value = result?.[STORAGE_KEY];
  return Array.isArray(value) ? value : [];
}

async function saveSnapshotHistory(history) {
  await chrome.storage.local.set({ [STORAGE_KEY]: history });
}

function appendSnapshot(history, snapshot) {
  const duplicateIndex = history.findIndex((entry) => entry?.fetched_at === snapshot.fetched_at);
  if (duplicateIndex >= 0) {
    history[duplicateIndex] = snapshot;
    return;
  }
  history.push(snapshot);
  history.sort((left, right) => {
    const leftTs = Date.parse(left?.fetched_at || left?.date || "");
    const rightTs = Date.parse(right?.fetched_at || right?.date || "");
    return leftTs - rightTs;
  });
}

async function refreshStoredCount() {
  const history = await loadSnapshotHistory();
  const latest = history[history.length - 1];
  storedEl.textContent = latest
    ? `Stored snapshots: ${history.length} (latest: ${latest.fetched_at || latest.date})`
    : "Stored snapshots: 0";
}

function scrapeOpenProcessingPage() {
  const byId = new Map();

  function toNumber(text) {
    const digitsOnly = String(text || "").replace(/[^\d]/g, "");
    return digitsOnly ? Number(digitsOnly) : 0;
  }

  function extractSketchId(url) {
    if (!url) {
      return null;
    }

    const sketchMatch = url.match(/\/sketch\/(\d+)/i);
    if (sketchMatch) {
      return Number(sketchMatch[1]);
    }

    const visualMatch = url.match(/[?&]visualID=(\d+)/i);
    if (visualMatch) {
      return Number(visualMatch[1]);
    }

    return null;
  }

  function parseTitle(rawTitle) {
    const normalizedTitle = String(rawTitle || "").replace(/\s+/g, " ").trim();
    const trailingViewsMatch = String(rawTitle || "").match(/^(.*?)(?:\s{2,}|\n+)([\d][\d\s,.]*)$/);
    if (trailingViewsMatch) {
      return trailingViewsMatch[1].replace(/\s+/g, " ").trim();
    }
    return normalizedTitle;
  }

  function parseViewsFromCard(card) {
    const directViewsText = card?.querySelector(".sketchMeta .views, .views")?.textContent;
    if (directViewsText) {
      return toNumber(directViewsText);
    }
    return 0;
  }

  const links = Array.from(document.querySelectorAll('a[href^="/sketch/"], a[href*="openprocessing.org/sketch/"]'));

  for (const link of links) {
    const href = link.getAttribute("href") || "";
    if (!href || /\/sketch\/create\/?$/i.test(href)) {
      continue;
    }

    const url = new URL(href, window.location.origin).toString();
    const sketchId = extractSketchId(url);
    if (sketchId === null || byId.has(sketchId)) {
      continue;
    }

    const card =
      link.closest(".sketchThumbContainer, .sketchThumb, article, li, .card, .sketch, .gallery-item") || link;
    const titleFromCard = card.querySelector(".sketchHeader, .sketchLabel h1, .sketchLabel h2, .sketchLabel h3, h1, h2, h3, h4")
      ?.textContent;
    const title = parseTitle(titleFromCard || link.textContent || "");
    const views = parseViewsFromCard(card);

    const sketch = {
      id: sketchId,
      title,
      views,
      url,
    };
    byId.set(sketchId, sketch);
  }

  return {
    sketches: Array.from(byId.values()).sort((left, right) => Number(right.views || 0) - Number(left.views || 0)),
  };
}
