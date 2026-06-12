// ============ STATS ============
function updateStats() {
  const summary = getDashboardAggregateSummary();
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
  set('stat-total', summary.activeCount);
  set('stat-high', summary.highScoreCount);
  set('stat-pending', summary.pendingCount);
  set('stat-sent', summary.emailCount);
  set('stat-sent2', summary.emailCount);
  set('stat-contacted', summary.uniqueContactedCount);
  set('stat-waiting', summary.waitingCount);
}

let _dashboardAggregateCache = { dirty: true, summary: null, version: 0 };

function markDashboardAggregatesDirty(reason = '') {
  _dashboardAggregateCache.dirty = true;
  _dashboardAggregateCache.version += 1;
  _dashboardAggregateCache.reason = reason;
}

function getDashboardAggregateSummary() {
  if ((_dashboardAggregateCache.lastLeadCount || 0) !== leads.length || (_dashboardAggregateCache.lastEmailCount || 0) !== emailHistory.length) {
    _dashboardAggregateCache.dirty = true;
  }
  if (!_dashboardAggregateCache.dirty && _dashboardAggregateCache.summary) {
    return _dashboardAggregateCache.summary;
  }
  const activeLeads = leads.filter(l => !l.archived);
  const contactedEmails = new Set();
  emailHistory.forEach(h => {
    if (h?.email) contactedEmails.add(String(h.email).toLowerCase());
  });
  const segmentStats = {};
  activeLeads.forEach(l => {
    const segment = l.segment || 'Sin segmento';
    if (!segmentStats[segment]) segmentStats[segment] = { total: 0, contacted: 0, responded: 0, totalScore: 0 };
    segmentStats[segment].total += 1;
    segmentStats[segment].totalScore += Number(l.score || 0);
    if (['Contactado','Respuesta del cliente','Visita','Entrega de presupuesto','Cerrado'].includes(l.status)) segmentStats[segment].contacted += 1;
    if (['Respuesta del cliente','Visita','Entrega de presupuesto','Cerrado'].includes(l.status)) segmentStats[segment].responded += 1;
  });
  const summary = {
    activeLeads,
    activeCount: activeLeads.length,
    highScoreCount: activeLeads.filter(l => Number(l.score || 0) >= 70).length,
    pendingCount: activeLeads.filter(l => l.status === 'Pendiente').length,
    emailCount: emailHistory.length,
    uniqueContactedCount: contactedEmails.size,
    waitingCount: emailHistory.filter(h => h.status === 'Visita').length,
    segmentStats
  };
  _dashboardAggregateCache.summary = summary;
  _dashboardAggregateCache.dirty = false;
  _dashboardAggregateCache.lastLeadCount = leads.length;
  _dashboardAggregateCache.lastEmailCount = emailHistory.length;
  return summary;
}

function getDashboardPrioritySnapshot() {
  const summary = getDashboardAggregateSummary();
  const activeLeads = summary.activeLeads;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const urgent = activeLeads.filter(l => l.status === 'Pendiente' && (l.score || 0) >= 75);
  const overdue = activeLeads.filter(l => {
    if (!l.next_contact) return false;
    const next = new Date(l.next_contact);
    next.setHours(0, 0, 0, 0);
    return next < today && l.status !== 'Cerrado';
  });
  const pending = activeLeads.filter(l => !l.status || l.status === 'Pendiente');
  const contactedWaiting = activeLeads.filter(l => l.status === 'Contactado');
  const results = Array.isArray(window.tempSearchResults) ? window.tempSearchResults : [];
  const selectedResults = results.filter(r => r && r._selectedForImport !== false).length;
  const withCoverageOrigin = activeLeads.filter(l => l.coverageMission || l.coverageMissionLabel || l.coverageLocation).length;
  return {
    active: activeLeads.length,
    urgent,
    overdue,
    pending,
    contactedWaiting,
    results,
    selectedResults,
    withCoverageOrigin
  };
}

function dashboardSetLeadFilters(config = {}) {
  const pairs = {
    'lead-search': config.search ?? null,
    'filter-segment': config.segment ?? null,
    'filter-status': config.status ?? null,
    'filter-source': config.source ?? null,
    'sort-leads': config.sort ?? null,
    'filter-score-min': config.scoreMin ?? null,
    'filter-date-range': config.dateRange ?? null,
    'filter-next-contact': config.nextContact ?? null
  };
  Object.entries(pairs).forEach(([id, value]) => {
    if (value === null) return;
    const el = document.getElementById(id);
    if (el) el.value = value;
  });
}

let _dashboardProgressiveTimers = {};

function clearDashboardProgressiveTimers() {
  Object.keys(_dashboardProgressiveTimers).forEach(key => {
    clearTimeout(_dashboardProgressiveTimers[key]);
    delete _dashboardProgressiveTimers[key];
  });
}

function scheduleDashboardStage(key, fn, delay) {
  clearTimeout(_dashboardProgressiveTimers[key]);
  _dashboardProgressiveTimers[key] = setTimeout(() => {
    delete _dashboardProgressiveTimers[key];
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => fn(), { timeout: 1800 });
    } else {
      setTimeout(fn, 60);
    }
  }, delay);
}

function renderTechnicalHealthPanel() {
  const container = document.getElementById('technical-health-content');
  if (!container) return;
  const diag = typeof window.getGordiPerfDiagnostic === 'function' ? window.getGordiPerfDiagnostic() : null;
  const summary = typeof window.getGordiPerfSummary === 'function' ? window.getGordiPerfSummary().slice(0, 4) : [];
  const cards = [
    {
      label: 'Modo',
      value: window.GORDI_SAFE_MODE ? 'Seguro' : 'Normal',
      hint: window.GORDI_SAFE_MODE ? 'Capas pesadas desactivadas' : 'Experiencia completa'
    },
    {
      label: 'Último fallback',
      value: diag?.reason || 'Ninguno',
      hint: diag?.at ? new Date(diag.at).toLocaleString('es-ES') : 'Sin rescate reciente'
    },
    {
      label: 'Arranque',
      value: (summary.find(item => item.name === 'boot:DOMContentLoaded')?.max || 0) + 'ms',
      hint: 'Tiempo máximo registrado'
    },
    {
      label: 'Leadset',
      value: `${leads.length} leads`,
      hint: leads.length > 900 ? 'Carga grande: dashboard aligerado' : 'Carga normal'
    }
  ];
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem">
      ${cards.map(card => `
        <div style="padding:.85rem 1rem;border:1px solid var(--glass-border);border-radius:12px;background:rgba(255,255,255,.03);display:grid;gap:.25rem">
          <span style="font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim)">${card.label}</span>
          <strong style="font-size:.96rem;color:var(--text)">${card.value}</strong>
          <span style="font-size:.72rem;color:var(--text-muted)">${card.hint}</span>
        </div>`).join('')}
    </div>
    ${summary.length ? `<div style="display:grid;gap:.35rem;margin-top:.25rem">${summary.map(item => `
      <div style="display:grid;grid-template-columns:minmax(150px,1fr) 70px 70px 60px;gap:.5rem;font-size:.74rem;color:var(--text-muted)">
        <strong style="color:var(--text)">${item.name}</strong>
        <span>avg ${item.avg}ms</span>
        <span>max ${item.max}ms</span>
        <span>n=${item.count}</span>
      </div>`).join('')}</div>` : ''}
  `;
}

function queueDashboardProgressiveRender(reason = 'default') {
  clearDashboardProgressiveTimers();
  const runPrimary = () => {
    updateStats();
    renderRecentActivity();
    renderTechnicalHealthPanel();
    if (typeof renderDashboardCharts === 'function') renderDashboardCharts('primary');
  };
  const runSecondary = () => {
    if (typeof renderDashboardCharts === 'function') renderDashboardCharts('secondary');
    renderTechnicalHealthPanel();
  };
  const runHeavy = () => {
    if (typeof renderDashboardCharts === 'function') renderDashboardCharts('full');
    renderTechnicalHealthPanel();
  };

  if (typeof window.gordiPerfMeasure === 'function') {
    window.gordiPerfMeasure(`dashboard:stage-primary:${reason}`, runPrimary, { leads: leads.length, safeMode: !!window.GORDI_SAFE_MODE });
  } else {
    runPrimary();
  }
  scheduleDashboardStage('secondary', () => {
    if (typeof window.gordiPerfMeasure === 'function') {
      window.gordiPerfMeasure(`dashboard:stage-secondary:${reason}`, runSecondary, { leads: leads.length, safeMode: !!window.GORDI_SAFE_MODE });
    } else {
      runSecondary();
    }
  }, 240);
  scheduleDashboardStage('heavy', () => {
    if (window.GORDI_SAFE_MODE) return;
    if (typeof window.gordiPerfMeasure === 'function') {
      window.gordiPerfMeasure(`dashboard:stage-heavy:${reason}`, runHeavy, { leads: leads.length, safeMode: !!window.GORDI_SAFE_MODE });
    } else {
      runHeavy();
    }
  }, leads.length > 900 ? 2200 : 1200);
}

function dashboardBridge(action) {
  if (action === 'urgent') {
    showView('leads');
    dashboardSetLeadFilters({ status: 'Pendiente', sort: 'score', scoreMin: '70', nextContact: '' });
    renderLeads();
    return;
  }
  if (action === 'overdue') {
    showView('leads');
    dashboardSetLeadFilters({ status: '', sort: 'next_contact', scoreMin: '', nextContact: 'overdue' });
    renderLeads();
    return;
  }
  if (action === 'pending') {
    showView('leads');
    dashboardSetLeadFilters({ status: 'Pendiente', sort: 'score', scoreMin: '', nextContact: '' });
    renderLeads();
    return;
  }
  if (action === 'search-leads') {
    showView('leads');
    dashboardSetLeadFilters({ source: 'search', status: '', sort: 'date', scoreMin: '', nextContact: '' });
    renderLeads();
    return;
  }
  if (action === 'results') {
    showView('planner');
    setTimeout(() => {
      const panel = document.getElementById('search-results-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return;
  }
  if (action === 'results-import') {
    if (Array.isArray(window.tempSearchResults) && window.tempSearchResults.length && typeof importSelectedSearch === 'function') {
      importSelectedSearch();
      return;
    }
    dashboardBridge('results');
    return;
  }
  if (action === 'tracking') {
    showView('tracking');
    renderTracking();
    return;
  }
  if (action === 'pipeline') {
    showView('kanban');
    renderKanban();
    return;
  }
  if (action === 'search') {
    showView('planner');
    setTimeout(() => document.getElementById('plan-location')?.focus(), 120);
  }
}

function renderPriorityControlCenter() {
  const snap = getDashboardPrioritySnapshot();
  const items = [
    {
      label: 'Contactar primero',
      value: `${snap.urgent.length} urgentes`,
      hint: snap.urgent.length ? 'Score alto pendientes' : 'Sin urgentes bloqueando',
      action: 'urgent',
      tone: snap.urgent.length ? 'var(--danger)' : 'var(--success)'
    },
    {
      label: 'Seguimientos vencidos',
      value: `${snap.overdue.length} por mover`,
      hint: snap.overdue.length ? 'Hay acciones atrasadas' : 'Seguimiento al dia',
      action: 'overdue',
      tone: snap.overdue.length ? 'var(--warning)' : 'var(--success)'
    },
    {
      label: 'Resultados listos',
      value: `${snap.results.length} scraping`,
      hint: snap.results.length ? `${snap.selectedResults} seleccionados para importar` : 'Sin resultados pendientes',
      action: snap.results.length ? 'results' : 'search',
      tone: snap.results.length ? 'var(--primary)' : 'var(--text-dim)'
    },
    {
      label: 'Cobertura trazable',
      value: `${snap.withCoverageOrigin} con origen`,
      hint: `${snap.pending.length} pendientes totales`,
      action: 'search-leads',
      tone: 'var(--primary)'
    }
  ];

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:.75rem;margin-bottom:${snap.urgent.length || snap.overdue.length ? '.85rem' : '0'}">
      ${items.map(item => `
        <button type="button" onclick="dashboardBridge('${item.action}')" style="text-align:left;padding:.95rem 1rem;border-radius:14px;border:1px solid var(--glass-border);background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025));display:grid;gap:.28rem;cursor:pointer">
          <span style="font-size:.7rem;letter-spacing:.06em;text-transform:uppercase;color:var(--text-dim)">${item.label}</span>
          <strong style="font-size:1.05rem;color:${item.tone}">${item.value}</strong>
          <span style="font-size:.74rem;color:var(--text-muted)">${item.hint}</span>
        </button>`).join('')}
    </div>`;
}

// 🏛️ ARQUITECTURA: Escuchar cambios globales
if (typeof VoltiumEvents !== 'undefined') {
    VoltiumEvents.on('state:changed', () => {
        debouncedRender('dashboard-state', () => {
          queueDashboardProgressiveRender('state');
        }, 140);
    });
}

// ============ DASHBOARD CHARTS + INTELIGENCIA ============

function renderSegmentChart() {
  const container = document.getElementById('segment-chart');
  if (!container) return;
  const summary = getDashboardAggregateSummary();
  const counts = {};
  Object.entries(summary.segmentStats).forEach(([segment, stats]) => {
    counts[segment] = stats.total;
  });
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  const max = sorted[0]?.[1] || 1;
  container.innerHTML = sorted.length
    ? sorted.map(([seg, cnt]) => `
        <div class="seg-row">
          <div class="seg-label">${seg}</div>
          <div class="seg-bar-wrap"><div class="seg-bar" style="width:${Math.round(cnt/max*100)}%;background:${SEGMENT_COLORS[seg]||'#7a8ba0'}"></div></div>
          <div class="seg-count" style="color:${SEGMENT_COLORS[seg]||'#7a8ba0'}">${cnt}</div>
        </div>`).join('')
    : '<p style="color:var(--text-muted);font-size:.83rem;margin-top:1rem">Sin datos aún</p>';
}

// ── NIVEL 1: Top leads por scoring dinámico con señales ──────────────────────
function renderTopLeads() {
  const container = document.getElementById('top-leads-list');
  if (!container) return;
  const measure = () => {
    const useCachedScores = window.GORDI_SAFE_MODE || leads.length > 500;
    const summary = getDashboardAggregateSummary();
    const candidates = summary.activeLeads.filter(l => l.status === 'Pendiente' || l.status === 'Contactado');
    const top = candidates
      .map(l => ({
        lead: l,
        score: useCachedScores ? Number(l.score || 0) : recalculateLeadScore(l)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    if (!top.length) {
      container.innerHTML = `
        <p style="color:var(--text-muted);font-size:.83rem;margin-top:.5rem">No hay leads pendientes con prioridad operativa ahora mismo.</p>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.8rem">
          <button class="btn-action" onclick="dashboardBridge('search')">Buscar nuevas empresas</button>
          <button class="btn-action" onclick="dashboardBridge('pipeline')">Revisar pipeline</button>
        </div>`;
      return;
    }

    container.innerHTML = top.map(entry => {
      const l = entry.lead;
      const score = entry.score;
      const bc = score >= 70 ? 'badge-high' : (score >= 40 ? 'badge-mid' : 'badge-low');
      const signals = [];
      if (l.rating && l.rating < 4.2) signals.push(`<span class="intel-tag warn">⭐ ${l.rating}</span>`);
      if (l.email) signals.push('<span class="intel-tag ok">✉️</span>');
      if (l.phone) signals.push('<span class="intel-tag ok">📞</span>');
      if (l.decision_maker && l.decision_maker !== 'Responsable') signals.push('<span class="intel-tag ok">👤</span>');
      const daysSince = l.date ? Math.floor((Date.now()-new Date(l.date))/(1000*86400)) : 0;
      if (daysSince > 7) signals.push(`<span class="intel-tag warn">${daysSince}d sin contacto</span>`);

      return `<div class="top-lead-item" onclick="openLeadDetail('${l.id}')">
        <div class="top-lead-avatar" style="background:${SEGMENT_COLORS[l.segment]||'#5E5CE6'}22;color:${SEGMENT_COLORS[l.segment]||'#5E5CE6'}">${(l.company||'?')[0].toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div class="top-lead-name">${l.company}</div>
          <div class="top-lead-co">${l.segment}${signals.length ? ' · '+signals.join('') : ''}</div>
        </div>
        <span class="score-badge ${bc}">${score}</span>
      </div>`;
    }).join('');
  };
  if (typeof window.gordiPerfMeasure === 'function') {
    window.gordiPerfMeasure('dashboard:top-leads', measure, { leads: leads.length, safeMode: !!window.GORDI_SAFE_MODE });
  } else {
    measure();
  }
}

// ── NIVEL 6: Métricas de conversión ──────────────────────────────────────────
function renderConversionMetrics() {
  const el = document.getElementById('conversion-metrics');
  if (!el) return;

  const summary = getDashboardAggregateSummary();
  const total = summary.activeCount;
  const contacted = summary.activeLeads.filter(l => ['Contactado','Respuesta del cliente','Visita','Entrega de presupuesto','Cerrado'].includes(l.status)).length;
  const responded = summary.activeLeads.filter(l => ['Respuesta del cliente','Visita','Entrega de presupuesto','Cerrado'].includes(l.status)).length;
  const closed = summary.activeLeads.filter(l => l.status === 'Cerrado').length;
  const convRate = contacted ? Math.min(Math.round(responded/contacted*100), 100) : 0;
  const closeRate = responded ? Math.round(closed/responded*100) : 0;
  const avgScore = total ? Math.round(leads.reduce((s,l)=>s+l.score,0)/total) : 0;

  // Tiempo medio de respuesta
  const sentLeads = summary.activeLeads.filter(l => l.status !== 'Pendiente' && l.date);
  const avgDays = sentLeads.length
    ? Math.round(sentLeads.reduce((s,l) => s + Math.floor((Date.now()-new Date(l.date))/(1000*86400)),0) / sentLeads.length)
    : 0;

  // MEJORA 1: Time-to-first-contact
  const ttfcLeads = summary.activeLeads.filter(l => l.ttfc_hours != null);
  const avgTtfc = ttfcLeads.length
    ? Math.round(ttfcLeads.reduce((s,l) => s + l.ttfc_hours, 0) / ttfcLeads.length)
    : null;
  const ttfcVal = avgTtfc != null ? (avgTtfc < 24 ? avgTtfc+'h' : Math.round(avgTtfc/24)+'d') : '—';
  const ttfcColor = avgTtfc == null ? 'var(--text-dim)' : avgTtfc <= 24 ? 'var(--success)' : avgTtfc <= 72 ? 'var(--warning)' : 'var(--danger)';

  const metrics = [
    { label:'Tasa de respuesta', value: convRate+'%', sub: `${responded} de ${contacted} contactados`, color: convRate>20?'var(--success)':convRate>10?'var(--warning)':'var(--danger)', icon:'📬' },
    { label:'Tasa de cierre', value: closeRate+'%', sub: `${closed} proyectos cerrados`, color: closeRate>30?'var(--success)':closeRate>10?'var(--warning)':'var(--danger)', icon:'🏆' },
    { label:'Score medio', value: avgScore, sub: 'de 100 puntos posibles', color: avgScore>60?'var(--success)':avgScore>40?'var(--warning)':'var(--danger)', icon:'⚡' },
    { label:'Días medio en pipeline', value: avgDays+'d', sub: 'desde creación del lead', color:'var(--primary)', icon:'⏱️' },
    { label:'Tiempo hasta 1er contacto', value: ttfcVal, sub: avgTtfc != null ? `${ttfcLeads.length} leads con dato · <24h = óptimo` : 'Sin emails enviados aún', color: ttfcColor, icon:'⚡' },
  ];

  el.innerHTML = metrics.map(m => `
    <div style="display:flex;align-items:center;gap:.75rem;padding:.6rem 0;border-bottom:1px solid var(--glass-border)">
      <span style="font-size:1.1rem">${m.icon}</span>
      <div style="flex:1">
        <div style="font-size:.75rem;color:var(--text-muted)">${m.label}</div>
        <div style="font-size:.7rem;color:var(--text-dim)">${m.sub}</div>
      </div>
      <div style="font-size:1.3rem;font-weight:700;color:${m.color}">${m.value}</div>
    </div>`).join('');

  if (!total) el.innerHTML = '<p style="color:var(--text-muted);font-size:.83rem">Sin datos todavía. Añade leads para ver métricas.</p>';
}

// ── NIVEL 6: Rendimiento por sector ──────────────────────────────────────────
function renderSectorPerformance() {
  const el = document.getElementById('sector-performance');
  const summary = getDashboardAggregateSummary();
  if (!el || !summary.activeCount) {
    if (el) el.innerHTML = '<p style="color:var(--text-muted);font-size:.83rem">Sin datos todavía.</p>';
    return;
  }

  const sorted = Object.entries(summary.segmentStats)
    .map(([seg, d]) => ({ seg, ...d, avgScore: Math.round(d.totalScore/d.total), convRate: d.contacted ? Math.round(d.responded/d.contacted*100) : 0 }))
    .sort((a,b) => b.convRate - a.convRate);

  el.innerHTML = sorted.map(s => `
    <div style="display:flex;align-items:center;gap:.6rem;padding:.4rem 0;border-bottom:1px solid var(--glass-border)">
      <div style="width:8px;height:8px;border-radius:50%;background:${SEGMENT_COLORS[s.seg]||'#7a8ba0'};flex-shrink:0"></div>
      <div style="flex:1;font-size:.78rem;color:var(--text-muted);min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.seg}</div>
      <div style="font-size:.72rem;color:var(--text-dim)">${s.total} leads</div>
      <div style="font-size:.82rem;font-weight:600;color:${s.convRate>20?'var(--success)':s.convRate>5?'var(--warning)':'var(--text-muted)'}">${s.convRate}%</div>
    </div>`).join('');
}

// ── NIVEL 4: Inteligencia competitiva local ───────────────────────────────────
function renderIntelPanel() {
  const el = document.getElementById('intel-content');
  if (!el) return;

  const withRating = leads.filter(l => l.rating);
  if (!withRating.length) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:.83rem">Busca empresas con el Buscador Inteligente para ver comparativas de zona.</p>';
    return;
  }

  // Agrupar por segmento y calcular medias
  const segStats = {};
  withRating.forEach(l => {
    if (!segStats[l.segment]) segStats[l.segment] = { ratings:[], count:0 };
    segStats[l.segment].ratings.push(l.rating);
    segStats[l.segment].count++;
  });

  // Oportunidades: empresas con rating por debajo de la media de su sector
  const opportunities = [];
  Object.entries(segStats).forEach(([seg, data]) => {
    const avg = data.ratings.reduce((s,r)=>s+r,0) / data.ratings.length;
    const avgR = Math.round(avg*10)/10;
    const belowAvg = leads.filter(l => l.segment === seg && l.rating && l.rating < avg && l.status === 'Pendiente');
    if (belowAvg.length > 0) {
      opportunities.push({ seg, avg: avgR, belowAvg, count: data.count });
    }
  });

  if (!opportunities.length) {
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:1rem">
        ${Object.entries(segStats).map(([seg,d]) => {
          const avg = Math.round(d.ratings.reduce((s,r)=>s+r,0)/d.ratings.length*10)/10;
          return `<div style="padding:.75rem;background:var(--glass);border-radius:8px;border:1px solid var(--glass-border)">
            <div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.25rem">${seg}</div>
            <div style="font-size:1.1rem;font-weight:700;color:var(--warning)">⭐ ${avg}</div>
            <div style="font-size:.7rem;color:var(--text-dim)">${d.count} empresas analizadas</div>
          </div>`;
        }).join('')}
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="margin-bottom:1rem;font-size:.82rem;color:var(--text-muted)">
      Empresas con rating <strong style="color:var(--warning)">por debajo de la media</strong> de su sector — <strong style="color:var(--primary)">oportunidad de reforma alta</strong>
    </div>
    <div style="display:grid;gap:.5rem">
      ${opportunities.flatMap(o => o.belowAvg.slice(0,3).map(l => `
        <div class="intel-row" onclick="openLeadDetail('${l.id}')">
          <div style="display:flex;align-items:center;gap:.6rem;flex:1">
            <span style="font-size:.9rem">⭐</span>
            <div>
              <div style="font-size:.82rem;font-weight:600">${l.company}</div>
              <div style="font-size:.7rem;color:var(--text-muted)">${l.segment} · Rating ${l.rating} vs media ${o.avg} del sector</div>
            </div>
          </div>
          <span class="intel-tag warn">-${Math.round((o.avg-l.rating)*10)/10} pts bajo media</span>
        </div>`)).join('')}
    </div>`;
}

// ── NIVEL 1: Alerta inteligente de prioridades ────────────────────────────────
function renderSmartAlert() {
  const el = document.getElementById('smart-alert');
  if (!el) return;

  const urgent = leads.filter(l => l.score >= 75 && l.status === 'Pendiente');
  const overdue = leads.filter(l => {
    if (!l.date || l.status !== 'Contactado') return false;
    return Math.floor((Date.now()-new Date(l.date))/(1000*86400)) > 5;
  });

  let html = renderPriorityControlCenter();
  if (urgent.length > 0) {
    html += `<div class="smart-alert-box alert-urgent">
      <span style="font-size:1.1rem">🔥</span>
      <div>
        <strong>${urgent.length} lead${urgent.length>1?'s':''} de alta prioridad</strong> esperando contacto — score ≥75
        <div style="font-size:.75rem;margin-top:.2rem;opacity:.8">${urgent.slice(0,3).map(l=>l.company).join(', ')}${urgent.length>3?' y '+(urgent.length-3)+' más':''}</div>
      </div>
      <button class="btn-action" onclick="dashboardBridge('urgent')" style="margin-left:auto;white-space:nowrap">Ver -></button>
    </div>`;
  }
  if (overdue.length > 0) {
    html += `<div class="smart-alert-box alert-warn" style="margin-top:.5rem">
      <span style="font-size:1.1rem">⏰</span>
      <div>
        <strong>${overdue.length} lead${overdue.length>1?'s':''}</strong> contactados hace más de 5 días sin respuesta registrada
        <div style="font-size:.75rem;margin-top:.2rem;opacity:.8">${overdue.slice(0,3).map(l=>l.company).join(', ')}</div>
      </div>
      <button class="btn-action" onclick="dashboardBridge('pipeline')" style="margin-left:auto;white-space:nowrap">Pipeline -></button>
    </div>`;
  }

  // MEJORA 1: Alerta leads calientes sin contactar >48h
  const hotUncontacted = leads.filter(l =>
    l.score >= 70 &&
    l.status === 'Pendiente' &&
    !l.first_contact_date &&
    (Date.now() - new Date(l.date)) > 48 * 3600000
  );
  if (hotUncontacted.length > 0) {
    html += `<div class="smart-alert-box alert-urgent" style="margin-top:.5rem;border-color:rgba(239,68,68,.4)">
      <span style="font-size:1.1rem">⚡</span>
      <div>
        <strong>${hotUncontacted.length} lead${hotUncontacted.length>1?'s':''} caliente${hotUncontacted.length>1?'s':''} sin contactar</strong> — llevan más de 48h esperando
        <div style="font-size:.75rem;margin-top:.2rem;opacity:.8">${hotUncontacted.slice(0,3).map(l=>`${l.company} (${l.score}pts)`).join(', ')}${hotUncontacted.length>3?' y '+(hotUncontacted.length-3)+' más':''}</div>
      </div>
      <button class="btn-action" onclick="dashboardBridge('urgent')" style="margin-left:auto;white-space:nowrap">Contactar -></button>
    </div>`;
  }

  el.style.display = html ? 'block' : 'none';
  el.innerHTML = html;
}

function renderRecentActivity() {
  const container = document.getElementById('recent-activity');
  if (!container) return;
  const recent = emailHistory.slice(0, 8);
  container.innerHTML = recent.length
    ? recent.map(e => `
        <div class="activity-item">
          <div class="activity-dot"></div>
          <div>
            <div class="activity-text">Email enviado a <strong>${e.company}</strong> — ${e.email}</div>
            <div class="activity-time">${new Date(e.date).toLocaleDateString('es-ES', {day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
          </div>
        </div>`).join('') + `
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.85rem">
          <button class="btn-action" onclick="dashboardBridge('tracking')">Abrir seguimiento</button>
          <button class="btn-action" onclick="dashboardBridge('pending')">Pendientes</button>
          ${(Array.isArray(window.tempSearchResults) && window.tempSearchResults.length) ? '<button class="btn-action" onclick="dashboardBridge(\'results\')">Volver a resultados</button>' : ''}
        </div>`
    : `<p style="color:var(--text-muted);font-size:.83rem">Sin actividad reciente</p>
       <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.85rem">
         <button class="btn-action" onclick="dashboardBridge('search')">Lanzar búsqueda</button>
         <button class="btn-action" onclick="dashboardBridge('pipeline')">Revisar pipeline</button>
       </div>`;
}

// ============ KANBAN ============
function renderKanban() {
  const maxCardsPerColumn = 80;
  const cols = ['Pendiente','Contactado','Respuesta del cliente','Visita','Entrega de presupuesto','Cerrado'];
  cols.forEach(status => {
    const container = document.getElementById(`cards-${status}`);
    const counter = document.getElementById(`cnt-${status}`);
    if (!container) return;
    const kSearch   = (document.getElementById('kanban-search')?.value || '').toLowerCase();
    const kSeg      = document.getElementById('kanban-filter-seg')?.value || '';
    const kScore    = parseInt(document.getElementById('kanban-filter-score')?.value || '0') || 0;
    const kSort     = document.getElementById('kanban-sort')?.value || 'score';
    const kOverdue  = document.getElementById('kanban-filter-overdue')?.checked || false;
    const kToday    = new Date(); kToday.setHours(0,0,0,0);

    let items = leads.filter(l => {
      if (l.status !== status || l.archived) return false;
      if (kSearch) {
        const hay = [l.name, l.company, l.email, l.segment, l.notes].join(' ').toLowerCase();
        if (!hay.includes(kSearch)) return false;
      }
      if (kSeg && l.segment !== kSeg) return false;
      if (kScore && (l.score||0) < kScore) return false;
      if (kOverdue) {
        if (!l.next_contact) return false;
        if (new Date(l.next_contact) >= kToday) return false;
      }
      return true;
    });

    items.sort((a,b) => {
      if (kSort === 'score') return (b.score||0) - (a.score||0);
      if (kSort === 'company') return (a.company||'').localeCompare(b.company||'');
      if (kSort === 'days') {
        const dA = a.status_date ? Math.floor((Date.now()-new Date(a.status_date))/86400000) : 0;
        const dB = b.status_date ? Math.floor((Date.now()-new Date(b.status_date))/86400000) : 0;
        return dB - dA;
      }
      if (kSort === 'next_contact') {
        if (!a.next_contact && !b.next_contact) return 0;
        if (!a.next_contact) return 1; if (!b.next_contact) return -1;
        return new Date(a.next_contact) - new Date(b.next_contact);
      }
      if (kSort === 'budget') return (b.budget||0) - (a.budget||0);
      return 0;
    });
    if (counter) counter.innerText = items.length;
    // MEJORA 3: Pipeline value per column
    const colValue = items.reduce((s, l) => s + (l.budget || 0), 0);
    const valEl = document.getElementById(`val-${status}`);
    if (valEl) {
      if (colValue > 0) {
        valEl.textContent = colValue >= 1000000 ? (colValue/1000000).toFixed(1)+'M€'
          : colValue >= 1000 ? Math.round(colValue/1000)+'k€' : colValue+'€';
        valEl.style.display = 'inline';
      } else { valEl.style.display = 'none'; }
    }

    const today = new Date(); today.setHours(0,0,0,0);

    const visibleItems = items.slice(0, maxCardsPerColumn);
    container.innerHTML = items.length
      ? visibleItems.map(l => {
          const daysInStatus = l.status_date ? Math.floor((Date.now() - new Date(l.status_date)) / 86400000) : 0;
          const daysBadge = daysInStatus >= 7 ? `<span style="font-size:.6rem;background:rgba(239,68,68,.2);color:#ef4444;padding:1px 5px;border-radius:4px;margin-left:3px">${daysInStatus}d</span>` :
                            daysInStatus >= 3 ? `<span style="font-size:.6rem;background:rgba(245,158,11,.15);color:#f59e0b;padding:1px 5px;border-radius:4px;margin-left:3px">${daysInStatus}d</span>` : '';

          let nextBadge = '';
          if (l.next_contact) {
            const nc = new Date(l.next_contact); nc.setHours(0,0,0,0);
            const diff = Math.floor((nc - today) / 86400000);
            if (diff === 0) nextBadge = '<div style="font-size:.62rem;color:var(--warning);margin-top:2px">📅 Seguimiento hoy</div>';
            else if (diff < 0) nextBadge = '<div style="font-size:.62rem;color:var(--danger);margin-top:2px">⚠️ Seguimiento vencido</div>';
            else if (diff <= 2) nextBadge = `<div style="font-size:.62rem;color:var(--primary);margin-top:2px">📅 ${diff}d para seguimiento</div>`;
          }

          const tagsHtml = (l.tags||[]).slice(0,1).map(t => `<span style="font-size:.6rem;background:rgba(94,92,230,.15);color:#a78bfc;padding:1px 5px;border-radius:8px">${t}</span>`).join('');
          const budgetHtml = l.budget ? `<div style="font-size:.62rem;color:var(--success);margin-top:2px">💰 ${l.budget.toLocaleString('es-ES')}€</div>` : '';

          return `<div class="kanban-card" draggable="true" ondragstart="dragStart(event,'${l.id}')" onclick="openLeadDetail('${l.id}')" oncontextmenu="event.preventDefault();openCtxMenu(event,'${l.id}','kanban')">
            <button class="kanban-quick-note-btn ${l.notes?'has-note':''}" onclick="openQuickNote(event,'${l.id}')" title="${l.notes?'Ver/editar nota':'Añadir nota rápida'}">📝</button>
            <div class="kanban-card-name">${l.name}</div>
            <div class="kanban-card-co">${l.company}</div>
            ${nextBadge}
            ${l.notes ? `<div style="font-size:.62rem;color:var(--text-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">📝 ${l.notes.slice(0,45)}${l.notes.length>45?'…':''}</div>` : ''}
            ${l.email ? `<div style="display:flex;align-items:center;gap:3px;margin-top:3px"><span style="font-size:.62rem;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">✉️ ${l.email}</span><button onclick="event.stopPropagation(); copyToClipboard('${l.email}', 'Email: ${l.email}')" title="Copiar email" style="background:none;border:none;cursor:pointer;color:var(--text-dim);padding:0 2px;font-size:.72rem;line-height:1;flex-shrink:0;transition:color .15s" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='var(--text-dim)'">⧉</button></div>` : ''}
            ${budgetHtml}
            <div class="kanban-card-foot">
              <span class="kanban-seg">${l.segment}</span>
              <div style="display:flex;align-items:center;gap:2px">
                ${tagsHtml}
                <span class="score-badge ${l.score>=70?'badge-high':l.score>=40?'badge-mid':'badge-low'}" style="font-size:.68rem">${l.score}</span>
                ${daysBadge}
              </div>
            </div>
          </div>`;
        }).join('') + (items.length > visibleItems.length
          ? `<div style="text-align:center;padding:.8rem;color:var(--text-dim);font-size:.72rem">+${items.length - visibleItems.length} leads mas. Usa filtros para afinar.</div>`
          : '')
      : `<div style="text-align:center;padding:1.5rem;color:var(--text-dim);font-size:.78rem">Arrastra aquí</div>`;
  });

  // Update kanban filter count
  const kCountEl = document.getElementById('kanban-filter-count');
  if (kCountEl) {
    const total = leads.filter(l => !l.archived).length;
    const kSearch = (document.getElementById('kanban-search')?.value || '');
    const kSeg = document.getElementById('kanban-filter-seg')?.value || '';
    const kScore = document.getElementById('kanban-filter-score')?.value || '';
    const kOverdue = document.getElementById('kanban-filter-overdue')?.checked || false;
    const activeK = [kSearch, kSeg, kScore, kOverdue ? '1' : ''].filter(Boolean).length;
    // Contar items reales mostrados sumando las columnas ya renderizadas
    const shownCount = document.querySelectorAll('#kanban-board .kanban-card').length;
    kCountEl.textContent = activeK
      ? `${shownCount} de ${total} · ${activeK} filtro${activeK>1?'s':''} activo${activeK>1?'s':''}`
      : '';
  }
}

function resetKanbanFilters() {
  ['kanban-search','kanban-filter-seg','kanban-filter-score','kanban-sort'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id === 'kanban-sort' ? 'score' : '';
  });
  const ov = document.getElementById('kanban-filter-overdue');
  if (ov) ov.checked = false;
  renderKanban();
}

let draggedId = null;
function dragStart(e, id) { draggedId = id; e.target.classList.add('dragging'); }
function dropLead(e, newStatus) {
  e.preventDefault();
  if (!draggedId) return;
  const lead = leads.find(l => l.id == draggedId);
  if (lead) {
    const oldStatus = lead.status;
    if (oldStatus === newStatus) {
      document.querySelectorAll('.kanban-card.dragging').forEach(c => c.classList.remove('dragging'));
      draggedId = null;
      return;
    }
    confirmStatusChange(lead, newStatus, () => {
      lead.status = newStatus;
      lead.status_date = new Date().toISOString();
      addActivityLog(lead.id, `Pipeline: ${oldStatus} -> ${newStatus}`);
      applySequenceRule(lead, newStatus);
      saveLeads();
      renderKanban();
      renderLeads();
      updateStats();
    });
  }
  document.querySelectorAll('.kanban-card.dragging').forEach(c => c.classList.remove('dragging'));
  draggedId = null;
}

// ============ TRACKING ============
function renderTracking() {
  const tbody = document.getElementById('tracking-body');
  const empty = document.getElementById('tracking-empty');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!emailHistory.length) { if (empty) empty.style.display = 'flex'; return; }
  if (empty) empty.style.display = 'none';

  const tSearch  = (document.getElementById('tracking-search')?.value || '').toLowerCase();
  const tSeg     = document.getElementById('tracking-filter-seg')?.value || '';
  const tChannel = document.getElementById('tracking-filter-channel')?.value || '';
  const tDate    = document.getElementById('tracking-filter-date')?.value || '';
  const tSort    = document.getElementById('tracking-sort')?.value || 'date_desc';

  const today = new Date(); today.setHours(0,0,0,0);
  const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay() + 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const threeMonthsAgo = new Date(today); threeMonthsAgo.setMonth(today.getMonth() - 3);

  let list = emailHistory.filter(e => {
    if (tSearch) {
      const hay = [e.company, e.email, e.subject, e.segment, e.notes, e.channel].join(' ').toLowerCase();
      if (!hay.includes(tSearch)) return false;
    }
    if (tSeg && e.segment !== tSeg) return false;
    if (tChannel && (e.channel || 'email') !== tChannel) return false;
    if (tDate && e.date) {
      const d = new Date(e.date); d.setHours(0,0,0,0);
      if (tDate === 'today' && d.getTime() !== today.getTime()) return false;
      if (tDate === 'week' && d < weekStart) return false;
      if (tDate === 'month' && d < monthStart) return false;
      if (tDate === '3months' && d < threeMonthsAgo) return false;
    }
    return true;
  });

  list.sort((a,b) => {
    if (tSort === 'date_desc') return new Date(b.date||0) - new Date(a.date||0);
    if (tSort === 'date_asc')  return new Date(a.date||0) - new Date(b.date||0);
    if (tSort === 'company')   return (a.company||'').localeCompare(b.company||'');
    if (tSort === 'segment')   return (a.segment||'').localeCompare(b.segment||'');
    return 0;
  });

  // Update count
  const cntEl = document.getElementById('tracking-filter-count');
  if (cntEl) {
    const active = [tSearch,tSeg,tChannel,tDate].filter(Boolean).length;
    cntEl.textContent = `${list.length} de ${emailHistory.length} registros` +
      (active ? ` · ${active} filtro${active>1?'s':''}` : '');
  }

  if (!list.length) { if (empty) empty.style.display = 'flex'; return; }

  list.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-size:.78rem">${new Date(e.date).toLocaleDateString('es-ES',{day:'2-digit',month:'short',year:'numeric'})}</td>
      <td><div class="lead-name">${e.company}</div></td>
      <td style="color:var(--primary);font-size:.82rem"><span style="display:inline-flex;align-items:center;gap:.35rem">${e.email}<button onclick="event.stopPropagation(); copyToClipboard('${e.email}', 'Email: ${e.email}')" title="Copiar email" style="background:none;border:none;cursor:pointer;color:var(--text-dim);padding:1px 4px;font-size:.75rem;line-height:1;transition:color .15s" onmouseover="this.style.color='var(--primary)'" onmouseout="this.style.color='var(--text-dim)'">⧉</button></span></td>
      <td><span style="font-size:.75rem;background:var(--glass);padding:2px 8px;border-radius:5px;color:var(--text-muted)">${e.segment}</span></td>
      <td><span style="color:var(--success);font-size:.78rem">✅ ${e.status}</span></td>
      <td style="font-size:.78rem;color:var(--text-muted)">${e.notes||'—'}</td>`;
    tbody.appendChild(tr);
  });
}

function resetTrackingFilters() {
  ['tracking-search','tracking-filter-seg','tracking-filter-channel','tracking-filter-date','tracking-sort'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id === 'tracking-sort' ? 'date_desc' : '';
  });
  renderTracking();
}

function exportTracking() {
  if (!emailHistory.length) { alert('No hay historial.'); return; }
  let csv = 'Fecha,Empresa,Email,Sector,Estado\n';
  emailHistory.forEach(e => { csv += `"${new Date(e.date).toLocaleDateString('es-ES')}","${e.company}","${e.email}","${e.segment}","${e.status}"\n`; });
  downloadCSV(csv, 'historial_gordi.csv');
}

// ============ TEMPLATES ============
function renderTemplateList() {
  const ul = document.getElementById('template-list');
  if (!ul) return;
  const keys = Object.keys(emailTemplates).filter(k => k !== 'Default');
  keys.push('Default');
  ul.innerHTML = keys.map(k => `<li onclick="loadTemplate('${k}')">${k}</li>`).join('');
}

function loadTemplate(key) {
  const t = emailTemplates[key];
  if (!t) return;
  document.getElementById('tpl-subject-a').value = t.subjectA || t.subject || '';
  document.getElementById('tpl-subject-b').value = t.subjectB || '';
  document.getElementById('tpl-body').value = t.body || '';
  document.getElementById('tpl-current-key').value = key;
  document.getElementById('template-edit-title').innerText = `Editando: ${key}`;
  document.querySelectorAll('.template-list li').forEach(li => li.classList.toggle('active', li.textContent === key));
  document.getElementById('template-preview-box').style.display = 'none';
}

function saveTemplate() {
  const key = document.getElementById('tpl-current-key').value;
  if (!key) { alert('Selecciona un segmento primero.'); return; }
  emailTemplates[key] = {
    subjectA: document.getElementById('tpl-subject-a').value,
    subjectB: document.getElementById('tpl-subject-b').value,
    body: document.getElementById('tpl-body').value
  };
  const saved = {};
  Object.entries(emailTemplates).forEach(([k,v]) => { if (JSON.stringify(v) !== JSON.stringify(defaultTemplates[k])) saved[k] = v; });
  localStorage.setItem('gordi_templates', JSON.stringify(emailTemplates));
  if (localStorage.getItem('gordi_jsonbin_auto') === 'true') {
    if (typeof jsonbinPush === 'function') jsonbinPush(false);
  }
  showToast('Plantilla guardada ✓');
}

function previewTemplate() {
  const body = document.getElementById('tpl-body').value;
  const subject = document.getElementById('tpl-subject-a').value;
  const firma = buildFirmaText();
  const saludo = buildSaludo('Carlos García', 'Empresa Ejemplo S.L.');
  const preview = body
    .replace(/{{SALUDO}}/g, saludo)
    .replace(/{{Name}}/g, 'Carlos García')
    .replace(/{{Company}}/g, 'Empresa Ejemplo S.L.')
    .replace(/{{Sector}}/g, 'Hoteles')
    .replace(/{{Ciudad}}/g, 'Madrid')
    .replace(/{{Rating}}/g, '3.8')
    .replace(/{{Signal}}/g, 'están buscando actualizar sus instalaciones')
    .replace(/{{Señal}}/g, 'están buscando actualizar sus instalaciones')
    .replace(/{{FIRMA}}/g, firma);
  const subjectPreview = subject
    .replace(/{{Company}}/g, 'Empresa Ejemplo S.L.')
    .replace(/{{Name}}/g, 'Carlos García')
    .replace(/{{Sector}}/g, 'Hoteles');
  const box = document.getElementById('template-preview-box');
  document.getElementById('template-preview-content').innerHTML =
    `<div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.5rem">📌 <strong>Asunto:</strong> ${subjectPreview}</div>` +
    `<pre style="white-space:pre-wrap;font-family:inherit;font-size:.82rem">${preview}</pre>` +
    `<div style="font-size:.68rem;color:var(--text-dim);margin-top:.75rem">Variables disponibles: {{SALUDO}} {{Company}} {{Name}} {{Sector}} {{Signal}} {{Ciudad}} {{Rating}} {{FIRMA}}</div>`;
  box.style.display = 'block';
}

// ============ IMPORTACIÓN CSV ============
function switchImportTab(tab, btn) {
  document.querySelectorAll('.import-tab-content').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.import-tab').forEach(el => el.classList.remove('active'));
  document.getElementById(`import-${tab}-tab`).style.display = 'block';
  btn.classList.add('active');
}

// Importación CSV/Excel — gestionada íntegramente por modules/smart-import.js
// (handleFileSelect, handleDrop, handleDragOver, processFile, parseAndPreviewImport,
//  processBulkImport, importSelectedLeads, clearImportArea, toggleAllImport,
//  updateImportEmail, autoDetectSegment)
// NO redeclarar aquí para evitar conflictos de source ('import' vs 'propio')
// y de atributos data-index vs data-idx en los checkboxes de previsualización.

// ============ CAMPAÑAS ============
function openCampaignModal() { document.getElementById('campaign-modal').style.display = 'flex'; }
function closeCampaignModal() { document.getElementById('campaign-modal').style.display = 'none'; }

function saveCampaign() {
  const name = document.getElementById('camp-name').value.trim();
  if (!name) { alert('Ponle nombre a la campaña.'); return; }
  const seg = document.getElementById('camp-segment').value;
  const seq = document.getElementById('camp-sequence').value;
  const desc = document.getElementById('camp-desc').value.trim();
  const filtered = seg === 'Todos' ? leads : leads.filter(l => l.segment === seg);
  campaigns.push({ id: Date.now(), name, segment: seg, sequence: seq, desc, leadCount: filtered.length, sent: 0, date: new Date().toISOString(), active: true });
  localStorage.setItem('gordi_campaigns', JSON.stringify(campaigns));
  if (localStorage.getItem('gordi_jsonbin_auto') === 'true') {
    if (typeof jsonbinPush === 'function') jsonbinPush(false);
  }
  closeCampaignModal();
  renderCampaigns();
  showToast('Campaña creada ✓');
}

function getCampaignLeadList(c) {
  if (Array.isArray(c.leadIds) && c.leadIds.length) {
    const ids = new Set(c.leadIds.map(String));
    return leads.filter(l => ids.has(String(l.id)));
  }
  return c.segment === 'Todos' ? leads : leads.filter(l => l.segment === c.segment);
}

function getCampaignSentCount(c) {
  const campLeads = getCampaignLeadList(c);
  if (Array.isArray(c.leadIds) && c.leadIds.length) {
    const ids = new Set(c.leadIds.map(String));
    const emails = new Set(campLeads.map(l => l.email).filter(Boolean));
    return emailHistory.filter(e => ids.has(String(e.leadId)) || emails.has(e.email)).length;
  }
  return emailHistory.filter(e => c.segment === 'Todos' || e.segment === c.segment).length;
}

function renderCampaigns() {
  const container = document.getElementById('campaigns-list');
  const empty = document.getElementById('campaigns-empty');
  if (!container) return;
  if (!campaigns.length) { empty.style.display = 'flex'; container.style.display = 'none'; return; }

  const cSearch = (document.getElementById('campaigns-search')?.value || '').toLowerCase();
  const cSeg    = document.getElementById('campaigns-filter-seg')?.value || '';
  const cSort   = document.getElementById('campaigns-sort')?.value || 'date_desc';
  const cStatus = document.getElementById('campaigns-filter-status')?.value || '';

  let list = campaigns.filter(c => {
    if (cSearch && !c.name.toLowerCase().includes(cSearch) && !(c.desc||'').toLowerCase().includes(cSearch)) return false;
    if (cSeg && c.segment !== cSeg) return false;
    if (cStatus) {
      const sent = getCampaignSentCount(c);
      const total = getCampaignLeadList(c).length;
      const pct = total ? Math.min(Math.round(sent/total*100), 100) : 0;
      if (cStatus === 'active' && sent === 0) return false;
      if (cStatus === 'empty' && sent > 0) return false;
      if (cStatus === 'complete' && pct < 100) return false;
    }
    return true;
  });

  list.sort((a,b) => {
    if (cSort === 'date_desc') return (b.id||0) - (a.id||0);
    if (cSort === 'name') return a.name.localeCompare(b.name);
    if (cSort === 'progress_desc') {
      const sentA = getCampaignSentCount(a);
      const sentB = getCampaignSentCount(b);
      const totA  = getCampaignLeadList(a).length;
      const totB  = getCampaignLeadList(b).length;
      return (totB ? sentB/totB : 0) - (totA ? sentA/totA : 0);
    }
    if (cSort === 'leads_desc') {
      const tA = getCampaignLeadList(a).length;
      const tB = getCampaignLeadList(b).length;
      return tB - tA;
    }
    return 0;
  });

  const cntEl = document.getElementById('campaigns-filter-count');
  if (cntEl) {
    const active = [cSearch,cSeg,cStatus].filter(Boolean).length;
    cntEl.textContent = `${list.length} de ${campaigns.length}` + (active ? ` · ${active} filtro${active>1?'s':''}` : '');
  }

  if (!list.length) { empty.style.display = 'flex'; container.style.display = 'none'; return; }
  empty.style.display = 'none';
  container.style.display = 'grid';
  container.innerHTML = list.map(c => {
    // Calculate real sent from emailHistory matching segment
    const realSent = getCampaignSentCount(c);
    const totalLeads = getCampaignLeadList(c).length;
    const pct = totalLeads ? Math.min(Math.round(realSent/totalLeads*100), 100) : 0;
    return `
      <div class="campaign-card">
        <div class="camp-header">
          <div class="camp-name">${c.name}</div>
          <span class="camp-seg">${c.segment}</span>
        </div>
        <div class="camp-stats">
          <div class="camp-stat"><div class="camp-stat-val">${totalLeads}</div><div class="camp-stat-lbl">Leads</div></div>
          <div class="camp-stat"><div class="camp-stat-val">${realSent}</div><div class="camp-stat-lbl">Enviados</div></div>
          <div class="camp-stat"><div class="camp-stat-val">${pct}%</div><div class="camp-stat-lbl">Progreso</div></div>
        </div>
        <div class="camp-progress"><div class="camp-progress-fill" style="width:${pct}%"></div></div>
        <div class="camp-real-progress">📊 Progreso real basado en historial de emails</div>
        <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.75rem">${c.desc||'Sin descripción'}</div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <span style="font-size:.72rem;background:var(--glass);padding:2px 8px;border-radius:5px;color:var(--text-muted)">${c.sequence === 'cold' ? '📧 Cold Outbound' : '📩 Inbound Nurturing'}</span>
          <button class="btn-action" onclick="duplicateCampaign(${c.id})" title="Duplicar campaña">⎘</button>
          <button class="btn-action" onclick="openCampaignLeads(${c.id})">Ver leads -></button>
          <button class="btn-action danger" onclick="deleteCampaign(${c.id})" style="margin-left:auto">Eliminar</button>
        </div>
      </div>`;
  }).join('');
}

function resetCampaignsFilters() {
  ['campaigns-search','campaigns-filter-seg','campaigns-sort','campaigns-filter-status'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id === 'campaigns-sort' ? 'date_desc' : '';
  });
  renderCampaigns();
}

function openCampaignLeads(id) {
  const c = campaigns.find(x => x.id === id);
  if (!c) return;
  showView('leads');
  const searchEl = document.getElementById('lead-search');
  const segEl = document.getElementById('filter-segment');
  if (Array.isArray(c.leadIds) && c.leadIds.length) {
    if (searchEl) searchEl.value = c.name;
    if (segEl) segEl.value = '';
  } else {
    if (searchEl) searchEl.value = '';
    if (segEl) segEl.value = c.segment === 'Todos' ? '' : c.segment;
  }
  renderLeads();
}

function deleteCampaign(id) {
  const c = campaigns.find(x => x.id === id);
  if (!c) return;
  const seg = c.segment === 'Todos' ? leads.length : leads.filter(l => l.segment === c.segment).length;
  const sent = emailHistory.filter(e => c.segment === 'Todos' || e.segment === c.segment).length;
  const summary = `Campaña: ${c.name}\nLeads: ${seg} · Emails enviados: ${sent}`;
  if (!confirm('¿Eliminar esta campaña?\n\n' + summary)) return;
  campaigns = campaigns.filter(x => x.id !== id);
  localStorage.setItem('gordi_campaigns', JSON.stringify(campaigns));
  renderCampaigns();
}

function duplicateCampaign(id) {
  const c = campaigns.find(x => x.id === id);
  if (!c) return;
  const copy = { ...c, id: Date.now(), name: c.name + ' (copia)', date: new Date().toISOString() };
  campaigns.push(copy);
  localStorage.setItem('gordi_campaigns', JSON.stringify(campaigns));
  renderCampaigns();
  showToast('Campaña duplicada ✓');
}

// ============ EXPORT ============
function exportData() {
  if (!leads.length) { alert('No hay leads para exportar.'); return; }
  let csv = 'Nombre,Empresa,Email,Teléfono,Segmento,Señal,Score,Estado,Web\n';
  leads.forEach(l => { csv += `"${l.name}","${l.company}","${l.email||''}","${l.phone||''}","${l.segment}","${(l.signal||'').replace(/"/g,"'")}",${l.score},"${l.status}","${l.website||''}"\n`; });
  downloadCSV(csv, 'leads_gordi.csv');
}

function downloadCSV(content, filename) {
  const blob = new Blob(['\uFEFF'+content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function clearAllLeads() {
  if (!confirm('⚠️ ¿Borrar TODOS los leads? Esta acción no se puede deshacer.')) return;
  if (typeof createSafetySnapshot === 'function') createSafetySnapshot('before_clear_all_leads');
  if (typeof createCriticalRescueSnapshot === 'function') createCriticalRescueSnapshot('before_clear_all_leads');
  if (typeof markIntentionalEmptyLeads === 'function') markIntentionalEmptyLeads();
  leads = [];
  saveLeads();
  if (typeof markDashboardAggregatesDirty === 'function') markDashboardAggregatesDirty('clear-all-leads');
  if (typeof refreshDataDependentViews === 'function') refreshDataDependentViews({ reason: 'clear-all-leads' });
  else {
    renderAll();
    renderDashboardCharts();
  }
  showToast('Todos los leads eliminados');
}

