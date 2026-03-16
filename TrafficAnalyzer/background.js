let noiseFilter = [
  'google-analytics.com',
  'googletagmanager.com',
  'clients1.google.com',
  'clients2.google.com',
  'clients3.google.com',
  'clients4.google.com',
  'accounts.google.com',
  'update.googleapis.com'
];

// In-memory state
let domainCache = {};
let isRecording = false;
let blockedCache = {};
let isBlockedRecording = false;

// Debounced storage saves — coalesces rapid writes under heavy traffic
let domainSaveTimer = null;
let blockedSaveTimer = null;
function scheduleSave(key) {
  if (key === 'domainData') {
    clearTimeout(domainSaveTimer);
    domainSaveTimer = setTimeout(() => chrome.storage.local.set({ domainData: domainCache }), 200);
  } else {
    clearTimeout(blockedSaveTimer);
    blockedSaveTimer = setTimeout(() => chrome.storage.local.set({ blockedData: blockedCache }), 200);
  }
}

// Seed from storage when the service worker starts
chrome.storage.local.get(['domainData', 'isRecording', 'blockedData', 'isBlockedRecording', 'noiseFilter'], (data) => {
  if (data.domainData)          domainCache        = data.domainData;
  if (data.isRecording)         isRecording        = data.isRecording;
  if (data.blockedData)         blockedCache       = data.blockedData;
  if (data.isBlockedRecording)  isBlockedRecording = data.isBlockedRecording;
  if (data.noiseFilter)         noiseFilter        = data.noiseFilter;
});

// Sync in-memory state with popup changes
chrome.storage.onChanged.addListener((changes) => {
  if (changes.isRecording !== undefined)        isRecording        = changes.isRecording.newValue;
  if (changes.isBlockedRecording !== undefined) isBlockedRecording = changes.isBlockedRecording.newValue;
  if (changes.noiseFilter !== undefined)        noiseFilter        = changes.noiseFilter.newValue;
  if (changes.domainData  !== undefined && Object.keys(changes.domainData.newValue  || {}).length === 0) domainCache  = {};
  if (changes.blockedData !== undefined && Object.keys(changes.blockedData.newValue || {}).length === 0) blockedCache = {};
});

// Storage defaults on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['theme', 'linkedLogging', 'noiseFilter'], (data) => {
    const updates = {};
    if (data.theme         === undefined) updates.theme         = 'dark';
    if (data.linkedLogging === undefined) updates.linkedLogging = true;
    if (data.noiseFilter   === undefined) updates.noiseFilter   = noiseFilter;
    if (Object.keys(updates).length > 0) chrome.storage.local.set(updates);
  });
});

function resolvePort(protocol, rawPort) {
  if (rawPort) return rawPort;
  if (protocol === 'https' || protocol === 'wss') return '443';
  if (protocol === 'http'  || protocol === 'ws')  return '80';
  return '';
}

// Tab 1: Capture all request domains
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isRecording) return;

    try {
      const url = new URL(details.url);
      const hostname = url.hostname;
      const protocol = url.protocol.replace(':', '');

      if (!hostname) return;

      const port = resolvePort(protocol, url.port);
      const connKey = `${protocol}:${port}`;

      const isNoise    = noiseFilter.some(noise => hostname.includes(noise));
      const isInternal = details.url.startsWith('chrome-extension') || details.url.startsWith('chrome://');

      if (!isNoise && !isInternal) {
        if (!domainCache[hostname]) domainCache[hostname] = { connections: {} };

        const conns = domainCache[hostname].connections;
        if (!conns[connKey]) {
          conns[connKey] = { protocol, port, statusCodes: [], requestCount: 1 };
        } else {
          conns[connKey].requestCount = (conns[connKey].requestCount || 0) + 1;
        }
        scheduleSave('domainData');
      }
    } catch (e) { /* silent */ }
  },
  { urls: ["<all_urls>"] }
);

// Shared onCompleted: Tab 1 status codes + Tab 2 blocked traffic
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!isRecording && !isBlockedRecording) return;

    try {
      const url = new URL(details.url);
      const hostname = url.hostname;
      const protocol = url.protocol.replace(':', '');

      if (!hostname) return;

      const port = resolvePort(protocol, url.port);
      const connKey = `${protocol}:${port}`;

      const isNoise    = noiseFilter.some(noise => hostname.includes(noise));
      const isInternal = details.url.startsWith('chrome-extension') || details.url.startsWith('chrome://');
      if (isNoise || isInternal) return;

      const statusCode = String(details.statusCode);

      // Tab 1: add status code to matching connection entry
      if (isRecording && domainCache[hostname]) {
        const conns = domainCache[hostname].connections;
        if (!conns[connKey]) conns[connKey] = { protocol, port, statusCodes: [], requestCount: 0 };
        if (!conns[connKey].statusCodes.includes(statusCode)) {
          conns[connKey].statusCodes.push(statusCode);
          conns[connKey].statusCodes.sort();
          scheduleSave('domainData');
        }
      }

      // Tab 2: log 4xx/5xx
      if (isBlockedRecording && details.statusCode >= 400) {
        if (!blockedCache[hostname]) blockedCache[hostname] = { connections: {} };
        const conns = blockedCache[hostname].connections;
        if (!conns[connKey]) {
          conns[connKey] = { protocol, port, statusCodes: [statusCode], requestCount: 1 };
        } else {
          conns[connKey].requestCount = (conns[connKey].requestCount || 0) + 1;
          if (!conns[connKey].statusCodes.includes(statusCode)) {
            conns[connKey].statusCodes.push(statusCode);
            conns[connKey].statusCodes.sort();
          }
        }
        scheduleSave('blockedData');
      }
    } catch (e) { /* silent */ }
  },
  { urls: ["<all_urls>"] }
);
