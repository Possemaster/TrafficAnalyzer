const DEFAULT_NOISE_FILTER = [
  'google-analytics.com',
  'googletagmanager.com',
  'clients1.google.com',
  'clients2.google.com',
  'clients3.google.com',
  'clients4.google.com',
  'accounts.google.com',
  'update.googleapis.com'
];

// ── Theme ─────────────────────────────────────────────────────────────────────
function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  document.getElementById('setting-theme').checked = (theme === 'light');
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function activateTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + tabName));
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    activateTab(btn.dataset.tab);
    chrome.storage.local.set({ activeTab: btn.dataset.tab });
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusBadge(code) {
  let cls = 'badge-5xx';
  if (code.startsWith('1'))      cls = 'badge-1xx';
  else if (code.startsWith('2')) cls = 'badge-2xx';
  else if (code.startsWith('3')) cls = 'badge-3xx';
  else if (code.startsWith('4')) cls = 'badge-4xx';
  return `<span class="badge ${cls}">${code}</span>`;
}

function getLinked(callback) {
  chrome.storage.local.get(['linkedLogging'], (data) => {
    callback(data.linkedLogging !== false);
  });
}

function aggregateDomain(info) {
  const conns = Object.values(info.connections || {});
  return {
    ports:        [...new Set(conns.map(c => c.port))].sort(),
    protocols:    [...new Set(conns.map(c => c.protocol))].sort(),
    statusCodes:  [...new Set(conns.flatMap(c => c.statusCodes || []))].sort(),
    requestCount: conns.reduce((sum, c) => sum + (c.requestCount || 0), 0)
  };
}

function buildExportCSV(dataObj) {
  let csv = 'Domain;Protocol;Port;Status Code\n';
  Object.keys(dataObj).sort().forEach(domain => {
    const conns = Object.values(dataObj[domain].connections || {});
    conns
      .sort((a, b) => a.protocol.localeCompare(b.protocol) || a.port.localeCompare(b.port))
      .forEach(conn => {
        const codes = conn.statusCodes || [];
        if (codes.length === 0) {
          csv += `${domain};${conn.protocol};${conn.port};\n`;
        } else {
          codes.forEach(code => {
            csv += `${domain};${conn.protocol};${conn.port};${code}\n`;
          });
        }
      });
  });
  return csv;
}

function downloadCSV(csv, filename) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Sort state ────────────────────────────────────────────────────────────────
const sortState = {
  logger:  { col: 'domain', dir: 'asc' },
  blocked: { col: 'domain', dir: 'asc' }
};

// ── Table rendering ───────────────────────────────────────────────────────────
function renderTable(tabId, domainData) {
  const state  = sortState[tabId];
  const filter = document.getElementById(`${tabId}-search`).value.toLowerCase();

  let rows = Object.keys(domainData)
    .filter(d => d.toLowerCase().includes(filter))
    .map(domain => ({ domain, ...aggregateDomain(domainData[domain]) }));

  rows.sort((a, b) => {
    let av, bv;
    switch (state.col) {
      case 'domain':   av = a.domain;                  bv = b.domain;                  break;
      case 'port':     av = a.ports.join(';');         bv = b.ports.join(';');         break;
      case 'protocol': av = a.protocols.join(';');     bv = b.protocols.join(';');     break;
      case 'status':   av = a.statusCodes.join(';');   bv = b.statusCodes.join(';');   break;
      case 'requests': av = a.requestCount;            bv = b.requestCount;            break;
    }
    if (typeof av === 'number') return state.dir === 'asc' ? av - bv : bv - av;
    return state.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  // Update sort indicators on headers
  document.querySelectorAll(`#tab-${tabId} th[data-col]`).forEach(th => {
    th.dataset.dir = (th.dataset.col === state.col) ? state.dir : '';
  });

  const tbody = document.getElementById(`${tabId}-table-body`);
  tbody.innerHTML = '';
  rows.forEach(({ domain, ports, protocols, statusCodes, requestCount }) => {
    const tr = document.createElement('tr');

    const tdDomain    = document.createElement('td');
    tdDomain.textContent = domain;
    const tdPorts     = document.createElement('td');
    tdPorts.textContent = ports.join('; ');
    const tdProtocols = document.createElement('td');
    tdProtocols.textContent = protocols.join('; ');
    const tdStatus    = document.createElement('td');
    tdStatus.innerHTML = statusCodes.map(statusBadge).join(''); // badges are internally generated
    const tdRequests  = document.createElement('td');
    tdRequests.textContent = requestCount || '';

    tr.append(tdDomain, tdPorts, tdProtocols, tdStatus, tdRequests);
    tbody.appendChild(tr);
  });
}

// ── Sortable headers ──────────────────────────────────────────────────────────
document.querySelectorAll('th[data-col]').forEach(th => {
  th.addEventListener('click', () => {
    const tabId = th.closest('.tab-content').id.replace('tab-', '');
    const col   = th.dataset.col;
    const state = sortState[tabId];
    if (state.col === col) {
      state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    } else {
      state.col = col;
      state.dir = 'asc';
    }
    const dataKey = tabId === 'logger' ? 'domainData' : 'blockedData';
    chrome.storage.local.get([dataKey], (data) => renderTable(tabId, data[dataKey] || {}));
  });
});

// ── Search ────────────────────────────────────────────────────────────────────
['logger', 'blocked'].forEach(tabId => {
  const dataKey = tabId === 'logger' ? 'domainData' : 'blockedData';
  document.getElementById(`${tabId}-search`).addEventListener('input', () => {
    chrome.storage.local.get([dataKey], (data) => renderTable(tabId, data[dataKey] || {}));
  });
});

// ── Unified tab UI update ─────────────────────────────────────────────────────
function updateTabUI(tabId, dataKey, recordingKey) {
  chrome.storage.local.get([dataKey, recordingKey], (data) => {
    const isRec      = !!data[recordingKey];
    const domainData = data[dataKey] || {};
    const count      = Object.keys(domainData).length;

    const statusEl = document.getElementById(`${tabId}-status`);
    statusEl.className = 'status' + (isRec ? ' recording' : '');
    statusEl.innerHTML = `<span class="status-dot"></span>${isRec ? 'Logging...' : 'Stopped'} (${count} domains)`;

    document.getElementById(`${tabId}-start`).className = 'ctrl start' + (isRec ? ' active' : '');
    document.getElementById(`${tabId}-stop`).className  = 'ctrl stop'  + (!isRec ? ' active' : '');

    renderTable(tabId, domainData);
  });
}

function updateLoggerUI()  { updateTabUI('logger',  'domainData',  'isRecording'); }
function updateBlockedUI() { updateTabUI('blocked', 'blockedData', 'isBlockedRecording'); }

// ── Tab 1 controls ────────────────────────────────────────────────────────────
document.getElementById('logger-start').addEventListener('click', () => {
  getLinked(linked => {
    const update = { isRecording: true };
    if (linked) update.isBlockedRecording = true;
    chrome.storage.local.set(update);
  });
});

document.getElementById('logger-stop').addEventListener('click', () => {
  getLinked(linked => {
    const update = { isRecording: false };
    if (linked) update.isBlockedRecording = false;
    chrome.storage.local.set(update);
  });
});

document.getElementById('logger-clear').addEventListener('click', () => {
  getLinked(linked => {
    const msg = linked ? 'Clear all logged data from both tabs?' : 'Clear all logged domains?';
    if (confirm(msg)) {
      const update = { domainData: {} };
      if (linked) update.blockedData = {};
      chrome.storage.local.set(update);
    }
  });
});

document.getElementById('logger-export-copy').addEventListener('click', () => {
  chrome.storage.local.get(['domainData'], (data) => {
    const csv = buildExportCSV(data.domainData || {});
    navigator.clipboard.writeText(csv).then(() => alert('CSV copied to clipboard!'));
  });
});

document.getElementById('logger-export-download').addEventListener('click', () => {
  chrome.storage.local.get(['domainData'], (data) => {
    downloadCSV(buildExportCSV(data.domainData || {}), 'all-traffic.csv');
  });
});

// ── Tab 2 controls ────────────────────────────────────────────────────────────
document.getElementById('blocked-start').addEventListener('click', () => {
  getLinked(linked => {
    const update = { isBlockedRecording: true };
    if (linked) update.isRecording = true;
    chrome.storage.local.set(update);
  });
});

document.getElementById('blocked-stop').addEventListener('click', () => {
  getLinked(linked => {
    const update = { isBlockedRecording: false };
    if (linked) update.isRecording = false;
    chrome.storage.local.set(update);
  });
});

document.getElementById('blocked-clear').addEventListener('click', () => {
  getLinked(linked => {
    const msg = linked ? 'Clear all logged data from both tabs?' : 'Clear all blocked traffic data?';
    if (confirm(msg)) {
      const update = { blockedData: {} };
      if (linked) update.domainData = {};
      chrome.storage.local.set(update);
    }
  });
});

document.getElementById('blocked-export-copy').addEventListener('click', () => {
  chrome.storage.local.get(['blockedData'], (data) => {
    const csv = buildExportCSV(data.blockedData || {});
    navigator.clipboard.writeText(csv).then(() => alert('CSV copied to clipboard!'));
  });
});

document.getElementById('blocked-export-download').addEventListener('click', () => {
  chrome.storage.local.get(['blockedData'], (data) => {
    downloadCSV(buildExportCSV(data.blockedData || {}), 'blocked-traffic.csv');
  });
});

// ── Tab 3: Settings ───────────────────────────────────────────────────────────
function renderNoiseList(filters) {
  const list = document.getElementById('noise-list');
  list.innerHTML = '';
  filters.forEach((entry, i) => {
    const row  = document.createElement('div');
    row.className = 'noise-row';
    const span = document.createElement('span');
    span.textContent = entry;
    const btn  = document.createElement('button');
    btn.textContent = '✕';
    btn.className = 'noise-remove';
    btn.addEventListener('click', () => {
      const updated = filters.filter((_, j) => j !== i);
      chrome.storage.local.set({ noiseFilter: updated });
      renderNoiseList(updated);
    });
    row.append(span, btn);
    list.appendChild(row);
  });
}

document.getElementById('noise-add-btn').addEventListener('click', () => {
  const input = document.getElementById('noise-add-input');
  const value = input.value.trim();
  if (!value) return;
  chrome.storage.local.get(['noiseFilter'], (data) => {
    const filters = data.noiseFilter || DEFAULT_NOISE_FILTER;
    if (filters.includes(value)) return;
    const updated = [...filters, value];
    chrome.storage.local.set({ noiseFilter: updated });
    renderNoiseList(updated);
    input.value = '';
  });
});

document.getElementById('noise-add-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('noise-add-btn').click();
});

document.getElementById('setting-linked').addEventListener('change', (e) => {
  chrome.storage.local.set({ linkedLogging: e.target.checked });
});

document.getElementById('setting-theme').addEventListener('change', (e) => {
  const theme = e.target.checked ? 'light' : 'dark';
  applyTheme(theme);
  chrome.storage.local.set({ theme });
});

// ── Storage change listener ───────────────────────────────────────────────────
chrome.storage.onChanged.addListener((changes) => {
  if (changes.domainData  || changes.isRecording)        updateLoggerUI();
  if (changes.blockedData || changes.isBlockedRecording) updateBlockedUI();
});

// ── Initial load ──────────────────────────────────────────────────────────────
chrome.storage.local.get(['activeTab', 'theme', 'linkedLogging', 'noiseFilter'], (data) => {
  applyTheme(data.theme || 'dark');
  document.getElementById('setting-linked').checked = (data.linkedLogging !== false);
  renderNoiseList(data.noiseFilter || DEFAULT_NOISE_FILTER);
  if (data.activeTab) activateTab(data.activeTab);
});

updateLoggerUI();
updateBlockedUI();
