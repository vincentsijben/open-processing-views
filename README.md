# OpenProcessing Chrome Extension

This extension lets you manually scrape sketch view data from the OpenProcessing page currently open in your browser.

## Install (Developer Mode)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `chrome-extension` folder in this repository.

## Use

1. Open your OpenProcessing sketch list page.
2. Scroll until the sketches you want are visible.
3. Click the extension icon.
4. Click **Capture current page**.
5. The full captured snapshot is shown in the popup preview pane and saved in `chrome.storage.local`.
6. Click **Open graph view** to open the extension options page with a D3 line chart.
7. In the options page, use **Download stored history** to export all captures and **Clear stored history** to reset saved data.

Each capture is stored with its exact capture timestamp, so repeated captures on the same day are kept as separate history points.

## Graph view

The options page renders a D3 line graph where:

- X-axis = snapshot date
- Y-axis = views
- Each line = one sketch over time

Use the **Filter sketch** dropdown to focus on one sketch quickly. In single-sketch mode, the Y-axis auto-zooms to a range near that sketch values for easier reading.

The legend below the chart lists each sketch with latest view count.

## Output format

The exported history file contains an array of daily snapshots:

```json
[
  {
    "date": "2026-02-23",
    "fetched_at": "2026-02-23T21:00:00.000Z",
    "page_url": "https://openprocessing.org/user/78298?view=sketches",
    "sketches": [
      {
        "id": 123456,
        "title": "My Sketch",
        "views": 789,
        "url": "https://openprocessing.org/sketch/123456"
      }
    ]
  }
]
```
