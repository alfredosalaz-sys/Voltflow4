// ============ SISTEMA VISUAL OPERATIVO ============
(function () {
  'use strict';

  if (window.__gordiVisualSystemBooted) return;
  window.__gordiVisualSystemBooted = true;

  let triageIndex = 0;
  const ICONS = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18 3 21V6l6-3 6 3 6-3v15l-6 3-6-3Z"/><path d="M9 3v15"/><path d="M15 6v15"/></svg>',
    lead: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>',
    route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h3a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h3"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.6a16 16 0 0 0 6.3 6.3l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2Z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><path d="m20 6-11 11-5-5"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="m21.7 18-8.5-14.5a1.4 1.4 0 0 0-2.4 0L2.3 18a1.4 1.4 0 0 0 1.2 2h17a1.4 1.4 0 0 0 1.2-2Z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>'
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function qs(id) { return document.getElementById(id); }
  function getLeads() { return Array.isArray(window.leads) ? window.leads : []; }
  function getResults() { return Array.isArray(window.tempSearchResults) ? window.tempSearchResults : []; }
  function getSearchLifecycle() { return window.gordiSearchLifecycle || {}; }
  function norm(value) { return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim(); }
  function companyKey(item = {}) { return norm(item.company || item.name || '').replace(/[^\w]+/g, ''); }

  function getActiveView() {
    const view = document.querySelector('.view.active');
    return view?.id?.replace(/-view$/, '') || 'dashboard';
  }

  function findDuplicateLead(result = {}) {
    const email = norm(result.email);
    const phone = String(result.phone || result.whatsapp || '').replace(/\D/g, '');
    const key = companyKey(result);
    return getLeads().find(lead => {
      if (lead.archived) return false;
      if (email && norm(lead.email) === email) return true;
      const leadPhone = String(lead.phone || lead.whatsapp || '').replace(/\D/g, '');
      if (phone && leadPhone && phone.slice(-9) === leadPhone.slice(-9)) return true;
      return key && companyKey(lead) === key;
    }) || null;
  }

  function getDataConfidence(item = {}) {
    const checks = [
      !!item.email,
      !!item.phone || !!item.whatsapp,
      !!item.website,
      !!item.address,
      !!(item.segment || item.sourceSector || item.coverageSector),
      !!(item.decision_maker || item.name),
      !findDuplicateLead(item)
    ];
    const score = checks.filter(Boolean).length;
    if (score >= 6) return { level: 'Alta', cls: 'high', score };
    if (score >= 4) return { level: 'Media', cls: 'mid', score };
    return { level: 'Baja', cls: 'low', score };
  }

  function readActiveMission() {
    try {
      if (typeof window.getCoverageActiveMission === 'function') return window.getCoverageActiveMission();
    } catch {}
    try {
      return JSON.parse(localStorage.getItem('gordi_coverage_active_mission') || 'null');
    } catch {
      return null;
    }
  }

  function getMissionData() {
    const activeMission = readActiveMission();
    const inputSector = qs('plan-segment')?.selectedOptions?.[0]?.textContent?.trim() || qs('plan-segment')?.value || '';
    const inputLocation = qs('plan-location')?.value?.trim() || '';
    const missionLocation = activeMission?.location || activeMission?.postalCode || '';
    const missionSector = activeMission?.sector || activeMission?.sectors?.[0] || '';
    const lifecycle = getSearchLifecycle();
    const sector = missionSector || inputSector;
    const location = missionLocation || lifecycle.location || inputLocation;
    const results = getResults();
    const leads = getLeads();
    const complete = results.filter(r => r && r.email && r.phone).length;
    const withEmail = results.filter(r => r && r.email).length;
    const pending = leads.filter(l => !l.status || l.status === 'Pendiente').length;
    const overdue = leads.filter(l => {
      if (!l.next_contact) return false;
      const d = new Date(l.next_contact);
      return !Number.isNaN(d.getTime()) && d < new Date();
    }).length;
    const hasStoredMission = !!(missionLocation || missionSector || activeMission?.label || activeMission?.resultSearchId);
    const searching = lifecycle.status === 'running';
    const hasMission = !!(hasStoredMission || location || results.length || lifecycle.status);
    return { sector, location, results: results.length, complete, withEmail, pending, overdue, view: getActiveView(), hasMission, lifecycle, searching };
  }

  function formatRelativeMoment(value) {
    if (!value) return 'sin registro';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'sin registro';
    const diffMin = Math.round((Date.now() - date.getTime()) / 60000);
    if (diffMin < 1) return 'ahora';
    if (diffMin < 60) return `hace ${diffMin} min`;
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return `hace ${diffHours} h`;
    const diffDays = Math.round(diffHours / 24);
    if (diffDays < 8) return `hace ${diffDays} d`;
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }

  function safeReadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function getOperationalStatusData() {
    const summary = typeof window.getLocalRecoverySummary === 'function'
      ? window.getLocalRecoverySummary()
      : {
          leads: getLeads().length,
          emails: safeReadJson('gordi_email_history', []).length,
          campaigns: safeReadJson('gordi_campaigns', []).length,
          searches: safeReadJson('gordi_search_history', []).length + safeReadJson('gordi_saved_searches', []).length,
          origin: location.origin && location.origin !== 'null' ? location.origin : 'este navegador'
        };
    const leads = getLeads().filter(lead => !lead.archived);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = leads.filter(lead => {
      if (!lead.next_contact) return false;
      const next = new Date(lead.next_contact);
      next.setHours(0, 0, 0, 0);
      return next < today && lead.status !== 'Cerrado';
    }).length;
    const pending = leads.filter(lead => !lead.status || lead.status === 'Pendiente').length;
    const selectedResults = getResults().filter(item => item && item._selectedForImport !== false).length;
    const safetySnapshots = typeof window.readSafetySnapshots === 'function' ? window.readSafetySnapshots() : safeReadJson('gordi_safety_snapshots', []);
    const rescueSnapshots = typeof window.readCriticalRescues === 'function' ? window.readCriticalRescues() : safeReadJson('gordi_critical_rescue_snapshots', []);
    const diskBackupStatus = safeReadJson('gordi_disk_backup_last_status', null);
    const leadSources = leads.reduce((acc, lead) => {
      const key = lead.source || 'manual';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const primarySource = Object.entries(leadSources).sort((a, b) => b[1] - a[1])[0];
    const sync = [];
    if (localStorage.getItem('gordi_gh_token')) {
      sync.push({
        label: 'GitHub',
        mode: localStorage.getItem('gordi_gh_auto') === 'true' ? 'auto' : 'manual',
        push: localStorage.getItem('gordi_gh_last_push'),
        pull: localStorage.getItem('gordi_gh_last_pull')
      });
    }
    if (localStorage.getItem('gordi_jsonbin_bin')) {
      sync.push({
        label: 'JSONBin',
        mode: localStorage.getItem('gordi_jsonbin_auto') === 'true' ? 'auto' : 'manual',
        push: localStorage.getItem('gordi_jsonbin_last_push'),
        pull: null
      });
    }
    if (localStorage.getItem('gordi_sheets_id')) {
      sync.push({
        label: 'Sheets',
        mode: 'manual',
        push: localStorage.getItem('gordi_sheets_last_sync'),
        pull: null
      });
    }
    return {
      summary,
      pending,
      overdue,
      selectedResults,
      lastSaved: localStorage.getItem('gordi_local_last_modified'),
      safetySnapshots,
      rescueSnapshots,
      diskBackupStatus,
      sync,
      primarySource
    };
  }

  function getMissionAction(data) {
    if (data.searching) return { label: 'Volver al scraping', view: 'planner', icon: 'search' };
    if (data.view === 'coverage') return { label: 'Buscar pendiente', view: 'planner', icon: 'search' };
    if (data.view === 'planner' && data.results) return { label: 'Importar completos', fn: 'importSelectedSearch', icon: 'lead' };
    if (data.view === 'planner') return { label: 'Lanzar busqueda', fn: 'searchBusinesses', icon: 'search' };
    if (data.view === 'leads' || data.view === 'kanban') return { label: 'Ver mapa', view: 'map', icon: 'map' };
    if (data.view === 'map') return { label: 'Abrir cobertura', view: 'coverage', icon: 'route' };
    return { label: 'Ir a prospeccion', view: 'planner', icon: 'arrow' };
  }

  function runMissionAction(action) {
    if (action.fn && typeof window[action.fn] === 'function') return window[action.fn]();
    if (action.view && typeof window.showView === 'function') window.showView(action.view);
  }

  function ensureMissionBar() {
    const workflowBar = qs('workflow-mission-bar');
    if (workflowBar) {
      qs('mission-bar')?.remove();
      workflowBar.classList.add('mission-bar', 'visual-mission-bar');
      return workflowBar;
    }
    let bar = qs('mission-bar');
    if (bar) return bar;
    bar = document.createElement('div');
    bar.id = 'mission-bar';
    bar.className = 'mission-bar';
    const main = document.querySelector('main');
    if (main) main.prepend(bar);
    else document.body.prepend(bar);
    return bar;
  }

  function ensureOpsStatusLayer() {
    let layer = qs('ops-status-layer');
    if (layer) return layer;
    layer = document.createElement('section');
    layer.id = 'ops-status-layer';
    layer.className = 'ops-status-layer ui-panel';
    const main = document.querySelector('main');
    const anchor = qs('mission-bar') || qs('workflow-mission-bar');
    if (anchor?.parentNode) anchor.insertAdjacentElement('afterend', layer);
    else if (main) main.prepend(layer);
    else document.body.prepend(layer);
    return layer;
  }

  function renderOpsStatusLayer() {
    const layer = ensureOpsStatusLayer();
    if (!layer) return;
    const data = getOperationalStatusData();
    const syncHtml = data.sync.length
      ? data.sync.map(item => `<span class="state-chip ${item.mode === 'auto' ? 'state-success' : 'state-info'}">${esc(item.label)} ${esc(item.mode)} · ${esc(formatRelativeMoment(item.push || item.pull))}</span>`).join('')
      : '<span class="state-chip state-warning">Sin sync cloud activo</span>';
    const diskStatus = data.diskBackupStatus?.status || (localStorage.getItem('gordi_disk_backup_enabled') === 'true' ? 'activo' : 'sin carpeta');
    const diskDetail = data.diskBackupStatus?.detail || localStorage.getItem('gordi_disk_backup_last_file') || 'Backup local no configurado';
    const primarySource = data.primarySource ? `${data.primarySource[0]} · ${data.primarySource[1]} leads` : 'manual';
    layer.innerHTML = `
      <div style="display:grid;grid-template-columns:minmax(220px,1.5fr) minmax(220px,1.2fr) minmax(220px,1.1fr);gap:.8rem;align-items:start">
        <div style="display:grid;gap:.32rem">
          <span class="mission-kicker">Confianza operativa</span>
          <strong style="font-size:1rem">${data.summary.leads} leads · ${data.summary.emails || 0} emails · ${data.summary.campaigns || 0} campañas</strong>
          <span style="font-size:.78rem;color:var(--text-muted)">Guardado local ${esc(formatRelativeMoment(data.lastSaved))} · origen visible ${esc(data.summary.origin || 'este navegador')}</span>
          <span style="font-size:.72rem;color:var(--text-dim)">Fuente dominante: ${esc(primarySource)}</span>
        </div>
        <div style="display:grid;gap:.45rem">
          <strong style="font-size:.78rem;color:var(--text-muted)">Sync y copias</strong>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">${syncHtml}</div>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            <span class="state-chip state-info">${data.safetySnapshots.length} snapshots</span>
            <span class="state-chip ${data.rescueSnapshots.length ? 'state-success' : 'state-warning'}">${data.rescueSnapshots.length} rescates</span>
            <span class="state-chip ${diskStatus === 'success' || diskStatus === 'already_exists' ? 'state-success' : 'state-warning'}">Backup disco · ${esc(diskStatus)}</span>
          </div>
          <span style="font-size:.72rem;color:var(--text-dim)">${esc(diskDetail)}</span>
        </div>
        <div style="display:grid;gap:.45rem">
          <strong style="font-size:.78rem;color:var(--text-muted)">Pendiente ahora</strong>
          <div style="display:flex;gap:.4rem;flex-wrap:wrap">
            <button type="button" class="state-chip state-warning" onclick="dashboardBridge && dashboardBridge('pending')">${data.pending} pendientes</button>
            <button type="button" class="state-chip ${data.overdue ? 'state-warning' : 'state-success'}" onclick="dashboardBridge && dashboardBridge('overdue')">${data.overdue} vencidos</button>
            <button type="button" class="state-chip ${data.selectedResults ? 'state-info' : 'state-muted'}" onclick="dashboardBridge && dashboardBridge('${data.selectedResults ? 'results' : 'search'}')">${data.selectedResults} resultados listos</button>
          </div>
          <div style="display:flex;gap:.45rem;flex-wrap:wrap">
            <button type="button" class="btn-secondary btn-sm" onclick="showView && showView('settings')">Datos</button>
            <button type="button" class="btn-secondary btn-sm" onclick="showStorageDiagnostics && showStorageDiagnostics()">Diagnostico</button>
            ${data.safetySnapshots.length ? '<button type="button" class="btn-secondary btn-sm" onclick="openSafetySnapshotsModal && openSafetySnapshotsModal()">Snapshots</button>' : ''}
          </div>
        </div>
      </div>`;
  }

  function renderMissionBar() {
    const data = getMissionData();
    if (!data.hasMission) {
      qs('mission-bar')?.remove();
      const workflowBar = qs('workflow-mission-bar');
      if (workflowBar) {
        workflowBar.classList.remove('mission-bar', 'visual-mission-bar');
        workflowBar.style.display = 'none';
      }
      return;
    }
    const bar = ensureMissionBar();
    const action = getMissionAction(data);
    bar.style.display = 'grid';
    const missionMetric = data.searching
      ? `<span class="state-chip state-info">Buscando ahora</span>`
      : `<span class="state-chip state-info">${data.results} resultados</span>`;
    const flowSearchDone = data.searching || data.results > 0;
    const missionSubline = data.searching
      ? `Scraping en curso${data.lifecycle?.mode === 'multi' ? ' · multibusqueda' : ''}`
      : (data.sector || 'Sector pendiente');
    bar.innerHTML = `
      <div class="mission-context"><span class="mission-kicker">Mision activa</span><strong>${esc(data.location || 'Busqueda actual')}</strong><span>${esc(missionSubline)}</span></div>
      <div class="mission-flow" aria-label="Flujo de trabajo">
        ${renderFlowStep('Cobertura', data.view === 'coverage', true)}
        ${renderFlowStep('Buscar', data.view === 'planner' && data.searching, flowSearchDone)}
        ${renderFlowStep('Resultados', data.view === 'planner' && !data.searching && data.results > 0, data.results > 0)}
        ${renderFlowStep('Leads', data.view === 'leads' || data.view === 'kanban', data.pending >= 0)}
        ${renderFlowStep('Mapa', data.view === 'map', false)}
      </div>
      <div class="mission-metrics">
        ${missionMetric}
        <span class="state-chip state-success">${data.withEmail} con email</span>
        <span class="state-chip state-warning">${data.overdue} vencidos</span>
      </div>
      <button class="mission-action" type="button" data-mission-action><span class="ui-icon">${ICONS[action.icon] || ICONS.arrow}</span>${esc(action.label)}</button>
    `;
    bar.querySelector('[data-mission-action]')?.addEventListener('click', () => runMissionAction(action));
  }

  function renderFlowStep(label, active, done) {
    return `<span class="flow-step ${active ? 'active' : ''} ${done ? 'done' : ''}"><i></i>${esc(label)}</span>`;
  }

  function decorateSearchConsole() {
    const panel = document.querySelector('#planner-view > .glass-panel');
    if (panel) panel.classList.add('search-console', 'ui-panel');
    const bar = panel?.querySelector('.search-engine-bar');
    if (bar && !bar.parentNode.querySelector('.search-console-title')) {
      const title = document.createElement('div');
      title.className = 'search-console-title';
      title.innerHTML = `<span class="ui-icon">${ICONS.search}</span><div><strong>Consola de prospeccion</strong><em>Donde, que, cuanto y accion en un unico bloque</em></div>`;
      bar.before(title);
    }
    qs('multi-sector-toolbar')?.classList.add('multi-sector-visual');
  }

  function renderDashboardCommandDeck() {
    const view = qs('dashboard-view');
    if (!view) return;
    let deck = qs('visual-command-deck');
    if (!deck) {
      deck = document.createElement('div');
      deck.id = 'visual-command-deck';
      deck.className = 'visual-command-deck';
      const header = view.querySelector('.page-header');
      if (header?.nextSibling) header.parentNode.insertBefore(deck, header.nextSibling);
      else view.prepend(deck);
    }
    const data = getMissionData();
    const newLeads = getLeads().filter(l => l.source === 'search' || l.origin === 'search').length;
    const resultsAction = data.results ? "dashboardBridge && dashboardBridge('results')" : "dashboardBridge && dashboardBridge('search')";
    const importAction = data.results ? "dashboardBridge && dashboardBridge('results')" : "showView && showView('planner')";
    deck.innerHTML = `
      ${renderCommandCard('Que buscar ahora', data.location ? `${data.location} - ${data.sector || 'Sector pendiente'}` : 'Elige CP/zona y sector', 'Abrir prospeccion', "dashboardBridge && dashboardBridge('search')", 'search', 'info')}
      ${renderCommandCard('Que importar', `${data.results} resultados - ${data.complete} completos`, data.results ? 'Ir a resultados' : 'Preparar busqueda', resultsAction, 'lead', data.results ? 'success' : 'muted')}
      ${renderCommandCard('A quien contactar', `${data.pending} leads pendientes - ${data.overdue} vencidos`, 'Gestionar leads', "dashboardBridge && dashboardBridge('urgent')", 'mail', data.overdue ? 'warning' : 'info')}
      ${renderCommandCard('Donde avanzar', `${newLeads} leads desde scraping`, data.results ? 'Cruzar con resultados' : 'Mapa comercial', data.results ? importAction : "showView && showView('map')", 'map', 'muted')}
    `;
  }

  function renderCommandCard(title, value, action, handler, icon, tone) {
    return `<button class="visual-command-card ${tone || 'muted'}" type="button" onclick="${handler}"><span class="ui-icon">${ICONS[icon] || ICONS.arrow}</span><span><em>${esc(title)}</em><strong>${esc(value)}</strong><small>${esc(action)}</small></span></button>`;
  }

  function renderResultsDecisionBar() {
    const panel = qs('search-results-panel');
    if (!panel || panel.style.display === 'none') return;
    let bar = qs('result-decision-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'result-decision-bar';
      bar.className = 'result-decision-bar';
      panel.prepend(bar);
    }
    const results = getResults();
    const selected = results.filter(r => r && r._selectedForImport !== false).length;
    const withEmail = results.filter(r => r && r.email).length;
    const withPhone = results.filter(r => r && r.phone).length;
    const complete = results.filter(r => r && r.email && r.phone && (r.address || r.website)).length;
    const duplicates = results.filter(r => findDuplicateLead(r)).length;
    const highConfidence = results.filter(r => getDataConfidence(r).cls === 'high').length;
    bar.innerHTML = `
      <div><span class="mission-kicker">Cierre post-scraping</span><strong>${results.length} empresas encontradas</strong></div>
      <div class="decision-metrics">
        <span class="state-chip state-success">${complete} completas</span>
        <span class="state-chip state-success">${highConfidence} alta confianza</span>
        <span class="state-chip state-info">${withEmail} email</span>
        <span class="state-chip state-muted">${withPhone} telefono</span>
        <span class="state-chip state-warning">${duplicates} duplicados</span>
        <span class="state-chip state-warning">${selected} seleccionadas</span>
      </div>
      <div class="decision-actions">
        <button class="btn-secondary btn-sm" onclick="openTriageMode && openTriageMode()">Triage rapido</button>
        <button class="btn-secondary btn-sm" onclick="openDuplicateCenter && openDuplicateCenter()">Duplicados</button>
        <button class="btn-secondary btn-sm" onclick="filterResults && filterResults('email', event.currentTarget)">Filtrar con email</button>
        <button class="btn-secondary btn-sm" onclick="dashboardBridge && dashboardBridge('search-leads')">Leads importados</button>
        <button class="btn-primary btn-sm" onclick="importSelectedSearch && importSelectedSearch()">Importar seleccionadas</button>
      </div>`;
  }

  function decorateCardsAndStates() {
    document.querySelectorAll('.search-card').forEach(card => {
      if (card.querySelector('.decision-tag')) return;
      const idx = Number(card.dataset.index || card.dataset.idx);
      const item = getResults()[idx];
      const tag = document.createElement('div');
      tag.className = 'decision-tag';
      if (!item) tag.textContent = 'Revisar';
      else if (item.email && item.phone) { tag.classList.add('ready'); tag.textContent = 'Importar ahora'; }
      else if (item.email) { tag.classList.add('partial'); tag.textContent = 'Email valido'; }
      else { tag.classList.add('review'); tag.textContent = 'Necesita enriquecer'; }
      card.prepend(tag);
      if (item) {
        const conf = getDataConfidence(item);
        const confChip = document.createElement('div');
        confChip.className = `confidence-chip confidence-${conf.cls}`;
        confChip.textContent = `Confianza ${conf.level}`;
        card.prepend(confChip);
        const dup = findDuplicateLead(item);
        if (dup) {
          const dupChip = document.createElement('button');
          dupChip.type = 'button';
          dupChip.className = 'duplicate-chip';
          dupChip.textContent = `Ya en Leads - ${dup.status || 'Sin estado'}`;
          dupChip.addEventListener('click', event => {
            event.stopPropagation();
            if (typeof window.openLeadDetail === 'function') window.openLeadDetail(dup.id);
          });
          card.prepend(dupChip);
        }
      }
    });
  }

  function decorateLeadConfidenceAndTimeline() {
    document.querySelectorAll('#leads-table tbody tr[data-lead-id]').forEach(row => {
      if (row.querySelector('.lead-confidence-mini')) return;
      const lead = getLeads().find(l => String(l.id) === String(row.dataset.leadId));
      const cell = row.children[1];
      if (!lead || !cell) return;
      const conf = getDataConfidence(lead);
      const chip = document.createElement('div');
      chip.className = `lead-confidence-mini confidence-chip confidence-${conf.cls}`;
      chip.textContent = `Confianza ${conf.level}`;
      cell.appendChild(chip);
    });
    decorateLeadDrawer();
  }

  function buildLeadTimeline(lead = {}) {
    const items = [];
    if (lead.coverageLocation || lead.coverageMission) items.push({ label: 'Buscado', value: lead.coverageLocation || lead.coverageMission?.location || 'Cobertura', date: lead.coverageSearchDate || lead.date });
    if (lead.date) items.push({ label: 'Importado', value: lead.source || 'Lead creado', date: lead.date });
    if (lead.first_contact_date) items.push({ label: 'Contactado', value: lead.email || lead.phone || 'Primer contacto', date: lead.first_contact_date });
    if (lead.status && lead.status !== 'Pendiente') items.push({ label: lead.status, value: 'Estado actual', date: lead.status_date || lead.date });
    if (lead.next_contact) items.push({ label: 'Proxima accion', value: 'Seguimiento', date: lead.next_contact });
    return items.length ? items : [{ label: 'Lead creado', value: lead.company || lead.name || 'Sin origen registrado', date: lead.date }];
  }

  function decorateLeadDrawer() {
    const body = qs('lead-drawer-body');
    const title = qs('modal-lead-title')?.textContent || '';
    if (!body || !title || body.querySelector('.lead-timeline-panel')) return;
    const lead = getLeads().find(l => title.includes(l.company || '__') || title.includes(l.name || '__'));
    if (!lead) return;
    const conf = getDataConfidence(lead);
    const panel = document.createElement('div');
    panel.className = 'lead-timeline-panel';
    panel.innerHTML = `
      <div class="lead-timeline-head"><span class="state-chip state-info">Origen comercial</span><span class="confidence-chip confidence-${conf.cls}">Confianza ${conf.level}</span></div>
      <div class="lead-origin-grid">
        <span>CP/Zona<strong>${esc(lead.coverageLocation || lead.coverageMission?.location || 'Sin dato')}</strong></span>
        <span>Sector<strong>${esc(lead.coverageSector || lead.segment || lead.coverageMission?.sector || 'Sin dato')}</strong></span>
        <span>Fuente<strong>${esc(lead.source || 'Manual')}</strong></span>
      </div>
      <div class="lead-timeline">${buildLeadTimeline(lead).map(item => `<div class="lead-timeline-item"><i></i><span><strong>${esc(item.label)}</strong><em>${esc(item.value || '')}</em></span><time>${item.date ? esc(new Date(item.date).toLocaleDateString('es-ES')) : '-'}</time></div>`).join('')}</div>`;
    body.prepend(panel);
  }

  function normalizeResultIcons() {
    const map = { '✉️': ICONS.mail, '📞': ICONS.phone, '👤': ICONS.lead, '🌐': ICONS.map, 'ℹ️': ICONS.alert };
    document.querySelectorAll('.sc-icon').forEach(icon => {
      const key = icon.textContent.trim();
      if (!map[key]) return;
      icon.classList.add('ui-icon', 'sc-svg-icon');
      icon.innerHTML = map[key];
    });
    document.querySelectorAll('.sc-copy-email-btn').forEach(btn => {
      if (btn.dataset.visualIcon) return;
      btn.dataset.visualIcon = '1';
      btn.innerHTML = `<span class="ui-icon">${ICONS.check}</span>Copiar`;
    });
  }

  function renderCommandPalette(query = '') {
    const overlay = qs('global-search-overlay');
    const results = qs('global-search-results');
    if (!overlay || !results || overlay.style.display === 'none') return;
    const q = norm(query || qs('global-search-input')?.value || '');
    const commands = getCommandItems(q);
    qs('command-palette-actions')?.remove();
    if (!commands.length) return;
    const wrap = document.createElement('div');
    wrap.id = 'command-palette-actions';
    wrap.className = 'command-palette-actions';
    wrap.innerHTML = `<div class="command-kicker">Acciones rapidas</div>${commands.map(cmd => `<button class="command-item" type="button" onclick="${esc(cmd.action)}"><span class="ui-icon">${ICONS[cmd.icon] || ICONS.arrow}</span><span><strong>${esc(cmd.title)}</strong><em>${esc(cmd.desc)}</em></span></button>`).join('')}`;
    results.prepend(wrap);
  }

  function getCommandItems(q) {
    const items = [
      { title: 'Buscar empresas', desc: 'Ir a prospeccion y lanzar busqueda', icon: 'search', keywords: 'buscar scraping prospeccion empresas', action: "showView('planner');setTimeout(()=>document.getElementById('plan-location')?.focus(),80)" },
      { title: 'Triage rapido', desc: 'Revisar resultados uno a uno', icon: 'check', keywords: 'triage revisar resultados aceptar descartar', action: "openTriageMode && openTriageMode()" },
      { title: 'Centro de duplicados', desc: 'Comparar resultados contra Leads', icon: 'alert', keywords: 'duplicados repetir comparar existentes', action: "openDuplicateCenter && openDuplicateCenter()" },
      { title: 'Abrir cobertura', desc: 'Ver CP y sectores pendientes', icon: 'route', keywords: 'cobertura cp sectores pendientes', action: "showView('coverage')" },
      { title: 'Mapa comercial', desc: 'Ver leads y cobertura en mapa', icon: 'map', keywords: 'mapa chinchetas territorio cobertura', action: "showView('map')" }
    ];
    if (!q) return items;
    return items.filter(item => norm(`${item.title} ${item.desc} ${item.keywords}`).includes(q)).slice(0, 6);
  }

  function openTriageMode(startIndex = 0) {
    const results = getResults();
    if (!results.length) return typeof showToast === 'function' && showToast('No hay resultados para revisar.');
    triageIndex = Math.max(0, Math.min(startIndex, results.length - 1));
    let modal = qs('triage-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'triage-modal';
      modal.className = 'triage-modal';
      document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    renderTriageCard();
  }

  function closeTriageMode() { const modal = qs('triage-modal'); if (modal) modal.style.display = 'none'; }
  function triageMove(delta) { const r = getResults(); triageIndex = Math.max(0, Math.min(triageIndex + delta, r.length - 1)); renderTriageCard(); }
  function triageDiscard() { const item = getResults()[triageIndex]; if (item) item._selectedForImport = false; refreshVisualSystem(); triageMove(1); }
  function triageAccept() { const item = getResults()[triageIndex]; if (item) item._selectedForImport = true; refreshVisualSystem(); triageMove(1); }

  function triageImportCurrent() {
    getResults().forEach((item, idx) => { item._selectedForImport = idx === triageIndex; });
    if (typeof window.importSelectedSearch === 'function') window.importSelectedSearch();
  }

  function renderTriageCard() {
    const modal = qs('triage-modal');
    const results = getResults();
    const item = results[triageIndex];
    if (!modal || !item) return;
    const dup = findDuplicateLead(item);
    const conf = getDataConfidence(item);
    modal.innerHTML = `
      <div class="triage-box">
        <div class="triage-top"><div><span class="mission-kicker">Triage rapido ${triageIndex + 1}/${results.length}</span><h2>${esc(item.name || item.company || 'Empresa')}</h2></div><button class="triage-close" onclick="closeTriageMode()" aria-label="Cerrar"></button></div>
        <div class="triage-tags"><span class="confidence-chip confidence-${conf.cls}">Confianza ${conf.level}</span>${dup ? `<span class="state-chip state-warning">Ya en Leads - ${esc(dup.status || 'Sin estado')}</span>` : '<span class="state-chip state-success">Nuevo en CRM</span>'}${item.email ? '<span class="state-chip state-info">Email</span>' : '<span class="state-chip state-muted">Sin email</span>'}${item.phone ? '<span class="state-chip state-info">Telefono</span>' : '<span class="state-chip state-muted">Sin telefono</span>'}</div>
        <div class="triage-data">
          <p><strong>Direccion</strong><span>${esc(item.address || 'Sin direccion')}</span></p>
          <p><strong>Email</strong><span>${esc(item.email || 'Sin email')}</span></p>
          <p><strong>Telefono</strong><span>${esc(item.phone || item.whatsapp || 'Sin telefono')}</span></p>
          <p><strong>Web</strong><span>${item.website ? `<a href="${esc(item.website)}" target="_blank">${esc(item.website.replace(/^https?:\/\//, ''))}</a>` : 'Sin web'}</span></p>
        </div>
        <div class="triage-actions">
          <button class="btn-secondary" onclick="triageDiscard()">Descartar</button>
          <button class="btn-secondary" onclick="triageMove(-1)" ${triageIndex ? '' : 'disabled'}>Anterior</button>
          ${item.website ? `<a class="btn-secondary triage-link" href="${esc(item.website)}" target="_blank">Abrir web</a>` : ''}
          ${!dup ? '<button class="btn-primary" onclick="triageImportCurrent()">Importar este</button>' : `<button class="btn-primary" onclick="openLeadDetail && openLeadDetail('${esc(dup.id)}')">Abrir lead</button>`}
          <button class="btn-primary" onclick="triageAccept()">Aceptar y siguiente</button>
        </div>
      </div>`;
  }

  function openDuplicateCenter() {
    const rows = getResults().map((item, index) => ({ item, index, dup: findDuplicateLead(item) })).filter(row => row.dup);
    let modal = qs('duplicate-center-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'duplicate-center-modal';
      modal.className = 'duplicate-center-modal';
      document.body.appendChild(modal);
    }
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="duplicate-center-box">
        <div class="triage-top"><div><span class="mission-kicker">Centro de duplicados</span><h2>${rows.length} coincidencias detectadas</h2></div><button class="triage-close" onclick="closeDuplicateCenter()" aria-label="Cerrar"></button></div>
        <p class="duplicate-note">Los duplicados no son un fallo: son trabajo ahorrado. Puedes excluirlos antes de importar o abrir el lead existente.</p>
        <div class="duplicate-list">${rows.length ? rows.map(row => `<div class="duplicate-row"><span><strong>${esc(row.item.name || row.item.company)}</strong><em>Resultado de scraping</em></span><span><strong>${esc(row.dup.company || row.dup.name)}</strong><em>${esc(row.dup.status || 'Sin estado')}</em></span><div><button class="btn-secondary btn-sm" onclick="openLeadDetail && openLeadDetail('${esc(row.dup.id)}')">Abrir lead</button><button class="btn-secondary btn-sm" onclick="excludeDuplicateResult(${row.index})">Excluir</button></div></div>`).join('') : '<div class="empty-state">No hay duplicados visibles en los resultados actuales.</div>'}</div>
        <div class="triage-actions"><button class="btn-secondary" onclick="closeDuplicateCenter()">Cerrar</button><button class="btn-primary" onclick="selectOnlyNewResults()">Seleccionar solo nuevos</button></div>
      </div>`;
  }

  function closeDuplicateCenter() { const modal = qs('duplicate-center-modal'); if (modal) modal.style.display = 'none'; }
  function syncSearchSelectionChecks() {
    document.querySelectorAll('.search-check[data-index]').forEach(check => {
      const item = getResults()[Number(check.dataset.index)];
      check.checked = !!item && item._selectedForImport !== false;
    });
  }
  function rerenderSearchSelection() {
    if (typeof renderSearchCards === 'function') renderSearchCards();
    else if (typeof showResultsPanel === 'function') showResultsPanel();
    syncSearchSelectionChecks();
  }
  function excludeDuplicateResult(index) {
    const item = getResults()[index];
    if (item) item._selectedForImport = false;
    rerenderSearchSelection();
    refreshVisualSystem();
    openDuplicateCenter();
  }
  function selectOnlyNewResults() {
    let selected = 0;
    getResults().forEach(item => {
      const isNew = !findDuplicateLead(item);
      item._selectedForImport = isNew;
      if (isNew) selected += 1;
    });
    closeDuplicateCenter();
    rerenderSearchSelection();
    refreshVisualSystem();
    if (typeof showToast === 'function') showToast(`${selected} resultados nuevos seleccionados. Revisa y usa Importar seleccionadas.`, 'success');
  }

  function showBusy(label = 'Procesando...') {
    let busy = qs('visual-busy');
    if (!busy) {
      busy = document.createElement('div');
      busy.id = 'visual-busy';
      busy.className = 'visual-busy';
      document.body.appendChild(busy);
    }
    busy.innerHTML = `<span></span><strong>${esc(label)}</strong>`;
    busy.classList.add('show');
  }

  function hideBusySoon() { setTimeout(() => qs('visual-busy')?.classList.remove('show'), 450); }

  function decorateCoverageAndMap() {
    qs('coverage-root')?.classList.add('coverage-pro');
    qs('map-view')?.classList.add('map-pro');
    const legend = qs('map-legend');
    if (legend && !legend.querySelector('.map-action-legend')) {
      const helper = document.createElement('div');
      helper.className = 'map-action-legend';
      helper.innerHTML = '<span><i class="dot done"></i>Trabajado</span><span><i class="dot partial"></i>Completar</span><span><i class="dot pending"></i>Pendiente</span><span><i class="dot danger"></i>Revisar</span>';
      legend.appendChild(helper);
    }
  }

  function normalizeVisibleControls() {
    document.querySelectorAll('.btn-primary').forEach(btn => btn.classList.add('ui-btn'));
    document.querySelectorAll('.btn-outline').forEach(btn => btn.classList.add('ui-btn'));
    document.querySelectorAll('.glass-panel').forEach(panel => panel.classList.add('ui-panel'));
  }

  function registerVisualTourFeatures() {
    if (typeof window.registerTourFeature !== 'function') return;
    window.registerTourFeature({
      id: 'ops-status-layer-feature',
      view: 'dashboard',
      contexts: ['update', 'dashboard'],
      selector: '#ops-status-layer',
      title: 'Confianza operativa visible',
      text: 'Este bloque resume guardado local, origen visible, sync, snapshots, rescates y pendientes. Antes de trabajar, aquí puedes comprobar si todo está sano sin entrar en Configuración.',
      manual: 'dashboard',
      topic: 'opsStatus',
      priority: 20
    });
    window.registerTourFeature({
      id: 'mission-active-feature',
      view: 'dashboard',
      contexts: ['update', 'dashboard'],
      selector: '#workflow-mission-bar, #mission-bar',
      title: 'Misión activa',
      text: 'La app mantiene visible la búsqueda o zona sobre la que estás trabajando y te enlaza al siguiente paso útil. Ya no tienes que recordar manualmente en qué punto del flujo estabas.',
      manual: 'dashboard',
      topic: 'mission',
      modules: ['workflow'],
      priority: 30
    });
    window.registerTourFeature({
      id: 'visual-command-deck-feature',
      view: 'dashboard',
      contexts: ['update', 'dashboard'],
      selector: '#visual-command-deck',
      title: 'Decisiones guiadas desde el dashboard',
      text: 'El dashboard ya no es solo un panel de métricas. Responde a cuatro preguntas reales: qué buscar, qué importar, a quién contactar y dónde avanzar.',
      manual: 'dashboard',
      topic: 'commandCenter',
      priority: 50
    });
    window.registerTourFeature({
      id: 'result-decision-bar-feature',
      view: 'planner',
      contexts: ['update', 'planner'],
      selector: '#search-results-panel, #result-decision-bar',
      title: 'Resultados para decidir mejor',
      text: 'Los resultados ya no son solo una lista. Aquí puedes revisar calidad, filtrar por datos útiles y decidir qué merece entrar en Leads para importar mejor, no solo más.',
      manual: 'search',
      topic: 'resultDecision',
      requiresResults: true,
      priority: 80
    });
  }

  function refreshVisualSystem() {
    renderOpsStatusLayer();
    renderMissionBar();
    renderDashboardCommandDeck();
    decorateSearchConsole();
    renderResultsDecisionBar();
    decorateCardsAndStates();
    decorateLeadConfidenceAndTimeline();
    normalizeResultIcons();
    decorateCoverageAndMap();
    normalizeVisibleControls();
    renderCommandPalette();
  }

  function wrapRender(name) {
    const original = window[name];
    if (typeof original !== 'function' || original.__visualWrapped) return;
    const wrapped = function (...args) {
      const result = original.apply(this, args);
      setTimeout(refreshVisualSystem, 60);
      return result;
    };
    wrapped.__visualWrapped = true;
    window[name] = wrapped;
  }

  function wrapBusy(name, label) {
    const original = window[name];
    if (typeof original !== 'function' || original.__visualBusyWrapped) return;
    const wrapped = function (...args) {
      showBusy(label);
      try {
        const result = original.apply(this, args);
        if (result && typeof result.finally === 'function') result.finally(hideBusySoon);
        else hideBusySoon();
        return result;
      } catch (err) {
        hideBusySoon();
        throw err;
      }
    };
    wrapped.__visualBusyWrapped = true;
    window[name] = wrapped;
  }

  function bootVisualSystem() {
    registerVisualTourFeatures();
    wrapRender('renderSearchResults');
    wrapRender('applyAdvancedFilters');
    wrapRender('renderCoverage');
    wrapRender('setMapMode');
    wrapRender('renderLeads');
    wrapBusy('searchBusinesses', 'Ejecutando scraping...');
    wrapBusy('searchBusinessesMultiSector', 'Ejecutando multibusqueda...');
    wrapBusy('importSelectedSearch', 'Importando a Leads...');
    ['change', 'input', 'click', 'gordi:flow'].forEach(type => document.addEventListener(type, () => setTimeout(refreshVisualSystem, 80), true));
    document.addEventListener('gordi:view-changed', () => setTimeout(refreshVisualSystem, 40));
    document.addEventListener('input', event => {
      if (event.target?.id === 'global-search-input') setTimeout(() => renderCommandPalette(event.target.value), 30);
    }, true);
    document.addEventListener('keydown', event => {
      if (qs('triage-modal')?.style.display !== 'flex') return;
      if (event.key === 'Escape') closeTriageMode();
      if (event.key === 'ArrowRight') triageMove(1);
      if (event.key === 'ArrowLeft') triageMove(-1);
      if (event.key.toLowerCase() === 'a') triageAccept();
      if (event.key.toLowerCase() === 'd') triageDiscard();
    });
    refreshVisualSystem();
    setInterval(refreshVisualSystem, 5000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootVisualSystem, { once: true });
  else bootVisualSystem();

  Object.assign(window, {
    refreshVisualSystem,
    openTriageMode,
    closeTriageMode,
    triageMove,
    triageAccept,
    triageDiscard,
    triageImportCurrent,
    openDuplicateCenter,
    closeDuplicateCenter,
    excludeDuplicateResult,
    selectOnlyNewResults,
    renderCommandPalette
  });
})();
