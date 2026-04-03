# Traffic Analyzer — Claude Session Context

Paste this file at the start of a new session to restore full context.

## Project

**Name:** Traffic Analyzer
**Type:** Chrome Extension (Manifest V3)
**Location:** `TrafficAnalyzer/` subfolder contains the extension source. `README.md` and `CONTEXT.md` live at the repo root.

## What it does

Chrome extension with two recording tabs:
- **Tab 1 (All Traffic):** captures every domain contacted, logs protocol/port/status codes/request count
- **Tab 2 (Blocked Traffic):** captures only 4xx/5xx responses

## Key design decisions made

- **No BLOCKED status tag** — uBlock-blocked requests (ERR_ABORTED) are left with empty `statusCodes: []` rather than tagged. Too many false positives; empty array is clear enough.
- **Separate export buttons per tab** — export is independent; linked logging (Start/Stop/Clear) still works across both tabs when enabled.
- **Debounced storage writes** — `background.js` coalesces rapid `chrome.storage.local.set` calls to max once per 200ms per cache to avoid Chrome throttling under heavy traffic.
- **Storage Quota Safeguard** — `chrome.storage.local` is limited to 5MB. A check is performed before debounced saves; if usage exceeds 4.5MB, recording is gracefully halted to prevent `QuotaExceededError`.
- **Modern MV3 APIs** — Callback-based `chrome.storage` calls were refactored to use Promises (`async/await`) across both `background.js` and `popup.js`.
- **Request count tracked in background** — incremented in `onBeforeRequest` (Tab 1) and `onCompleted` (Tab 2), stored as `requestCount` on each connection entry.
- **Noise filter is user-editable** — stored in `chrome.storage.local` as `noiseFilter` string array, manageable in the Settings tab. Default list hardcoded in both `background.js` and `popup.js` as `DEFAULT_NOISE_FILTER` fallback.
- **Light theme uses mid-tone grays** — not pure white; mirrors dark theme layering and uses the same badge color families.

## File structure

```
background.js   service worker — listeners, caches, debounce
popup.html      UI + all CSS inline (theme vars, badges, animation, sort indicators)
popup.js        rendering, sort/filter state, CSV export, settings
manifest.json   MV3, permissions: webRequest + storage
```

## Storage schema

```js
// domainData / blockedData (same shape)
{
  "hostname": {
    connections: {
      "https:443": { protocol, port, statusCodes: [], requestCount: 0 }
    }
  }
}

// Other keys: theme, linkedLogging, noiseFilter, activeTab, isRecording, isBlockedRecording
```

## Notable patterns

- `updateTabUI(tabId, dataKey, recordingKey)` — single function drives both tab UI updates
- `renderTable(tabId, domainData)` — reads `sortState[tabId]` and search input, builds table with `createElement` (no innerHTML on user data)
- `scheduleSave(key)` / `performSave` — debounce helpers in background.js with built-in quota check against `QUOTA_LIMIT`
- NOISE_FILTER uses `.some(noise => hostname.includes(noise))` — substring match throughout

## What was explicitly ruled out

- Auto-clear on start (user declined)
- BLOCKED status tag on ERR_ABORTED (too unreliable, removed)
- Export linked to logging link (exports are always independent)
