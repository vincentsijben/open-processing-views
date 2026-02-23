# open-processing-views

A Node.js project that fetches daily view counts for every public sketch of an [OpenProcessing](https://openprocessing.org) user and stores them as a growing JSON dataset for data visualisation.

## How it works

1. A **GitHub Actions** workflow runs automatically every day at 00:00 UTC.
2. The workflow calls `node src/fetchViews.js`, which queries the OpenProcessing API for all public sketches of user **78298**.
3. A new snapshot is appended to `data/views.json` (or the existing entry for today is replaced, so manual re-runs are idempotent).
4. The workflow commits and pushes the updated `data/views.json` back to the repository.

Over time `data/views.json` grows into a time-series dataset you can use to answer questions like:

- Which sketches gained the most views over a given period?
- Which sketches are consistently popular vs. spiking occasionally?

## Data format

`data/views.json` is a JSON array. Each element represents one daily snapshot:

```json
[
  {
    "date": "2024-01-01",
    "fetched_at": "2024-01-01T00:03:12.456Z",
    "sketches": [
      { "id": 123456, "title": "My Sketch", "views": 789 }
    ]
  }
]
```

## Requirements

- Node.js ≥ 18 (uses the built-in `fetch` API)

## Usage

### Fetch manually

```bash
node src/fetchViews.js
```

### Run tests

```bash
npm test
```

## Automated scheduling

The workflow is defined in `.github/workflows/daily-fetch.yml`. You can also trigger it manually via the **Actions** tab → **Daily Sketch View Fetch** → **Run workflow**.
