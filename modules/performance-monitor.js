(function () {
  'use strict';

  if (window.__gordiPerformanceMonitorBooted) return;
  window.__gordiPerformanceMonitorBooted = true;

  const BUILD = window.GORDI_APP_BUILD || '2026.06.04.0320';
  const PERF_LOG_KEY = 'gordi_perf_log';
  const PERF_DIAG_KEY = 'gordi_perf_diag';
  const PERF_MAX = 120;
  const FREEZE_THRESHOLD_MS = 4500;
  const HEARTBEAT_MS = 1500;
  const PERF_FLUSH_MS = 12000;
  let lastBeat = performance.now();
  let autoFallbackTriggered = false;
  let perfBuffer = [];
  let perfFlushTimer = null;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function flushPerfSamples() {
    if (perfFlushTimer) clearTimeout(perfFlushTimer);
    perfFlushTimer = null;
    if (!perfBuffer.length) return;
    const log = readJson(PERF_LOG_KEY, []);
    writeJson(PERF_LOG_KEY, [...perfBuffer, ...log].slice(0, PERF_MAX));
    perfBuffer = [];
  }

  function pushPerfSample(sample) {
    const keepSample = String(sample?.name || '').startsWith('boot:')
      || String(sample?.name || '').startsWith('view:')
      || Number(sample?.duration || 0) >= 16;
    if (!keepSample) return;
    perfBuffer.unshift(sample);
    if (perfBuffer.length >= 40) {
      flushPerfSamples();
      return;
    }
    if (perfFlushTimer) clearTimeout(perfFlushTimer);
    perfFlushTimer = setTimeout(flushPerfSamples, PERF_FLUSH_MS);
  }

  function storeDiagnostic(reason, extra = {}) {
    const activeView = document.querySelector('.view.active')?.id || 'unknown';
    const diag = {
      reason,
      at: new Date().toISOString(),
      build: BUILD,
      safeMode: !!window.GORDI_SAFE_MODE,
      activeView,
      leads: Array.isArray(window.leads) ? window.leads.length : null,
      results: Array.isArray(window.tempSearchResults) ? window.tempSearchResults.length : null,
      bootReady: !!window.__gordiBootReady,
      ...extra
    };
    writeJson(PERF_DIAG_KEY, diag);
    return diag;
  }

  function measure(name, fn, meta = {}) {
    const start = performance.now();
    try {
      return fn();
    } finally {
      const duration = Math.round((performance.now() - start) * 10) / 10;
      pushPerfSample({
        name,
        duration,
        at: new Date().toISOString(),
        build: BUILD,
        meta
      });
    }
  }

  function begin(name, meta = {}) {
    return { name, meta, startedAt: performance.now() };
  }

  function end(token, extra = {}) {
    if (!token || typeof token.startedAt !== 'number') return;
    const duration = Math.round((performance.now() - token.startedAt) * 10) / 10;
    if (String(token.name || '').startsWith('view:')) {
      const slowLimit = String(token.name).includes('dashboard') ? 120 : 180;
      if (duration > slowLimit) {
        storeDiagnostic('slow-view', { view: token.name.replace('view:', ''), duration });
      }
    }
    pushPerfSample({
      name: token.name,
      duration,
      at: new Date().toISOString(),
      build: BUILD,
      meta: { ...(token.meta || {}), ...(extra || {}) }
    });
  }

  function getSummary() {
    const samples = [...perfBuffer, ...readJson(PERF_LOG_KEY, [])];
    const groups = {};
    samples.forEach(sample => {
      if (!sample?.name) return;
      if (!groups[sample.name]) groups[sample.name] = { count: 0, total: 0, max: 0 };
      groups[sample.name].count += 1;
      groups[sample.name].total += Number(sample.duration || 0);
      groups[sample.name].max = Math.max(groups[sample.name].max, Number(sample.duration || 0));
    });
    return Object.entries(groups)
      .map(([name, value]) => ({
        name,
        count: value.count,
        avg: Math.round((value.total / Math.max(1, value.count)) * 10) / 10,
        max: Math.round(value.max * 10) / 10
      }))
      .sort((a, b) => b.max - a.max);
  }

  function maybeAutoFallback(reason, extra = {}) {
    if (autoFallbackTriggered || window.GORDI_SAFE_MODE) return;
    autoFallbackTriggered = true;
    flushPerfSamples();
    storeDiagnostic(reason, extra);
    if (typeof window.setGordiSafeMode === 'function') {
      window.setGordiSafeMode(true, reason, { reload: true });
    }
  }

  function heartbeat() {
    if (document.hidden) {
      lastBeat = performance.now();
      return;
    }
    const now = performance.now();
    const drift = now - lastBeat - HEARTBEAT_MS;
    lastBeat = now;
    if (drift > FREEZE_THRESHOLD_MS) {
      maybeAutoFallback('freeze-detected', { driftMs: Math.round(drift) });
    }
  }

  function openDiagnostics() {
    const diag = readJson(PERF_DIAG_KEY, null);
    const summary = getSummary().slice(0, 12);
    const message = [
      `Build: ${BUILD}`,
      `Safe mode: ${window.GORDI_SAFE_MODE ? 'si' : 'no'}`,
      diag ? `Ultimo motivo: ${diag.reason} (${diag.at})` : 'Sin diagnostico reciente',
      '',
      ...summary.map(item => `${item.name}: avg ${item.avg}ms · max ${item.max}ms · n=${item.count}`)
    ].join('\n');
    alert(message);
  }

  function installSafeModeStubs() {
    if (!window.GORDI_SAFE_MODE) return;
    const disabled = function (label) {
      const message = `${label || 'Esta funcion'} no esta disponible en modo seguro.`;
      if (typeof window.showToast === 'function') window.showToast(message);
      else alert(message);
    };
    const names = {
      toggleChat: 'El asistente',
      openTourCenter: 'El centro de novedades',
      openAppManual: 'El manual',
      connectDiskBackupFolder: 'El backup en disco',
      disconnectDiskBackupFolder: 'El backup en disco',
      runDiskBackupNow: 'El backup en disco',
      workflowContinueMission: 'Workflow',
      workflowOpenCoverageMap: 'Workflow',
      workflowImportRecommended: 'Workflow',
      startUpdateTour: 'El tour',
      startCoverageTour: 'El tour',
      openVoiceModal: 'La nota de voz',
      openScanModal: 'El escaneo',
      openFocusMode: 'El modo enfoque',
      runAutoMaintenance: 'El mantenimiento automatico',
      generateWeeklyPlan: 'La planificacion asistida'
    };
    Object.entries(names).forEach(([fnName, label]) => {
      if (typeof window[fnName] === 'function') return;
      window[fnName] = function () { disabled(label); };
    });
  }

  window.gordiPerfMeasure = measure;
  window.gordiPerfBegin = begin;
  window.gordiPerfEnd = end;
  window.getGordiPerfSummary = getSummary;
  window.getGordiPerfDiagnostic = () => readJson(PERF_DIAG_KEY, null);
  window.showPerformanceDiagnostics = openDiagnostics;
  window.noteGordiPerfIssue = storeDiagnostic;
  window.triggerGordiSafeFallback = maybeAutoFallback;

  installSafeModeStubs();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flushPerfSamples();
  });
  window.addEventListener('beforeunload', flushPerfSamples);
  setInterval(heartbeat, HEARTBEAT_MS);
})();
