// Automatic daily disk backups.
// Uses the browser File System Access API when available and authorized.
(function () {
  'use strict';

  const DB_NAME = 'gordi_disk_backup_db';
  const DB_VERSION = 1;
  const STORE = 'handles';
  const HANDLE_KEY = 'backupDirectory';
  const ENABLED_KEY = 'gordi_disk_backup_enabled';
  const LAST_DATE_KEY = 'gordi_disk_backup_last_date';
  const LAST_STATUS_KEY = 'gordi_disk_backup_last_status';
  const LAST_FILE_KEY = 'gordi_disk_backup_last_file';
  const LAST_ERROR_KEY = 'gordi_disk_backup_last_error';

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function isSupported() {
    return typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('No se pudo abrir IndexedDB'));
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error || new Error('No se pudo leer el permiso'));
      tx.oncomplete = () => db.close();
    });
  }

  async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error || new Error('No se pudo guardar el permiso'));
    });
  }

  async function idbDelete(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error || new Error('No se pudo eliminar el permiso'));
    });
  }

  async function hasWritePermission(handle, requestIfNeeded) {
    if (!handle) return false;
    const opts = { mode: 'readwrite' };
    if (typeof handle.queryPermission === 'function') {
      const current = await handle.queryPermission(opts);
      if (current === 'granted') return true;
    }
    if (requestIfNeeded && typeof handle.requestPermission === 'function') {
      const next = await handle.requestPermission(opts);
      return next === 'granted';
    }
    return false;
  }

  function parseArray(key) {
    try {
      const raw = localStorage.getItem(key) || '[]';
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function buildBackupPayload() {
    const snapshot = typeof exportDataSnapshot === 'function' ? exportDataSnapshot() : {};
    const summary = typeof getSnapshotSummary === 'function'
      ? getSnapshotSummary(snapshot)
      : { keys: Object.keys(snapshot || {}).length };
    return {
      version: '2.0',
      backupType: 'auto_disk_daily',
      date: new Date().toISOString(),
      appVersion: typeof VOLTFLOW_VERSION !== 'undefined' ? VOLTFLOW_VERSION : '',
      build: window.GORDI_APP_BUILD || '',
      origin: location.href,
      portableSnapshot: snapshot,
      integrity: summary
    };
  }

  function setStatus(status, detail) {
    const payload = {
      status,
      detail: detail || '',
      at: new Date().toISOString()
    };
    localStorage.setItem(LAST_STATUS_KEY, JSON.stringify(payload));
    if (status !== 'error') localStorage.removeItem(LAST_ERROR_KEY);
    if (status === 'error') localStorage.setItem(LAST_ERROR_KEY, detail || 'Error desconocido');
    renderDiskBackupStatus();
  }

  async function writeBackupFile(dirHandle, fileName, payload) {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    await writable.close();
  }

  async function backupFileExists(dirHandle, fileName) {
    try {
      await dirHandle.getFileHandle(fileName, { create: false });
      return true;
    } catch {
      return false;
    }
  }

  async function runDiskBackupNow(showFeedback = true, options = {}) {
    if (!isSupported()) {
      setStatus('unsupported', 'Tu navegador no permite guardar backups directos en una carpeta.');
      if (showFeedback && typeof showToast === 'function') showToast('Este navegador no permite backup automatico a carpeta');
      return false;
    }

    const dirHandle = await idbGet(HANDLE_KEY);
    if (!dirHandle) {
      setStatus('not_configured', 'Elige una carpeta de backups una vez para activar la copia diaria.');
      if (showFeedback && typeof showToast === 'function') showToast('Elige primero una carpeta de backups');
      return false;
    }

    try {
      const canWrite = await hasWritePermission(dirHandle, !!options.requestPermission);
      if (!canWrite) {
        setStatus('permission_needed', 'Chrome necesita que vuelvas a autorizar la carpeta de backups.');
        if (showFeedback && typeof showToast === 'function') showToast('Autoriza de nuevo la carpeta de backups');
        return false;
      }

      const date = todayKey();
      const fileName = `gordi_backup_auto_${date}.json`;
      if (!options.force && await backupFileExists(dirHandle, fileName)) {
        localStorage.setItem(LAST_DATE_KEY, date);
        localStorage.setItem(LAST_FILE_KEY, fileName);
        setStatus('already_exists', `Ya existe el backup de hoy: ${fileName}`);
        return true;
      }

      const payload = buildBackupPayload();
      await writeBackupFile(dirHandle, fileName, payload);
      localStorage.setItem(ENABLED_KEY, 'true');
      localStorage.setItem(LAST_DATE_KEY, date);
      localStorage.setItem(LAST_FILE_KEY, fileName);
      setStatus('ok', `Backup diario creado: ${fileName}`);
      if (showFeedback && typeof showToast === 'function') {
        const leadsCount = payload.integrity && payload.integrity.leads != null ? payload.integrity.leads : payload.leads.length;
        showToast(`Backup en disco creado: ${leadsCount} leads y ${payload.integrity.keys || 0} claves`);
      }
      return true;
    } catch (err) {
      setStatus('error', err && err.message ? err.message : String(err));
      if (showFeedback && typeof showToast === 'function') showToast('No se pudo crear el backup en disco');
      return false;
    }
  }

  async function maybeCreateDailyDiskBackup() {
    if (localStorage.getItem(ENABLED_KEY) !== 'true') {
      renderDiskBackupStatus();
      return false;
    }
    if (localStorage.getItem(LAST_DATE_KEY) === todayKey()) {
      renderDiskBackupStatus();
      return true;
    }
    return runDiskBackupNow(false, { requestPermission: false });
  }

  async function connectDiskBackupFolder() {
    if (!isSupported()) {
      setStatus('unsupported', 'Usa Chrome o Edge actualizado para guardar automaticamente en disco.');
      alert('Tu navegador no permite elegir una carpeta para backups automaticos. Usa Chrome o Edge actualizado.');
      return;
    }
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const canWrite = await hasWritePermission(dirHandle, true);
      if (!canWrite) {
        setStatus('permission_needed', 'No se concedio permiso de escritura.');
        return;
      }
      await idbSet(HANDLE_KEY, dirHandle);
      localStorage.setItem(ENABLED_KEY, 'true');
      await runDiskBackupNow(true, { requestPermission: true, force: false });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      setStatus('error', err && err.message ? err.message : String(err));
    }
  }

  async function disconnectDiskBackupFolder() {
    await idbDelete(HANDLE_KEY);
    localStorage.setItem(ENABLED_KEY, 'false');
    setStatus('not_configured', 'Backup automatico a disco desactivado.');
    if (typeof showToast === 'function') showToast('Backup automatico a disco desactivado');
  }

  function getStatusLabel(status) {
    const labels = {
      ok: 'Activo',
      already_exists: 'Hecho hoy',
      not_configured: 'Sin carpeta',
      permission_needed: 'Permiso necesario',
      unsupported: 'No compatible',
      error: 'Error'
    };
    return labels[status] || 'Pendiente';
  }

  function renderDiskBackupStatus() {
    const host = document.getElementById('disk-backup-status');
    if (!host) return;
    let lastStatus = null;
    try { lastStatus = JSON.parse(localStorage.getItem(LAST_STATUS_KEY) || 'null'); } catch {}
    const enabled = localStorage.getItem(ENABLED_KEY) === 'true';
    const lastDate = localStorage.getItem(LAST_DATE_KEY) || '-';
    const lastFile = localStorage.getItem(LAST_FILE_KEY) || '-';
    const supported = isSupported();
    const status = lastStatus?.status || (enabled ? 'permission_needed' : (supported ? 'not_configured' : 'unsupported'));
    const color = status === 'ok' || status === 'already_exists' ? 'var(--success)'
      : status === 'error' ? 'var(--danger)'
      : status === 'unsupported' ? 'var(--warning)'
      : 'var(--text-muted)';
    host.innerHTML = `
      <div style="display:grid;gap:.45rem">
        <div style="display:flex;align-items:center;gap:.55rem;flex-wrap:wrap">
          <strong style="color:${color}">${getStatusLabel(status)}</strong>
          <span style="color:var(--text-muted);font-size:.78rem">${lastStatus?.detail || 'El backup se crea una vez al dia mientras la app esta abierta.'}</span>
        </div>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;color:var(--text-dim);font-size:.74rem">
          <span>Ultimo dia: <strong style="color:var(--text-muted)">${lastDate}</strong></span>
          <span>Archivo: <strong style="color:var(--text-muted)">${lastFile}</strong></span>
          <span>Incluye: leads, API keys, cobertura, scraping, campanas, historial y configuracion</span>
        </div>
      </div>`;
  }

  window.connectDiskBackupFolder = connectDiskBackupFolder;
  window.disconnectDiskBackupFolder = disconnectDiskBackupFolder;
  window.runDiskBackupNow = runDiskBackupNow;
  window.maybeCreateDailyDiskBackup = maybeCreateDailyDiskBackup;
  window.renderDiskBackupStatus = renderDiskBackupStatus;

  function scheduleDailyDiskBackup() {
    const run = () => maybeCreateDailyDiskBackup();
    if ('requestIdleCallback' in window) {
      setTimeout(() => requestIdleCallback(run, { timeout: 60000 }), 30000);
    } else {
      setTimeout(run, 45000);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleDailyDiskBackup);
  } else {
    scheduleDailyDiskBackup();
  }
})();
