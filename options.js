const STORAGE_KEY = "openprocessingViewHistory";
const state = {
  normalizedHistory: [],
  series: [],
  timeLabels: [],
  selectedSketchId: "all",
};

init();

async function init() {
  const history = await loadHistory();
  buildState(history);
  bindFilterEvents();
  bindActionEvents();
  render();
}

async function loadHistory() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const history = result?.[STORAGE_KEY];
  return Array.isArray(history) ? history : [];
}

function buildState(history) {
  const normalizedHistory = [...history].sort((a, b) => snapshotTime(a) - snapshotTime(b));
  state.normalizedHistory = normalizedHistory;
  state.timeLabels = normalizedHistory.map((snapshot, index) => snapshotLabel(snapshot, index));

  const bySketch = new Map();

  for (let index = 0; index < normalizedHistory.length; index += 1) {
    const snapshot = normalizedHistory[index];
    const snapshotLabelKey = snapshotLabel(snapshot, index);
    const sketches = Array.isArray(snapshot.sketches) ? snapshot.sketches : [];

    for (const sketch of sketches) {
      const sketchId = Number(sketch?.id);
      if (!Number.isFinite(sketchId)) {
        continue;
      }

      if (!bySketch.has(sketchId)) {
        bySketch.set(sketchId, {
          id: sketchId,
          title: String(sketch?.title || `Sketch ${sketchId}`),
          url: String(sketch?.url || ""),
          points: new Map(),
        });
      }

      bySketch.get(sketchId).points.set(snapshotLabelKey, Number(sketch?.views || 0));
    }
  }

  const snapshotDateByLabel = new Map(
    normalizedHistory.map((snapshot, index) => [snapshotLabel(snapshot, index), snapshot.fetched_at || snapshot.date])
  );

  state.series = Array.from(bySketch.values())
    .map((series) => {
      const points = state.timeLabels.map((timeLabel) => ({
        timeLabel,
        date: snapshotDateByLabel.get(timeLabel) || new Date(0).toISOString(),
        views: Number(series.points.get(timeLabel) || 0),
      }));

      const latestViews = points.length ? points[points.length - 1].views : 0;

      return {
        ...series,
        points,
        latestViews,
      };
    })
    .filter((item) => item.points.some((point) => point.views > 0))
    .sort((a, b) => b.latestViews - a.latestViews);

  populateFilterOptions();
}

function bindFilterEvents() {
  const filterEl = document.getElementById("sketch-filter");
  filterEl.addEventListener("change", () => {
    state.selectedSketchId = filterEl.value;
    render();
  });
}

function bindActionEvents() {
  const downloadButton = document.getElementById("download-history");
  const clearButton = document.getElementById("clear-history");

  downloadButton.addEventListener("click", downloadStoredHistory);
  clearButton.addEventListener("click", clearStoredHistory);
}

async function downloadStoredHistory() {
  const downloadButton = document.getElementById("download-history");
  const clearButton = document.getElementById("clear-history");
  downloadButton.disabled = true;
  clearButton.disabled = true;

  try {
    const history = await loadHistory();
    if (!history.length) {
      return;
    }

    const json = JSON.stringify(history, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url: objectUrl,
      filename: "openprocessing-views-history.json",
      saveAs: true,
    });

    URL.revokeObjectURL(objectUrl);
  } finally {
    downloadButton.disabled = false;
    clearButton.disabled = false;
  }
}

async function clearStoredHistory() {
  const confirmed = window.confirm("Delete all stored snapshots from this extension?");
  if (!confirmed) {
    return;
  }

  const downloadButton = document.getElementById("download-history");
  const clearButton = document.getElementById("clear-history");
  downloadButton.disabled = true;
  clearButton.disabled = true;

  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: [] });
    buildState([]);
    render();
  } finally {
    downloadButton.disabled = false;
    clearButton.disabled = false;
  }
}

function populateFilterOptions() {
  const filterEl = document.getElementById("sketch-filter");
  const previousValue = state.selectedSketchId;
  filterEl.innerHTML = "";

  const allOption = document.createElement("option");
  allOption.value = "all";
  allOption.textContent = `All sketches (${state.series.length})`;
  filterEl.appendChild(allOption);

  const sortedSeries = [...state.series].sort((left, right) =>
    String(left.title || "").localeCompare(String(right.title || ""), undefined, { sensitivity: "base" })
  );

  for (const line of sortedSeries) {
    const option = document.createElement("option");
    option.value = String(line.id);
    option.textContent = `${line.title} (#${line.id})`;
    filterEl.appendChild(option);
  }

  const hasPrevious = Array.from(filterEl.options).some((option) => option.value === previousValue);
  filterEl.value = hasPrevious ? previousValue : "all";
  state.selectedSketchId = filterEl.value;
}

function render() {
  const summaryEl = document.getElementById("summary");
  const chartEl = document.getElementById("chart");
  const legendEl = document.getElementById("legend");

  chartEl.innerHTML = "";
  legendEl.innerHTML = "";

  if (!state.normalizedHistory.length) {
    summaryEl.textContent = "No stored snapshots yet. Capture from the popup first.";
    return;
  }

  const series =
    state.selectedSketchId === "all"
      ? state.series
      : state.series.filter((item) => String(item.id) === state.selectedSketchId);

  if (!series.length) {
    summaryEl.textContent = "No data for selected sketch.";
    return;
  }

  if (state.selectedSketchId === "all") {
    summaryEl.textContent = `${state.normalizedHistory.length} captures · ${series.length} sketches`;
  } else {
    const selected = series[0];
    summaryEl.textContent = `${state.normalizedHistory.length} captures · ${selected.title} (#${selected.id})`;
  }

  drawLineChart(chartEl, series, state.normalizedHistory, state.timeLabels, state.selectedSketchId !== "all");
  drawLegend(legendEl, series);
}

function drawLineChart(container, series, snapshots, timeLabels, focusedSingleSeries) {
  const margin = { top: 20, right: 24, bottom: 40, left: 56 };
  const width = Math.max(900, timeLabels.length * 90);
  const height = 500;

  const svg = d3
    .select(container)
    .append("svg")
    .attr("width", width)
    .attr("height", height)
    .attr("viewBox", `0 0 ${width} ${height}`);

  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const xDomain = snapshots.map((snapshot) => new Date(snapshot.fetched_at || snapshot.date));

  const xScale = d3
    .scaleTime()
    .domain(d3.extent(xDomain))
    .range([margin.left, margin.left + innerWidth]);

  const minViews = d3.min(series, (line) => d3.min(line.points, (point) => point.views)) || 0;
  const maxViews = d3.max(series, (line) => d3.max(line.points, (point) => point.views)) || 0;
  const yDomain = computeYDomain(minViews, maxViews, focusedSingleSeries);
  const yScale = d3
    .scaleLinear()
    .domain(yDomain)
    .nice()
    .range([margin.top + innerHeight, margin.top]);

  const xAxis = d3.axisBottom(xScale).ticks(Math.min(timeLabels.length, 10)).tickFormat(d3.timeFormat("%d %b %H:%M"));
  const yAxis = d3.axisLeft(yScale).ticks(8).tickFormat(d3.format(","));

  const yGrid = d3.axisLeft(yScale).ticks(8).tickSize(-innerWidth).tickFormat("");
  svg.append("g").attr("class", "grid").attr("transform", `translate(${margin.left},0)`).call(yGrid);

  svg
    .append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0,${margin.top + innerHeight})`)
    .call(xAxis);

  svg.append("g").attr("class", "axis").attr("transform", `translate(${margin.left},0)`).call(yAxis);

  const color = d3.scaleOrdinal(d3.schemeTableau10);

  const lineGenerator = d3
    .line()
    .x((point) => xScale(new Date(point.date)))
    .y((point) => yScale(point.views));

  const tooltip = getOrCreateTooltip();

  series.forEach((line) => {
    const lineColor = color(String(line.id));

    svg
      .append("path")
      .datum(line.points)
      .attr("fill", "none")
      .attr("stroke", lineColor)
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.75)
      .attr("d", lineGenerator);

    svg
      .selectAll(`.point-${line.id}`)
      .data(line.points)
      .enter()
      .append("circle")
      .attr("cx", (point) => xScale(new Date(point.date)))
      .attr("cy", (point) => yScale(point.views))
      .attr("r", 3)
      .attr("fill", lineColor)
      .attr("opacity", 0.85)
      .on("mouseenter", (event, point) => {
        tooltip
          .style("opacity", 1)
          .html(
            `${escapeHtml(line.title)}<br>${formatTooltipTimestamp(point.timeLabel)}: ${point.views.toLocaleString()} views`
          )
          .style("left", `${event.pageX + 10}px`)
          .style("top", `${event.pageY - 30}px`);
      })
      .on("mousemove", (event) => {
        tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY - 30}px`);
      })
      .on("mouseleave", () => {
        tooltip.style("opacity", 0);
      });
  });
}

function computeYDomain(minViews, maxViews, focusedSingleSeries) {
  if (!focusedSingleSeries) {
    return [0, maxViews * 1.05 || 1];
  }

  if (maxViews <= 0) {
    return [0, 1];
  }

  if (maxViews === minViews) {
    const padding = Math.max(5, Math.round(maxViews * 0.1));
    return [Math.max(0, minViews - padding), maxViews + padding];
  }

  const range = maxViews - minViews;
  const padding = Math.max(5, Math.round(range * 0.15));
  return [Math.max(0, minViews - padding), maxViews + padding];
}

function getOrCreateTooltip() {
  let tooltip = d3.select("#chart-tooltip");
  if (tooltip.empty()) {
    tooltip = d3.select("body").append("div").attr("id", "chart-tooltip");
  }
  return tooltip.style("opacity", 0);
}

function snapshotTime(snapshot) {
  const ts = Date.parse(snapshot?.fetched_at || snapshot?.date || "");
  return Number.isNaN(ts) ? 0 : ts;
}

function snapshotLabel(snapshot, index = 0) {
  const base = snapshot?.fetched_at || snapshot?.date || `snapshot-${index + 1}`;
  return String(base);
}

function formatTooltipTimestamp(value) {
  const text = String(value || "").trim();
  const timestampWithoutZone = text.replace(/\.\d{1,6}(?=[+-]\d{2}:?\d{2}$)/, "").replace(/([+-]\d{2}:?\d{2})$/, "");
  const normalized = timestampWithoutZone.replace("T", " ");
  return normalized;
}

function drawLegend(container, series) {
  const color = d3.scaleOrdinal(d3.schemeTableau10);

  for (const line of series) {
    const item = document.createElement("div");
    item.className = "legend-item";

    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = color(String(line.id));

    const text = document.createElement("span");

    if (line.url) {
      const link = document.createElement("a");
      link.href = line.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "legend-link";
      link.textContent = `${line.title} (#${line.id})`;
      text.appendChild(link);
      text.appendChild(document.createTextNode(` — latest: ${line.latestViews.toLocaleString()}`));
    } else {
      text.textContent = `${line.title} (#${line.id}) — latest: ${line.latestViews.toLocaleString()}`;
    }

    item.appendChild(swatch);
    item.appendChild(text);
    container.appendChild(item);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
