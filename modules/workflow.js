// ============ WORKFLOW OPERATIVO ============
// Capa de integracion no destructiva entre scraping, leads, cobertura, mapa y backups.
(function () {
  'use strict';

  const BUILD = '2026.06.04.0320';
  const RESTORE_KEY = 'gordi_workflow_restore_points';
  const AUDIT_KEY = 'gordi_workflow_audit_log';
  const MAX_RESTORE_POINTS = 8;
  const MAX_AUDIT = 120;
  let repeatBypassOnce = false;
  let workflowRenderTimer = null;
  let workflowBooted = false;

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function idle(fn, timeout = 2000) {
    if ('requestIdleCallback' in window) {
      requestIdleCallback(fn, { timeout });
    } else {
      setTimeout(fn, 80);
    }
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function norm(value) {
    return String(value || '').trim().toLowerCase();
  }

  function getLeadsSafe() {
    try {
      if (Array.isArray(leads)) return leads;
    } catch {}
    return readJson('gordi_leads', []);
  }

  function getSearchResultsSafe() {
    try {
      if (Array.isArray(tempSearchResults)) return tempSearchResults;
    } catch {}
    return [];
  }

  function getCoverageEntriesSafe() {
    if (typeof getCoverageEntries === 'function') return getCoverageEntries();
    return readJson('gordi_search_coverage', []);
  }

  function getCoverageTargetsSafe() {
    if (typeof getCoverageTargets === 'function') return getCoverageTargets();
    return readJson('gordi_coverage_targets', { locations: [], sectors: [] });
  }

  function getMissionSafe() {
    if (typeof getCoverageActiveMission === 'function') return getCoverageActiveMission();
    return readJson('gordi_coverage_active_mission', null);
  }

  function getSavedSearchesSafe() {
    if (typeof getSavedSearches === 'function') return getSavedSearches();
    return readJson('gordi_saved_searches', []);
  }

  function toast(message) {
    if (typeof showToast === 'function') showToast(message);
  }

  function logAudit(type, detail) {
    const log = readJson(AUDIT_KEY, []);
    log.unshift({
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type,
      detail: detail || '',
      at: new Date().toISOString(),
      build: BUILD
    });
    writeJson(AUDIT_KEY, log.slice(0, MAX_AUDIT));
  }

  function countApiKeys() {
    return [
      'gordi_api_key', 'gordi_hunter_key', 'gordi_apollo_key',
      'gordi_gemini_key', 'gordi_claude_key', 'gordi_groq_key',
      'gordi_openrouter_key'
    ].filter(key => !!localStorage.getItem(key)).length;
  }

  function dataSummary() {
    const coverage = getCoverageEntriesSafe();
    const results = getSearchResultsSafe();
    return {
      leads: getLeadsSafe().length,
      results: results.length,
      coverage: coverage.length,
      searches: readJson('gordi_search_history', []).length + getSavedSearchesSafe().length,
      campaigns: readJson('gordi_campaigns', []).length,
      apiKeys: countApiKeys()
    };
  }

  function createRestorePoint(reason) {
    try {
      let snapshot = null;
      if (typeof exportDataSnapshot === 'function') snapshot = exportDataSnapshot();
      if (!snapshot) {
        snapshot = {};
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith('gordi_')) snapshot[key] = localStorage.getItem(key);
        }
      }
      delete snapshot[RESTORE_KEY];
      delete snapshot[AUDIT_KEY];
      if (typeof createSafetySnapshot === 'function') {
        try { createSafetySnapshot(`workflow_${reason || 'auto'}`, { throttleMs: 0, maxBytes: 1200000 }); } catch {}
      }
      const summary = typeof getSnapshotSummary === 'function' ? getSnapshotSummary(snapshot) : dataSummary();
      const storeSnapshot = !summary.bytes || summary.bytes <= 1200000;
      const points = readJson(RESTORE_KEY, []);
      const point = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        reason: reason || 'auto',
        at: new Date().toISOString(),
        summary,
        snapshot: storeSnapshot ? snapshot : null,
        skippedSnapshot: storeSnapshot ? false : 'too_large_for_local_storage'
      };
      points.unshift(point);
      writeJson(RESTORE_KEY, points.slice(0, MAX_RESTORE_POINTS));
      logAudit('restore_point', point.reason);
      if (String(reason || '').startsWith('manual')) toast('Backup inteligente creado');
      scheduleWorkflowPanels(80);
      return point;
    } catch (err) {
      console.warn('Workflow restore point failed', err);
      return null;
    }
  }

  function restorePoint(id) {
    const point = readJson(RESTORE_KEY, []).find(item => item.id === id);
    if (!point || !point.snapshot) return toast('No se encontro el punto de restauracion');
    if (!confirm('Restaurar este punto? Se creara un backup antes de restaurar.')) return;
    createRestorePoint('before_workflow_restore');
    if (typeof importDataSnapshot === 'function') {
      importDataSnapshot(point.snapshot, true, { reason: 'workflow_restore' });
    } else {
      Object.entries(point.snapshot).forEach(([key, value]) => {
        if (key.startsWith('gordi_')) localStorage.setItem(key, value);
      });
      if (typeof loadAllData === 'function') loadAllData();
    }
    logAudit('restore_applied', point.reason);
    toast('Datos restaurados. Recargando interfaz...');
    setTimeout(() => location.reload(), 600);
  }

  function getSearchContext() {
    const segmentEl = document.getElementById('plan-segment');
    const locationEl = document.getElementById('plan-location');
    return {
      segment: segmentEl ? segmentEl.value : '',
      location: locationEl ? locationEl.value : ''
    };
  }

  function resultScore(company) {
    if (typeof getLeadUsefulnessScore === 'function') return getLeadUsefulnessScore(company);
    let score = 0;
    if (company.email) score += 40;
    if (company.phone) score += 20;
    if (company.website) score += 15;
    if (company.address) score += 10;
    if (company.decision_maker) score += 15;
    return score;
  }

  function isDuplicateCompany(company) {
    const companyName = norm(company.company || company.name);
    const email = norm(company.email);
    const web = norm(company.website).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    return getLeadsSafe().some(lead => {
      const leadCompany = norm(lead.company || lead.name);
      const leadEmail = norm(lead.email);
      const leadWeb = norm(lead.website).replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      if (email && leadEmail && email === leadEmail) return true;
      if (web && leadWeb && web === leadWeb) return true;
      return companyName && leadCompany && companyName === leadCompany;
    });
  }

  function recommendedResults() {
    return getSearchResultsSafe()
      .map((company, idx) => ({ company, idx, score: resultScore(company), duplicate: isDuplicateCompany(company) }))
      .filter(item => !item.duplicate && (item.company.email || item.company.phone || item.company.website) && item.score >= 35);
  }

  function searchStats() {
    const results = getSearchResultsSafe();
    const duplicates = results.filter(isDuplicateCompany).length;
    return {
      total: results.length,
      email: results.filter(item => !!item.email).length,
      phone: results.filter(item => !!item.phone).length,
      website: results.filter(item => !!item.website).length,
      duplicates,
      recommended: recommendedResults().length
    };
  }

  function pendingCoverageCells() {
    const targets = getCoverageTargetsSafe();
    const locations = Array.isArray(targets.locations) ? targets.locations : [];
    const sectors = Array.isArray(targets.sectors) ? targets.sectors : [];
    const entries = getCoverageEntriesSafe();
    const done = new Set(entries.filter(e => e && e.status !== 'error').map(e => `${norm(e.location)}|${norm(e.sector)}`));
    const cells = [];
    locations.forEach(location => {
      sectors.forEach(sector => {
        if (!done.has(`${norm(location)}|${norm(sector)}`)) cells.push({ location, sector });
      });
    });
    return cells;
  }

  function activeCells() {
    const entries = getCoverageEntriesSafe();
    return entries.slice().sort((a, b) => new Date(b.lastSearchedAt || b.updatedAt || 0) - new Date(a.lastSearchedAt || a.updatedAt || 0));
  }

  function cellFunnel(location, sector) {
    if (typeof getCoverageCellFunnel === 'function') return getCoverageCellFunnel(location, sector);
    const leadsForCell = getLeadsSafe().filter(lead => norm(lead.coverageLocation || lead.searchLocation || lead.location).includes(norm(location)) && norm(lead.segment || lead.sector).includes(norm(sector)));
    return {
      imported: leadsForCell.length,
      contacted: leadsForCell.filter(lead => (lead.emailHistory || lead.activity || []).length || lead.last_contact).length,
      won: leadsForCell.filter(lead => norm(lead.status).includes('cerrado')).length
    };
  }

  function repeatRisk(segment, location) {
    const s = norm(segment);
    const l = norm(location);
    if (!s || !l) return null;
    const entries = getCoverageEntriesSafe().filter(entry => norm(entry.sector) === s && norm(entry.location) === l);
    const saved = getSavedSearchesSafe().filter(item => norm(item.segment || item.sector) === s && norm(item.location) === l);
    const last = [...entries, ...saved]
      .map(item => item.lastSearchedAt || item.date || item.createdAt || item.updatedAt)
      .filter(Boolean)
      .sort()
      .pop();
    if (!entries.length && !saved.length) return null;
    return {
      segment,
      location,
      count: entries.length + saved.length,
      last: last ? new Date(last).toLocaleString('es-ES') : 'sin fecha'
    };
  }

  function showRepeatModal(risk) {
    let modal = document.getElementById('workflow-repeat-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'workflow-repeat-modal';
      modal.className = 'modal-overlay';
      document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-content ops-modal">
        <div class="panel-header">
          <h3>No repetir trabajo</h3>
          <button class="btn-icon" onclick="document.getElementById('workflow-repeat-modal').style.display='none'">x</button>
        </div>
        <div class="ops-warning-box">
          Ya existe busqueda para <strong>${esc(risk.location)}</strong> en <strong>${esc(risk.segment)}</strong>.
          Ultima vez: <strong>${esc(risk.last)}</strong>.
        </div>
        <div class="ops-actions">
          <button class="btn-primary" onclick="workflowOpenCoverage('${encodeURIComponent(risk.location)}')">Ver cobertura</button>
          <button class="btn-outline" onclick="workflowOpenCoverageMap()">Ver mapa</button>
          <button class="btn-action" onclick="workflowBypassRepeatAndSearch()">Buscar igualmente</button>
        </div>
      </div>`;
  }

  function continueMission() {
    const mission = getMissionSafe();
    if (mission && mission.location && mission.sector) {
      runCoverageSearch(encodeURIComponent(mission.location), encodeURIComponent(mission.sector), true);
      return;
    }
    const next = pendingCoverageCells()[0];
    if (next) {
      runCoverageSearch(encodeURIComponent(next.location), encodeURIComponent(next.sector), false);
      return;
    }
    showView('coverage');
  }

  function openCoverage(encodedLocation) {
    const location = decodeURIComponent(encodedLocation || '');
    showView('coverage');
    if (location && typeof openCoverageForLocation === 'function') setTimeout(() => openCoverageForLocation(location), 80);
  }

  function openCoverageMap() {
    showView('map');
    if (typeof setMapMode === 'function') setTimeout(() => setMapMode('coverage'), 60);
  }

  function selectRecommendedResults() {
    const picks = recommendedResults();
    document.querySelectorAll('.result-select').forEach(input => { input.checked = false; });
    picks.forEach(item => {
      const input = document.querySelector(`.result-select[data-index="${item.idx}"]`);
      if (input) input.checked = true;
    });
    toast(`${picks.length} resultados recomendados seleccionados`);
    renderWorkflowPostScrapingPanel();
    return picks.length;
  }

  async function importRecommendedResults() {
    createRestorePoint('before_import_recommended');
    const count = selectRecommendedResults();
    if (!count) return toast('No hay resultados recomendados para importar');
    if (typeof importSelectedSearch === 'function') {
      await importSelectedSearch();
      logAudit('import_recommended', `${count} resultados`);
      scheduleWorkflowPanels(80);
    }
  }

  function createCampaignFromRecommended() {
    createRestorePoint('before_campaign_from_search');
    selectRecommendedResults();
    if (typeof createProspectingCampaignFromSearch === 'function') createProspectingCampaignFromSearch();
    scheduleWorkflowPanels(80);
  }

  function clearTechnicalCache() {
    let removed = 0;
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (
        key === 'gordi_enrich_cache'
        || key === 'gordi_map_geocode_cache'
        || key.startsWith('gordi_ecache_')
        || key.startsWith('gordi_geo_cache_')
        || key.startsWith('gordi_scrape_memory_')
        || key.startsWith('gordi_scrape_tmp_')
      )) keys.push(key);
    }
    keys.forEach(key => { localStorage.removeItem(key); removed++; });
    if (window.caches && caches.keys) {
      caches.keys().then(names => names.forEach(name => {
        if (/gordi|voltium|voltflow|progama/i.test(name)) caches.delete(name);
      })).catch(() => {});
    }
    logAudit('technical_cache_clear', `${removed} local keys`);
    toast(`Cache tecnica limpiada: ${removed} claves locales`);
    scheduleWorkflowPanels(80);
  }

  function renderKpi(label, value, tone) {
    return `<div class="ops-kpi ${tone || ''}"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
  }

  function renderWorkflowCommandCenter() {
    const host = document.getElementById('workflow-command-center');
    if (!host) return;
    const summary = dataSummary();
    const pending = pendingCoverageCells();
    const mission = getMissionSafe();
    const stats = searchStats();
    const recentCells = activeCells().slice(0, 4);
    const highLeads = getLeadsSafe().filter(lead => !lead.archived && Number(lead.score || 0) >= 70).length;
    const nextTask = mission
      ? `Continuar ${mission.location || ''} / ${mission.sector || ''}`
      : pending[0]
        ? `Buscar ${pending[0].location} / ${pending[0].sector}`
        : stats.recommended
          ? `Importar ${stats.recommended} leads utiles`
          : 'Revisar cobertura y pipeline';

    host.innerHTML = `
      <div class="ops-header">
        <div>
          <span class="ops-eyebrow">Centro de mando diario</span>
          <h3>${esc(nextTask)}</h3>
          <p>Decide la siguiente accion entre cobertura, scraping y leads con datos reales guardados.</p>
        </div>
        <div class="ops-actions">
          <button class="btn-primary" onclick="workflowContinueMission()">Ejecutar siguiente</button>
          <button class="btn-outline" onclick="workflowOpenCoverageMap()">Mapa cobertura</button>
          <button class="btn-outline" onclick="showView('coverage')">Cobertura</button>
        </div>
      </div>
      <div class="ops-kpi-row">
        ${renderKpi('Leads', summary.leads)}
        ${renderKpi('Cobertura', summary.coverage)}
        ${renderKpi('Pendientes CP/sector', pending.length, pending.length ? 'warn' : 'ok')}
        ${renderKpi('Resultados listos', stats.recommended, stats.recommended ? 'ok' : '')}
        ${renderKpi('Alta prioridad', highLeads, highLeads ? 'hot' : '')}
      </div>
      <div class="ops-command-grid">
        <div class="ops-card">
          <strong>Mision activa</strong>
          <span>${mission ? `${esc(mission.location || '')} / ${esc(mission.sector || '')}` : 'Sin mision abierta'}</span>
          <div class="ops-actions compact">
            <button class="btn-outline btn-sm" onclick="workflowContinueMission()">Continuar</button>
            <button class="btn-outline btn-sm" onclick="showView('leads')">Ver leads</button>
          </div>
        </div>
        <div class="ops-card">
          <strong>Cierre post-scraping</strong>
          <span>${stats.total} resultados, ${stats.email} emails, ${stats.duplicates} duplicados detectados.</span>
          <div class="ops-actions compact">
            <button class="btn-outline btn-sm" onclick="workflowImportRecommended()">Importar utiles</button>
            <button class="btn-outline btn-sm" onclick="showView('planner')">Revisar</button>
          </div>
        </div>
        <div class="ops-card wide">
          <strong>Embudo por CP/sector</strong>
          <div class="ops-funnel-list">
            ${recentCells.length ? recentCells.map(cell => {
              const funnel = cellFunnel(cell.location, cell.sector);
              return `<button onclick="workflowOpenCoverage('${encodeURIComponent(cell.location || '')}')" title="Abrir cobertura">
                <span>${esc(cell.location || 'Zona')} / ${esc(cell.sector || 'Sector')}</span>
                <small>${Number(cell.results || 0)} encontrados -> ${Number(funnel.imported || 0)} leads -> ${Number(funnel.contacted || 0)} contacto</small>
              </button>`;
            }).join('') : '<span class="ops-empty">Todavia no hay celdas de cobertura registradas.</span>'}
          </div>
        </div>
      </div>`;
  }

  function renderMissionBar() {
    const host = document.getElementById('workflow-mission-bar');
    if (!host) return;
    const mission = getMissionSafe();
    const pending = pendingCoverageCells().length;
    if (!mission && !pending) {
      host.style.display = 'none';
      return;
    }
    host.style.display = 'flex';
    host.innerHTML = `
      <div>
        <span>Mision activa</span>
        <strong>${mission ? `${esc(mission.location || '')} / ${esc(mission.sector || '')}` : `${pending} busquedas pendientes`}</strong>
      </div>
      <div class="ops-actions compact">
        <button class="btn-primary btn-sm" onclick="workflowContinueMission()">Continuar</button>
        <button class="btn-outline btn-sm" onclick="showView('coverage')">Cobertura</button>
        <button class="btn-outline btn-sm" onclick="workflowOpenCoverageMap()">Mapa</button>
      </div>`;
  }

  function renderWorkflowPostScrapingPanel() {
    const panel = document.getElementById('workflow-post-scraping-panel');
    if (!panel) return;
    const stats = searchStats();
    if (!stats.total) {
      panel.style.display = 'none';
      return;
    }
    panel.style.display = 'block';
    panel.innerHTML = `
      <div class="ops-header slim">
        <div>
          <span class="ops-eyebrow">Cierre post-scraping</span>
          <h3>${stats.recommended} resultados listos para leads</h3>
          <p>${stats.total} resultados, ${stats.email} con email, ${stats.phone} con telefono, ${stats.duplicates} duplicados.</p>
        </div>
        <div class="ops-actions">
          <button class="btn-primary" onclick="workflowImportRecommended()">Importar recomendadas</button>
          <button class="btn-outline" onclick="workflowSelectRecommendedResults()">Seleccionar utiles</button>
          <button class="btn-outline" onclick="workflowCreateCampaignFromRecommended()">Crear campana</button>
        </div>
      </div>`;
  }

  function renderCoverageFunnelBoard() {
    const host = document.getElementById('workflow-coverage-funnel-board');
    if (!host) return;
    const cells = activeCells().slice(0, 8);
    host.innerHTML = `
      <details class="ops-collapsed-panel">
        <summary>
          <div>
            <span class="ops-eyebrow">Embudo operativo</span>
            <strong>Ver recorrido CP/sector hasta pipeline</strong>
          </div>
          <button class="btn-outline btn-sm" onclick="event.preventDefault(); workflowOpenCoverageMap()">Abrir mapa</button>
        </summary>
        <p>Compara lo buscado, lo importado a leads y lo ya contactado sin cargar la vista principal.</p>
        <div class="ops-funnel-grid">
          ${cells.length ? cells.map(cell => {
            const funnel = cellFunnel(cell.location, cell.sector);
            return `<div class="ops-funnel-card">
              <strong>${esc(cell.location || 'Zona')}</strong>
              <span>${esc(cell.sector || 'Sector')}</span>
              <div class="ops-bars">
                <i style="--w:${Math.min(100, Number(cell.results || 0) * 4)}%"></i>
                <i class="ok" style="--w:${Math.min(100, Number(funnel.imported || 0) * 8)}%"></i>
                <i class="hot" style="--w:${Math.min(100, Number(funnel.contacted || 0) * 12)}%"></i>
              </div>
              <small>${Number(cell.results || 0)} encontrados / ${Number(funnel.imported || 0)} leads / ${Number(funnel.contacted || 0)} contacto</small>
            </div>`;
          }).join('') : '<div class="ops-empty">Sin cobertura registrada todavia.</div>'}
        </div>
      </details>`;
  }

  function renderLeadOriginSummary() {
    const host = document.getElementById('workflow-lead-origin-summary');
    if (!host) return;
    const all = getLeadsSafe().filter(lead => !lead.archived);
    const withOrigin = all.filter(lead => lead.coverageLocation || lead.coverageSector || lead.searchLocation || lead.searchSector);
    const mission = getMissionSafe();
    host.innerHTML = `
      <div class="ops-header slim">
        <div>
          <span class="ops-eyebrow">Origen real del lead</span>
          <h3>${withOrigin.length}/${all.length} leads con CP/sector trazable</h3>
          <p>Usa cobertura para saber de donde viene cada contacto y que falta por trabajar.</p>
        </div>
        <div class="ops-actions">
          <button class="btn-outline" onclick="showView('coverage')">Ver cobertura</button>
          ${mission ? '<button class="btn-outline" onclick="showCoverageMissionLeads && showCoverageMissionLeads()">Leads de mision</button>' : ''}
        </div>
      </div>`;
  }

  function renderMapBrief() {
    const host = document.getElementById('workflow-map-brief');
    if (!host) return;
    const entries = getCoverageEntriesSafe();
    const complete = entries.filter(e => e.status === 'complete').length;
    const partial = entries.filter(e => e.status === 'partial').length;
    const error = entries.filter(e => e.status === 'error').length;
    host.innerHTML = `
      <div class="ops-kpi-row map">
        ${renderKpi('CP/sector en mapa', entries.length)}
        ${renderKpi('Completos', complete, 'ok')}
        ${renderKpi('Parciales', partial, 'warn')}
        ${renderKpi('Errores', error, error ? 'hot' : '')}
      </div>`;
  }

  function renderHealthCenter() {
    const host = document.getElementById('workflow-system-health');
    if (!host) return;
    const summary = dataSummary();
    const points = readJson(RESTORE_KEY, []);
    const audit = readJson(AUDIT_KEY, []);
    const lastPoint = points[0];
    const origin = location.origin && location.origin !== 'null' ? location.origin : 'file:// local';
    host.innerHTML = `
      <div class="ops-header">
        <div>
          <span class="ops-eyebrow">Centro de salud del sistema</span>
          <h3>Build ${BUILD} en ${esc(origin)}</h3>
          <p>Controla datos locales, API keys, backups y errores sin borrar trabajo.</p>
        </div>
        <div class="ops-actions">
          <button class="btn-primary" onclick="workflowCreateRestorePoint('manual_health')">Backup ahora</button>
          <button class="btn-outline" onclick="workflowClearTechnicalCache()">Limpiar cache tecnica</button>
        </div>
      </div>
      <div class="ops-kpi-row">
        ${renderKpi('Leads', summary.leads)}
        ${renderKpi('Busquedas', summary.searches)}
        ${renderKpi('Cobertura', summary.coverage)}
        ${renderKpi('API keys', summary.apiKeys, summary.apiKeys ? 'ok' : 'warn')}
        ${renderKpi('Backups', points.length, points.length ? 'ok' : 'warn')}
      </div>
      <div class="ops-command-grid">
        <div class="ops-card">
          <strong>Ultimo backup inteligente</strong>
          <span>${lastPoint ? `${new Date(lastPoint.at).toLocaleString('es-ES')} ? ${esc(lastPoint.reason)}` : 'Aun no hay backups workflow'}</span>
        </div>
        <div class="ops-card">
          <strong>Auditoria reciente</strong>
          <span>${audit[0] ? `${esc(audit[0].type)} ? ${new Date(audit[0].at).toLocaleString('es-ES')}` : 'Sin eventos registrados'}</span>
        </div>
      </div>`;
  }

  function renderRestorePanel() {
    const host = document.getElementById('workflow-restore-panel');
    if (!host) return;
    const points = readJson(RESTORE_KEY, []);
    host.innerHTML = `
      <div class="ops-header slim">
        <div>
          <span class="ops-eyebrow">Restaurar como ayer</span>
          <h3>Puntos de seguridad antes de cambios</h3>
          <p>Se crean antes de importar leads, lanzar busquedas clave o generar campanas.</p>
        </div>
        <button class="btn-outline" onclick="workflowCreateRestorePoint('manual_restore_panel')">Crear punto</button>
      </div>
      <div class="ops-restore-list">
        ${points.length ? points.map(point => `<div class="ops-restore-row">
          <div>
            <strong>${esc(point.reason)}</strong>
            <span>${new Date(point.at).toLocaleString('es-ES')} ? ${Number(point.summary?.leads || 0)} leads ? ${Number(point.summary?.keys || 0)} claves</span>
          </div>
          <button class="btn-outline btn-sm" onclick="workflowRestorePoint('${esc(point.id)}')">Restaurar</button>
        </div>`).join('') : '<div class="ops-empty">Sin puntos workflow todavia. Crea uno antes de cambios importantes.</div>'}
      </div>`;
  }

  function ensurePanel(id, selector, position, className) {
    if (document.getElementById(id)) return document.getElementById(id);
    const target = document.querySelector(selector);
    if (!target || !target.parentNode) return null;
    const el = document.createElement('div');
    el.id = id;
    el.className = className || 'glass-panel ops-shell';
    if (position === 'before') target.parentNode.insertBefore(el, target);
    else if (position === 'after') target.parentNode.insertBefore(el, target.nextSibling);
    else target.appendChild(el);
    return el;
  }

  function ensureWorkflowPanels() {
    ensurePanel('workflow-command-center', '#dashboard-view .stats-grid', 'before', 'glass-panel ops-shell');
    ensurePanel('workflow-post-scraping-panel', '#search-results-panel', 'before', 'glass-panel ops-shell');
    ensurePanel('workflow-coverage-funnel-board', '#coverage-root', 'before', 'glass-panel ops-shell');
    ensurePanel('workflow-map-brief', '#leads-map', 'before', 'glass-panel ops-shell ops-map-brief');
    ensurePanel('workflow-lead-origin-summary', '#leads-view .page-header', 'after', 'glass-panel ops-shell');
    ensurePanel('workflow-system-health', '#settings-view .glass-panel', 'before', 'glass-panel ops-shell');
    ensurePanel('workflow-restore-panel', '#settings-view .glass-panel', 'before', 'glass-panel ops-shell');
    if (!document.getElementById('workflow-mission-bar')) {
      const app = document.getElementById('app-content');
      if (app) {
        const bar = document.createElement('div');
        bar.id = 'workflow-mission-bar';
        bar.className = 'ops-mission-bar';
        app.insertBefore(bar, app.firstElementChild);
      }
    }
  }

  function renderWorkflowPanels() {
    if (document.hidden) return;
    ensureWorkflowPanels();
    renderWorkflowCommandCenter();
    renderMissionBar();
    renderWorkflowPostScrapingPanel();
    renderCoverageFunnelBoard();
    renderLeadOriginSummary();
    renderMapBrief();
    renderHealthCenter();
    renderRestorePanel();
  }

  function scheduleWorkflowPanels(delay = 120) {
    if (workflowRenderTimer) clearTimeout(workflowRenderTimer);
    workflowRenderTimer = setTimeout(() => {
      workflowRenderTimer = null;
      idle(renderWorkflowPanels, 1800);
    }, delay);
  }

  function wrapFunction(name, before, after) {
    const original = window[name];
    if (typeof original !== 'function' || original.__workflowWrapped) return;
    const wrapped = function (...args) {
      if (before) {
        const decision = before(name, args);
        if (decision === false) return false;
      }
      try {
        const result = original.apply(this, args);
        if (result && typeof result.then === 'function') {
          return result.then(value => {
            if (after) after(name, args, value);
            return value;
          }).catch(err => {
            logAudit('error', `${name}: ${err && err.message ? err.message : err}`);
            throw err;
          });
        }
        if (after) after(name, args, result);
        return result;
      } catch (err) {
        logAudit('error', `${name}: ${err && err.message ? err.message : err}`);
        throw err;
      }
    };
    wrapped.__workflowWrapped = true;
    window[name] = wrapped;
  }

  function installWrappers() {
    wrapFunction('searchBusinesses', () => {
      const ctx = getSearchContext();
      const risk = repeatRisk(ctx.segment, ctx.location);
      if (risk && !repeatBypassOnce) {
        showRepeatModal(risk);
        return false;
      }
      repeatBypassOnce = false;
      createRestorePoint('before_search');
      return true;
    }, () => {
      logAudit('search_completed', JSON.stringify(searchStats()));
      scheduleWorkflowPanels(120);
    });

    ['searchBusinessesSingle', 'searchBusinessesMultiSector'].forEach(name => {
      wrapFunction(name, null, () => {
        logAudit(`${name}_completed`, JSON.stringify(searchStats()));
        scheduleWorkflowPanels(120);
      });
    });

    wrapFunction('importSelectedSearch', () => {
      createRestorePoint('before_import_selected');
      return true;
    }, () => {
      logAudit('import_selected', 'Resultados volcados a leads');
      scheduleWorkflowPanels(120);
    });

    wrapFunction('quickImportOne', () => {
      createRestorePoint('before_quick_import');
      return true;
    }, () => scheduleWorkflowPanels(120));

    wrapFunction('createProspectingCampaignFromSearch', () => {
      createRestorePoint('before_campaign_from_search');
      return true;
    }, () => scheduleWorkflowPanels(120));

    wrapFunction('renderSearchCards', null, () => setTimeout(renderWorkflowPostScrapingPanel, 40));
    wrapFunction('showResultsPanel', null, () => setTimeout(renderWorkflowPostScrapingPanel, 40));
    wrapFunction('renderCoverage', null, () => scheduleWorkflowPanels(80));
    wrapFunction('renderLeads', null, () => setTimeout(renderLeadOriginSummary, 60));
    wrapFunction('setMapMode', null, () => setTimeout(renderMapBrief, 60));
  }

  window.addEventListener('error', event => {
    logAudit('browser_error', event.message || 'error');
    if (workflowBooted) scheduleWorkflowPanels(250);
  });
  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason && event.reason.message ? event.reason.message : String(event.reason || 'promise');
    logAudit('promise_error', reason);
    if (workflowBooted) scheduleWorkflowPanels(250);
  });

  window.workflowContinueMission = continueMission;
  window.workflowOpenCoverage = openCoverage;
  window.workflowOpenCoverageMap = openCoverageMap;
  window.workflowSelectRecommendedResults = selectRecommendedResults;
  window.workflowImportRecommended = importRecommendedResults;
  window.workflowCreateCampaignFromRecommended = createCampaignFromRecommended;
  window.workflowCreateRestorePoint = createRestorePoint;
  window.workflowRestorePoint = restorePoint;
  window.workflowClearTechnicalCache = clearTechnicalCache;
  window.workflowBypassRepeatAndSearch = function () {
    const modal = document.getElementById('workflow-repeat-modal');
    if (modal) modal.style.display = 'none';
    repeatBypassOnce = true;
    if (typeof searchBusinesses === 'function') searchBusinesses();
  };
  window.renderWorkflowPanels = renderWorkflowPanels;

  function bootWorkflow() {
    ensureWorkflowPanels();
    installWrappers();
    workflowBooted = true;
    scheduleWorkflowPanels(2200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootWorkflow);
  } else {
    bootWorkflow();
  }
})();




