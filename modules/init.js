// ============ INIT ============
document.addEventListener('DOMContentLoaded', () => {
  checkPin();
  populateSegmentDropdowns(); // Poblar dropdowns antes de cargar datos que puedan depender de ellos
  const migrationResult = tryAutoMigrate();
  loadAllData();
  const autoRescued = autoRestoreCriticalRescueIfNeeded();
  if (autoRescued) loadAllData();
  const recoverySummary = getLocalRecoverySummary();
  runIdleStartupTask('critical-rescue-snapshot', () => {
    createCriticalRescueSnapshot(`startup_${VOLTFLOW_VERSION}`, {
      throttleMs: 12 * 60 * 60 * 1000,
      maxBytes: 1200000
    });
  }, 9000);

  updateDate();
  runStartupTask('dashboard-visible', () => {
    updateStats();
    renderDashboardCharts();
    renderRecentActivity();
    renderTopLeads();
    renderTodayPanel();
  }, 0);
  runIdleStartupTask('settings-light-background', () => {
    if (isViewActive('settings')) {
      renderTemplateList();
      updateStorageInfo();
    }
  }, 1600);
  setTimeout(() => showStartupStorageRecoveryNotice(recoverySummary), 1200);

  // Mostrar banner de migraci?n autom?tica si hubo volcado
  if (migrationResult && typeof migrationResult === 'object' && migrationResult.leads > 0) {
    setTimeout(() => showMigrationBanner(migrationResult), 600);
  }
  if (autoRescued) {
    setTimeout(() => showToast(`Rescate automatico aplicado: ${leads.length} leads recuperados`), 700);
  }

  const leadForm = document.getElementById('lead-form');
  if (leadForm) leadForm.addEventListener('submit', e => { e.preventDefault(); saveLead(); });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    // 1. Teclas con modificadores (Ctrl/Alt)
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'k') { e.preventDefault(); openGlobalSearch(); return; }
    }
    
    if (e.altKey) {
      if (e.key === 'l') { e.preventDefault(); showView('leads'); return; }
      if (e.key === 'd') { e.preventDefault(); showView('dashboard'); return; }
      if (e.key === 's') { e.preventDefault(); showView('settings'); return; }
      if (e.key === 'i' && typeof aiCurrentLeadId !== 'undefined' && aiCurrentLeadId) { 
        e.preventDefault(); openAiEmailModal(aiCurrentLeadId); return; 
      }
    }

    // 2. Teclas simples (Solo si no estamos escribiendo)
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

    if (e.key === 'Escape') {
      closeGlobalSearch();
      // Cerrar paneles laterales de leads (si est?n abiertos)
      if (typeof closeLeadSidePanel === 'function') closeLeadSidePanel();
      closeLead(); closeAiModal(); closeCampaignModal(); closeObjectivesModal();
      document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
      return;
    }

    // Atajos de navegaci?n r?pida
    const navMap = {
      'n': () => { showView('leads'); toggleLeadForm(); },
      'f': () => { openFocusMode(); },
      'b': () => { showView('planner'); },
      'd': () => { showView('dashboard'); },
      'k': () => { showView('kanban'); },
      's': () => { showView('settings'); }
    };

    if (navMap[e.key]) {
      e.preventDefault();
      navMap[e.key]();
    }
  });

  // Tutorial solo si es instalaci?n completamente nueva (sin datos y sin migraci?n)
  if (!localStorage.getItem('gordi_tutorial_done') && leads.length === 0 && !migrationResult) {
    setTimeout(() => showTutorial(), 800);
  }

  // Apply saved theme
  if (localStorage.getItem('gordi_light_mode') === '1') applyLightMode(true);

  // Apply font scale
  const scale = localStorage.getItem('gordi_font_scale');
  if (scale) setFontSize(scale, true);

  // Auto backup weekly
  runIdleStartupTask('weekly-backup', () => autoWeeklyBackup(), 12000);

  // Purgar caches de enriquecimiento caducadas (>7 dias)
  runIdleStartupTask('purge-stale-caches', () => purgeStaleCaches(), 3200);

  // MEJORA: Sistema de Actualizaciones Autom?tico via version.json
  checkUpdates({ migrationResult, recoverySummary });
  window.__gordiBootReady = true;

  // Auto-pull JSONBin al iniciar si est? habilitado
  if (localStorage.getItem('gordi_jsonbin_auto') === 'true') {
    runIdleStartupTask('jsonbin-auto-pull', () => {
      if (typeof jsonbinPull === 'function') jsonbinPull(false);
    }, 5000);
  }
});

function runStartupTask(name, fn, delay) {
  setTimeout(() => {
    try {
      fn();
    } catch (err) {
      console.error(`Error en arranque diferido (${name}):`, err);
      try {
        if (typeof logAudit === 'function') logAudit('startup_task_error', `${name}: ${err && err.message ? err.message : err}`);
      } catch {}
    }
  }, delay || 0);
}

function runIdleStartupTask(name, fn, delay) {
  runStartupTask(name, () => {
    const run = () => {
      try {
        fn();
      } catch (err) {
        console.error(`Error en arranque idle (${name}):`, err);
        try {
          if (typeof logAudit === 'function') logAudit('startup_idle_error', `${name}: ${err && err.message ? err.message : err}`);
        } catch {}
      }
    };
    if ('requestIdleCallback' in window) {
      requestIdleCallback(run, { timeout: 2500 });
    } else {
      setTimeout(run, 120);
    }
  }, delay || 0);
}


// --- MIGRACION AUTOM?TICA DE DATOS ENTRE VERSIONES ---------------------------
// Todas las versiones de Voltflow comparten el mismo localStorage en file://
// Al arrancar por primera vez esta versi?n, se vuelcan todos los datos autom?ticamente.

let VOLTFLOW_VERSION = '2.8.2'; // Fallback
let VOLTFLOW_CHANGELOG = [];

// ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ 
// Aviso: PERFORMANCE SYSTEM - debounce renders, smart batching, pagination
// ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ 

// Debounce timers
const _renderTimers = {};
function debouncedRender(key, fn, delay) {
  if (_renderTimers[key]) clearTimeout(_renderTimers[key]);
  _renderTimers[key] = setTimeout(() => { delete _renderTimers[key]; fn(); }, delay || 60);
}

// Batch multiple render requests - only executes once per animation frame
const _pendingRenders = new Set();
let   _rafScheduled   = false;
function scheduleRender(key) {
  _pendingRenders.add(key);
  if (!_rafScheduled) {
    _rafScheduled = true;
    requestAnimationFrame(() => {
      _rafScheduled = false;
      const toRun = new Set(_pendingRenders);
      _pendingRenders.clear();
      if (toRun.has('leads'))    renderLeads();
      if (toRun.has('kanban'))   renderKanban();
      if (toRun.has('stats'))    updateStats();
      if (toRun.has('tracking')) renderTracking();
      if (toRun.has('charts'))   { try { renderDashboardCharts(); } catch(e){} }
    });
  }
}

// Smart batch: replaces renderLeads();renderKanban();updateStats() pattern
function renderAll() {
  scheduleRender('leads');
  scheduleRender('kanban');
  scheduleRender('stats');
}
function renderAllFull() {
  scheduleRender('leads');
  scheduleRender('kanban');
  scheduleRender('stats');
  scheduleRender('tracking');
}

function isViewActive(view) {
  const el = document.getElementById(`${view}-view`);
  return !!(el && el.classList.contains('active'));
}

// Pagination for leads table
const LEADS_PAGE_SIZE = 50;
let   leadsPage = 0;

// Single-row update - update only the changed row without full re-render
function updateLeadRow(leadId) {
  const tbody = document.getElementById('leads-body');
  if (!tbody) return false;
  const existingRow = tbody.querySelector(`tr[data-lead-id="${leadId}"]`);
  if (!existingRow) return false; // row not visible, skip
  // Just re-render this lead's row by doing a targeted replace
  const lead = leads.find(l => l.id == leadId);
  if (!lead) { existingRow.remove(); return true; }
  // Trigger a lightweight status color update only
  const bc = lead.score >= 70 ? 'badge-high' : (lead.score >= 40 ? 'badge-mid' : 'badge-low');
  const sc = (lead.status || 'pendiente').toLowerCase().replace(/ /g, '-');
  const scoreEl  = existingRow.querySelector('.score-badge');
  const statusEl = existingRow.querySelector('[class^="status-"]');
  if (scoreEl)  { scoreEl.className = `score-badge ${bc}`; scoreEl.textContent = lead.score; }
  if (statusEl) { statusEl.className = `status-${sc}`; statusEl.querySelector('.status-dot') || (statusEl.innerHTML = `<span class="status-dot"></span>${lead.status}`); }
  return true;
}
const VOLTFLOW_DATA_KEYS = [
  'gordi_leads', 'gordi_email_history', 'gordi_campaigns',
  'gordi_objectives', 'gordi_search_history', 'gordi_templates',
  'gordi_api_key', 'gordi_hunter_key', 'gordi_apollo_key',
  'gordi_claude_key', 'gordi_gemini_key',
  'gordi_groq_key', 'gordi_openrouter_key',
  'gordi_user_name', 'gordi_user_email', 'gordi_user_company',
  'gordi_user_phone', 'gordi_user_web', 'gordi_user_logo',
  'gordi_sender_name', 'gordi_sender_email',
  'gordi_sheets_id', 'gordi_sheets_client_id', 'gordi_sheets_token',
  'gordi_pin', 'gordi_streak', 'gordi_tutorial_done',
  'gordi_light_mode', 'gordi_font_scale',
  'gordi_commercial_memory', 'gordi_saved_searches',
  'gordi_search_coverage', 'gordi_coverage_targets',
  'gordi_coverage_daily_plan', 'gordi_coverage_events',
  'gordi_coverage_view_mode', 'gordi_coverage_active_mission',
  'gordi_coverage_lead_filter',
  'gordi_coverage_update_tour',
  'gordi_professional_update_tour',
  'gordi_manual_state',
  'gordi_workflow_restore_points', 'gordi_workflow_audit_log',
  'gordi_jsonbin_key', 'gordi_jsonbin_bin', 'gordi_jsonbin_auto',
  // --  GitHub sync ------------------------------------------------------
  'gordi_gh_token', 'gordi_gh_user', 'gordi_gh_repo', 'gordi_gh_auto',
];

const VOLTFLOW_SAFETY_SNAPSHOTS_KEY = 'gordi_safety_snapshots';
const VOLTFLOW_LAST_SAFETY_SNAPSHOT_KEY = 'gordi_last_safety_snapshot';
const VOLTFLOW_CRITICAL_RESCUE_KEY = 'gordi_critical_rescue_snapshots';
const VOLTFLOW_INTENTIONAL_EMPTY_KEY = 'gordi_intentional_empty_leads_at';
const VOLTFLOW_MAX_SAFETY_SNAPSHOTS = 12;
const VOLTFLOW_MAX_CRITICAL_RESCUES = 6;
const VOLTFLOW_SNAPSHOT_EXCLUDED_KEYS = new Set([
  VOLTFLOW_SAFETY_SNAPSHOTS_KEY,
  VOLTFLOW_LAST_SAFETY_SNAPSHOT_KEY,
  VOLTFLOW_CRITICAL_RESCUE_KEY,
  VOLTFLOW_INTENTIONAL_EMPTY_KEY,
  'gordi_workflow_restore_points',
  'gordi_workflow_audit_log',
  'gordi_auto_backup'
]);

function isTechnicalSnapshotKey(key) {
  return key === 'gordi_enrich_cache'
    || key === 'gordi_api_log'
    || key === 'gordi_map_geocode_cache'
    || key.startsWith('gordi_ecache_')
    || key.startsWith('gordi_geo_cache_')
    || key.startsWith('gordi_scrape_memory_')
    || key.startsWith('gordi_scrape_tmp_');
}

function exportDataSnapshot(options = {}) {
  const includeCaches = options.includeCaches === true;
  const snapshot = { _voltflow_version: VOLTFLOW_VERSION, _exported: new Date().toISOString() };
  for (const key of VOLTFLOW_DATA_KEYS) {
    if (VOLTFLOW_SNAPSHOT_EXCLUDED_KEYS.has(key)) continue;
    if (!includeCaches && isTechnicalSnapshotKey(key)) continue;
    const val = localStorage.getItem(key);
    if (val !== null) snapshot[key] = val;
  }
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || VOLTFLOW_SNAPSHOT_EXCLUDED_KEYS.has(k)) continue;
    if (!includeCaches && isTechnicalSnapshotKey(k)) continue;
    if (k && k.startsWith('gordi_') && snapshot[k] === undefined) snapshot[k] = localStorage.getItem(k);
    if (k && k.startsWith('voltium_') && snapshot[k] === undefined) snapshot[k] = localStorage.getItem(k);
  }
  return snapshot;
}

function parseSnapshotArray(snapshot, key) {
  try {
    const value = JSON.parse(snapshot && snapshot[key] ? snapshot[key] : '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function getSnapshotSummary(snapshot = exportDataSnapshot()) {
  const localKeys = Object.keys(snapshot || {}).filter(key => key.startsWith('gordi_'));
  const bytes = Object.entries(snapshot || {}).reduce((sum, [key, value]) => {
    return sum + String(key).length + String(value == null ? '' : value).length;
  }, 0);
  return {
    leads: parseSnapshotArray(snapshot, 'gordi_leads').length,
    emails: parseSnapshotArray(snapshot, 'gordi_email_history').length,
    campaigns: parseSnapshotArray(snapshot, 'gordi_campaigns').length,
    searches: parseSnapshotArray(snapshot, 'gordi_search_history').length + parseSnapshotArray(snapshot, 'gordi_saved_searches').length,
    keys: localKeys.length,
    bytes
  };
}

function getCurrentDataSummary() {
  return getSnapshotSummary(exportDataSnapshot());
}

function validateDataSnapshot(snapshot, baselineSummary = null) {
  const errors = [];
  const warnings = [];
  if (!snapshot || typeof snapshot !== 'object') {
    return { ok: false, errors: ['El archivo no contiene datos validos.'], warnings, summary: getSnapshotSummary({}) };
  }

  const arrayKeys = [
    'gordi_leads', 'gordi_email_history', 'gordi_campaigns',
    'gordi_objectives', 'gordi_search_history', 'gordi_saved_searches'
  ];

  for (const key of arrayKeys) {
    if (snapshot[key] === undefined) continue;
    try {
      const parsed = JSON.parse(snapshot[key]);
      if (key !== 'gordi_objectives' && !Array.isArray(parsed)) errors.push(`${key} no es una lista valida.`);
    } catch {
      errors.push(`${key} contiene JSON corrupto.`);
    }
  }

  const incomingLeads = parseSnapshotArray(snapshot, 'gordi_leads');
  const ids = new Set();
  let duplicateIds = 0;
  let weakLeads = 0;
  incomingLeads.forEach(lead => {
    if (!lead || typeof lead !== 'object') {
      weakLeads++;
      return;
    }
    if (lead.id && ids.has(String(lead.id))) duplicateIds++;
    if (lead.id) ids.add(String(lead.id));
    if (!lead.company && !lead.name && !lead.email && !lead.phone) weakLeads++;
  });
  if (duplicateIds) warnings.push(`${duplicateIds} leads tienen ID duplicado.`);
  if (weakLeads) warnings.push(`${weakLeads} leads parecen incompletos.`);

  const summary = getSnapshotSummary(snapshot);
  if (baselineSummary && baselineSummary.leads > 0 && summary.leads < baselineSummary.leads) {
    const loss = baselineSummary.leads - summary.leads;
    warnings.push(`El origen tiene ${loss} leads menos que tus datos actuales.`);
  }
  if (summary.keys === 0) errors.push('No hay claves de datos de Voltflow en el archivo.');

  return { ok: errors.length === 0, errors, warnings, summary };
}

function readSafetySnapshots() {
  try {
    const items = JSON.parse(localStorage.getItem(VOLTFLOW_SAFETY_SNAPSHOTS_KEY) || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeSafetySnapshots(items) {
  localStorage.setItem(VOLTFLOW_SAFETY_SNAPSHOTS_KEY, JSON.stringify(items.slice(0, VOLTFLOW_MAX_SAFETY_SNAPSHOTS)));
}

function createSafetySnapshot(reason = 'manual', options = {}) {
  try {
    const snapshot = exportDataSnapshot();
    const summary = getSnapshotSummary(snapshot);
    if (!summary.keys) return null;
    const maxBytes = options.maxBytes || 1200000;
    const storeSnapshot = options.download || summary.bytes <= maxBytes;

    const item = {
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      date: new Date().toISOString(),
      reason,
      summary,
      snapshot: storeSnapshot ? snapshot : null,
      skippedSnapshot: storeSnapshot ? false : 'too_large_for_local_storage'
    };

    let items = [item, ...readSafetySnapshots()].slice(0, VOLTFLOW_MAX_SAFETY_SNAPSHOTS);
    let stored = false;
    while (!stored && items.length) {
      try {
        writeSafetySnapshots(items);
        stored = true;
      } catch (e) {
        items = items.slice(0, -1);
      }
    }
    if (!stored) return null;

    localStorage.setItem(VOLTFLOW_LAST_SAFETY_SNAPSHOT_KEY, item.id);
    if (options.download) downloadDataSnapshot(snapshot, `voltflow_snapshot_${reason}_${new Date().toISOString().slice(0,10)}.json`);
    return item;
  } catch (e) {
    console.warn('No se pudo crear snapshot de seguridad:', e);
    return null;
  }
}

function readCriticalRescues() {
  try {
    const items = JSON.parse(localStorage.getItem(VOLTFLOW_CRITICAL_RESCUE_KEY) || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeCriticalRescues(items) {
  localStorage.setItem(VOLTFLOW_CRITICAL_RESCUE_KEY, JSON.stringify(items.slice(0, VOLTFLOW_MAX_CRITICAL_RESCUES)));
}

function createCriticalRescueSnapshot(reason = 'auto', options = {}) {
  try {
    const now = Date.now();
    const throttleMs = options.throttleMs || 0;
    const items = readCriticalRescues();
    if (throttleMs && items[0] && items[0].reason === reason && now - new Date(items[0].date).getTime() < throttleMs) {
      return items[0];
    }

    const snapshot = exportDataSnapshot();
    const summary = getSnapshotSummary(snapshot);
    const maxBytes = options.maxBytes || 1200000;
    if (summary.bytes > maxBytes) {
      localStorage.setItem('_voltflow_last_large_snapshot_skip', JSON.stringify({
        date: new Date(now).toISOString(),
        reason,
        bytes: summary.bytes,
        maxBytes
      }));
      return null;
    }
    const hasApiKeys = ['gordi_api_key','gordi_hunter_key','gordi_apollo_key','gordi_gemini_key','gordi_claude_key','gordi_groq_key','gordi_openrouter_key']
      .some(key => !!snapshot[key]);
    if (!summary.keys || (!summary.leads && !summary.emails && !summary.campaigns && !summary.searches && !hasApiKeys)) return null;

    const item = {
      id: `rescue_${now}_${Math.random().toString(36).slice(2, 8)}`,
      date: new Date(now).toISOString(),
      reason,
      summary,
      snapshot
    };
    writeCriticalRescues([item, ...items].slice(0, VOLTFLOW_MAX_CRITICAL_RESCUES));
    return item;
  } catch (e) {
    console.warn('No se pudo crear rescate critico:', e);
    return null;
  }
}

function getBestCriticalRescue() {
  return readCriticalRescues()
    .filter(item => item && item.snapshot)
    .sort((a, b) => {
      const la = a.summary?.leads || getSnapshotSummary(a.snapshot).leads;
      const lb = b.summary?.leads || getSnapshotSummary(b.snapshot).leads;
      if (lb !== la) return lb - la;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    })[0] || null;
}

function wasIntentionalEmptyRecently() {
  const ts = parseInt(localStorage.getItem(VOLTFLOW_INTENTIONAL_EMPTY_KEY) || '0', 10);
  return ts && Date.now() - ts < 24 * 60 * 60 * 1000;
}

function markIntentionalEmptyLeads() {
  localStorage.setItem(VOLTFLOW_INTENTIONAL_EMPTY_KEY, Date.now().toString());
}

function autoRestoreCriticalRescueIfNeeded() {
  if (wasIntentionalEmptyRecently()) return false;
  const current = getCurrentDataSummary();
  if (current.leads > 0) return false;
  const rescue = getBestCriticalRescue();
  const rescueLeads = rescue?.summary?.leads || (rescue ? getSnapshotSummary(rescue.snapshot).leads : 0);
  if (!rescue || rescueLeads <= 0) return false;

  try {
    importDataSnapshot(rescue.snapshot, true, { reason: 'before_auto_restore_critical_rescue' });
    localStorage.setItem('_voltflow_last_auto_rescue', JSON.stringify({
      date: new Date().toISOString(),
      rescueId: rescue.id,
      leads: rescueLeads,
      reason: rescue.reason
    }));
    return true;
  } catch (e) {
    console.warn('No se pudo restaurar rescate critico:', e);
    return false;
  }
}

function listSafetySnapshots() {
  return readSafetySnapshots().map(({ snapshot, ...meta }) => meta);
}

function downloadDataSnapshot(snapshot, filename) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `voltflow_snapshot_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportLatestSafetySnapshot() {
  const item = readSafetySnapshots()[0];
  if (!item || !item.snapshot) {
    if (typeof showToast === 'function') showToast('No hay snapshots de seguridad todavia');
    return;
  }
  downloadDataSnapshot(item.snapshot, `voltflow_snapshot_${item.date.slice(0,10)}.json`);
  if (typeof showToast === 'function') showToast('Snapshot exportado');
}

function exportLatestCriticalRescue() {
  const item = getBestCriticalRescue();
  if (!item || !item.snapshot) {
    if (typeof showToast === 'function') showToast('No hay rescates criticos todavia');
    return;
  }
  downloadDataSnapshot(item.snapshot, `voltflow_rescate_critico_${item.date.slice(0,10)}.json`);
  if (typeof showToast === 'function') showToast(`Rescate critico exportado: ${item.summary?.leads || 0} leads`);
}

function showCriticalRescueDiagnostics() {
  const items = readCriticalRescues();
  const best = getBestCriticalRescue();
  const lines = items.map((item, idx) => {
    const s = item.summary || getSnapshotSummary(item.snapshot);
    return `${idx + 1}. ${new Date(item.date).toLocaleString('es-ES')} - ${s.leads} leads, ${s.keys} claves (${item.reason})`;
  });
  alert(
    `Rescates criticos guardados: ${items.length}\n` +
    `Mejor rescate: ${best ? `${best.summary?.leads || 0} leads del ${new Date(best.date).toLocaleString('es-ES')}` : 'ninguno'}\n\n` +
    (lines.length ? lines.join('\n') : 'Aun no hay rescates criticos.')
  );
}

function restoreSafetySnapshot(id) {
  const item = readSafetySnapshots().find(s => s.id === id);
  if (!item || !item.snapshot) {
    alert('Snapshot no encontrado.');
    return;
  }
  const summary = item.summary || getSnapshotSummary(item.snapshot);
  const label = new Date(item.date).toLocaleString('es-ES');
  if (!confirm(`Restaurar snapshot del ${label}?\nSe cargaran ${summary.leads} leads y ${summary.keys} claves.\nAntes de restaurar se creara otro snapshot de seguridad.`)) return;
  importDataSnapshot(item.snapshot, true, { reason: 'before_restore_safety_snapshot' });
  reloadDataFromStorage();
  if (typeof showToast === 'function') showToast(`Snapshot restaurado: ${summary.leads} leads`);
}

function reloadDataFromStorage() {
  if (typeof loadAllData === 'function') loadAllData();
  if (typeof renderAll === 'function') renderAll();
  if (typeof renderDashboardCharts === 'function') renderDashboardCharts();
  if (typeof renderTracking === 'function') renderTracking();
  if (typeof renderCampaigns === 'function') renderCampaigns();
  if (typeof renderTemplateList === 'function') renderTemplateList();
  if (typeof updateStorageInfo === 'function') updateStorageInfo();
}

function importDataSnapshot(snapshot, overwrite = false, options = {}) {
  const validation = validateDataSnapshot(snapshot, overwrite ? getCurrentDataSummary() : null);
  if (!validation.ok) {
    throw new Error('Snapshot invalido: ' + validation.errors.join(' '));
  }
  if (overwrite) createSafetySnapshot(options.reason || 'before_snapshot_import');

  let imported = 0;
  for (const [key, val] of Object.entries(snapshot)) {
    if (key.startsWith('_')) continue;
    if (VOLTFLOW_SNAPSHOT_EXCLUDED_KEYS.has(key)) continue;
    if (!overwrite && localStorage.getItem(key) !== null) continue;
    localStorage.setItem(key, val);
    imported++;
  }
  return imported;
}

function parseStoredArray(key) {
  try {
    const value = parseStoredJson(localStorage.getItem(key), []);
    return coerceStoredArray(value, key.replace(/^gordi_/, ''));
  } catch {
    return [];
  }
}

function parseStoredObject(key) {
  try {
    const value = parseStoredJson(localStorage.getItem(key), {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function getLocalRecoverySummary() {
  const localKeys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('gordi_')) localKeys.push(key);
  }

  const templates = parseStoredObject('gordi_templates');
  const memory = parseStoredObject('gordi_commercial_memory');
  const scrapeMemoryKeys = localKeys.filter(key => key.startsWith('gordi_scrape_memory_')).length;
  const enrichCacheKeys = localKeys.filter(key => key.startsWith('gordi_ecache_')).length;
  const hasCloud = !!(localStorage.getItem('gordi_jsonbin_key') || localStorage.getItem('gordi_gh_token') || localStorage.getItem('gordi_sheets_id'));
  const apiKeys = ['gordi_api_key', 'gordi_hunter_key', 'gordi_apollo_key', 'gordi_gemini_key', 'gordi_claude_key', 'gordi_groq_key', 'gordi_openrouter_key']
    .filter(key => !!localStorage.getItem(key)).length;

  return {
    leads: parseStoredArray('gordi_leads').length,
    emails: parseStoredArray('gordi_email_history').length,
    campaigns: parseStoredArray('gordi_campaigns').length,
    searches: parseStoredArray('gordi_search_history').length + parseStoredArray('gordi_saved_searches').length,
    templates: Object.keys(templates).length,
    commercialMemory: Object.keys(memory).length,
    scrapeMemory: scrapeMemoryKeys,
    enrichCache: enrichCacheKeys,
    apiKeys,
    hasProfile: !!localStorage.getItem('gordi_user_name'),
    hasCloud,
    localKeys: localKeys.length,
    origin: location.origin && location.origin !== 'null' ? location.origin : 'este navegador'
  };
}

function hasRecoveredLocalData(summary) {
  return !!summary && (
    summary.leads > 0 ||
    summary.emails > 0 ||
    summary.campaigns > 0 ||
    summary.searches > 0 ||
    summary.commercialMemory > 0 ||
    summary.scrapeMemory > 0 ||
    summary.enrichCache > 0 ||
    summary.apiKeys > 0 ||
    summary.hasProfile
  );
}

// Detecta si esta versi?n concreta se abre por primera vez en este navegador
// Si hay datos de versiones anteriores en el mismo localStorage, los vuelca todo autom?ticamente.
function showStorageDiagnostics() {
  const summary = getLocalRecoverySummary();
  const origin = summary.origin || location.href;
  alert(
    `Almacenamiento actual:\n${origin}\n\n` +
    `Leads: ${summary.leads}\n` +
    `Emails: ${summary.emails}\n` +
    `Campanas: ${summary.campaigns}\n` +
    `Busquedas: ${summary.searches}\n` +
    `Claves gordi_*: ${summary.localKeys}\n\n` +
    'GitHub debe usarse para actualizar archivos. Para trabajar, abre siempre la misma URL local, por ejemplo http://127.0.0.1:8765/app.html. Si antes trabajaste desde GitHub Pages, localhost, file://, otro puerto, otro perfil o modo incognito, el navegador usa otro almacenamiento.'
  );
}

function showStartupStorageRecoveryNotice(summary) {
  if (!summary || summary.leads > 0) return;
  try {
    if (sessionStorage.getItem('_voltflow_storage_notice_dismissed') === '1') return;
  } catch {}
  if (document.getElementById('storage-recovery-notice')) return;

  const origin = summary.origin || location.href;
  const notice = document.createElement('div');
  notice.id = 'storage-recovery-notice';
  notice.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:99998;width:min(430px,calc(100vw - 36px));background:var(--bg-card);border:1px solid rgba(245,158,11,.35);box-shadow:0 18px 45px rgba(0,0,0,.35);border-radius:14px;padding:14px;color:var(--text);font-size:.82rem;line-height:1.45';
  notice.innerHTML = `
    <div style="display:flex;gap:.75rem;align-items:flex-start">
      <div style="font-size:1.25rem;line-height:1">!</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:800;margin-bottom:.25rem;color:var(--warning)">Este navegador no ve leads guardados</div>
        <div style="color:var(--text-muted);margin-bottom:.55rem">
          Origen actual: <strong style="color:var(--text);word-break:break-all">${origin}</strong><br>
          GitHub actualiza archivos; los datos viven en la URL local. Si antes trabajaste desde GitHub Pages, localhost, file://, otro puerto o modo incognito, esos datos estan en otro almacenamiento.
        </div>
        <div style="display:flex;gap:.45rem;flex-wrap:wrap">
          <button class="btn-primary" style="padding:.42rem .7rem;font-size:.75rem" onclick="showStorageDiagnostics()">Diagnosticar</button>
          <button class="btn-outline" style="padding:.42rem .7rem;font-size:.75rem" onclick="showView('settings')">Abrir datos</button>
          <button class="btn-outline" style="padding:.42rem .7rem;font-size:.75rem" onclick="document.getElementById('restore-file')?.click()">Restaurar backup</button>
          <button class="btn-action" style="padding:.42rem .7rem;font-size:.75rem" onclick="dismissStorageRecoveryNotice()">Ocultar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(notice);
}

function dismissStorageRecoveryNotice() {
  document.getElementById('storage-recovery-notice')?.remove();
  try { sessionStorage.setItem('_voltflow_storage_notice_dismissed', '1'); } catch {}
}

function tryAutoMigrate() {
  const thisVersionKey = `_voltflow_opened_${VOLTFLOW_VERSION}`;

  // Si ya se abri? esta versi?n antes -> no hacer nada
  if (localStorage.getItem(thisVersionKey)) return false;

  // Primera vez que se abre esta versi?n -> marcarla
  localStorage.setItem(thisVersionKey, Date.now().toString());

  // Contar datos disponibles en el localStorage (dejados por versiones anteriores)
  const existingLeads   = (() => { try { return JSON.parse(localStorage.getItem('gordi_leads') || '[]'); } catch { return []; } })();
  const existingHistory = (() => { try { return JSON.parse(localStorage.getItem('gordi_email_history') || '[]'); } catch { return []; } })();
  const existingCamps   = (() => { try { return JSON.parse(localStorage.getItem('gordi_campaigns') || '[]'); } catch { return []; } })();
  const existingSearches = (() => { try { return JSON.parse(localStorage.getItem('gordi_search_history') || '[]'); } catch { return []; } })();
  const existingSavedSearches = (() => { try { return JSON.parse(localStorage.getItem('gordi_saved_searches') || '[]'); } catch { return []; } })();
  const existingMemory = parseStoredObject('gordi_commercial_memory');
  const hasScrapeMemory = (() => {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('gordi_scrape_memory_') || key.startsWith('gordi_ecache_'))) return true;
    }
    return false;
  })();
  const hasApiKeys      = !!(localStorage.getItem('gordi_api_key') || getGeminiKey() || localStorage.getItem('gordi_hunter_key'));
  const hasProfile      = !!localStorage.getItem('gordi_user_name');

  // Si no hay ning?n dato previo -> primera instalaci?n, nada que migrar
  const hasWorkData = existingLeads.length || existingHistory.length || existingCamps.length ||
    existingSearches.length || existingSavedSearches.length || Object.keys(existingMemory).length ||
    hasScrapeMemory || hasApiKeys || hasProfile;
  if (!hasWorkData) return false;

  const migrationSnapshot = createSafetySnapshot(`before_opening_${VOLTFLOW_VERSION}`);

  // Hay datos -> volcado autom?tico completo (ya est?n en localStorage, solo necesitamos cargarlos en memoria)
  // Guardar un registro de la migraci?n para mostrarlo
  const migrationLog = {
    date: new Date().toISOString(),
    leads: existingLeads.length,
    emails: existingHistory.length,
    campaigns: existingCamps.length,
    searches: existingSearches.length + existingSavedSearches.length,
    commercialMemory: Object.keys(existingMemory).length,
    hasScrapeMemory,
    hasApiKeys,
    hasProfile,
    safetySnapshotId: migrationSnapshot ? migrationSnapshot.id : null,
    fromVersion: localStorage.getItem('_voltflow_last_version') || 'anterior'
  };
  localStorage.setItem('_voltflow_last_migration', JSON.stringify(migrationLog));
  localStorage.setItem('_voltflow_last_version', VOLTFLOW_VERSION);

  return migrationLog;
}

function parseStoredJson(raw, defaultVal) {
  if (!raw) return defaultVal;
  try {
    let parsed = JSON.parse(raw);
    if (typeof parsed === 'string') parsed = JSON.parse(parsed);
    return parsed;
  } catch (e) {
    throw e;
  }
}

function coerceStoredArray(value, key) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value[key])) return value[key];
  if (key === 'leads' && value && Array.isArray(value.gordi_leads)) return value.gordi_leads;
  return [];
}

function normalizeLoadedLead(lead, index) {
  if (!lead || typeof lead !== 'object') return null;
  const now = new Date().toISOString();
  return {
    ...lead,
    id: lead.id || `${Date.now()}_${index}`,
    name: lead.name || lead.contact || lead.manager || '',
    company: lead.company || lead.title || lead.nombre || 'Sin empresa',
    email: lead.email || '',
    phone: lead.phone || lead.telefono || '',
    segment: lead.segment || lead.sector || 'Otros',
    status: lead.status || 'Pendiente',
    date: lead.date || lead.created_at || now,
    status_date: lead.status_date || lead.date || now,
    notes: lead.notes || '',
    tags: Array.isArray(lead.tags) ? lead.tags : [],
    activity: Array.isArray(lead.activity) ? lead.activity : []
  };
}

function loadAllData() {
  let corruptionDetected = false;
  
  const loadWithCatch = (key, defaultVal) => {
    try {
      const data = localStorage.getItem(key);
      return parseStoredJson(data, defaultVal);
    } catch (e) {
      console.error(`Error parsing ${key}:`, e);
      corruptionDetected = true;
      return defaultVal;
    }
  };

  const rawLeads = localStorage.getItem('gordi_leads');
  leads = coerceStoredArray(loadWithCatch('gordi_leads', []), 'leads')
    .map(normalizeLoadedLead)
    .filter(Boolean);
  emailHistory = coerceStoredArray(loadWithCatch('gordi_email_history', []), 'emailHistory');
  campaigns = coerceStoredArray(loadWithCatch('gordi_campaigns', []), 'campaigns');
  objectives = loadWithCatch('gordi_objectives', { leads: 20, emails: 10, replies: 3 });
  searchHistoryList = coerceStoredArray(loadWithCatch('gordi_search_history', []), 'searchHistoryList');
  window.__voltflowLoadDiagnostics = {
    origin: location.origin && location.origin !== 'null' ? location.origin : location.href,
    rawLeadsPresent: !!rawLeads,
    loadedLeads: leads.length,
    loadedAt: new Date().toISOString()
  };
  
  try {
    const saved = localStorage.getItem('gordi_templates');
    emailTemplates = saved ? { ...defaultTemplates, ...JSON.parse(saved) } : { ...defaultTemplates };
  } catch (e) {
    console.error('Error parsing templates:', e);
    emailTemplates = { ...defaultTemplates };
    corruptionDetected = true;
  }

  if (corruptionDetected) {
    alert("Aviso: ALERTA DE DATOS: Se han detectado datos corruptos o incompatibles en tu base de datos local.\n\nPor seguridad, los datos afectados no se han cargado para evitar sobreescribirlos. Por favor, ve a 'Configuracion' y utiliza la opcion 'Exportar Datos' para generar un backup sin procesar, y contacta con soporte.");
  }

  // Cargar keys y perfil
  const apiKey = localStorage.getItem('gordi_api_key');
  const hunterKey = localStorage.getItem('gordi_hunter_key');
  const el = id => document.getElementById(id);

  const profile = {
    name: localStorage.getItem('gordi_user_name') || 'H?ctor Alfredo Salazar',
    email: localStorage.getItem('gordi_user_email') || 'hector@voltiummadrid.es',
    company: localStorage.getItem('gordi_user_company') || 'Voltium Madrid',
    phone: localStorage.getItem('gordi_user_phone') || '',
    web: localStorage.getItem('gordi_user_web') || 'https://www.voltiummadrid.es',
    logo: localStorage.getItem('gordi_user_logo') || ''
  };

  if (el('user-name-input')) el('user-name-input').value = profile.name;
  if (el('user-email-input')) el('user-email-input').value = profile.email;
  if (el('user-company-input')) el('user-company-input').value = profile.company;
  if (el('user-phone-input')) el('user-phone-input').value = profile.phone;
  if (el('user-web-input')) el('user-web-input').value = profile.web;
  if (el('user-logo-input')) el('user-logo-input').value = profile.logo;

  if (apiKey && el('api-key-input')) {
    el('api-key-input').value = apiKey;
    el('api-key-status').innerHTML = '<span style="color:var(--success)">OK API Key guardada</span>';
    loadGoogleMapsScript(apiKey);
  }
  if (hunterKey && el('hunter-key-input')) {
    el('hunter-key-input').value = hunterKey;
    el('hunter-key-status').innerHTML = '<span style="color:var(--success)">OK Hunter Key guardada</span>';
  }
  const _ssid = localStorage.getItem('gordi_sheets_id');
  const _scid = localStorage.getItem('gordi_sheets_client_id');
  const _stok = localStorage.getItem('gordi_sheets_token');
  if (_ssid && el('sheets-id-input'))     el('sheets-id-input').value     = _ssid;
  if (_scid && el('sheets-client-input')) el('sheets-client-input').value = _scid;
  if (_stok && el('sheets-token-input'))  el('sheets-token-input').value  = _stok;

  const claudeKey = getGeminiKey();
  if (claudeKey && el('claude-key-input')) {
    el('claude-key-input').value = claudeKey;
    el('claude-key-status').innerHTML = '<span style="color:var(--success)">OK Gemini Key guardada</span>';
  }
  const groqKey = localStorage.getItem('gordi_groq_key');
  if (groqKey && el('groq-key-input')) {
    el('groq-key-input').value = groqKey;
    el('groq-key-status').innerHTML = '<span style="color:var(--success)">OK Groq Key guardada</span>';
  }
  const openrouterKey = localStorage.getItem('gordi_openrouter_key');
  if (openrouterKey && el('openrouter-key-input')) {
    el('openrouter-key-input').value = openrouterKey;
    el('openrouter-key-status').innerHTML = '<span style="color:var(--success)">OK OpenRouter Key guardada</span>';
  }
  // Mostrar estado del router IA
  setTimeout(refreshAiRouterStatus, 100);
  const apolloKey = localStorage.getItem('gordi_apollo_key');
  if (apolloKey && el('apollo-key-input')) {
    el('apollo-key-input').value = apolloKey;
    el('apollo-key-status').innerHTML = '<span style="color:var(--success)">OK Apollo Key guardada</span>';
  }
  // JSONBin
  const jbKey = localStorage.getItem('gordi_jsonbin_key');
  const jbBin = localStorage.getItem('gordi_jsonbin_bin');
  if (jbKey && el('jsonbin-key-input')) {
    el('jsonbin-key-input').value = jbKey;
    if (jbBin && el('jsonbin-bin-input')) el('jsonbin-bin-input').value = jbBin;
    jsonbinActivateUI();
  }
  const jbAuto = localStorage.getItem('gordi_jsonbin_auto') === 'true';
  if (el('jsonbin-auto-toggle')) el('jsonbin-auto-toggle').checked = jbAuto;
}

function updateDate() {
  const el = document.getElementById('current-date');
  if (el) el.innerText = new Date().toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

// ============ NAVEGACION ============

function syncViewNavigationState(view) {
  document.querySelectorAll('aside nav li[data-view]').forEach(li => {
    li.classList.toggle('active', li.getAttribute('data-view') === view);
  });

  let mobileMatched = false;
  document.querySelectorAll('#mobile-bottom-nav .mob-nav-btn[data-view]').forEach(btn => {
    const btnView = btn.getAttribute('data-view');
    const isActive = btnView === view;
    if (isActive) mobileMatched = true;
    btn.classList.toggle('active', isActive);
  });

  const moreBtn = document.querySelector('#mobile-bottom-nav .mob-nav-btn[data-view="more"]');
  if (moreBtn) moreBtn.classList.toggle('active', !mobileMatched);
  document.body.dataset.activeView = view;
}

function closeMobileChromeAfterNavigation() {
  if (window.innerWidth > 1024) return;
  try {
    if (typeof closeMobileSidebar === 'function') closeMobileSidebar();
  } catch {}
}

function notifyViewChanged(view) {
  const detail = {
    view,
    id: `${view}-view`,
    timestamp: Date.now()
  };
  try {
    document.dispatchEvent(new CustomEvent('gordi:view-changed', { detail }));
  } catch {}
  try {
    if (typeof VoltiumEvents !== 'undefined' && typeof VoltiumEvents.emit === 'function') {
      VoltiumEvents.emit('view:changed', detail);
    }
  } catch {}
}


// ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ 
//     MODULO: UI
// --   Renderizado, vistas, modales, drawer y componentes visuales
// --   Funciones: showView, showToast, setProgress, logEnrich, updateEnrichStats,
  //          renderLeads, renderKanban, updateCard, openLeadDrawer, closeDrawer,
  //          openGlobalSearch, openVoiceModal, openScanModal, openFocusMode
// ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ 

function showView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`${view}-view`);
  if (!target) {
    const fallback = document.getElementById('dashboard-view');
    if (fallback) fallback.classList.add('active');
    syncViewNavigationState('dashboard');
    closeMobileChromeAfterNavigation();
    notifyViewChanged('dashboard');
    requestAnimationFrame(() => {
      if (typeof refreshVisualSystem === 'function') refreshVisualSystem();
    });
    console.warn('Vista no encontrada:', view);
    return;
  }
  target.classList.add('active');
  syncViewNavigationState(view);
  if (view === 'leads') renderLeads();
  if (view === 'kanban') renderKanban();
  if (view === 'campaigns') renderCampaigns();
  if (view === 'tracking') renderTracking();
  if (view === 'coverage' && typeof renderCoverage === 'function') renderCoverage();
  if ((view === 'inbox' || view === 'map') && typeof ensureGordiModule === 'function') {
    ensureGordiModule('inbox').then(() => {
      if (view === 'map' && typeof initLeadsMap === 'function') setTimeout(initLeadsMap, 80);
    });
  }
  if (view === 'import' && typeof ensureGordiModule === 'function') {
    ensureGordiModule('smartImport');
  }
  if (view === 'settings') {
    renderTemplateList();
    renderSearchHistory();
    updateStorageInfo();
  }
  if (view === 'dashboard') { renderDashboardCharts(); renderRecentActivity(); renderTopLeads(); if (typeof renderTodayPanel === 'function') renderTodayPanel(); }

  closeMobileChromeAfterNavigation();
  const main = document.querySelector('main');
  if (main) main.scrollTop = 0;
  try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch {}
  notifyViewChanged(view);
  requestAnimationFrame(() => {
    if (typeof refreshVisualSystem === 'function') refreshVisualSystem();
  });
}

function toggleLeadForm() {
  const panel = document.getElementById('lead-form-panel');
  const isOpening = panel.style.display === 'none' || panel.style.display === '';
  panel.style.display = isOpening ? 'block' : 'none';
  if (isOpening) {
    setTimeout(initLeadFormDatePicker, 50);
    restoreLeadFormDraft();
    startLeadFormAutosave();
  } else {
    stopLeadFormAutosave();
  }
}

// ============ PERFIL / FIRMA ============

function previewFirma() {
  saveProfile();
  const box = document.getElementById('firma-preview');
  const content = document.getElementById('firma-preview-content');
  box.style.display = 'block';
  content.innerHTML = buildFirmaHTML();
}


// ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ 
//   MODULO: JSONBin Sync - Sincronizaci?n multi-dispositivo
// ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ ⬢ 

const JSONBIN_API = 'https://api.jsonbin.io/v3';
let _jsonbinPushing = false;
let _jsonbinPullPending = false;

// --  Activar UI cuando hay key guardada ---------------------------------------
function jsonbinActivateUI() {
  const badge   = document.getElementById('jsonbin-badge');
  const pushBtn = document.getElementById('btn-jsonbin-push');
  const pullBtn = document.getElementById('btn-jsonbin-pull');
  const testBtn = document.getElementById('btn-jsonbin-test');
  const autoRow = document.getElementById('jsonbin-auto-row');
  if (badge)   badge.style.display   = 'inline-block';
  if (pushBtn) pushBtn.style.display = 'inline-flex';
  if (pullBtn) pullBtn.style.display = 'inline-flex';
  if (testBtn) testBtn.style.display = 'inline-flex';
  if (autoRow) autoRow.style.display = 'flex';
}


// --  Guardar configuracion ---------------------------------------------------
async function saveJsonBinConfig() {
  const key = document.getElementById('jsonbin-key-input')?.value.trim();
  if (!key || key.length < 10) {
    jsonbinSetStatus('Aviso: Introduce tu Master Key de JSONBin', 'var(--danger)');
    return;
  }
  localStorage.setItem('gordi_jsonbin_key', key);
  jsonbinSetStatus('⏳ Conectando con JSONBin...', 'var(--text-dim)');

  // Check if we already have a bin ID
  const existingBin = document.getElementById('jsonbin-bin-input')?.value.trim();
  if (existingBin) {
    localStorage.setItem('gordi_jsonbin_bin', existingBin);
    jsonbinActivateUI();
    jsonbinSetStatus('OK Configuracion guardada - bin existente vinculado', 'var(--success)');
    showToast(' JSONBin configurado correctamente');
    return;
  }

  // Create a new bin with current data
  await jsonbinCreateBin(key);
}

// --  Crear bin nuevo ---------------------------------------------------------
async function jsonbinCreateBin(key) {
  try {
    const snapshot = exportDataSnapshot();
    const res = await fetch(`${JSONBIN_API}/b`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': key,
        'X-Bin-Name': 'voltflow-data',
        'X-Bin-Private': 'true'
      },
      body: JSON.stringify({ voltflow: snapshot, _created: new Date().toISOString() })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const binId = data.metadata?.id;
    if (!binId) throw new Error('No bin ID returned');
    localStorage.setItem('gordi_jsonbin_bin', binId);
    const binInput = document.getElementById('jsonbin-bin-input');
    if (binInput) binInput.value = binId;
    jsonbinActivateUI();
    jsonbinSetStatus(`OK Bin creado y datos subidos - ID: ${binId}`, 'var(--success)');
    showToast(' JSONBin configurado - bin creado con tus datos actuales');
  } catch(e) {
    console.error('JSONBin create error:', e);
    jsonbinSetStatus(`Error: Error al crear bin: ${e.message} - comprueba tu Master Key`, 'var(--danger)');
  }
}

// --  Push (subir datos) ------------------------------------------------------
async function jsonbinPush(showFeedback = true) {
  const key = localStorage.getItem('gordi_jsonbin_key');
  const binId = localStorage.getItem('gordi_jsonbin_bin');
  if (!key || !binId) {
    if (showFeedback) jsonbinSetStatus('Aviso: Configura primero la Master Key y crea un bin', 'var(--warning)');
    return;
  }
  if (_jsonbinPushing) return; // debounce
  _jsonbinPushing = true;

  if (showFeedback) jsonbinSetStatus(' Subiendo datos...', 'var(--text-dim)');

  try {
    const snapshot = exportDataSnapshot();
    const res = await fetch(`${JSONBIN_API}/b/${binId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': key
      },
      body: JSON.stringify({ voltflow: snapshot, _updated: new Date().toISOString() })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const now = new Date().toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
    localStorage.setItem('gordi_jsonbin_last_push', new Date().toISOString());
    if (showFeedback) {
      jsonbinSetStatus(`OK Datos subidos correctamente - ${now}`, 'var(--success)');
      showToast(' Datos sincronizados en la nube');
    }
  } catch(e) {
    console.error('JSONBin push error:', e);
    if (showFeedback) jsonbinSetStatus(`Error: Error al subir: ${e.message}`, 'var(--danger)');
  } finally {
    setTimeout(() => { _jsonbinPushing = false; }, 3000); // debounce 3s
  }
}

// --  Pull (descargar datos) ---------------------------------------------------
async function jsonbinPull(showFeedback = true) {
  const key = localStorage.getItem('gordi_jsonbin_key');
  const binId = localStorage.getItem('gordi_jsonbin_bin');
  if (!key || !binId) {
    if (showFeedback) jsonbinSetStatus('Aviso: Configura primero la Master Key', 'var(--warning)');
    return;
  }

  if (showFeedback) jsonbinSetStatus(' Descargando datos...', 'var(--text-dim)');

  try {
    const res = await fetch(`${JSONBIN_API}/b/${binId}/latest`, {
      headers: { 'X-Master-Key': key }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const snapshot = data.record?.voltflow;
    if (!snapshot) throw new Error('Datos no encontrados en el bin');
    const snapshotValidation = validateDataSnapshot(snapshot, getCurrentDataSummary());
    if (!snapshotValidation.ok) throw new Error(snapshotValidation.errors.join(' '));

    // Smart merge: solo importar si la nube es m?s reciente o tiene diferencias claras
    const cloudUpdated = data.record?._updated || data.record?._created || '';
    const lastPush = localStorage.getItem('gordi_jsonbin_last_push') || '';
    const cloudLeadCount = (() => {
      try { return JSON.parse(snapshot['gordi_leads'] || '[]').length; } catch { return 0; }
    })();
    const localLeadCount = leads.length;

    // Hash r?pido: longitud del JSON local vs nube para detectar cambios reales sin parsear todo
    const cloudLeadsRaw  = snapshot['gordi_leads'] || '[]';
    const localLeadsRaw  = localStorage.getItem('gordi_leads') || '[]';
    const dataIsDifferent = cloudLeadsRaw.length !== localLeadsRaw.length;

    let isNewer = false;
    let shouldPull = false;

    if (cloudUpdated) {
      const cloudTime = new Date(cloudUpdated).getTime();
      const localTime = lastPush ? new Date(lastPush).getTime() : 0;
      // A?adimos buffer de 5s para evitar pull de algo que acabamos de pushear
      if (cloudTime > localTime + 5000) isNewer = true;
    }

    if (showFeedback) {
      if (cloudLeadCount !== localLeadCount || isNewer) {
        const confirmMsg = `?Descargar datos de la nube?\n\nNube: ${cloudLeadCount} leads (actualizado: ${cloudUpdated ? new Date(cloudUpdated).toLocaleString('es-ES') : 'desconocido'})\nLocal: ${localLeadCount} leads\n\nEsto reemplazar? tus datos locales.`;
        if (!confirm(confirmMsg)) {
          jsonbinSetStatus('Descarga cancelada por el usuario', 'var(--text-dim)');
          return;
        }
        shouldPull = true;
      } else {
        shouldPull = true; // El usuario puls? el bot?n manualmente y no hay diff grave, hacemos pull
      }
    } else {
      // Descarga silenciosa (al arrancar): solo si la nube es realmente m?s reciente Y los datos difieren.
      // Evita render extra + p?rdida de ediciones tempranas cuando counts son iguales pero la nube
      // tiene el mismo snapshot que acabamos de pushear hace menos de 5 s.
      if (isNewer && dataIsDifferent) {
        shouldPull = true;
      } else if (cloudLeadCount > localLeadCount && dataIsDifferent) {
        shouldPull = true;
      }
    }

    if (!shouldPull) {
      if (!showFeedback) console.log('JSONBin Pull omitido: los datos locales ya est?n actualizados.');
      return;
    }

    if (!showFeedback && snapshotValidation.warnings.length && cloudLeadCount < localLeadCount) {
      console.warn('JSONBin Pull omitido por posible perdida de datos:', snapshotValidation.warnings);
      return;
    }

    // Apply snapshot
    importDataSnapshot(snapshot, true, { reason: 'before_jsonbin_pull' });
    // Reload all data through the same tolerant loader used at startup.
    loadAllData();

    renderAll();
    try { renderTracking(); } catch(e) {}
    try { renderDashboardCharts(); } catch(e) {}

    const now = new Date().toLocaleTimeString('es-ES', { hour:'2-digit', minute:'2-digit' });
    if (showFeedback) {
      jsonbinSetStatus(`OK Datos descargados - ${cloudLeadCount} leads ? ${now}`, 'var(--success)');
      showToast(` ${cloudLeadCount} leads descargados desde la nube`);
    } else {
      // Silent pull on app start - show subtle toast only if data changed
      if (cloudLeadCount !== localLeadCount) {
        showToast(` Sync: ${cloudLeadCount} leads desde la nube`);
      }
    }
  } catch(e) {
    console.error('JSONBin pull error:', e);
    if (showFeedback) jsonbinSetStatus(`Error: Error al descargar: ${e.message}`, 'var(--danger)');
  }
}

// --  Test conexi?n ------------------------------------------------------------
async function jsonbinTestConnection() {
  const key = localStorage.getItem('gordi_jsonbin_key');
  const binId = localStorage.getItem('gordi_jsonbin_bin');
  jsonbinSetStatus(' Probando conexi?n...', 'var(--text-dim)');
  try {
    const res = await fetch(`${JSONBIN_API}/b/${binId}/latest`, {
      headers: { 'X-Master-Key': key }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const updated = data.record?._updated || data.record?._created || '';
    jsonbinSetStatus(
      `OK Conexion OK - ultima actualizacion: ${updated ? new Date(updated).toLocaleString('es-ES') : 'desconocida'}`,
      'var(--success)'
    );
  } catch(e) {
    jsonbinSetStatus(`Error: Error de conexi?n: ${e.message}`, 'var(--danger)');
  }
}

// --  Toggle auto-sync ---------------------------------------------------------

async function checkUpdates(startupContext = {}) {
  try {
    const res = await fetch('version.json?t=' + Date.now());
    if (res.ok) {
      const data = await res.json();
      VOLTFLOW_VERSION = data.version || VOLTFLOW_VERSION;
      VOLTFLOW_CHANGELOG = Array.isArray(data.changelog) ? data.changelog : [];
    }
  } catch (e) {
    console.warn('No se pudo comprobar version.json:', e);
  }

  const lastSeen = localStorage.getItem('_voltflow_last_version');
  const noticeKey = `_voltflow_notice_seen_${VOLTFLOW_VERSION}`;
  const isUpdate = !!lastSeen && lastSeen !== VOLTFLOW_VERSION;
  const recovered = hasRecoveredLocalData(startupContext.recoverySummary);
  const shouldShow = !localStorage.getItem(noticeKey) && (isUpdate || recovered || startupContext.migrationResult);

  if (shouldShow) {
    setTimeout(() => showWhatsNewModal(lastSeen || 'primera apertura', VOLTFLOW_VERSION, startupContext), 900);
  } else if (!lastSeen) {
    localStorage.setItem('_voltflow_last_version', VOLTFLOW_VERSION);
  }
}


function getProfile() {
  return {
    name: localStorage.getItem('gordi_user_name') || 'Hector Alfredo Salazar',
    email: localStorage.getItem('gordi_user_email') || 'hector@voltiummadrid.es',
    company: localStorage.getItem('gordi_user_company') || 'Voltium Madrid',
    phone: localStorage.getItem('gordi_user_phone') || '',
    web: localStorage.getItem('gordi_user_web') || 'https://www.voltiummadrid.es',
    logo: localStorage.getItem('gordi_user_logo') || ''
  };
}

function buildFirmaText() {
  const p = getProfile();
  let firma = `\n--\n${p.name}`;
  if (p.company) firma += ` - ${p.company}`;
  if (p.phone) firma += `\nTel. ${p.phone}`;
  if (p.email) firma += `\n${p.email}`;
  if (p.web) firma += `\n${p.web}`;
  return firma;
}

function buildFirmaHTML() {
  const p = getProfile();
  let html = `<div style="font-family:Arial,sans-serif;margin-top:1.5rem;padding-top:1rem;border-top:1px solid #ddd;font-size:13px;color:#333">`;
  if (p.logo) html += `<img src="${p.logo}" alt="${p.company}" style="height:40px;margin-bottom:.5rem;display:block">`;
  html += `<strong>${p.name}</strong>`;
  if (p.company) html += ` - <strong>${p.company}</strong>`;
  if (p.phone) html += `<br>Tel: ${p.phone}`;
  html += `<br>Email: <a href="mailto:${p.email}">${p.email}</a>`;
  if (p.web) html += `<br>Web: <a href="${p.web}" target="_blank">${p.web}</a>`;
  html += `</div>`;
  return html;
}

function saveProfile() {
  ['name','email','company','phone','web','logo'].forEach(k => {
    const input = document.getElementById(`user-${k}-input`);
    if (input) localStorage.setItem(`gordi_user_${k}`, input.value.trim());
  });
  const status = document.getElementById('profile-status');
  if (status) status.innerHTML = '<span style="color:var(--success)">Perfil actualizado</span>';
  setTimeout(() => {
    if (status) status.innerHTML = '';
  }, 3000);
}

function jsonbinSetStatus(msg, color) {
  const el = document.getElementById('jsonbin-status');
  if (el) el.innerHTML = `<span style="color:${color || 'var(--text-dim)'}">${cleanVisibleText(msg)}</span>`;
}

function updateCloudPill() {
  const pill = document.getElementById('cloud-sync-pill');
  const dot = document.getElementById('cloud-sync-dot');
  const lbl = document.getElementById('cloud-sync-label');
  if (!pill) return;
  const ghToken = localStorage.getItem('gordi_gh_token');
  const ghAuto = localStorage.getItem('gordi_gh_auto') === 'true';
  if (ghToken) {
    pill.style.display = 'flex';
    dot.style.background = ghAuto ? 'var(--success)' : 'var(--warning,#f59e0b)';
    lbl.textContent = ghAuto ? 'GitHub sync' : 'Manual';
  } else {
    pill.style.display = 'none';
  }
}

function toggleJsonBinAuto(enabled) {
  localStorage.setItem('gordi_jsonbin_auto', enabled ? 'true' : 'false');
  updateCloudPill();
  if (enabled) {
    jsonbinSetStatus('Sync automatico activado - los datos se subiran al guardar y descargaran al abrir', 'var(--success)');
    showToast('Sincronizacion automatica activada');
  } else {
    jsonbinSetStatus('Sync automatico desactivado - usa los botones para sincronizar manualmente', 'var(--text-dim)');
  }
}

function saveApiKey() {
  const k = document.getElementById('api-key-input')?.value.trim();
  if (!k) return;
  localStorage.setItem('gordi_api_key', k);
  const status = document.getElementById('api-key-status');
  if (status) status.innerHTML = '<span style="color:var(--success)">API Key guardada. Recarga (F5) para activar.</span>';
  loadGoogleMapsScript(k);
}

function saveHunterKey() {
  const k = document.getElementById('hunter-key-input')?.value.trim();
  if (!k) return;
  localStorage.setItem('gordi_hunter_key', k);
  const status = document.getElementById('hunter-key-status');
  if (status) status.innerHTML = '<span style="color:var(--success)">Hunter Key guardada</span>';
}

function saveApolloKey() {
  const k = document.getElementById('apollo-key-input')?.value.trim();
  if (!k) return;
  localStorage.setItem('gordi_apollo_key', k);
  const status = document.getElementById('apollo-key-status');
  if (status) status.innerHTML = '<span style="color:var(--success)">Apollo Key guardada</span>';
}

function saveClaudeKey() {
  const k = document.getElementById('claude-key-input')?.value.trim();
  if (!k) return;
  localStorage.setItem('gordi_claude_key', k);
  localStorage.setItem('gordi_gemini_key', k);
  const status = document.getElementById('claude-key-status');
  if (status) status.innerHTML = '<span style="color:var(--success)">Gemini Key guardada</span>';
  refreshAiRouterStatus();
}

function saveGroqKey() {
  const k = document.getElementById('groq-key-input')?.value.trim();
  if (!k) return;
  localStorage.setItem('gordi_groq_key', k);
  const status = document.getElementById('groq-key-status');
  if (status) status.innerHTML = '<span style="color:var(--success)">Groq Key guardada</span>';
  refreshAiRouterStatus();
}

function saveOpenRouterKey() {
  const k = document.getElementById('openrouter-key-input')?.value.trim();
  if (!k) return;
  localStorage.setItem('gordi_openrouter_key', k);
  const status = document.getElementById('openrouter-key-status');
  if (status) status.innerHTML = '<span style="color:var(--success)">OpenRouter Key guardada</span>';
  refreshAiRouterStatus();
}

function refreshAiRouterStatus() {
  const el = document.getElementById('ai-router-status');
  if (!el) return;
  const s = AI_ROUTER.getStatus();
  const row = (name, label, icon, info) => {
    const ok = s[name].configured;
    const lim = s[name].limited;
    const color = !ok ? 'var(--text-dim)' : lim ? 'var(--warning)' : 'var(--success)';
    const badge = !ok ? 'No configurado' : lim ? 'Limite alcanzado' : 'Activo';
    return `<div style="display:flex;align-items:center;gap:.6rem;padding:.35rem 0;border-bottom:1px solid var(--glass-border)">
      <span>${icon}</span>
      <span style="flex:1;font-weight:600">${label}</span>
      <span style="color:${color};font-size:.75rem">${badge}</span>
      ${ok ? '' : `<a href="${info}" target="_blank" style="font-size:.72rem;color:var(--primary)">Configurar -></a>`}
    </div>`;
  };
  el.innerHTML =
    row('gemini', 'Gemini (Principal)', 'G', 'https://aistudio.google.com/apikey') +
    row('groq', 'Groq (Respaldo 1)', 'G', 'https://console.groq.com') +
    row('openrouter', 'OpenRouter (Resp. 2)', 'O', 'https://openrouter.ai') +
    `<p style="margin-top:.6rem;font-size:.75rem;color:var(--text-dim)">Configura los 3 proveedores para tener IA practicamente ilimitada. El sistema cambia automaticamente cuando uno alcanza su limite.</p>`;
}

// Clean override for the startup modal. The older block above contains mojibake
// characters from previous encoding conversions; this ASCII-only version is the
// one used at runtime.
function showWhatsNewModal(oldV, newV, startupContext = {}) {
  const summary = startupContext.recoverySummary || getLocalRecoverySummary();
  const changelog = VOLTFLOW_CHANGELOG.length ? VOLTFLOW_CHANGELOG : [
    { title: 'Datos locales recuperados', desc: 'La app carga automaticamente los datos guardados en este navegador.' }
  ];
  const items = changelog.map(item => `
    <div style="margin-bottom:12px;padding:12px;background:rgba(255,255,255,0.03);border-radius:10px;border:1px solid rgba(255,255,255,0.05)">
      <strong style="display:block;color:var(--primary);margin-bottom:4px;font-size:15px">${item.title}</strong>
      <span style="font-size:13px;color:var(--text-dim);line-height:1.45">${item.desc}</span>
    </div>
  `).join('');
  const stat = (label, value) => `
    <div style="padding:.65rem .75rem;border:1px solid var(--glass-border);border-radius:10px;background:rgba(255,255,255,.035)">
      <div style="font-size:1rem;font-weight:800;color:var(--text)">${value}</div>
      <div style="font-size:.68rem;color:var(--text-dim)">${label}</div>
    </div>`;

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(10px);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .35s ease';
  modal.innerHTML = `
    <div style="background:var(--bg-card);max-width:620px;width:100%;border-radius:20px;border:1px solid var(--glass-border);box-shadow:0 25px 50px -12px rgba(0,0,0,.5);overflow:hidden;transform:scale(.94);transition:transform .35s ease">
      <div style="background:linear-gradient(135deg,var(--primary),var(--secondary));padding:30px;text-align:center">
        <div style="font-size:34px;margin-bottom:10px;font-weight:800;letter-spacing:.04em;color:#fff">OK</div>
        <h2 style="margin:0;color:#fff;font-size:24px">Gordi listo y datos recuperados</h2>
        <p style="margin:6px 0 0;color:rgba(255,255,255,.82);font-size:14px">v${oldV} -> v${newV}</p>
      </div>
      <div style="padding:25px;max-height:520px;overflow-y:auto">
        <div style="padding:14px 16px;margin-bottom:18px;border-radius:12px;background:rgba(16,217,124,.08);border:1px solid rgba(16,217,124,.22);font-size:.86rem;line-height:1.55;color:var(--text-muted)">
          Tus datos se han cargado automaticamente desde la memoria local de <strong style="color:var(--text)">${summary.origin}</strong>. Esto incluye CRM, historial, busquedas, configuracion y memoria comercial guardada en este navegador.
          <br><span style="color:var(--warning)">Importante:</span> si abres la herramienta en otro navegador, otro dispositivo, modo incognito o borras datos del sitio, esa memoria local no estara disponible. Para mover datos usa backup, QR o sincronizacion en la nube.
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:.55rem;margin-bottom:18px">
          ${stat('Leads', summary.leads)}
          ${stat('Emails', summary.emails)}
          ${stat('Campanas', summary.campaigns)}
          ${stat('Busquedas', summary.searches)}
          ${stat('Memoria', summary.commercialMemory)}
          ${stat('Scraping', (summary.scrapeMemory || 0) + (summary.enrichCache || 0))}
          ${stat('Claves API', summary.apiKeys)}
        </div>
        <h3 style="margin:0 0 15px;font-size:16px;color:var(--text)">Novedades en esta version:</h3>
        ${items}
      </div>
      <div style="padding:20px;text-align:center;border-top:1px solid var(--glass-border)">
        <button id="close-whats-new" style="background:var(--primary);color:#fff;border:none;padding:12px 35px;border-radius:30px;font-weight:bold;cursor:pointer;box-shadow:0 10px 20px -5px var(--primary)">Entendido</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  requestAnimationFrame(() => {
    modal.style.opacity = '1';
    modal.querySelector('div').style.transform = 'scale(1)';
  });
  modal.querySelector('#close-whats-new').onclick = () => {
    modal.style.opacity = '0';
    modal.querySelector('div').style.transform = 'scale(.94)';
    setTimeout(() => {
      modal.remove();
      localStorage.setItem(`_voltflow_notice_seen_${VOLTFLOW_VERSION}`, Date.now().toString());
      localStorage.setItem('_voltflow_last_version', VOLTFLOW_VERSION);
    }, 300);
  };
}




