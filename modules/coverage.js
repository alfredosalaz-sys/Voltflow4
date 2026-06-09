const COVERAGE_KEY = 'gordi_search_coverage';
const COVERAGE_TARGETS_KEY = 'gordi_coverage_targets';
const COVERAGE_PLAN_KEY = 'gordi_coverage_daily_plan';
const COVERAGE_FILTER_KEY = 'gordi_coverage_filter';
const COVERAGE_EVENTS_KEY = 'gordi_coverage_events';
const COVERAGE_VIEW_KEY = 'gordi_coverage_view_mode';
const COVERAGE_MISSION_KEY = 'gordi_coverage_active_mission';
const COVERAGE_LEAD_FILTER_KEY = 'gordi_coverage_lead_filter';
const COVERAGE_STALE_DAYS = 30;
const COVERAGE_REPEAT_WARN_DAYS = 7;

let coverageSearchTerm = '';
let coverageSmartFilter = coverageSafeJson(COVERAGE_FILTER_KEY, 'all');
let coverageViewMode = coverageSafeJson(COVERAGE_VIEW_KEY, 'cp');
let coverageBypassRepeatWarning = false;
let _coverageLeadIndexCache = null;

function coverageSafeJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function coverageSaveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function normalizeCoverageLocation(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function coverageEscapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function coverageKey(location, sector) {
  return `${normalizeCoverageLocation(location).toLowerCase()}::${String(sector || '').trim()}`;
}

function getCoverageSectorLabel(sector) {
  if (typeof getSegmentLabel === 'function') return getSegmentLabel(sector);
  return sector || 'Sector';
}

function getCoverageSectorIcon(sector) {
  if (typeof SEGMENT_ICONS !== 'undefined' && SEGMENT_ICONS[sector]) return SEGMENT_ICONS[sector];
  const map = { Multi: 'M', 'Multi-sector': 'M', Todos: '*' };
  return map[sector] || '*';
}

function getCoverageTargets() {
  return coverageSafeJson(COVERAGE_TARGETS_KEY, { locations: [], sectors: [] });
}

function saveCoverageTargets(targets) {
  const clean = {
    locations: [...new Set((targets.locations || []).map(normalizeCoverageLocation).filter(Boolean))],
    sectors: [...new Set((targets.sectors || []).filter(Boolean))],
  };
  coverageSaveJson(COVERAGE_TARGETS_KEY, clean);
  return clean;
}

function getCoverageRawEntries() {
  return coverageSafeJson(COVERAGE_KEY, []);
}

function saveCoverageRawEntries(entries) {
  coverageSaveJson(COVERAGE_KEY, entries.slice(-500));
}

function getCoverageEvents() {
  return coverageSafeJson(COVERAGE_EVENTS_KEY, []);
}

function saveCoverageEvents(events) {
  coverageSaveJson(COVERAGE_EVENTS_KEY, events.slice(-300));
}

function appendCoverageEvent(event) {
  const events = getCoverageEvents();
  events.push({
    id: `cov_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString(),
    ...event,
  });
  saveCoverageEvents(events);
}

function getCoverageActiveMission() {
  return coverageSafeJson(COVERAGE_MISSION_KEY, null);
}

function saveCoverageActiveMission(mission) {
  if (!mission) {
    try { localStorage.removeItem(COVERAGE_MISSION_KEY); } catch {}
    renderCoverageFlowBar();
    return null;
  }
  const clean = {
    id: mission.id || `mission_${Date.now()}`,
    location: normalizeCoverageLocation(mission.location),
    sector: mission.sector || '',
    sectors: Array.isArray(mission.sectors) && mission.sectors.length ? mission.sectors : [mission.sector].filter(Boolean),
    label: mission.label || `${normalizeCoverageLocation(mission.location)} · ${getCoverageSectorLabel(mission.sector || mission.sectors?.[0] || 'Multi-sector')}`,
    status: mission.status || 'coverage',
    createdAt: mission.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    searchedCount: mission.searchedCount || 0,
    readyCount: mission.readyCount || 0,
    selectedCount: mission.selectedCount || 0,
    importedCount: mission.importedCount || 0,
    duplicateCount: mission.duplicateCount || 0,
    resultSearchId: mission.resultSearchId || null,
    searchMode: mission.searchMode || ((mission.sectors || []).length > 1 ? 'multi' : 'single'),
    lastAction: mission.lastAction || '',
  };
  coverageSaveJson(COVERAGE_MISSION_KEY, clean);
  renderCoverageFlowBar();
  return clean;
}

function startCoverageMission(location, sector, extra = {}) {
  const loc = normalizeCoverageLocation(location);
  const sectors = Array.isArray(extra.sectors) && extra.sectors.length ? extra.sectors : [sector].filter(Boolean);
  const primary = sector || sectors[0] || 'Multi-sector';
  return saveCoverageActiveMission({
    id: extra.id || `mission_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    location: loc,
    sector: primary,
    sectors,
    label: extra.label || `${loc} · ${getCoverageSectorLabel(primary)}`,
    status: extra.status || 'coverage',
    ...extra,
  });
}

function clearCoverageMission() {
  saveCoverageActiveMission(null);
  showToast('Mision activa cerrada');
}

function updateCoverageMission(patch = {}) {
  const current = getCoverageActiveMission();
  if (!current) return null;
  return saveCoverageActiveMission({ ...current, ...patch });
}

function getCoverageMissionForLead(lead) {
  return lead?.coverageMission || (lead?.coverageMissionId ? {
    id: lead.coverageMissionId,
    label: lead.coverageMissionLabel || '',
    location: lead.coverageLocation || '',
    sector: lead.coverageSector || lead.segment || '',
  } : null);
}

function leadMatchesCoverageCell(lead, location, sector) {
  if (!lead || lead.archived) return false;
  const mission = getCoverageMissionForLead(lead);
  if (mission) {
    const sameLocation = normalizeCoverageLocation(mission.location) === normalizeCoverageLocation(location);
    const sameSector = !sector || mission.sector === sector || lead.segment === sector;
    if (sameLocation && sameSector) return true;
  }
  return normalizeCoverageLocation(lead.coverageLocation || '') === normalizeCoverageLocation(location)
    && (!sector || lead.coverageSector === sector || lead.segment === sector);
}

function getCoverageLeadIndex() {
  const source = Array.isArray(window.leads) ? window.leads : (typeof leads !== 'undefined' ? leads : []);
  const now = Date.now();
  if (_coverageLeadIndexCache?.source === source
    && _coverageLeadIndexCache?.length === source.length
    && now - (_coverageLeadIndexCache.at || 0) < 5000) {
    return _coverageLeadIndexCache.index;
  }
  const signature = `${source.length}:${source.map(l => `${l.id || l.email || l.company || l.name || ''}:${l.status || ''}:${l.archived ? 1 : 0}:${l.coverageLocation || ''}:${l.coverageSector || l.segment || ''}`).join('|')}`;
  if (_coverageLeadIndexCache?.signature === signature) return _coverageLeadIndexCache.index;
  const index = new Map();
  const add = (location, sector, lead) => {
    const loc = normalizeCoverageLocation(location);
    const sec = String(sector || '').trim();
    if (!loc || !sec) return;
    const key = coverageKey(loc, sec);
    if (!index.has(key)) index.set(key, []);
    const bucket = index.get(key);
    if (!bucket.includes(lead)) bucket.push(lead);
  };
  source.forEach(lead => {
    if (!lead || lead.archived) return;
    const mission = getCoverageMissionForLead(lead);
    if (mission) add(mission.location, mission.sector || lead.segment || lead.coverageSector, lead);
    add(lead.coverageLocation, lead.coverageSector || lead.segment, lead);
    if (lead.coverageSector && lead.segment && lead.coverageSector !== lead.segment) add(lead.coverageLocation, lead.segment, lead);
  });
  _coverageLeadIndexCache = { signature, index, source, length: source.length, at: now };
  return index;
}

function getCoverageCellFunnel(location, sector, entryOverride = null) {
  const entry = entryOverride || getCoverageEntries().find(e => e.key === coverageKey(location, sector));
  const related = getCoverageLeadIndex().get(coverageKey(location, sector)) || [];
  const contactedStatuses = ['Contactado', 'Respuesta del cliente', 'Visita', 'Entrega de presupuesto', 'Cerrado'];
  return {
    searched: entry?.uniqueCount || 0,
    useful: entry?.readyCount || 0,
    imported: related.length || entry?.importedCount || 0,
    contacted: related.filter(l => contactedStatuses.includes(l.status)).length,
    responded: related.filter(l => ['Respuesta del cliente', 'Visita', 'Entrega de presupuesto', 'Cerrado'].includes(l.status)).length,
    leads: related,
  };
}

function getCoverageProfitability(location, sector, funnelOverride = null) {
  const funnel = funnelOverride || getCoverageCellFunnel(location, sector);
  const usefulRate = funnel.searched ? Math.round((funnel.useful / funnel.searched) * 100) : 0;
  const importRate = funnel.useful ? Math.round((funnel.imported / funnel.useful) * 100) : 0;
  const responseRate = funnel.imported ? Math.round((funnel.responded / funnel.imported) * 100) : 0;
  const value = Math.round((usefulRate * 0.35) + (importRate * 0.35) + (responseRate * 0.30));
  let label = 'Sin datos';
  if (funnel.searched && value >= 55) label = 'Rentable';
  else if (funnel.searched && value >= 25) label = 'Prometedora';
  else if (funnel.searched) label = 'Floja';
  return { ...funnel, usefulRate, importRate, responseRate, value, label };
}

function summarizeCoverageResults(results = []) {
  const uniqueCount = results.length;
  const emailCount = results.filter(r => r.email).length;
  const phoneCount = results.filter(r => r.phone).length;
  const readyCount = results.filter(r => r.email && (r.decision_maker || r.phone)).length;
  const avgScore = uniqueCount
    ? Math.round(results.reduce((sum, r) => sum + (r.opportunityScore || r.score || 0), 0) / uniqueCount)
    : 0;
  const leadList = Array.isArray(window.leads) ? window.leads : (typeof leads !== 'undefined' && Array.isArray(leads) ? leads : []);
  const leadMatches = results.filter(r => leadList.some(l => {
    if (l.archived) return false;
    if (r.placeId && l.placeId && r.placeId === l.placeId) return true;
    if (typeof isSameBusiness === 'function') return isSameBusiness({ ...r, company: r.name }, l);
    return (r.name || '').toLowerCase() === (l.company || l.name || '').toLowerCase();
  })).length;
  return { uniqueCount, emailCount, phoneCount, readyCount, avgScore, importedCount: leadMatches };
}

function inferCoverageSectors(search, results = []) {
  const sectors = new Set();
  if (search?.segment && search.segment !== 'Multi-sector') sectors.add(search.segment);
  results.forEach(r => {
    (r.matchedSectors || []).forEach(s => s && sectors.add(s));
    if (r.sourceSector) sectors.add(r.sourceSector);
    else if (r.segment && r.segment !== 'Multi-sector') sectors.add(r.segment);
  });
  if (!sectors.size && search?.segment) sectors.add(search.segment);
  return [...sectors].filter(Boolean);
}

function recordSearchCoverage({ location, sectors, mode = 'single', status = 'complete', results = [], rawCount = null, error = '' }) {
  const loc = normalizeCoverageLocation(location);
  if (!loc || !Array.isArray(sectors) || !sectors.length) return;
  const entries = getCoverageRawEntries();
  const now = new Date().toISOString();
  sectors.forEach(sector => {
    const sectorResults = results.filter(r => {
      const matched = r.matchedSectors || [];
      return r.sourceSector === sector || r.segment === sector || matched.includes(sector) || sectors.length === 1;
    });
    const summary = summarizeCoverageResults(sectorResults.length ? sectorResults : results);
    const key = coverageKey(loc, sector);
    const previousIdx = entries.findIndex(e => e.key === key);
    const previous = previousIdx >= 0 ? entries[previousIdx] : {};
    const entry = {
      ...previous,
      key,
      location: loc,
      sector,
      mode,
      status,
      date: now,
      rawCount: rawCount ?? results.length,
      uniqueCount: summary.uniqueCount,
      emailCount: summary.emailCount,
      phoneCount: summary.phoneCount,
      readyCount: summary.readyCount,
      importedCount: Math.max(summary.importedCount, previous.importedCount || 0),
      avgScore: summary.avgScore,
      error,
    };
    if (previousIdx >= 0) entries.splice(previousIdx, 1);
    entries.push(entry);
    appendCoverageEvent({
      key,
      location: loc,
      sector,
      mode,
      type: status === 'error' ? 'error' : 'search',
      status,
      rawCount: rawCount ?? results.length,
      uniqueCount: summary.uniqueCount,
      emailCount: summary.emailCount,
      phoneCount: summary.phoneCount,
      readyCount: summary.readyCount,
      importedCount: summary.importedCount,
      avgScore: summary.avgScore,
      error,
    });
  });
  saveCoverageRawEntries(entries);
  completeCoveragePlanItems(loc, sectors);
  if (typeof renderCoverage === 'function') renderCoverage();
}

function rebuildCoverageFromSavedSearches() {
  const searches = typeof getSavedSearches === 'function' ? getSavedSearches() : [];
  const entries = new Map(getCoverageRawEntries().map(e => [e.key, e]));
  searches.forEach(s => {
    const results = s.results || [];
    const sectors = inferCoverageSectors(s, results);
    sectors.forEach(sector => {
      const sectorResults = results.filter(r =>
        (r.matchedSectors || []).includes(sector) || r.sourceSector === sector || r.segment === sector || sectors.length === 1
      );
      const summary = summarizeCoverageResults(sectorResults.length ? sectorResults : results);
      const key = coverageKey(s.location, sector);
      const previous = entries.get(key) || {};
      entries.set(key, {
        ...previous,
        key,
        location: normalizeCoverageLocation(s.location),
        sector,
        mode: s.segment === 'Multi-sector' || sectors.length > 1 ? 'multi' : 'single',
        status: summary.uniqueCount ? (summary.readyCount || summary.importedCount ? 'complete' : 'partial') : 'partial',
        date: s.date || previous.date || new Date().toISOString(),
        rawCount: Math.max(s.count || 0, previous.rawCount || 0),
        uniqueCount: summary.uniqueCount,
        emailCount: summary.emailCount,
        phoneCount: summary.phoneCount,
        readyCount: summary.readyCount,
        importedCount: Math.max(summary.importedCount, s.imported || 0, previous.importedCount || 0),
        avgScore: summary.avgScore,
        error: previous.error || '',
      });
    });
  });
  saveCoverageRawEntries([...entries.values()]);
  return [...entries.values()];
}

function getCoverageEntries() {
  return rebuildCoverageFromSavedSearches();
}

function inferCoverageSectorsFromFlow(payload = {}) {
  if (Array.isArray(payload.sectors) && payload.sectors.length) return payload.sectors.filter(Boolean);
  if (payload.segment && payload.segment !== 'Multi-sector') return [payload.segment];
  const sectors = new Set();
  (payload.results || []).forEach(result => {
    if (result.sourceSector) sectors.add(result.sourceSector);
    if (result.segment && result.segment !== 'Multi-sector') sectors.add(result.segment);
    (result.matchedSectors || []).forEach(sector => sector && sectors.add(sector));
  });
  return [...sectors].filter(Boolean);
}

function consumeCoverageFlowEvent(event) {
  const payload = event?.payload || {};
  if (!payload.location) return;
  if (event.type === 'coverage:record') {
    recordSearchCoverage({
      location: payload.location,
      sectors: payload.sectors || [],
      mode: payload.mode || 'single',
      status: payload.status || 'complete',
      results: payload.results || [],
      rawCount: payload.rawCount ?? null,
      error: payload.error || '',
    });
  }
  if (event.type === 'search:complete' || event.type === 'search:saved') {
    const sectors = inferCoverageSectorsFromFlow(payload);
    if (!sectors.length) return;
    recordSearchCoverage({
      location: payload.location,
      sectors,
      mode: payload.mode || (payload.segment === 'Multi-sector' || sectors.length > 1 ? 'multi' : 'single'),
      status: payload.status || ((payload.resultCount || payload.count || 0) ? 'complete' : 'partial'),
      results: payload.results || [],
      rawCount: payload.rawCount ?? payload.count ?? payload.resultCount ?? null,
    });
  }
  if (event.type === 'search:error') {
    const sectors = inferCoverageSectorsFromFlow(payload);
    if (!sectors.length) return;
    recordSearchCoverage({
      location: payload.location,
      sectors,
      mode: payload.mode || 'single',
      status: 'error',
      results: [],
      rawCount: 0,
      error: payload.error || 'error',
    });
  }
}

function replayCoverageFlowEvents() {
  if (typeof replayGordiFlowEvents !== 'function') return 0;
  return replayGordiFlowEvents(consumeCoverageFlowEvent, {
    consumer: 'coverage',
    types: ['search:complete', 'search:saved', 'search:error', 'coverage:record'],
  });
}

function getCoverageCellStatus(entry, isTarget) {
  if (!entry) return isTarget ? 'pending' : 'empty';
  if (entry.status === 'error') return 'error';
  if ((entry.uniqueCount || 0) === 0) return 'partial';
  if ((entry.importedCount || 0) > 0 || (entry.readyCount || 0) >= 5) return 'complete';
  if ((entry.emailCount || 0) > 0 || (entry.readyCount || 0) > 0) return 'partial';
  return 'searched';
}

function coverageStatusMeta(status) {
  return {
    complete: { label: 'Completa', icon: 'OK', cls: 'coverage-complete' },
    stale: { label: 'Caducada', icon: '30d', cls: 'coverage-stale' },
    partial: { label: 'Parcial', icon: '!', cls: 'coverage-partial' },
    searched: { label: 'Buscada', icon: '.', cls: 'coverage-searched' },
    error: { label: 'Error', icon: 'X', cls: 'coverage-error' },
    pending: { label: 'Pendiente', icon: '+', cls: 'coverage-pending' },
    empty: { label: 'Sin objetivo', icon: '-', cls: 'coverage-empty' },
  }[status] || { label: status, icon: '-', cls: 'coverage-empty' };
}

function getCoverageModel() {
  const entries = getCoverageEntries();
  const targets = getCoverageTargets();
  const locations = [...new Set([
    ...targets.locations,
    ...entries.map(e => e.location).filter(Boolean),
  ])].sort((a, b) => a.localeCompare(b, 'es'));
  const sectors = [...new Set([
    ...targets.sectors,
    ...entries.map(e => e.sector).filter(Boolean),
  ])].sort((a, b) => getCoverageSectorLabel(a).localeCompare(getCoverageSectorLabel(b), 'es'));
  const byKey = new Map(entries.map(e => [e.key, e]));
  return { entries, targets, locations, sectors, byKey };
}

function coverageAgeDays(entry) {
  if (!entry?.date) return null;
  const date = new Date(entry.date);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

function getCoverageCellFreshness(entry) {
  const age = coverageAgeDays(entry);
  if (age === null) return { age, label: 'Sin fecha', cls: 'coverage-fresh-unknown', stale: false };
  if (age <= 7) return { age, label: `${age}d`, cls: 'coverage-fresh-new', stale: false };
  if (age <= COVERAGE_STALE_DAYS) return { age, label: `${age}d`, cls: 'coverage-fresh-mid', stale: false };
  return { age, label: `${age}d`, cls: 'coverage-fresh-old', stale: true };
}

function buildCoverageCells(model, locations = model.locations) {
  const targetSectorSet = new Set(model.targets.sectors);
  const targetLocationSet = new Set(model.targets.locations);
  const cells = [];
  locations.forEach(location => {
    model.sectors.forEach(sector => {
      const entry = model.byKey.get(coverageKey(location, sector));
      const isTarget = targetLocationSet.has(location) && targetSectorSet.has(sector);
      const baseStatus = getCoverageCellStatus(entry, isTarget);
      const freshness = getCoverageCellFreshness(entry);
      const status = entry && baseStatus === 'complete' && freshness.stale ? 'stale' : baseStatus;
      const debt = getCoverageDebtScore({ location, sector, entry, status, isTarget, freshness });
      const reason = getCoverageReason({ entry, status, freshness });
      cells.push({ location, sector, entry, status, isTarget, freshness, debt, reason });
    });
  });
  return cells;
}

function getCoverageDebtScore(cell) {
  let score = 0;
  if (cell.status === 'error') score += 100;
  else if (cell.status === 'pending') score += 85;
  else if (cell.status === 'partial') score += 72;
  else if (cell.status === 'stale') score += 62;
  else if (cell.status === 'searched') score += 40;
  if (cell.isTarget) score += 18;
  if (cell.entry?.readyCount) score += Math.min(18, cell.entry.readyCount * 2);
  if (cell.entry?.avgScore) score += Math.min(12, Math.round(cell.entry.avgScore / 10));
  if (cell.freshness?.age && cell.freshness.age > COVERAGE_STALE_DAYS) score += Math.min(20, Math.floor((cell.freshness.age - COVERAGE_STALE_DAYS) / 10));
  return score;
}

function getCoverageReason(cell) {
  if (cell.status === 'error') return 'Fallo anterior';
  if (cell.status === 'pending') return 'Objetivo pendiente';
  if (cell.status === 'partial') return 'Busqueda incompleta';
  if (cell.status === 'stale') return 'Busqueda antigua';
  if (cell.status === 'searched') return 'Sin leads listos';
  return 'Sin objetivo';
}

function filterCoverageCells(cells) {
  return cells.filter(cell => {
    if (coverageSmartFilter === 'pending') return cell.status === 'pending';
    if (coverageSmartFilter === 'errors') return cell.status === 'error';
    if (coverageSmartFilter === 'stale') return cell.status === 'stale' || (cell.freshness?.age || 0) > COVERAGE_STALE_DAYS;
    if (coverageSmartFilter === 'partial') return cell.status === 'partial' || cell.status === 'searched';
    if (coverageSmartFilter === 'valuable') return ['pending', 'partial', 'stale', 'error'].includes(cell.status) && cell.debt >= 70;
    if (coverageSmartFilter === 'no_coverage') return !cell.entry && cell.isTarget;
    return true;
  });
}

function getCoverageFilterLabel() {
  return ({
    all: 'Todo',
    pending: 'Pendientes',
    errors: 'Errores',
    stale: 'Caducadas',
    partial: 'Parciales',
    valuable: 'Huecos valiosos',
    no_coverage: 'CP sin cubrir',
  })[coverageSmartFilter] || 'Todo';
}

function isCoverageActionable(cell) {
  return ['pending', 'partial', 'searched', 'stale', 'error'].includes(cell.status);
}

function getCoverageLocationSummary(location, sectors, cells) {
  const row = sectors.map(sector => cells.find(c => c.location === location && c.sector === sector)).filter(Boolean);
  const total = row.length || sectors.length || 0;
  const searched = row.filter(c => c.entry).length;
  const complete = row.filter(c => c.status === 'complete').length;
  const pending = row.filter(c => c.status === 'pending').length;
  const actionable = row.filter(isCoverageActionable).length;
  const errors = row.filter(c => c.status === 'error').length;
  const stale = row.filter(c => c.status === 'stale').length;
  const lastEntry = row.map(c => c.entry).filter(Boolean).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0];
  const lastFreshness = getCoverageCellFreshness(lastEntry);
  const percent = total ? Math.round((complete / total) * 100) : 0;
  return { total, searched, complete, pending, actionable, errors, stale, lastEntry, lastFreshness, percent };
}

function getCoverageSectorSummary(sector, locations, cells) {
  const col = locations.map(location => cells.find(c => c.location === location && c.sector === sector)).filter(Boolean);
  const total = col.length || locations.length || 0;
  const searched = col.filter(c => c.entry).length;
  const complete = col.filter(c => c.status === 'complete').length;
  const pending = col.filter(c => c.status === 'pending').length;
  const actionable = col.filter(isCoverageActionable).length;
  const errors = col.filter(c => c.status === 'error').length;
  const stale = col.filter(c => c.status === 'stale').length;
  const percent = total ? Math.round((complete / total) * 100) : 0;
  return { total, searched, complete, pending, actionable, errors, stale, percent };
}

function getCoverageCellPrimary(cell) {
  if (!cell.entry) return cell.status === 'pending' ? 'Nunca' : 'Sin objetivo';
  if (cell.status === 'error') return 'Error';
  if (cell.status === 'stale') return 'Caducada';
  if (cell.status === 'partial') return 'Parcial';
  if (cell.status === 'searched') return 'Buscada';
  return 'OK';
}

function getCoverageCellResult(cell) {
  if (!cell.entry) return cell.status === 'pending' ? 'Buscar' : '-';
  return `${cell.entry.readyCount || 0}/${cell.entry.uniqueCount || 0}`;
}

function getCoverageActionLabel(cell) {
  if (cell.status === 'pending') return 'Buscar';
  if (cell.status === 'error') return 'Reintentar';
  if (cell.status === 'stale') return 'Refrescar';
  if (cell.status === 'partial' || cell.status === 'searched') return 'Completar';
  return 'Ver';
}

function renderCoverage() {
  const root = document.getElementById('coverage-root');
  if (!root) return;
  const model = getCoverageModel();
  const query = normalizeCoverageLocation(coverageSearchTerm).toLowerCase();
  const queryLocations = query
    ? model.locations.filter(location => location.toLowerCase().includes(query))
    : model.locations;
  const allCells = buildCoverageCells(model, queryLocations);
  const cells = filterCoverageCells(allCells);
  const visibleLocations = [...new Set(cells.map(c => c.location))];
  const matrixModel = { ...model, locations: visibleLocations };
  const searched = cells.filter(c => c.entry).length;
  const complete = cells.filter(c => c.status === 'complete').length;
  const partial = cells.filter(c => c.status === 'partial' || c.status === 'searched').length;
  const pending = cells.filter(c => c.status === 'pending').length;
  const errors = cells.filter(c => c.status === 'error').length;
  const stale = cells.filter(c => c.status === 'stale').length;
  const best = getCoverageBestNextCell(model);
  const bestLabel = best ? `${coverageEscapeHtml(best.location)} - ${coverageEscapeHtml(getCoverageSectorLabel(best.sector))}` : 'Sin siguiente busqueda';

  root.innerHTML = `
    <div class="coverage-focus-shell">
      <div class="coverage-hero-strip">
        <div>
          <span class="coverage-eyebrow">Cobertura</span>
          <h3>CP x sector: buscado, cuando y que falta</h3>
          <p>${visibleLocations.length ? `${visibleLocations.length} CP visibles - ${searched} combinaciones buscadas - ${pending} pendientes.` : 'Empieza buscando o anadiendo objetivos de CP/sector.'}</p>
        </div>
        <div class="coverage-hero-actions">
          <button class="btn-outline" onclick="showView('planner')">Nueva busqueda</button>
          <button class="btn-outline" onclick="typeof workflowOpenCoverageMap === 'function' && workflowOpenCoverageMap()">Mapa</button>
        </div>
      </div>

      ${renderCoverageSearchPanel()}
      ${renderCoverageSearchResult(allCells, queryLocations)}
      ${renderCoverageSimpleSummary(cells, visibleLocations)}

      <div class="coverage-main glass-panel coverage-main-simple">
        <div class="coverage-toolbar coverage-toolbar-simple">
          <div>
            <span class="coverage-eyebrow">Vista principal</span>
            <h3>${coverageViewMode === 'sector' ? 'Sectores por CP' : 'Codigos postales y sectores'}</h3>
            <p>${visibleLocations.length ? 'Lee cada fila como un CP/zona y cada columna como un sector.' : 'No hay CP/zonas que coincidan con la busqueda o filtro.'}</p>
          </div>
          <div class="coverage-toolbar-actions">
            <button class="btn-primary btn-sm" onclick="runCoverageBestNext()" ${best ? '' : 'disabled'} title="${bestLabel}">Siguiente busqueda</button>
            <div class="coverage-view-toggle">
              <button class="${coverageViewMode === 'cp' ? 'active' : ''}" onclick="setCoverageViewMode('cp')">Por CP</button>
              <button class="${coverageViewMode === 'sector' ? 'active' : ''}" onclick="setCoverageViewMode('sector')">Por sector</button>
            </div>
          </div>
        </div>
        ${renderCoverageEssentialFilters(allCells)}
        ${renderCoverageCompactLegend()}
        ${coverageViewMode === 'sector' ? renderCoverageSectorView(matrixModel, cells) : renderCoverageMatrix(matrixModel, cells)}
      </div>

      ${renderCoverageAdvancedPanel(model, allCells)}
    </div>`;
}

function renderCoverageSimpleSummary(cells, visibleLocations) {
  const searched = cells.filter(c => c.entry).length;
  const pending = cells.filter(c => c.status === 'pending').length;
  const stale = cells.filter(c => c.status === 'stale').length;
  const review = cells.filter(c => c.status === 'partial' || c.status === 'searched' || c.status === 'error').length;
  const lastDates = cells
    .map(c => c.entry?.lastSearchedAt || c.entry?.updatedAt || c.entry?.date)
    .filter(Boolean)
    .sort();
  const lastDate = lastDates.length ? new Date(lastDates[lastDates.length - 1]).toLocaleDateString('es-ES') : 'Nunca';
  return `<div class="coverage-simple-summary">
    ${coverageSummaryCard('CP visibles', visibleLocations.length, 'zonas en pantalla')}
    ${coverageSummaryCard('Buscado', searched, 'CP/sector con historial')}
    ${coverageSummaryCard('Pendiente', pending, 'sin buscar todavia')}
    ${coverageSummaryCard('Revisar', review + stale, `ultimo ${coverageEscapeHtml(lastDate)}`)}
  </div>`;
}

function renderCoverageEssentialFilters(cells) {
  const filters = [
    ['all', 'Todo', cells.length],
    ['pending', 'Pendientes', cells.filter(c => c.status === 'pending').length],
    ['stale', 'Caducadas', cells.filter(c => c.status === 'stale').length],
    ['errors', 'Errores', cells.filter(c => c.status === 'error').length],
    ['partial', 'Revisar', cells.filter(c => c.status === 'partial' || c.status === 'searched').length],
  ];
  return `<div class="coverage-filter-bar coverage-filter-bar-simple">
    ${filters.map(([id, label, count]) => `<button class="coverage-filter ${coverageSmartFilter === id ? 'active' : ''}" onclick="setCoverageSmartFilter('${id}')">
      <span>${label}</span><b>${count}</b>
    </button>`).join('')}
  </div>`;
}

function renderCoverageCompactLegend() {
  return `<div class="coverage-legend coverage-legend-compact">
    ${[
      ['complete', 'Hecho'],
      ['searched', 'Buscado'],
      ['partial', 'Revisar'],
      ['stale', 'Caducado'],
      ['error', 'Error'],
      ['pending', 'Pendiente'],
    ].map(([s, label]) => {
      const meta = coverageStatusMeta(s);
      return `<span><i class="${meta.cls}"></i>${label}</span>`;
    }).join('')}
  </div>`;
}

function renderCoverageAdvancedPanel(model, allCells) {
  return `<details class="coverage-advanced-panel">
    <summary>
      <span>Opciones avanzadas</span>
      <small>Objetivos, ruta diaria, embudo, rentabilidad y filtros completos</small>
    </summary>
    <div class="coverage-advanced-grid">
      ${renderCoverageCommandDeck(model)}
      ${renderCoverageTargetPanel(model)}
      <div class="glass-panel coverage-advanced-tools">
        <h3>Filtros completos</h3>
        ${renderCoverageFilterBar(allCells)}
      </div>
    </div>
  </details>`;
}

function renderCoverageNarrative(cells, visibleLocations) {
  const searched = cells.filter(c => c.entry).length;
  const pending = cells.filter(c => c.status === 'pending').length;
  const stale = cells.filter(c => c.status === 'stale').length;
  const errors = cells.filter(c => c.status === 'error').length;
  const partial = cells.filter(c => c.status === 'partial' || c.status === 'searched').length;
  const filterText = coverageSmartFilter !== 'all' ? ` Filtro activo: ${getCoverageFilterLabel()}.` : '';
  return `<div class="coverage-narrative">
    Tienes ${visibleLocations.length} CP visibles, ${searched} combinaciones CP/sector buscadas, ${pending} pendientes, ${partial} para completar, ${stale} caducadas y ${errors} con error.${filterText}
  </div>`;
}

function renderCoverageSearchPanel() {
  return `<div class="glass-panel coverage-search-panel">
    <div>
      <h3>Buscar cobertura</h3>
      <p>Consulta un codigo postal o zona para ver si ya se ha buscado y que sectores tiene historial.</p>
    </div>
    <div class="coverage-search-controls">
      <input id="coverage-search-input" type="search" value="${coverageEscapeHtml(coverageSearchTerm)}" placeholder="Buscar CP o zona: 28001, Alcobendas..." oninput="setCoverageSearch(this.value)">
      <button class="btn-outline btn-sm" onclick="clearCoverageSearch()" ${coverageSearchTerm ? '' : 'disabled'}>Limpiar</button>
    </div>
  </div>`;
}

function renderCoverageCommandDeck(model) {
  const best = getCoverageBestNextCell(model);
  const inbox = getCoverageInboxItems(model);
  const profit = getCoverageGlobalProfit(model);
  const plan = getCoverageDailyPlan();
  const done = (plan.items || []).filter(i => i.status === 'done').length;
  const bestMeta = best ? coverageStatusMeta(best.status) : null;
  const activeMission = getCoverageActiveMission();
  return `<div class="glass-panel coverage-command-deck">
    <div class="coverage-command-main">
      <div>
        <span class="coverage-eyebrow">Ruta de trabajo</span>
        <h3>${best ? `${coverageEscapeHtml(best.location)} · ${coverageEscapeHtml(getCoverageSectorLabel(best.sector))}` : 'Sin siguiente hueco'}</h3>
        <p>${best ? `${coverageEscapeHtml(best.reason)} · deuda ${Math.round(best.debt)} · accion ${coverageEscapeHtml(getCoverageActionLabel(best))}` : 'Define objetivos o revisa los resultados guardados para generar una ruta.'}</p>
      </div>
      <div class="coverage-command-actions">
        <button class="btn-primary" onclick="runCoverageBestNext()" ${best ? '' : 'disabled'}>Siguiente mejor busqueda</button>
        <button class="btn-outline" onclick="generateCoverageDailyPlan()">Crear ruta de hoy</button>
        ${activeMission ? '<button class="btn-outline" onclick="runNextCoverageMissionStep()">Continuar mision</button>' : ''}
      </div>
    </div>
    <div class="coverage-command-grid">
      <button class="coverage-command-card" onclick="setCoverageSmartFilter('valuable')">
        <strong>${inbox.length}</strong>
        <span>Pendientes accionables</span>
      </button>
      <button class="coverage-command-card" onclick="showCoverageInbox()">
        <strong>${inbox.filter(i => i.type === 'unimported').length}</strong>
        <span>Resultados sin volcar</span>
      </button>
      <button class="coverage-command-card" onclick="showCoverageProfitPanel()">
        <strong>${profit.responseRate}%</strong>
        <span>Respuesta sobre importados</span>
      </button>
      <button class="coverage-command-card" onclick="showCoverageDailyRoute()">
        <strong>${done}/${(plan.items || []).length}</strong>
        <span>Ruta de hoy</span>
      </button>
    </div>
    ${best ? `<div class="coverage-command-strip">
      <span class="coverage-pill ${bestMeta.cls}">${bestMeta.label}</span>
      <span>${coverageEscapeHtml(getCoverageActionLabel(best))}</span>
      <span>${best.entry ? `${best.entry.uniqueCount || 0} empresas · ${best.entry.readyCount || 0} listas · ${getCoverageCellFunnel(best.location, best.sector).imported} leads` : 'Nunca buscado'}</span>
      <button class="btn-outline btn-sm" onclick="openCoverageCell('${encodeURIComponent(best.location)}','${encodeURIComponent(best.sector)}')">Abrir celda</button>
    </div>` : ''}
  </div>`;
}

function renderCoverageFlowBar() {
  const mission = getCoverageActiveMission();
  document.querySelectorAll('#coverage-flow-bar').forEach(el => el.remove());
  if (!mission) return;
  const activeView = document.querySelector('.view.active') || document.getElementById('coverage-view');
  if (!activeView || !['coverage-view', 'planner-view', 'leads-view'].includes(activeView.id)) return;
  const bar = document.createElement('div');
  bar.id = 'coverage-flow-bar';
  bar.className = 'coverage-flow-bar';
  const steps = [
    ['coverage', 'Cobertura'],
    ['scraping', 'Scraping'],
    ['import', 'Importacion'],
    ['leads', 'Leads'],
    ['followup', 'Seguimiento'],
  ];
  const currentIdx = Math.max(0, steps.findIndex(([id]) => id === mission.status));
  bar.innerHTML = `
    <div class="coverage-flow-main">
      <strong>Mision activa: ${coverageEscapeHtml(mission.label)}</strong>
      <span>${mission.searchedCount || 0} encontradas · ${mission.readyCount || 0} listas · ${mission.importedCount || 0} importadas${mission.duplicateCount ? ` · ${mission.duplicateCount} duplicadas` : ''}</span>
    </div>
    <div class="coverage-flow-steps">
      ${steps.map(([id, label], idx) => `<span class="${idx <= currentIdx ? 'active' : ''}">${label}</span>`).join('')}
    </div>
    <div class="coverage-flow-actions">
      <button onclick="showCoverageMissionCoverage()">Ver cobertura</button>
      <button onclick="showCoverageMissionResults()">Ver resultados</button>
      <button onclick="showCoverageMissionLeads()">Ver leads</button>
      <button onclick="runNextCoverageMissionStep()">Siguiente</button>
      <button onclick="clearCoverageMission()">Cerrar</button>
    </div>`;
  const header = activeView.querySelector('.page-header');
  if (header?.nextSibling) activeView.insertBefore(bar, header.nextSibling);
  else activeView.prepend(bar);
}

function showCoverageMissionCoverage() {
  const mission = getCoverageActiveMission();
  if (!mission) return;
  openCoverageForLocation(mission.location || '');
}

function openCoverageForLocation(location) {
  coverageSearchTerm = normalizeCoverageLocation(location || '');
  showView('coverage');
  renderCoverage();
}

function showCoverageMissionResults() {
  const mission = getCoverageActiveMission();
  if (!mission) return;
  const locEl = document.getElementById('plan-location');
  const segEl = document.getElementById('plan-segment');
  if (locEl) locEl.value = mission.location || '';
  if (segEl && mission.sector && mission.sector !== 'Multi-sector') segEl.value = mission.sector;
  showView('planner');
  if (Array.isArray(tempSearchResults) && tempSearchResults.length) {
    showResultsPanel();
    renderCoveragePostScrapingPanel();
  } else if (mission.resultSearchId) {
    loadCoverageSearchById(mission.resultSearchId);
  } else {
    if (typeof renderSearchCards === 'function') renderSearchCards();
    if (typeof showResultsPanel === 'function') showResultsPanel();
    renderCoveragePostScrapingPanel();
  }
}

function showCoverageMissionLeads() {
  const mission = getCoverageActiveMission();
  if (!mission) return;
  setCoverageLeadScope({
    missionId: mission.id,
    label: mission.label,
    location: mission.location,
    sector: mission.sector,
    sectorLabel: getCoverageSectorLabel(mission.sector),
  });
  showView('leads');
  if (typeof renderLeads === 'function') renderLeads();
}

function filterCoverageCellLeads(encodedLocation, encodedSector) {
  const location = decodeURIComponent(encodedLocation);
  const sector = decodeURIComponent(encodedSector);
  setCoverageLeadScope({
    location,
    sector,
    sectorLabel: getCoverageSectorLabel(sector),
    label: `${location} · ${getCoverageSectorLabel(sector)}`,
  });
  showView('leads');
  if (typeof renderLeads === 'function') renderLeads();
}

function setCoverageLeadScope(scope) {
  coverageSaveJson(COVERAGE_LEAD_FILTER_KEY, {
    ...scope,
    location: normalizeCoverageLocation(scope.location || ''),
    createdAt: new Date().toISOString(),
  });
}

function getCoverageLeadScope() {
  return coverageSafeJson(COVERAGE_LEAD_FILTER_KEY, null);
}

function clearCoverageLeadScope() {
  try { localStorage.removeItem(COVERAGE_LEAD_FILTER_KEY); } catch {}
}

function runNextCoverageMissionStep() {
  const mission = getCoverageActiveMission();
  if (!mission) return;
  if (mission.status === 'coverage') {
    runCoverageSearch(encodeURIComponent(mission.location), encodeURIComponent(mission.sector || mission.sectors?.[0] || ''));
    return;
  }
  if (mission.status === 'scraping' || mission.status === 'review') {
    showCoverageMissionResults();
    return;
  }
  if (mission.status === 'empty' || mission.status === 'error') {
    showCoverageMissionResults();
    return;
  }
  if (mission.status === 'import') {
    coverageImportRecommended();
    return;
  }
  showCoverageMissionLeads();
}

function renderCoverageRadar(model) {
  const recommendations = getCoverageRecommendations(model).slice(0, 5);
  return `<div class="glass-panel coverage-radar">
    <div class="coverage-radar-head">
      <div>
        <h3>Radar de trabajo</h3>
        <p>Las mejores acciones ahora segun pendiente, errores, frescura y potencial.</p>
      </div>
      <button class="btn-primary btn-sm" onclick="generateCoverageDailyPlan()">Crear plan de hoy</button>
    </div>
    <div class="coverage-radar-list">
      ${recommendations.length ? recommendations.map((cell, idx) => renderCoverageRadarCard(cell, idx)).join('') : '<div class="coverage-empty-task">Define objetivos o realiza busquedas para activar recomendaciones.</div>'}
    </div>
  </div>`;
}

function renderCoverageRadarCard(cell, idx) {
  const meta = coverageStatusMeta(cell.status);
  const encodedLocation = encodeURIComponent(cell.location);
  const encodedSector = encodeURIComponent(cell.sector);
  return `<div class="coverage-radar-card">
    <div class="coverage-radar-rank">${idx + 1}</div>
    <div class="coverage-radar-body">
      <strong>${coverageEscapeHtml(cell.location)} · ${coverageEscapeHtml(getCoverageSectorLabel(cell.sector))}</strong>
      <span>${cell.reason} · deuda ${Math.round(cell.debt)} · ${cell.entry ? `${cell.entry.uniqueCount || 0} empresas` : 'sin historial'}</span>
    </div>
    <div class="coverage-radar-actions">
      <span class="coverage-pill ${meta.cls}">${meta.label}</span>
      <button class="btn-outline btn-sm" onclick="addCoveragePlanItem('${encodedLocation}','${encodedSector}')">A cola</button>
      <button class="btn-primary btn-sm" onclick="runCoverageSearch('${encodedLocation}','${encodedSector}')">Buscar</button>
    </div>
  </div>`;
}

function renderCoverageFilterBar(cells) {
  const filters = [
    ['all', 'Todo', cells.length],
    ['valuable', 'Huecos valiosos', cells.filter(c => ['pending', 'partial', 'stale', 'error'].includes(c.status) && c.debt >= 70).length],
    ['pending', 'Pendientes', cells.filter(c => c.status === 'pending').length],
    ['partial', 'Parciales', cells.filter(c => c.status === 'partial' || c.status === 'searched').length],
    ['stale', 'Caducadas', cells.filter(c => c.status === 'stale').length],
    ['errors', 'Errores', cells.filter(c => c.status === 'error').length],
    ['no_coverage', 'CP sin cubrir', cells.filter(c => !c.entry && c.isTarget).length],
  ];
  return `<div class="coverage-filter-bar">
    ${filters.map(([id, label, count]) => `<button class="coverage-filter ${coverageSmartFilter === id ? 'active' : ''}" onclick="setCoverageSmartFilter('${id}')">
      <span>${label}</span><b>${count}</b>
    </button>`).join('')}
  </div>`;
}

function renderCoverageSearchResult(cells, visibleLocations) {
  const query = normalizeCoverageLocation(coverageSearchTerm);
  if (!query) return '';
  const searchedSectors = [...new Set(cells.filter(c => c.entry).map(c => c.sector))];
  const pendingSectors = [...new Set(cells.filter(c => c.status === 'pending').map(c => c.sector))];
  const partialSectors = [...new Set(cells.filter(c => ['partial', 'searched', 'error', 'stale'].includes(c.status)).map(c => c.sector))];
  const ready = cells.reduce((sum, c) => sum + (c.entry?.readyCount || 0), 0);
  const companies = cells.reduce((sum, c) => sum + (c.entry?.uniqueCount || 0), 0);
  const imported = cells.reduce((sum, c) => sum + (c.entry?.importedCount || 0), 0);
  const encodedQuery = encodeURIComponent(query);

  if (!visibleLocations.length) {
    return `<div class="coverage-search-result coverage-search-missing">
      <div>
        <strong>No aparece "${coverageEscapeHtml(query)}" en la cobertura</strong>
        <span>No hay busquedas guardadas ni objetivos para ese CP/zona.</span>
      </div>
      <div class="coverage-search-actions">
        <button class="btn-outline btn-sm" onclick="addCoverageQueryAsLocation('${encodedQuery}')">Anadir como objetivo</button>
        <button class="btn-primary btn-sm" onclick="startCoverageQuerySearch('${encodedQuery}')">Buscar ahora</button>
      </div>
    </div>`;
  }

  return `<div class="coverage-search-result">
    <div>
      <strong>${visibleLocations.length} zona${visibleLocations.length === 1 ? '' : 's'} encontrada${visibleLocations.length === 1 ? '' : 's'} para "${coverageEscapeHtml(query)}"</strong>
      <span>${searchedSectors.length ? `Buscado en: ${searchedSectors.map(getCoverageSectorLabel).join(', ')}` : 'Todavia no hay sectores buscados para esta zona.'}</span>
      ${pendingSectors.length ? `<span>Pendiente: ${pendingSectors.map(getCoverageSectorLabel).join(', ')}</span>` : ''}
      ${partialSectors.length ? `<span>Revisar/refrescar: ${partialSectors.map(getCoverageSectorLabel).join(', ')}</span>` : ''}
    </div>
    <div class="coverage-search-stats">
      <span><b>${companies}</b> empresas</span>
      <span><b>${ready}</b> listas</span>
      <span><b>${imported}</b> leads</span>
      ${visibleLocations.length === 1 ? `<button class="btn-outline btn-sm" onclick="openCoverageLocationTimeline('${encodeURIComponent(visibleLocations[0])}')">Timeline</button>` : ''}
    </div>
  </div>`;
}

function coverageSummaryCard(label, value, hint) {
  return `<div class="coverage-kpi">
    <div class="coverage-kpi-label">${label}</div>
    <div class="coverage-kpi-value">${value}</div>
    <div class="coverage-kpi-hint">${hint}</div>
  </div>`;
}

function renderCoverageMatrix(model, cells) {
  if (!model.locations.length || !model.sectors.length) {
    return `<div class="coverage-empty-state">
      <strong>Sin mapa todavia</strong>
      <span>Haz una busqueda o anade objetivos de CP/sector para crear tu mapa de cobertura.</span>
      <button class="btn-primary btn-sm" onclick="showView('planner')">Ir a Buscar</button>
    </div>`;
  }
  const cellByKey = new Map(cells.map(cell => [coverageKey(cell.location, cell.sector), cell]));
  return `<div class="coverage-matrix-wrap">
    <table class="coverage-matrix">
      <thead><tr><th>CP/Zona</th>${model.sectors.map(s => {
        const summary = getCoverageSectorSummary(s, model.locations, cells);
        return `<th>
          <button class="coverage-sector-head" onclick="openCoverageSectorPanel('${encodeURIComponent(s)}')">
            <strong>${coverageEscapeHtml(getCoverageSectorIcon(s))} ${coverageEscapeHtml(getCoverageSectorLabel(s))}</strong>
            <span>${summary.actionable} pendientes · ${summary.percent}%</span>
          </button>
        </th>`;
      }).join('')}</tr></thead>
      <tbody>${model.locations.map(location => `
        <tr>
          <th>${renderCoverageLocationHeader(location, model.sectors, cells)}</th>
          ${model.sectors.map(sector => {
            const cell = cellByKey.get(coverageKey(location, sector));
            if (!cell) return '<td><div class="coverage-cell coverage-filtered"><small>Filtro</small></div></td>';
            const meta = coverageStatusMeta(cell.status);
            const e = cell.entry;
            const funnel = getCoverageCellFunnel(location, sector, e);
            const profit = getCoverageProfitability(location, sector, funnel);
            const title = e
              ? `${getCoverageSectorLabel(sector)} en ${location}: ${e.uniqueCount || 0} empresas, ${e.readyCount || 0} listas, ${e.importedCount || 0} importadas. Accion: ${getCoverageActionLabel(cell)}`
              : `${getCoverageSectorLabel(sector)} en ${location}: ${meta.label}`;
            return `<td>
              <button class="coverage-cell ${meta.cls}" title="${coverageEscapeHtml(title)}" onclick="openCoverageCell('${encodeURIComponent(location)}','${encodeURIComponent(sector)}')">
                <span>${coverageEscapeHtml(getCoverageCellPrimary(cell))}</span>
                <small>${e ? cell.freshness.label : 'Nunca'}</small>
                <em class="${e ? cell.freshness.cls : ''}">${coverageEscapeHtml(getCoverageCellResult(cell))}</em>
                ${e ? `<small class="coverage-cell-funnel">${funnel.imported}L · ${funnel.contacted}C · ${profit.label}</small>` : ''}
              </button>
            </td>`;
          }).join('')}
        </tr>`).join('')}</tbody>
    </table>
  </div>`;
}

function renderCoverageLocationHeader(location, sectors, cells) {
  const summary = getCoverageLocationSummary(location, sectors, cells);
  const encodedLocation = encodeURIComponent(location);
  return `<div class="coverage-location-summary">
    <button class="coverage-location-link" onclick="openCoverageLocationTimeline('${encodedLocation}')">${coverageEscapeHtml(location)}</button>
    <span>${summary.searched}/${summary.total} sectores · ultimo ${summary.lastEntry ? summary.lastFreshness.label : 'nunca'}</span>
    <div class="coverage-progress"><i style="width:${summary.percent}%"></i></div>
    <div class="coverage-location-actions">
      <button onclick="openCoverageLocationTimeline('${encodedLocation}')">Ficha</button>
      <button onclick="openCoveragePendingSearch('${encodedLocation}')">${summary.actionable ? `Buscar ${summary.actionable}` : 'Completo'}</button>
    </div>
  </div>`;
}

function renderCoverageSectorView(model, cells) {
  if (!model.locations.length || !model.sectors.length) {
    return `<div class="coverage-empty-state">
      <strong>Sin sectores visibles</strong>
      <span>Ajusta filtros o anade objetivos para ver la cobertura por sector.</span>
    </div>`;
  }
  return `<div class="coverage-sector-view">
    ${model.sectors.map(sector => {
      const summary = getCoverageSectorSummary(sector, model.locations, cells);
      const sectorCells = model.locations.map(location => cells.find(c => c.location === location && c.sector === sector)).filter(Boolean);
      return `<div class="coverage-sector-card">
        <div class="coverage-sector-card-head">
          <div>
            <h3>${coverageEscapeHtml(getCoverageSectorLabel(sector))}</h3>
            <p>${summary.searched}/${summary.total} CP con historial · ${summary.actionable} pendientes/revisar · ${summary.percent}% completo</p>
          </div>
          <button class="btn-primary btn-sm" onclick="openCoverageSectorPanel('${encodeURIComponent(sector)}')">Buscar pendientes</button>
        </div>
        <div class="coverage-progress"><i style="width:${summary.percent}%"></i></div>
        <div class="coverage-sector-locations">
          ${sectorCells.map(cell => {
            const meta = coverageStatusMeta(cell.status);
            return `<button class="coverage-sector-location ${meta.cls}" onclick="openCoverageCell('${encodeURIComponent(cell.location)}','${encodeURIComponent(sector)}')">
              <strong>${coverageEscapeHtml(cell.location)}</strong>
              <span>${cell.entry ? cell.freshness.label : 'Nunca'} · ${coverageEscapeHtml(getCoverageCellResult(cell))}</span>
            </button>`;
          }).join('')}
        </div>
      </div>`;
    }).join('')}
  </div>`;
}

function renderCoverageTargetPanel(model) {
  const options = typeof SEGMENT_LABELS !== 'undefined'
    ? Object.keys(SEGMENT_LABELS).map(s => `<option value="${coverageEscapeHtml(s)}">${coverageEscapeHtml(getCoverageSectorLabel(s))}</option>`).join('')
    : '';
  return `<div class="glass-panel coverage-targets">
    <h3>Objetivos</h3>
    <p>Define las zonas y sectores que quieres cubrir para que aparezcan como pendientes.</p>
    <input id="coverage-location-input" type="text" placeholder="CP/zona: 28194, 28830..." onkeydown="if(event.key==='Enter')addCoverageLocation()">
    <div class="coverage-target-row">
      <select id="coverage-sector-select">${options}</select>
      <button class="btn-outline btn-sm" onclick="addCoverageSector()">Anadir sector</button>
    </div>
    <div class="coverage-target-actions">
      <button class="btn-primary btn-sm" onclick="addCurrentSearchAsCoverageTarget()">Usar busqueda actual</button>
      <button class="btn-outline btn-sm" onclick="clearCoverageTargets()">Limpiar objetivos</button>
    </div>
    <div class="coverage-chip-group">
      ${model.targets.locations.map(l => `<button onclick="removeCoverageLocation('${encodeURIComponent(l)}')" class="coverage-chip">CP ${coverageEscapeHtml(l)} x</button>`).join('')}
      ${model.targets.sectors.map(s => `<button onclick="removeCoverageSector('${encodeURIComponent(s)}')" class="coverage-chip">${coverageEscapeHtml(getCoverageSectorLabel(s))} x</button>`).join('')}
    </div>
  </div>`;
}

function renderCoverageQueue(cells) {
  const pending = cells
    .filter(c => c.status === 'pending' || c.status === 'error' || c.status === 'partial' || c.status === 'stale')
    .sort((a, b) => b.debt - a.debt)
    .slice(0, 10);
  return `<div class="glass-panel coverage-queue">
    <h3>Cola inteligente</h3>
    ${pending.length ? pending.map(c => {
      const meta = coverageStatusMeta(c.status);
      const action = c.status === 'pending' ? 'Buscar' : c.status === 'error' ? 'Reintentar' : c.status === 'stale' ? 'Refrescar' : 'Completar';
      return `<div class="coverage-task">
        <div><strong>${coverageEscapeHtml(getCoverageSectorLabel(c.sector))}</strong><span>${coverageEscapeHtml(c.location)} · ${meta.label} · deuda ${Math.round(c.debt)}</span></div>
        <button class="btn-outline btn-sm" onclick="runCoverageSearch('${encodeURIComponent(c.location)}','${encodeURIComponent(c.sector)}')">${action}</button>
      </div>`;
    }).join('') : '<div class="coverage-empty-task">No hay pendientes definidos.</div>'}
  </div>`;
}

function renderCoveragePlanPanel(model) {
  const plan = getCoverageDailyPlan();
  const items = plan.items || [];
  const done = items.filter(i => i.status === 'done').length;
  return `<div class="glass-panel coverage-plan">
    <div class="coverage-plan-head">
      <div>
        <h3>Plan de hoy</h3>
        <p>${items.length ? `${done}/${items.length} acciones completadas` : 'Crea una ruta diaria con las mejores celdas.'}</p>
      </div>
      <button class="btn-outline btn-sm" onclick="generateCoverageDailyPlan()">Regenerar</button>
    </div>
    ${items.length ? items.map(item => renderCoveragePlanItem(item)).join('') : '<div class="coverage-empty-task">Sin plan activo.</div>'}
  </div>`;
}

function showCoverageDailyRoute() {
  const model = getCoverageModel();
  const modal = document.createElement('div');
  modal.className = 'coverage-modal';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="coverage-modal-box coverage-work-modal">
    <button class="coverage-modal-close" onclick="this.closest('.coverage-modal').remove()">x</button>
    <div class="coverage-modal-title">Ruta de hoy</div>
    <div class="coverage-modal-date">Plan operativo para avanzar cobertura, scraping y leads sin perder contexto.</div>
    ${renderCoveragePlanPanel(model)}
  </div>`;
  document.body.appendChild(modal);
}

function showCoverageInbox() {
  const items = getCoverageInboxItems();
  const modal = document.createElement('div');
  modal.className = 'coverage-modal';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="coverage-modal-box coverage-work-modal">
    <button class="coverage-modal-close" onclick="this.closest('.coverage-modal').remove()">x</button>
    <div class="coverage-modal-title">Bandeja de trabajo pendiente</div>
    <div class="coverage-modal-date">Huecos reales entre busqueda, volcado a leads y seguimiento.</div>
    <div class="coverage-pending-list">
      ${items.length ? items.map(item => {
        const c = item.cell;
        const meta = coverageStatusMeta(c.status);
        return `<div class="coverage-pending-row">
          <span class="coverage-pill ${meta.cls}">${coverageEscapeHtml(item.title)}</span>
          <strong>${coverageEscapeHtml(c.location)} · ${coverageEscapeHtml(getCoverageSectorLabel(c.sector))}</strong>
          <em>${coverageEscapeHtml(item.detail)}</em>
          <button class="btn-outline btn-sm" onclick="openCoverageCell('${encodeURIComponent(c.location)}','${encodeURIComponent(c.sector)}')">Abrir</button>
          <button class="btn-primary btn-sm" onclick="resolveCoverageGap('${encodeURIComponent(c.location)}','${encodeURIComponent(c.sector)}','${item.type}');this.closest('.coverage-modal').remove()">Resolver</button>
        </div>`;
      }).join('') : '<div class="coverage-empty-task">No hay tareas pendientes ahora.</div>'}
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function showCoverageProfitPanel() {
  const model = getCoverageModel();
  const rows = buildCoverageCells(model)
    .filter(c => c.entry)
    .map(c => ({ cell: c, profit: getCoverageProfitability(c.location, c.sector) }))
    .sort((a, b) => b.profit.value - a.profit.value)
    .slice(0, 20);
  const totals = getCoverageGlobalProfit(model);
  const modal = document.createElement('div');
  modal.className = 'coverage-modal';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="coverage-modal-box coverage-work-modal">
    <button class="coverage-modal-close" onclick="this.closest('.coverage-modal').remove()">x</button>
    <div class="coverage-modal-title">Rentabilidad por CP y sector</div>
    <div class="coverage-modal-date">${totals.searched} empresas · ${totals.imported} leads · ${totals.contacted} contactados · ${totals.responded} respuestas.</div>
    <div class="coverage-cp-brief">
      <div><strong>${totals.usefulRate}%</strong><span>utiles sobre scraping</span></div>
      <div><strong>${totals.importRate}%</strong><span>volcados sobre utiles</span></div>
      <div><strong>${totals.contactRate}%</strong><span>contactados sobre leads</span></div>
      <div><strong>${totals.responseRate}%</strong><span>respuesta sobre leads</span></div>
    </div>
    <div class="coverage-pending-list">
      ${rows.length ? rows.map(row => `<div class="coverage-pending-row">
        <span class="coverage-pill ${row.profit.value >= 55 ? 'coverage-complete' : row.profit.value >= 25 ? 'coverage-partial' : 'coverage-searched'}">${coverageEscapeHtml(row.profit.label)}</span>
        <strong>${coverageEscapeHtml(row.cell.location)} · ${coverageEscapeHtml(getCoverageSectorLabel(row.cell.sector))}</strong>
        <em>${row.profit.usefulRate}% utiles · ${row.profit.importRate}% volcados · ${row.profit.responseRate}% respuesta</em>
        <button class="btn-outline btn-sm" onclick="openCoverageCell('${encodeURIComponent(row.cell.location)}','${encodeURIComponent(row.cell.sector)}')">Abrir</button>
      </div>`).join('') : '<div class="coverage-empty-task">Todavia no hay suficientes datos para medir rentabilidad.</div>'}
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function resolveCoverageGap(encodedLocation, encodedSector, type = '') {
  if (type === 'unimported') {
    loadCoverageSearch(encodedLocation, encodedSector);
    setTimeout(renderCoveragePostScrapingPanel, 0);
    return;
  }
  if (type === 'followup') {
    filterCoverageCellLeads(encodedLocation, encodedSector);
    return;
  }
  runCoverageSearch(encodedLocation, encodedSector);
}

function renderCoveragePlanItem(item) {
  const done = item.status === 'done';
  const encodedLocation = encodeURIComponent(item.location);
  const encodedSector = encodeURIComponent(item.sector);
  return `<div class="coverage-plan-item ${done ? 'done' : ''}">
    <button class="coverage-plan-check" onclick="toggleCoveragePlanItem('${encodedLocation}','${encodedSector}')">${done ? 'OK' : ''}</button>
    <div><strong>${coverageEscapeHtml(item.location)}</strong><span>${coverageEscapeHtml(getCoverageSectorLabel(item.sector))} · ${coverageEscapeHtml(item.reason || 'Pendiente')}</span></div>
    <button class="btn-outline btn-sm" onclick="runCoverageSearch('${encodedLocation}','${encodedSector}')">Buscar</button>
  </div>`;
}

function getCoverageRecommendations(model) {
  return buildCoverageCells(model)
    .filter(c => c.status !== 'complete' && c.status !== 'empty')
    .sort((a, b) => b.debt - a.debt);
}

function getCoverageBestNextCell(model = getCoverageModel()) {
  return getCoverageRecommendations(model)[0] || null;
}

function runCoverageBestNext() {
  const cell = getCoverageBestNextCell();
  if (!cell) {
    showToast('No hay huecos accionables ahora');
    return;
  }
  runCoverageSearch(encodeURIComponent(cell.location), encodeURIComponent(cell.sector));
}

function getCoverageInboxItems(model = getCoverageModel()) {
  const cells = buildCoverageCells(model);
  const items = [];
  cells.forEach(cell => {
    const funnel = getCoverageCellFunnel(cell.location, cell.sector);
    if (cell.status === 'error') {
      items.push({ type: 'error', priority: 100, cell, title: 'Reintentar error', detail: cell.entry?.error || 'La busqueda anterior fallo' });
    }
    if (cell.entry && (cell.entry.readyCount || 0) > funnel.imported) {
      items.push({
        type: 'unimported',
        priority: 92,
        cell,
        title: 'Leads utiles sin volcar',
        detail: `${(cell.entry.readyCount || 0) - funnel.imported} posibles leads pendientes`,
      });
    }
    if (cell.status === 'pending') {
      items.push({ type: 'pending', priority: 82, cell, title: 'Busqueda pendiente', detail: cell.reason });
    }
    if (cell.status === 'stale') {
      items.push({ type: 'stale', priority: 70, cell, title: 'Cobertura caducada', detail: `Hace ${cell.freshness?.age || '?'} dias` });
    }
    if (funnel.imported && !funnel.contacted) {
      items.push({ type: 'followup', priority: 64, cell, title: 'Leads sin seguimiento', detail: `${funnel.imported} importados sin contacto` });
    }
  });
  return items.sort((a, b) => b.priority - a.priority).slice(0, 12);
}

function getCoverageGlobalProfit(model = getCoverageModel()) {
  const cells = buildCoverageCells(model).filter(c => c.entry);
  const totals = cells.reduce((acc, cell) => {
    const p = getCoverageProfitability(cell.location, cell.sector);
    acc.searched += p.searched;
    acc.useful += p.useful;
    acc.imported += p.imported;
    acc.contacted += p.contacted;
    acc.responded += p.responded;
    return acc;
  }, { searched: 0, useful: 0, imported: 0, contacted: 0, responded: 0 });
  const usefulRate = totals.searched ? Math.round((totals.useful / totals.searched) * 100) : 0;
  const importRate = totals.useful ? Math.round((totals.imported / totals.useful) * 100) : 0;
  const contactRate = totals.imported ? Math.round((totals.contacted / totals.imported) * 100) : 0;
  const responseRate = totals.imported ? Math.round((totals.responded / totals.imported) * 100) : 0;
  return { ...totals, usefulRate, importRate, contactRate, responseRate };
}

function getCoverageDailyPlan() {
  const today = new Date().toISOString().slice(0, 10);
  const plan = coverageSafeJson(COVERAGE_PLAN_KEY, { date: today, items: [] });
  if (plan.date !== today) return { date: today, items: [] };
  return plan;
}

function saveCoverageDailyPlan(plan) {
  coverageSaveJson(COVERAGE_PLAN_KEY, plan);
}

function generateCoverageDailyPlan() {
  const model = getCoverageModel();
  const today = new Date().toISOString().slice(0, 10);
  const items = getCoverageRecommendations(model).slice(0, 12).map(c => ({
    location: c.location,
    sector: c.sector,
    reason: c.reason,
    debt: c.debt,
    status: 'pending',
  }));
  saveCoverageDailyPlan({ date: today, items });
  renderCoverage();
  showToast(items.length ? 'Plan de hoy creado' : 'No hay suficientes objetivos para crear plan');
}

function addCoveragePlanItem(encodedLocation, encodedSector) {
  const location = decodeURIComponent(encodedLocation);
  const sector = decodeURIComponent(encodedSector);
  const plan = getCoverageDailyPlan();
  if (!plan.items.some(i => coverageKey(i.location, i.sector) === coverageKey(location, sector))) {
    plan.items.push({ location, sector, reason: 'Anadido manualmente', debt: 0, status: 'pending' });
    saveCoverageDailyPlan(plan);
  }
  renderCoverage();
  showToast('Anadido al plan de hoy');
}

function toggleCoveragePlanItem(encodedLocation, encodedSector) {
  const location = decodeURIComponent(encodedLocation);
  const sector = decodeURIComponent(encodedSector);
  const plan = getCoverageDailyPlan();
  plan.items = plan.items.map(item => coverageKey(item.location, item.sector) === coverageKey(location, sector)
    ? { ...item, status: item.status === 'done' ? 'pending' : 'done' }
    : item);
  saveCoverageDailyPlan(plan);
  renderCoverage();
}

function completeCoveragePlanItems(location, sectors) {
  const plan = getCoverageDailyPlan();
  let changed = false;
  plan.items = plan.items.map(item => {
    if (normalizeCoverageLocation(item.location) === normalizeCoverageLocation(location) && sectors.includes(item.sector) && item.status !== 'done') {
      changed = true;
      return { ...item, status: 'done' };
    }
    return item;
  });
  if (changed) saveCoverageDailyPlan(plan);
}

function setCoverageSearch(value) {
  coverageSearchTerm = normalizeCoverageLocation(value);
  renderCoverage();
  const input = document.getElementById('coverage-search-input');
  if (input) {
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }
}

function clearCoverageSearch() {
  coverageSearchTerm = '';
  renderCoverage();
  setTimeout(() => document.getElementById('coverage-search-input')?.focus(), 0);
}

function setCoverageSmartFilter(filter) {
  coverageSmartFilter = filter || 'all';
  coverageSaveJson(COVERAGE_FILTER_KEY, coverageSmartFilter);
  renderCoverage();
}

function setCoverageViewMode(mode) {
  coverageViewMode = mode === 'sector' ? 'sector' : 'cp';
  coverageSaveJson(COVERAGE_VIEW_KEY, coverageViewMode);
  renderCoverage();
}

function getCoveragePendingCellsForLocation(location) {
  const model = getCoverageModel();
  return buildCoverageCells(model, [location])
    .filter(isCoverageActionable)
    .sort((a, b) => b.debt - a.debt);
}

function getCoveragePendingCellsForSector(sector) {
  const model = getCoverageModel();
  return buildCoverageCells(model)
    .filter(c => c.sector === sector && isCoverageActionable(c))
    .sort((a, b) => b.debt - a.debt);
}

function openCoveragePendingSearch(encodedLocation) {
  const location = decodeURIComponent(encodedLocation);
  const cells = getCoveragePendingCellsForLocation(location);
  const modal = document.createElement('div');
  modal.className = 'coverage-modal';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="coverage-modal-box coverage-quick-panel">
    <button class="coverage-modal-close" onclick="this.closest('.coverage-modal').remove()">x</button>
    <div class="coverage-modal-title">Pendientes en ${coverageEscapeHtml(location)}</div>
    <div class="coverage-modal-date">${cells.length ? `${cells.length} sectores para buscar, completar o refrescar.` : 'Este CP no tiene huecos accionables con los filtros actuales.'}</div>
    <div class="coverage-pending-list">
      ${cells.length ? cells.map(cell => {
        const meta = coverageStatusMeta(cell.status);
        return `<label class="coverage-pending-row">
          <input type="checkbox" class="coverage-pending-check" value="${coverageEscapeHtml(cell.sector)}" checked>
          <span class="coverage-pill ${meta.cls}">${meta.label}</span>
          <strong>${coverageEscapeHtml(getCoverageSectorLabel(cell.sector))}</strong>
          <em>${cell.entry ? `${cell.freshness.label} · ${getCoverageCellResult(cell)}` : 'Nunca buscado'}</em>
        </label>`;
      }).join('') : '<div class="coverage-empty-task">Nada pendiente aqui.</div>'}
    </div>
    <div class="coverage-modal-actions">
      <button class="btn-outline" onclick="openCoverageLocationTimeline('${encodedLocation}')">Ver ficha CP</button>
      <button class="btn-outline" onclick="addCoverageLocationPendingToPlan('${encodedLocation}');this.closest('.coverage-modal').remove()" ${cells.length ? '' : 'disabled'}>Anadir al plan</button>
      <button class="btn-primary" onclick="runSelectedCoveragePending('${encodedLocation}');this.closest('.coverage-modal').remove()" ${cells.length ? '' : 'disabled'}>Buscar seleccionados</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function openCoverageSectorPanel(encodedSector) {
  const sector = decodeURIComponent(encodedSector);
  const cells = getCoveragePendingCellsForSector(sector);
  const modal = document.createElement('div');
  modal.className = 'coverage-modal';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="coverage-modal-box coverage-quick-panel">
    <button class="coverage-modal-close" onclick="this.closest('.coverage-modal').remove()">x</button>
    <div class="coverage-modal-title">${coverageEscapeHtml(getCoverageSectorLabel(sector))} por CP</div>
    <div class="coverage-modal-date">${cells.length ? `${cells.length} codigos postales pendientes/revisar para este sector.` : 'Este sector no tiene huecos accionables visibles.'}</div>
    <div class="coverage-pending-list">
      ${cells.length ? cells.map(cell => {
        const meta = coverageStatusMeta(cell.status);
        return `<div class="coverage-pending-row">
          <span class="coverage-pill ${meta.cls}">${meta.label}</span>
          <strong>${coverageEscapeHtml(cell.location)}</strong>
          <em>${cell.entry ? `${cell.freshness.label} · ${getCoverageCellResult(cell)}` : 'Nunca buscado'}</em>
          <button class="btn-outline btn-sm" onclick="runCoverageSearch('${encodeURIComponent(cell.location)}','${encodeURIComponent(sector)}');this.closest('.coverage-modal').remove()">Buscar</button>
        </div>`;
      }).join('') : '<div class="coverage-empty-task">Nada pendiente para este sector.</div>'}
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function addCoverageLocationPendingToPlan(encodedLocation) {
  const location = decodeURIComponent(encodedLocation);
  const plan = getCoverageDailyPlan();
  getCoveragePendingCellsForLocation(location).forEach(cell => {
    if (!plan.items.some(i => coverageKey(i.location, i.sector) === coverageKey(cell.location, cell.sector))) {
      plan.items.push({ location: cell.location, sector: cell.sector, reason: cell.reason, debt: cell.debt, status: 'pending' });
    }
  });
  saveCoverageDailyPlan(plan);
  renderCoverage();
  showToast('Pendientes del CP anadidos al plan');
}

function runSelectedCoveragePending(encodedLocation) {
  const location = decodeURIComponent(encodedLocation);
  const selected = [...document.querySelectorAll('.coverage-pending-check:checked')].map(el => el.value);
  if (!selected.length) {
    showToast('No hay sectores seleccionados');
    return;
  }
  runCoverageSectorBatch(location, selected);
}

function runCoverageSectorBatch(location, sectors) {
  startCoverageMission(location, sectors[0] || 'Multi-sector', {
    sectors,
    label: sectors.length > 1 ? `${location} · ${sectors.length} sectores` : `${location} · ${getCoverageSectorLabel(sectors[0])}`,
    status: 'coverage',
  });
  const locEl = document.getElementById('plan-location');
  const multiToggle = document.getElementById('plan-multi-toggle');
  if (locEl) locEl.value = location;
  if (sectors.length === 1) {
    const segEl = document.getElementById('plan-segment');
    if (segEl) segEl.value = sectors[0];
    if (multiToggle) {
      multiToggle.checked = false;
      if (typeof toggleMultiSectorSearch === 'function') toggleMultiSectorSearch(false);
    }
    showView('planner');
    setTimeout(() => {
      coverageBypassRepeatWarning = true;
      if (typeof searchBusinesses === 'function') searchBusinesses();
    }, 250);
    return;
  }
  try { localStorage.setItem('gordi_multi_sector_selection', JSON.stringify(sectors)); } catch {}
  if (multiToggle) {
    multiToggle.checked = true;
    if (typeof toggleMultiSectorSearch === 'function') toggleMultiSectorSearch(true);
  }
  if (typeof renderMultiSectorPicker === 'function') renderMultiSectorPicker();
  showView('planner');
  setTimeout(() => {
    coverageBypassRepeatWarning = true;
    if (typeof searchBusinesses === 'function') searchBusinesses();
  }, 300);
}

function addCoverageQueryAsLocation(encodedQuery) {
  const value = normalizeCoverageLocation(decodeURIComponent(encodedQuery || ''));
  if (!value) return;
  const targets = getCoverageTargets();
  targets.locations.push(value);
  saveCoverageTargets(targets);
  coverageSearchTerm = value;
  renderCoverage();
  showToast('CP/zona anadido como objetivo de cobertura');
}

function startCoverageQuerySearch(encodedQuery) {
  const value = normalizeCoverageLocation(decodeURIComponent(encodedQuery || ''));
  if (!value) return;
  const locEl = document.getElementById('plan-location');
  if (locEl) locEl.value = value;
  showView('planner');
}

function addCoverageLocation() {
  const input = document.getElementById('coverage-location-input');
  const value = normalizeCoverageLocation(input?.value || '');
  if (!value) return;
  const targets = getCoverageTargets();
  targets.locations.push(value);
  saveCoverageTargets(targets);
  if (input) input.value = '';
  renderCoverage();
}

function addCoverageSector() {
  const select = document.getElementById('coverage-sector-select');
  const value = select?.value || '';
  if (!value) return;
  const targets = getCoverageTargets();
  targets.sectors.push(value);
  saveCoverageTargets(targets);
  renderCoverage();
}

function removeCoverageLocation(encoded) {
  const value = decodeURIComponent(encoded);
  const targets = getCoverageTargets();
  targets.locations = targets.locations.filter(l => l !== value);
  saveCoverageTargets(targets);
  renderCoverage();
}

function removeCoverageSector(encoded) {
  const value = decodeURIComponent(encoded);
  const targets = getCoverageTargets();
  targets.sectors = targets.sectors.filter(s => s !== value);
  saveCoverageTargets(targets);
  renderCoverage();
}

function clearCoverageTargets() {
  saveCoverageTargets({ locations: [], sectors: [] });
  renderCoverage();
}

function addCurrentSearchAsCoverageTarget() {
  const location = normalizeCoverageLocation(document.getElementById('plan-location')?.value || '');
  const sectors = document.getElementById('plan-multi-toggle')?.checked && typeof getMultiSectorSelection === 'function'
    ? getMultiSectorSelection()
    : [document.getElementById('plan-segment')?.value].filter(Boolean);
  if (!location || !sectors.length) {
    showToast('Define una zona y sector en Buscar primero');
    return;
  }
  const targets = getCoverageTargets();
  targets.locations.push(location);
  targets.sectors.push(...sectors);
  saveCoverageTargets(targets);
  renderCoverage();
  showToast('Objetivo anadido al mapa de cobertura');
}

function openCoverageCell(encodedLocation, encodedSector) {
  const location = decodeURIComponent(encodedLocation);
  const sector = decodeURIComponent(encodedSector);
  const entry = getCoverageEntries().find(e => e.key === coverageKey(location, sector));
  if (!entry) {
    runCoverageSearch(encodedLocation, encodedSector);
    return;
  }
  const freshness = getCoverageCellFreshness(entry);
  const funnel = getCoverageCellFunnel(location, sector);
  const profit = getCoverageProfitability(location, sector);
  const modal = document.createElement('div');
  modal.className = 'coverage-modal';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="coverage-modal-box">
    <button class="coverage-modal-close" onclick="this.closest('.coverage-modal').remove()">x</button>
    <div class="coverage-modal-title">${coverageEscapeHtml(getCoverageSectorIcon(sector))} ${coverageEscapeHtml(getCoverageSectorLabel(sector))} · ${coverageEscapeHtml(location)}</div>
    <div class="coverage-modal-date">Ultima busqueda: ${entry.date ? new Date(entry.date).toLocaleString('es-ES') : 'sin fecha'} · frescura ${freshness.label}</div>
    <div class="coverage-modal-grid">
      ${coverageSummaryCard('Empresas', entry.uniqueCount || 0, 'unicas guardadas')}
      ${coverageSummaryCard('Listas', entry.readyCount || 0, 'con contacto util')}
      ${coverageSummaryCard('Importadas', entry.importedCount || 0, 'ya en Leads')}
      ${coverageSummaryCard('Emails', entry.emailCount || 0, 'detectados')}
    </div>
    <div class="coverage-funnel">
      <div><b>${funnel.searched}</b><span>Buscadas</span></div>
      <div><b>${funnel.useful}</b><span>Utiles</span></div>
      <div><b>${funnel.imported}</b><span>Importadas</span></div>
      <div><b>${funnel.contacted}</b><span>Contactadas</span></div>
      <div><b>${funnel.responded}</b><span>Respondieron</span></div>
    </div>
    <div class="coverage-profit-strip">
      <strong>${coverageEscapeHtml(profit.label)}</strong>
      <span>${profit.usefulRate}% utiles · ${profit.importRate}% volcados · ${profit.responseRate}% respuesta</span>
    </div>
    ${entry.error ? `<div class="coverage-error-box">${coverageEscapeHtml(entry.error)}</div>` : ''}
    <div class="coverage-modal-actions">
      <button class="btn-primary" onclick="runCoverageSearch('${encodedLocation}','${encodedSector}');this.closest('.coverage-modal').remove()">Re-lanzar</button>
      <button class="btn-outline" onclick="loadCoverageSearch('${encodedLocation}','${encodedSector}');this.closest('.coverage-modal').remove()">Ver resultados</button>
      <button class="btn-outline" onclick="filterCoverageCellLeads('${encodedLocation}','${encodedSector}');this.closest('.coverage-modal').remove()">Ver leads</button>
      <button class="btn-outline" onclick="openCoverageLocationTimeline('${encodedLocation}');this.closest('.coverage-modal').remove()">Timeline CP</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function openCoverageLocationTimeline(encodedLocation) {
  const location = decodeURIComponent(encodedLocation);
  const events = getCoverageEvents()
    .filter(e => normalizeCoverageLocation(e.location) === normalizeCoverageLocation(location))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const entries = getCoverageEntries()
    .filter(e => normalizeCoverageLocation(e.location) === normalizeCoverageLocation(location))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const model = getCoverageModel();
  const cells = buildCoverageCells(model, [location]).sort((a, b) => b.debt - a.debt);
  const summary = getCoverageLocationSummary(location, model.sectors, cells);
  const searchedLabels = cells.filter(c => c.entry).map(c => getCoverageSectorLabel(c.sector));
  const pendingLabels = cells.filter(isCoverageActionable).map(c => getCoverageSectorLabel(c.sector));
  const covered = entries.length;
  const total = Math.max(model.sectors.length, covered);
  const pct = total ? Math.round((covered / total) * 100) : 0;
  const modal = document.createElement('div');
  modal.className = 'coverage-modal';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="coverage-modal-box coverage-timeline-modal">
    <button class="coverage-modal-close" onclick="this.closest('.coverage-modal').remove()">x</button>
    <div class="coverage-modal-title">Timeline de ${coverageEscapeHtml(location)}</div>
    <div class="coverage-modal-date">Cobertura estimada ${summary.percent || pct}% · ${summary.searched}/${summary.total} sectores con historial · ultimo ${summary.lastEntry ? summary.lastFreshness.label : 'nunca'}</div>
    <div class="coverage-cp-brief">
      <div><strong>Buscados</strong><span>${searchedLabels.length ? coverageEscapeHtml(searchedLabels.join(', ')) : 'Ninguno todavia'}</span></div>
      <div><strong>Pendientes/revisar</strong><span>${pendingLabels.length ? coverageEscapeHtml(pendingLabels.join(', ')) : 'Nada pendiente'}</span></div>
    </div>
    <div class="coverage-modal-actions">
      <button class="btn-primary" onclick="openCoveragePendingSearch('${encodedLocation}');this.closest('.coverage-modal').remove()" ${pendingLabels.length ? '' : 'disabled'}>Buscar lo que falta</button>
      <button class="btn-outline" onclick="addCoverageLocationPendingToPlan('${encodedLocation}')" ${pendingLabels.length ? '' : 'disabled'}>Anadir al plan</button>
    </div>
    <div class="coverage-timeline">
      ${events.length ? events.slice(0, 30).map(event => {
        const fresh = getCoverageCellFreshness(event);
        return `<div class="coverage-timeline-item">
          <div class="coverage-timeline-dot ${fresh.cls}"></div>
          <div>
            <strong>${coverageEscapeHtml(getCoverageSectorLabel(event.sector))}</strong>
            <span>${event.date ? new Date(event.date).toLocaleString('es-ES') : 'sin fecha'} · ${event.uniqueCount || 0} empresas · ${event.readyCount || 0} listas · ${event.importedCount || 0} leads${event.error ? ` · ${coverageEscapeHtml(event.error)}` : ''}</span>
          </div>
          <button class="btn-outline btn-sm" onclick="loadCoverageSearch('${encodeURIComponent(location)}','${encodeURIComponent(event.sector)}')">Ver</button>
        </div>`;
      }).join('') : entries.length ? entries.map(entry => {
        const fresh = getCoverageCellFreshness(entry);
        return `<div class="coverage-timeline-item">
          <div class="coverage-timeline-dot ${fresh.cls}"></div>
          <div>
            <strong>${coverageEscapeHtml(getCoverageSectorLabel(entry.sector))}</strong>
            <span>${entry.date ? new Date(entry.date).toLocaleString('es-ES') : 'sin fecha'} · ${entry.uniqueCount || 0} empresas · ${entry.readyCount || 0} listas · ${entry.importedCount || 0} leads</span>
          </div>
          <button class="btn-outline btn-sm" onclick="loadCoverageSearch('${encodeURIComponent(location)}','${encodeURIComponent(entry.sector)}')">Ver</button>
        </div>`;
      }).join('') : '<div class="coverage-empty-task">Este CP todavia no tiene busquedas guardadas.</div>'}
    </div>
    <h3 class="coverage-modal-subtitle">Siguientes huecos</h3>
    ${cells.filter(c => c.status !== 'complete').slice(0, 5).map(c => `<div class="coverage-task">
      <div><strong>${coverageEscapeHtml(getCoverageSectorLabel(c.sector))}</strong><span>${coverageEscapeHtml(c.reason)} · deuda ${Math.round(c.debt)}</span></div>
      <button class="btn-primary btn-sm" onclick="runCoverageSearch('${encodeURIComponent(c.location)}','${encodeURIComponent(c.sector)}');this.closest('.coverage-modal').remove()">Buscar</button>
    </div>`).join('') || '<div class="coverage-empty-task">No hay huecos pendientes visibles.</div>'}
  </div>`;
  document.body.appendChild(modal);
}

function loadCoverageSearch(encodedLocation, encodedSector) {
  const location = decodeURIComponent(encodedLocation);
  const sector = decodeURIComponent(encodedSector);
  const searches = typeof getSavedSearches === 'function' ? getSavedSearches() : [];
  const match = searches.find(s => normalizeCoverageLocation(s.location) === location &&
    (s.segment === sector || (s.results || []).some(r => r.sourceSector === sector || r.segment === sector || (r.matchedSectors || []).includes(sector))));
  if (!match || !match.results?.length) {
    showToast('No hay resultados guardados para esta celda');
    return;
  }
  tempSearchResults = match.results;
  const locEl = document.getElementById('plan-location');
  const segEl = document.getElementById('plan-segment');
  if (locEl) locEl.value = location;
  if (segEl && sector !== 'Multi-sector') segEl.value = sector;
  showView('planner');
  renderSearchCards();
  showResultsPanel();
  updateEnrichStats();
}

function loadCoverageSearchById(searchId) {
  const searches = typeof getSavedSearches === 'function' ? getSavedSearches() : [];
  const match = searches.find(s => String(s.id) === String(searchId));
  if (!match || !match.results?.length) {
    showToast('No hay resultados guardados para esta mision');
    return;
  }
  tempSearchResults = match.results;
  const locEl = document.getElementById('plan-location');
  const segEl = document.getElementById('plan-segment');
  if (locEl) locEl.value = match.location || '';
  if (segEl && match.segment && match.segment !== 'Multi-sector') segEl.value = match.segment;
  showView('planner');
  renderSearchCards();
  showResultsPanel();
  updateEnrichStats();
}

function runCoverageSearch(encodedLocation, encodedSector, force = false) {
  const location = decodeURIComponent(encodedLocation);
  const sector = decodeURIComponent(encodedSector);
  if (!force && shouldWarnRepeatedCoverageSearch(location, sector)) {
    showCoverageRepeatWarning(location, sector);
    return;
  }
  const locEl = document.getElementById('plan-location');
  const segEl = document.getElementById('plan-segment');
  const multiToggle = document.getElementById('plan-multi-toggle');
  if (locEl) locEl.value = location;
  if (segEl) segEl.value = sector;
  startCoverageMission(location, sector, { status: 'coverage', searchMode: 'single' });
  if (multiToggle) {
    multiToggle.checked = false;
    if (typeof toggleMultiSectorSearch === 'function') toggleMultiSectorSearch(false);
  }
  showView('planner');
  setTimeout(() => {
    if (typeof searchBusinesses === 'function') {
      window.__gordiBypassRepeatPreflight = true;
      coverageBypassRepeatWarning = true;
      searchBusinesses();
    }
  }, 250);
}

function shouldWarnRepeatedCoverageSearch(location, sector) {
  const entry = getCoverageEntries().find(e => e.key === coverageKey(location, sector));
  if (!entry) return false;
  const age = coverageAgeDays(entry);
  return age !== null && age <= COVERAGE_REPEAT_WARN_DAYS && entry.status !== 'error';
}

function showCoverageRepeatWarning(location, sector) {
  const entry = getCoverageEntries().find(e => e.key === coverageKey(location, sector));
  const age = coverageAgeDays(entry);
  const encodedLocation = encodeURIComponent(location);
  const encodedSector = encodeURIComponent(sector);
  const modal = document.createElement('div');
  modal.className = 'coverage-modal';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="coverage-modal-box coverage-repeat-box">
    <button class="coverage-modal-close" onclick="this.closest('.coverage-modal').remove()">x</button>
    <div class="coverage-modal-title">Busqueda reciente detectada</div>
    <p class="coverage-repeat-copy">Ya buscaste ${coverageEscapeHtml(getCoverageSectorLabel(sector))} en ${coverageEscapeHtml(location)} hace ${age} dias. Se guardaron ${entry?.uniqueCount || 0} empresas, ${entry?.readyCount || 0} listas y ${entry?.importedCount || 0} leads.</p>
    <div class="coverage-modal-actions">
      <button class="btn-outline" onclick="loadCoverageSearch('${encodedLocation}','${encodedSector}');this.closest('.coverage-modal').remove()">Ver resultados</button>
      <button class="btn-outline" onclick="prepareCoverageExpandedSearch('${encodedLocation}','${encodedSector}');this.closest('.coverage-modal').remove()">Ampliar radio</button>
      <button class="btn-primary" onclick="runCoverageSearch('${encodedLocation}','${encodedSector}',true);this.closest('.coverage-modal').remove()">Buscar igualmente</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function prepareCoverageExpandedSearch(encodedLocation, encodedSector) {
  const location = decodeURIComponent(encodedLocation);
  const sector = decodeURIComponent(encodedSector);
  const locEl = document.getElementById('plan-location');
  const segEl = document.getElementById('plan-segment');
  const radiusEl = document.getElementById('plan-radius');
  if (locEl) locEl.value = location;
  if (segEl) segEl.value = sector;
  if (radiusEl) radiusEl.value = Math.max(Number(radiusEl.value || 0), 8);
  showView('planner');
  showToast('Busqueda preparada con radio ampliado');
}

function ensureCoverageMissionFromIntent(intent = getCoverageCurrentIntent()) {
  if (!intent.location || !intent.sectors.length) return null;
  const current = getCoverageActiveMission();
  const same = current
    && normalizeCoverageLocation(current.location) === normalizeCoverageLocation(intent.location)
    && (current.sectors || []).join('|') === intent.sectors.join('|');
  if (same) return current;
  return startCoverageMission(intent.location, intent.sectors[0] || 'Multi-sector', {
    sectors: intent.sectors,
    label: intent.sectors.length > 1 ? `${intent.location} · ${intent.sectors.length} sectores` : `${intent.location} · ${getCoverageSectorLabel(intent.sectors[0])}`,
    status: 'scraping',
  });
}

function getCoverageCurrentIntent() {
  const location = normalizeCoverageLocation(document.getElementById('plan-location')?.value || '');
  const multiEnabled = !!document.getElementById('plan-multi-toggle')?.checked;
  const sectors = multiEnabled && typeof getMultiSectorSelection === 'function'
    ? getMultiSectorSelection()
    : [document.getElementById('plan-segment')?.value].filter(Boolean);
  return { location, sectors, multiEnabled };
}

function getCoverageRecentMatches(location, sectors) {
  if (!location || !Array.isArray(sectors) || !sectors.length) return [];
  return sectors.map(sector => {
    const entry = getCoverageEntries().find(e => e.key === coverageKey(location, sector));
    const age = coverageAgeDays(entry);
    return { sector, entry, age };
  }).filter(match => match.entry && match.age !== null && match.age <= COVERAGE_REPEAT_WARN_DAYS && match.entry.status !== 'error');
}

function showCoverageIntentRepeatWarning(intent, matches) {
  const modal = document.createElement('div');
  modal.className = 'coverage-modal';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `<div class="coverage-modal-box coverage-repeat-box">
    <button class="coverage-modal-close" onclick="this.closest('.coverage-modal').remove()">x</button>
    <div class="coverage-modal-title">Busqueda reciente detectada</div>
    <p class="coverage-repeat-copy">${coverageEscapeHtml(intent.location)} tiene ${matches.length} sector${matches.length === 1 ? '' : 'es'} buscado${matches.length === 1 ? '' : 's'} en los ultimos ${COVERAGE_REPEAT_WARN_DAYS} dias.</p>
    <div class="coverage-repeat-list">
      ${matches.map(match => `<div class="coverage-repeat-row">
        <strong>${coverageEscapeHtml(getCoverageSectorLabel(match.sector))}</strong>
        <span>hace ${match.age} dias · ${match.entry.uniqueCount || 0} empresas · ${match.entry.readyCount || 0} listas · ${match.entry.importedCount || 0} leads</span>
      </div>`).join('')}
    </div>
    <div class="coverage-modal-actions">
      <button class="btn-outline" onclick="showView('coverage');this.closest('.coverage-modal').remove()">Ver cobertura</button>
      <button class="btn-primary" onclick="window.__gordiBypassRepeatPreflight=true;coverageBypassRepeatWarning=true;searchBusinesses();this.closest('.coverage-modal').remove()">Buscar igualmente</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function installCoverageSearchPreflight() {
  if (typeof searchBusinesses !== 'function' || searchBusinesses._coveragePreflight) return false;
  const original = searchBusinesses;
  searchBusinesses = function(...args) {
    if (coverageBypassRepeatWarning || window.__gordiBypassRepeatPreflight) {
      coverageBypassRepeatWarning = false;
      window.__gordiBypassRepeatPreflight = false;
      return original.apply(this, args);
    }
    const intent = getCoverageCurrentIntent();
    const matches = getCoverageRecentMatches(intent.location, intent.sectors);
    if (matches.length) {
      showCoverageIntentRepeatWarning(intent, matches);
      return Promise.resolve(false);
    }
    ensureCoverageMissionFromIntent(intent);
    updateCoverageMission({ status: 'scraping', lastSearchStatus: 'running' });
    return original.apply(this, args);
  };
  searchBusinesses._coveragePreflight = true;
  return true;
}

function getCoverageResultStats() {
  const results = Array.isArray(tempSearchResults) ? tempSearchResults : [];
  const duplicates = results.filter(c => leads.some(l => !l.archived && isSameBusiness({ ...c, company: c.name }, l))).length;
  const ready = results.filter(c => c.email && (c.decision_maker || c.phone)).length;
  const recommended = results.filter(c => c.email && !leads.some(l => !l.archived && isSameBusiness({ ...c, company: c.name }, l)) && (c.opportunityScore || c.score || 0) >= 35).length;
  return { total: results.length, ready, duplicates, recommended };
}

function resolveCoverageSearchStage(mission, stats) {
  const current = mission?.status || 'coverage';
  const lastSearchStatus = mission?.lastSearchStatus || '';
  if (['leads', 'import', 'followup'].includes(current)) return current;
  if (lastSearchStatus === 'error') return 'error';
  if (stats.total > 0) return 'review';
  if (lastSearchStatus === 'empty') return 'empty';
  return current === 'scraping' ? 'empty' : current;
}

function renderCoveragePostScrapingPanel() {
  const mission = getCoverageActiveMission();
  const panel = document.getElementById('search-results-panel');
  if (!panel || !mission || !Array.isArray(tempSearchResults)) return;
  let box = document.getElementById('coverage-post-scraping');
  if (!box) {
    box = document.createElement('div');
    box.id = 'coverage-post-scraping';
    const anchor = document.getElementById('enrich-stats-bar') || panel.firstElementChild;
    if (anchor?.parentNode === panel) panel.insertBefore(box, anchor.nextSibling);
    else panel.prepend(box);
  }
  const stats = getCoverageResultStats();
  const stage = resolveCoverageSearchStage(mission, stats);
  updateCoverageMission({
    status: stage,
    lastSearchStatus: mission.lastSearchStatus || (stats.total ? 'complete' : 'empty'),
    searchedCount: stats.total,
    readyCount: stats.ready,
    duplicateCount: stats.duplicates,
  });
  const summary = mission.lastSearchStatus === 'error'
    ? 'La ultima ejecucion fallo o agoto las consultas. Revisa la clave, la cuota o vuelve a lanzar la busqueda.'
    : stats.total
      ? `${stats.total} empresas encontradas · ${stats.ready} listas · ${stats.duplicates} duplicadas · ${stats.recommended} recomendadas para Leads`
      : 'Sin resultados en esta busqueda. Puedes ampliar radio, reintentar o cerrar la mision.';
  const primaryAction = stats.total
    ? `<button class="btn-primary btn-sm" onclick="coverageImportRecommended()">Importar recomendadas</button>`
    : `<button class="btn-primary btn-sm" onclick="runCoverageSearch('${encodeURIComponent(mission.location || '')}','${encodeURIComponent(mission.sector || mission.sectors?.[0] || '')}',true)">Reintentar</button>`;
  box.className = 'coverage-post-scraping';
  box.innerHTML = `
    <div>
      <strong>${coverageEscapeHtml(mission.label)} · cierre de scraping</strong>
      <span>${summary}</span>
    </div>
    <div class="coverage-post-actions">
      ${primaryAction}
      <button class="btn-outline btn-sm" onclick="coverageReviewResults()">Revisar resultados</button>
      <button class="btn-outline btn-sm" onclick="showCoverageMissionCoverage()">Ver cobertura</button>
      <button class="btn-outline btn-sm" onclick="showCoverageMissionLeads()">Ver leads</button>
      <button class="btn-outline btn-sm" onclick="runNextCoveragePendingFromMission()">Siguiente pendiente</button>
      <button class="btn-outline btn-sm" onclick="coverageCloseMission()">Cerrar mision</button>
    </div>`;
}

function coverageReviewResults() {
  if (typeof renderSearchCards === 'function') renderSearchCards();
  if (typeof showResultsPanel === 'function') showResultsPanel();
  const panel = document.getElementById('search-results-panel');
  panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function coverageCloseMission() {
  const mission = getCoverageActiveMission();
  if (!mission) return;
  appendCoverageEvent({
    key: coverageKey(mission.location, mission.sector),
    location: mission.location,
    sector: mission.sector,
    mode: (mission.sectors || []).length > 1 ? 'multi' : 'single',
    type: 'mission_closed',
    status: 'closed',
    uniqueCount: mission.searchedCount || 0,
    readyCount: mission.readyCount || 0,
    importedCount: mission.importedCount || 0,
  });
  clearCoverageMission();
}

function coverageSelectRecommendedResults() {
  const results = Array.isArray(tempSearchResults) ? tempSearchResults : [];
  const checks = typeof getVisibleSearchChecks === 'function'
    ? getVisibleSearchChecks()
    : [...document.querySelectorAll('.search-check')];
  const recommended = results
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => {
      const visible = checks.some(ch => parseInt(ch.getAttribute('data-index'), 10) === i);
      const passes = typeof searchResultPassesFilters === 'function' ? searchResultPassesFilters(c) : true;
      return visible && passes && c.email && !leads.some(l => !l.archived && isSameBusiness({ ...c, company: c.name }, l)) && (c.opportunityScore || c.score || 0) >= 35;
    })
    .slice(0, 20)
    .map(x => x.i);
  checks.forEach(ch => {
    const idx = parseInt(ch.getAttribute('data-index'), 10);
    ch.checked = recommended.includes(idx);
  });
  return recommended.length;
}

function coverageImportRecommended() {
  if (!Array.isArray(tempSearchResults) || !tempSearchResults.length) {
    showToast('No hay resultados para importar');
    return;
  }
  const selected = coverageSelectRecommendedResults();
  if (!selected) {
    showToast('No hay recomendadas nuevas con email');
    return;
  }
  updateCoverageMission({ status: 'import', selectedCount: selected });
  if (typeof importSelectedSearch === 'function') importSelectedSearch();
}

function runNextCoveragePendingFromMission() {
  const mission = getCoverageActiveMission();
  if (!mission) return;
  const cells = getCoveragePendingCellsForLocation(mission.location)
    .filter(c => c.sector !== mission.sector)
    .sort((a, b) => b.debt - a.debt);
  if (!cells.length) {
    showToast('No quedan pendientes accionables en este CP');
    return;
  }
  runCoverageSearch(encodeURIComponent(cells[0].location), encodeURIComponent(cells[0].sector));
}

function installCoverageSearchResultHooks() {
  if (typeof renderSearchCards === 'function' && !renderSearchCards._coverageWrapped) {
    const originalCards = renderSearchCards;
    renderSearchCards = function(...args) {
      const out = originalCards.apply(this, args);
      setTimeout(renderCoveragePostScrapingPanel, 0);
      return out;
    };
    renderSearchCards._coverageWrapped = true;
  }
  if (typeof showResultsPanel === 'function' && !showResultsPanel._coverageWrapped) {
    const originalShowResults = showResultsPanel;
    showResultsPanel = function(...args) {
      const out = originalShowResults.apply(this, args);
      setTimeout(renderCoveragePostScrapingPanel, 0);
      return out;
    };
    showResultsPanel._coverageWrapped = true;
  }
  if (typeof buildLeadFromSearchCompany === 'function' && !buildLeadFromSearchCompany._coverageWrapped) {
    const originalBuildLead = buildLeadFromSearchCompany;
    buildLeadFromSearchCompany = function(c, segment, location, campaignName = '') {
      const lead = originalBuildLead.apply(this, arguments);
      const mission = getCoverageActiveMission();
      const loc = normalizeCoverageLocation(location);
      const sector = c?.sourceSector || segment;
      const missionSectors = Array.isArray(mission?.sectors) ? mission.sectors : [mission?.sector].filter(Boolean);
      const sameMissionSector = !missionSectors.length || missionSectors.includes(sector) || mission?.sector === sector;
      if (mission && normalizeCoverageLocation(mission.location) === loc && sameMissionSector) {
        lead.coverageMission = {
          id: mission.id,
          label: mission.label,
          location: mission.location,
          sector: sector || mission.sector,
        };
        lead.coverageMissionId = mission.id;
        lead.coverageMissionLabel = mission.label;
      }
      lead.coverageLocation = loc;
      lead.coverageSector = sector;
      lead.tags = [...new Set([...(lead.tags || []), 'cobertura'])];
      return lead;
    };
    buildLeadFromSearchCompany._coverageWrapped = true;
  }
  if (typeof importSelectedSearch === 'function' && !importSelectedSearch._coverageWrapped) {
    const originalImport = importSelectedSearch;
    importSelectedSearch = async function(...args) {
      const before = leads.length;
      const out = await originalImport.apply(this, args);
      const mission = getCoverageActiveMission();
      if (mission) {
        const imported = leads.filter(l => getCoverageMissionForLead(l)?.id === mission.id).length;
        updateCoverageMission({ status: 'leads', importedCount: imported || Math.max(0, leads.length - before) });
        renderCoveragePostScrapingPanel();
      }
      return out;
    };
    importSelectedSearch._coverageWrapped = true;
  }
  if (typeof quickImportOne === 'function' && !quickImportOne._coverageWrapped) {
    const originalQuick = quickImportOne;
    quickImportOne = function(...args) {
      const before = leads.length;
      const out = originalQuick.apply(this, args);
      const mission = getCoverageActiveMission();
      if (mission && leads.length > before) {
        const imported = leads.filter(l => getCoverageMissionForLead(l)?.id === mission.id).length;
        updateCoverageMission({ status: 'leads', importedCount: imported });
      }
      return out;
    };
    quickImportOne._coverageWrapped = true;
  }
  return true;
}

(function hookCoverageSavedSearches() {
  const install = () => {
    if (typeof saveCurrentSearch !== 'function' || saveCurrentSearch._coverageWrapped) return false;
    const original = saveCurrentSearch;
    saveCurrentSearch = function(results, segment, location, importedCount) {
      const out = original.apply(this, arguments);
      const latestSearch = (typeof getSavedSearches === 'function' ? getSavedSearches() : [])
        .find(s => normalizeCoverageLocation(s.location) === normalizeCoverageLocation(location)
          && (s.segment === segment || segment === 'Multi-sector'));
      const sectors = inferCoverageSectors({ segment, location }, results || []);
      recordSearchCoverage({
        location,
        sectors,
        mode: segment === 'Multi-sector' || sectors.length > 1 ? 'multi' : 'single',
        status: (results || []).length ? 'complete' : 'partial',
        results: results || [],
        rawCount: (results || []).length,
      });
      const mission = getCoverageActiveMission();
      if (mission && normalizeCoverageLocation(mission.location) === normalizeCoverageLocation(location)) {
        const stats = summarizeCoverageResults(results || []);
        updateCoverageMission({
          status: stats.uniqueCount ? 'review' : 'empty',
          lastSearchStatus: stats.uniqueCount ? 'complete' : 'empty',
          searchedCount: stats.uniqueCount,
          readyCount: stats.readyCount,
          importedCount: Math.max(mission.importedCount || 0, importedCount || 0),
          resultSearchId: latestSearch?.id || mission.resultSearchId,
        });
      }
      return out;
    };
    saveCurrentSearch._coverageWrapped = true;
    return true;
  };
  if (!install()) {
    document.addEventListener('DOMContentLoaded', () => setTimeout(install, 800));
  }
})();

function bootCoverageModule() {
  if (window.__gordiCoverageBooted) return;
  window.__gordiCoverageBooted = true;
  replayCoverageFlowEvents();
  if (!installCoverageSearchPreflight()) setTimeout(installCoverageSearchPreflight, 900);
  installCoverageSearchResultHooks();
  setTimeout(installCoverageSearchResultHooks, 900);
  if (typeof showView === 'function' && !showView._coverageFlowWrapped) {
    const originalShowView = showView;
    showView = function(...args) {
      const out = originalShowView.apply(this, args);
      setTimeout(renderCoverageFlowBar, 0);
      return out;
    };
    showView._coverageFlowWrapped = true;
  }
  const coverageView = document.getElementById('coverage-view');
  if (coverageView && coverageView.classList.contains('active')) renderCoverageFlowBar();
  setTimeout(() => {
    const view = document.getElementById('coverage-view');
    if (view && view.classList.contains('active')) renderCoverage();
  }, 900);
}

Object.assign(window, {
  normalizeCoverageLocation,
  getCoverageSectorLabel,
  getCoverageTargets,
  getCoverageActiveMission,
  renderCoverage,
  renderCoverageFlowBar,
  openCoverageForLocation,
  filterCoverageCellLeads,
  setCoverageLeadScope,
  getCoverageLeadScope,
  clearCoverageLeadScope,
  runCoverageBestNext,
  setCoverageSearch,
  setCoverageSmartFilter,
  setCoverageViewMode,
  openCoveragePendingSearch,
  openCoverageSectorPanel,
  runCoverageSectorBatch,
  openCoverageCell,
  openCoverageLocationTimeline,
  loadCoverageSearch,
  loadCoverageSearchById,
  runCoverageSearch,
  renderCoveragePostScrapingPanel,
  getCoverageModel,
  buildCoverageCells,
  getCoverageEntries,
  getCoverageCellFunnel,
  isCoverageActionable,
  recordSearchCoverage,
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootCoverageModule);
} else {
  bootCoverageModule();
}
