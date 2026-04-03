# Traffic Analyzer

A Chrome extension (Manifest V3) that captures and analyzes network traffic in real time, logging all contacted domains and HTTP error responses for review and CSV export.

## Repository structure

```
TrafficAnalyzer/   ← Chrome extension source (load this folder in Chrome)
  manifest.json
  background.js
  popup.html
  popup.js
```

## What it does

### Tab 1 — All Traffic
Captures every domain the browser contacts while recording is active. Logs the protocol, port, HTTP status codes received, and request count per connection. Useful for building proxy whitelists or auditing outbound connections.

### Tab 2 — Blocked Traffic
Captures only domains that returned a 4xx or 5xx HTTP response. Same data model as Tab 1 but scoped to error traffic only.

### Features
- **Linked logging** — Start/Stop/Clear on either tab can act on both simultaneously (configurable in Settings)
- **Search/filter** — filter the live table by domain substring
- **Sortable columns** — click any column header (Domain, Ports, Protocols, Status Codes, Requests) to sort ascending/descending
- **CSV export** — Copy to clipboard or download `.csv` per tab
- **Storage Safeguard** — Automatically pauses recording before hitting the Chrome 5MB local storage limit to prevent crashes
- **Noise filter** — configurable list of domain substrings to ignore during capture (e.g. analytics, Google updater); managed in Settings
- **Dark/light theme** — toggle in Settings, default is dark

## Architecture

| File | Role |
|------|------|
| `manifest.json` | MV3 manifest — declares `webRequest` + `storage` permissions |
| `background.js` | Service worker — `onBeforeRequest` and `onCompleted` WebRequest listeners, in-memory caches, debounced `chrome.storage.local` writes with quota safeguards |
| `popup.html` | Popup UI — all CSS inline (theme variables, badges, status dot animation, sortable headers) |
| `popup.js` | Popup logic — rendering, sorting, filtering, CSV export, settings |

## Data model

Both caches (`domainData`, `blockedData`) stored in `chrome.storage.local`:

```json
{
  "example.com": {
    "connections": {
      "https:443": {
        "protocol": "https",
        "port": "443",
        "statusCodes": ["200", "304"],
        "requestCount": 12
      }
    }
  }
}
```

## Storage keys

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `theme` | string | `"dark"` | `"dark"` or `"light"` |
| `linkedLogging` | boolean | `true` | Start/Stop/Clear acts on both tabs |
| `noiseFilter` | string[] | see `background.js` | Substrings of domains to ignore |
| `activeTab` | string | `"logger"` | Last active popup tab |
| `domainData` | object | `{}` | Tab 1 capture cache |
| `blockedData` | object | `{}` | Tab 2 capture cache |

## Installation

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `TrafficAnalyzer/` folder
4. The Traffic Analyzer icon appears in the Chrome toolbar

## Usage

1. Click the extension icon
2. Click **Start** on the desired tab(s)
3. Browse normally — domains captured in real time
4. Filter by typing in the search bar; click headers to sort
5. Click **Stop** when done, **Clear** to reset, **Download CSV** to export
