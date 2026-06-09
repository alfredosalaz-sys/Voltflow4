// ============================================================
// MOTOR DE BÚSQUEDA — 3 CAPAS + SCRAPING AVANZADO
// Capa 1: Google Places API  -> nombre, dirección, rating, web, teléfono, horario
// Capa 2: Web Scraping PRO   -> emails, redes, decisor, descripción, JSON-LD, Schema.org
// Capa 3: Hunter.io          -> verificación y búsqueda de emails corporativos
// ============================================================

// ── Proxies CORS (se prueban en orden, primer éxito gana) ────────────────────
// ── Lista de proxies CORS — actualizada 2026 ─────────────────────────────────
// Se intentan en orden; el sistema aprende cuáles funcionan mejor en la sesión
// y los sube en el ranking automáticamente.


// --------------------------------------------------------------------------
// ██  MÓDULO: SCRAPING
// ──  Motor de scraping y enriquecimiento web de empresas
// ──  Funciones: CORS_PROXIES, _proxyStats, _getSortedProxies, fetchWithProxy, enrichFromWeb,
  //          enrichFromHunter, enrichFromApollo, enrichFromWhois, enrichFromOpenCorporates,
  //          enrichFromNews, enrichFromStreetView, enrichFromBorme,
  //          enrichFromEmpressite, enrichFromExperian, extractEmailWithAI
// --------------------------------------------------------------------------

const CORS_PROXIES = [
  // ── Tier 1: alta fiabilidad ─────────────────────────────────────────────
  { url: 'https://api.allorigins.win/get?url=',           mode: 'allorigins' },
  { url: 'https://corsproxy.io/?',                        mode: 'raw' },
  { url: 'https://api.allorigins.win/raw?url=',           mode: 'raw' },
  // ── Tier 2: alternativos ────────────────────────────────────────────────
  { url: 'https://cors-anywhere.hexlet.io/',              mode: 'raw' },
  { url: 'https://proxy.cors.sh/',                        mode: 'raw' },
  { url: 'https://cors.eu.org/',                          mode: 'raw' },
  { url: 'https://api.codetabs.com/v1/proxy?quest=',      mode: 'raw' },
];

const PERF = {
  webBatch: 3,
  externalBatch: 2,
  signalBatch: 3,
  advancedBatch: 2,
  uiYieldMs: 0,
};

let multiSectorSearchState = null;
let currentMultiSectorFilter = 'all';

function extractDomain(url) {
  try {
    if (!url) return null;
    const value = String(url).trim();
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return parsed.hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }
}

function resetSearchRuntimeFilters() {
  currentResultFilter = 'all';
  currentUXStatusFilter = 'all';
  currentMultiSectorFilter = 'all';
  currentSearchMinOpportunity = null;
  ['search-results-text'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.querySelectorAll('.search-data-filter').forEach(el => { el.checked = false; });
  const match = document.getElementById('search-data-match');
  if (match) match.value = 'all';
  const sort = document.getElementById('search-results-sort');
  if (sort) sort.value = 'default';
}

function getSegmentLabel(seg) {
  return (typeof SEGMENT_LABELS !== 'undefined' && SEGMENT_LABELS[seg]) || seg;
}

function getMultiSectorSelection() {
  return [...document.querySelectorAll('.multi-sector-check:checked')].map(el => el.value);
}

function saveMultiSectorSelection() {
  try { localStorage.setItem('gordi_multi_sector_selection', JSON.stringify(getMultiSectorSelection())); } catch {}
  updateMultiSectorSummary();
}

function renderMultiSectorPicker() {
  const list = document.getElementById('multi-sector-list');
  if (!list || typeof SEGMENT_LABELS === 'undefined') return;
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('gordi_multi_sector_selection') || '[]'); } catch {}
  const current = document.getElementById('plan-segment')?.value;
  if (!saved.length && current) saved = [current];
  const segments = Object.keys(SEGMENT_LABELS);
  list.innerHTML = segments.map(seg => `
    <label style="display:inline-flex;align-items:center;gap:.35rem;border:1px solid var(--glass-border);background:rgba(255,255,255,.035);border-radius:999px;padding:.35rem .6rem;font-size:.75rem;cursor:pointer">
      <input class="multi-sector-check" type="checkbox" value="${seg}" ${saved.includes(seg) ? 'checked' : ''} onchange="saveMultiSectorSelection()" style="accent-color:var(--primary)">
      <span>${getSegmentLabel(seg)}</span>
    </label>`).join('');
  updateMultiSectorSummary();
}

function toggleMultiSectorSearch(enabled) {
  const panel = document.getElementById('multi-sector-panel');
  if (panel) panel.style.display = enabled ? 'block' : 'none';
  updateMultiSectorSummary();
}

function setAllMultiSectors(checked) {
  document.querySelectorAll('.multi-sector-check').forEach(el => { el.checked = checked; });
  saveMultiSectorSelection();
}

function updateMultiSectorSummary() {
  const el = document.getElementById('multi-sector-summary');
  if (!el) return;
  const selected = getMultiSectorSelection();
  el.textContent = selected.length
    ? `${selected.length} sectores seleccionados: ${selected.map(getSegmentLabel).join(', ')}`
    : 'Selecciona al menos un sector para activar la busqueda multi-sector.';
}

function ensureMultiSectorProgressPanel(sectors) {
  let el = document.getElementById('multi-sector-progress');
  const host = document.getElementById('enrich-pipeline') || document.getElementById('search-results-panel');
  if (!host) return null;
  if (!el) {
    el = document.createElement('div');
    el.id = 'multi-sector-progress';
    el.style.cssText = 'margin-top:1rem;padding:1rem;border:1px solid var(--glass-border);border-radius:12px;background:rgba(255,255,255,.035)';
    host.appendChild(el);
  }
  el.style.display = 'block';
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:1rem;align-items:center;margin-bottom:.75rem">
      <div>
        <div style="font-weight:800;color:var(--text)">Busqueda multi-sector</div>
        <div style="font-size:.78rem;color:var(--text-muted)">Mismo CP/zona, varios sectores, resultados deduplicados.</div>
      </div>
      <div id="multi-sector-progress-total" style="font-size:.78rem;color:var(--text-muted)">0/${sectors.length}</div>
    </div>
    <div id="multi-sector-progress-rows" style="display:grid;gap:.45rem">
      ${sectors.map(seg => `
        <div data-ms-row="${seg}" style="display:grid;grid-template-columns:minmax(110px,1fr) 2fr auto;gap:.6rem;align-items:center;font-size:.78rem">
          <strong style="color:var(--text)">${getSegmentLabel(seg)}</strong>
          <div style="height:7px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden"><div data-ms-fill="${seg}" style="width:0%;height:100%;background:var(--primary);transition:width .25s"></div></div>
          <span data-ms-status="${seg}" style="color:var(--text-muted)">pendiente</span>
        </div>`).join('')}
    </div>`;
  return el;
}

function setMultiSectorProgress(seg, status, pct, done, total) {
  const statusEl = document.querySelector(`[data-ms-status="${seg}"]`);
  const fillEl = document.querySelector(`[data-ms-fill="${seg}"]`);
  if (statusEl) statusEl.textContent = status;
  if (fillEl) fillEl.style.width = Math.max(0, Math.min(100, pct || 0)) + '%';
  const totalEl = document.getElementById('multi-sector-progress-total');
  if (totalEl && total) totalEl.textContent = `${done}/${total}`;
}

function mergeMultiSectorResults(items) {
  const merged = [];
  for (const item of items) {
    const sectors = item.matchedSectors || [item.sourceSector].filter(Boolean);
    const existing = merged.find(x => isSameBusiness(item, x));
    if (existing) {
      Object.assign(existing, { ...existing, ...item });
      existing.matchedSectors = [...new Set([...(existing.matchedSectors || []), ...sectors])];
      existing.sourceSector = existing.matchedSectors[0] || existing.sourceSector || item.sourceSector;
    } else {
      merged.push({ ...item, matchedSectors: [...new Set(sectors)] });
    }
  }
  return deduplicateResults(merged);
}

function getMultiSectorStats(results = tempSearchResults) {
  const stats = {};
  (results || []).forEach(c => (c.matchedSectors || [c.sourceSector || c.segment || 'Otros']).forEach(seg => {
    if (!stats[seg]) stats[seg] = { total: 0, email: 0, ready: 0, pain: 0, score: 0 };
    stats[seg].total++;
    stats[seg].email += c.email ? 1 : 0;
    stats[seg].ready += getLeadUXStatus(c).key === 'ready' ? 1 : 0;
    stats[seg].pain += (c.scrapeSignals || []).length ? 1 : 0;
    stats[seg].score += c.opportunityScore || 0;
  }));
  Object.values(stats).forEach(s => { s.avg = s.total ? Math.round(s.score / s.total) : 0; });
  return stats;
}

function renderMultiSectorResultsPanel() {
  const panel = document.getElementById('search-results-panel');
  if (!panel || !multiSectorSearchState) return;
  let el = document.getElementById('multi-sector-results-panel');
  if (!el) {
    el = document.createElement('div');
    el.id = 'multi-sector-results-panel';
    el.style.cssText = 'margin-bottom:1rem;padding:1rem 1.1rem;border-radius:12px;border:1px solid rgba(10,132,255,.22);background:rgba(10,132,255,.06)';
    panel.insertBefore(el, panel.firstChild);
  }
  const stats = getMultiSectorStats();
  const sectors = Object.keys(stats).sort((a, b) => stats[b].total - stats[a].total);
  const totalRaw = multiSectorSearchState.rawCount || tempSearchResults.length;
  const duplicates = Math.max(0, totalRaw - tempSearchResults.length);
  const newCount = tempSearchResults.filter(c => !leads.some(l => !l.archived && isSameBusiness({ ...c, company: c.name }, l))).length;
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap">
      <div>
        <div style="font-weight:800;color:var(--text)">CP/zona ${multiSectorSearchState.location}</div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-top:.2rem">${sectors.length} sectores · ${tempSearchResults.length} empresas unicas · ${newCount} nuevas · ${duplicates} duplicados fusionados</div>
      </div>
      <div style="display:flex;gap:.45rem;flex-wrap:wrap">
        <button class="btn-primary btn-sm" onclick="currentMultiSectorFilter='all';createProspectingCampaignFromSearch()">Campana multi-sector</button>
        <button class="btn-outline btn-sm" onclick="filterMultiSectorResults('all')">Ver todos</button>
      </div>
    </div>
    <div style="display:flex;gap:.45rem;flex-wrap:wrap;margin-top:.85rem">
      <button class="rfilt ms-filt ${currentMultiSectorFilter === 'all' ? 'active' : ''}" onclick="filterMultiSectorResults('all')">Todos <span style="opacity:.7">${tempSearchResults.length}</span></button>
      ${sectors.map(seg => {
        const s = stats[seg];
        return `<button class="rfilt ms-filt ${currentMultiSectorFilter === seg ? 'active' : ''}" onclick="filterMultiSectorResults('${seg}')">${getSegmentLabel(seg)} <span style="opacity:.7">${s.total}</span></button>`;
      }).join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:.5rem;margin-top:.85rem">
      ${sectors.map(seg => {
        const s = stats[seg];
        return `<div style="padding:.65rem;border:1px solid var(--glass-border);border-radius:10px;background:rgba(255,255,255,.035)">
          <div style="font-weight:700;font-size:.82rem;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${getSegmentLabel(seg)}</div>
          <div style="font-size:.7rem;color:var(--text-muted);margin-top:.25rem">${s.email} email · ${s.ready} listos · ${s.pain} dolores · score ${s.avg}</div>
          <button class="btn-outline btn-sm" style="margin-top:.45rem;width:100%" onclick="filterMultiSectorResults('${seg}');createProspectingCampaignFromSearch()">Campana sector</button>
        </div>`;
      }).join('')}
    </div>`;
}

function filterMultiSectorResults(seg) {
  currentMultiSectorFilter = seg || 'all';
  renderMultiSectorResultsPanel();
  applyAdvancedFilters();
}

function yieldToUI() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, PERF.uiYieldMs);
  });
}

async function runLimitedBatches(items, size, worker, delayMs = 0) {
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    await Promise.all(batch.map(worker));
    await yieldToUI();
    if (delayMs && i + size < items.length) await sleep(delayMs);
  }
}

const _uiSchedule = {};
function scheduleUI(key, fn, delay = 80) {
  clearTimeout(_uiSchedule[key]);
  _uiSchedule[key] = setTimeout(() => {
    delete _uiSchedule[key];
    fn();
  }, delay);
}

function clearScheduledSearchUI() {
  Object.keys(_uiSchedule).forEach(key => {
    clearTimeout(_uiSchedule[key]);
    delete _uiSchedule[key];
  });
}

function scheduleEnrichStats() {
  scheduleUI('enrichStats', updateEnrichStats, 120);
}

function scheduleSearchTableRender() {
  scheduleUI('searchTable', () => {
    const tableView = document.getElementById('results-table-view');
    if (!tableView || tableView.style.display !== 'none') renderSearchTable();
  }, 120);
}

function scheduleSearchCardsRender(delay = 700) {
  scheduleUI('searchCards', () => {
    renderSearchCards();
    scheduleAdvancedFilters(0);
  }, delay);
}

function scheduleAdvancedFilters(delay = 300) {
  scheduleUI('advancedFilters', applyAdvancedFilters, delay);
}

let currentUXStatusFilter = 'all';

function getDataTrust(c) {
  decorateContactQuality(c);
  const items = [];
  if (c.email) {
    const src = c.contactEmailRole ? `${c.contactEmailRole} · ${c.contactEmailReason || 'email validado'}` : (c.emailCandidates?.[0]?.reason || (c.emailQuality ? `calidad ${c.emailQuality}` : 'email validado'));
    items.push({ label: 'Email', value: c.email, confidence: c.contactEmailScore || (c.emailQuality === 'alta' ? 92 : c.emailQuality === 'media' ? 72 : 55), source: src });
  }
  if (c.decision_maker) {
    items.push({ label: 'Decisor', value: c.decision_maker, confidence: c.decision_maker_confidence || 55, source: c.decision_maker_source || 'web/scraping' });
  }
  if (c.phone) items.push({ label: 'Telefono', value: c.phone, confidence: c.contactPhoneScore || 78, source: c.contactPhoneType || (c.whatsapp ? 'telefono + WhatsApp' : 'Places/web') });
  if ((c.scrapeDiagnostics || []).length) items.push({ label: 'Scraping', value: (c.scrapeDiagnostics || [])[0], confidence: 35, source: 'diagnostico tecnico' });
  return items;
}

function getEmailContactRole(email = '') {
  const local = String(email || '').toLowerCase().split('@')[0] || '';
  if (/^(direccion|director|directora|gerencia|gerente|ceo|fundador|fundadora|owner|propietario|administrador|administradora)$/.test(local)) return 'directivo';
  if (/^(comercial|ventas|sales|business|presupuestos|clientes)$/.test(local)) return 'comercial';
  if (/^(soporte|support|help|ayuda|atencion|cliente|clientes|recepcion|reservas|citas)$/.test(local)) return 'soporte';
  if (/^(info|contacto|hola|hello|administracion|admin|office)$/.test(local)) return 'generico operativo';
  if (/^(noreply|no-reply|donotreply|legal|privacy|privacidad|rgpd|abuse|postmaster|webmaster)$/.test(local)) return 'no comercial';
  if (/^[a-z]+[._-][a-z]+$/.test(local) || /^[a-z]\.?[a-z]{3,}$/.test(local)) return 'personal';
  return 'generico';
}

function classifyPhoneContact(phone = '', whatsapp = '') {
  const normalized = normalizeLeadPhone(phone || whatsapp || '');
  if (!normalized) return { type: '', score: 0, reason: '' };
  const isMobile = /^[67]/.test(normalized);
  const type = whatsapp ? 'WhatsApp directo' : isMobile ? 'movil' : /^[89]/.test(normalized) ? 'fijo' : 'telefono';
  const score = whatsapp ? 90 : isMobile ? 82 : 70;
  return { type, score, reason: whatsapp ? 'permite contacto por WhatsApp' : isMobile ? 'telefono movil' : 'telefono fijo/local' };
}

function decorateContactQuality(c = {}) {
  if (!c) return c;
  const reasons = [];
  const domain = extractDomain(c.website || '') || '';
  let score = 0;

  if (c.email) {
    const emailInfo = classifyEmail(c.email, domain);
    const role = getEmailContactRole(c.email);
    let emailScore = emailInfo.score || 0;
    if (role === 'directivo') emailScore += 12;
    if (role === 'comercial') emailScore += 9;
    if (role === 'personal') emailScore += 8;
    if (role === 'soporte') emailScore += 3;
    if (role === 'no comercial') emailScore -= 35;
    emailScore = Math.max(0, Math.min(100, emailScore));
    c.emailQuality = c.emailQuality || emailInfo.quality;
    c.contactEmailRole = role;
    c.contactEmailScore = emailScore;
    c.contactEmailReason = emailInfo.reason;
    score += Math.round(emailScore * 0.48);
    reasons.push(`email ${role} (${emailScore}/100)`);
  } else {
    reasons.push('sin email');
  }

  const phoneInfo = classifyPhoneContact(c.phone, c.whatsapp);
  if (phoneInfo.score) {
    c.contactPhoneType = phoneInfo.type;
    c.contactPhoneScore = phoneInfo.score;
    score += Math.round(phoneInfo.score * 0.18);
    reasons.push(phoneInfo.reason);
  }

  if (c.decision_maker) {
    const dmScore = Math.max(45, Math.min(100, c.decision_maker_confidence || 65));
    c.contactProfileType = /director|gerente|ceo|fundador|propiet/i.test(c.decision_maker) ? 'perfil directivo' : 'perfil probable';
    c.contactProfileScore = dmScore;
    score += Math.round(dmScore * 0.24);
    reasons.push(`${c.contactProfileType} (${dmScore}/100)`);
  }

  if (c.linkedin || c.instagram || c.facebook) {
    score += 6;
    reasons.push('perfil social localizado');
  }
  if (c.website) score += 4;
  if ((c.scrapeDiagnostics || []).length) score -= 8;

  score = Math.max(0, Math.min(100, score));
  c.contactQualityScore = score;
  c.contactQuality = score >= 76 ? 'alta' : score >= 52 ? 'media' : score >= 25 ? 'baja' : 'pendiente';
  c.contactBucket = c.email && score >= 52 ? 'ready' : (!c.email && (c.phone || c.whatsapp) ? 'call_first' : 'enrich_later');
  c.contactQualityReasons = reasons.slice(0, 5);
  return c;
}

function buildResultExplanation(c = {}) {
  decorateContactQuality(c);
  const items = [];
  const sector = (c.matchedSectors || [c.sourceSector || c.segment]).filter(Boolean);
  if (sector.length) items.push({ label: 'Sector', value: sector.map(getSegmentLabel).join(', '), ok: true });
  if (c.querySource) items.push({ label: 'Query', value: c.querySource, ok: true });
  if (c.searchPoint || c.radiusUsed) items.push({ label: 'Zona', value: [c.searchPoint, c.radiusUsed ? `${c.radiusUsed}km` : ''].filter(Boolean).join(' · '), ok: true });
  if (c.distKm !== null && c.distKm !== undefined) items.push({ label: 'Distancia', value: `${c.distKm}km`, ok: c.distKm <= 10 });
  items.push({ label: 'Fuente', value: (c.enrichSource || []).length ? c.enrichSource.join(', ') : (c.foundBy || 'Google Places'), ok: true });
  items.push({ label: 'Web', value: c.website ? 'web valida' : 'sin web', ok: !!c.website });
  items.push({ label: 'Email', value: c.email ? `${c.contactEmailRole || 'email'} · ${c.contactQuality}` : 'sin email', ok: !!c.email });
  if (c.decision_maker) items.push({ label: 'Decisor', value: c.decision_maker, ok: true });
  if (c.duplicateCount) items.push({ label: 'Duplicados', value: `${c.duplicateCount} fusionados${c.duplicateReasons?.length ? ': ' + c.duplicateReasons.join(', ') : ''}`, ok: true });
  if ((c.scrapeDiagnostics || []).length) items.push({ label: 'Diagnostico', value: c.scrapeDiagnostics.join(', '), ok: false });
  items.push({ label: 'Confianza contacto', value: `${c.contactQualityScore || 0}/100`, ok: (c.contactQualityScore || 0) >= 52 });
  return items;
}

function decorateResultExplanation(c = {}) {
  c.resultExplanation = buildResultExplanation(c);
  return c;
}

function getLeadUXStatus(c) {
  const already = leads?.some(l => !l.archived && (
    (c.placeId && l.placeId && l.placeId === c.placeId) ||
    String(l.company || '').toLowerCase().trim() === String(c.name || '').toLowerCase().trim()
  ));
  if (already) return { key: 'crm', label: 'Ya en CRM', color: 'var(--text-muted)', action: 'Abrir ficha existente' };
  if (c.email && c.decision_maker) return { key: 'ready', label: 'Listo para contactar', color: 'var(--success)', action: 'Volcar y crear email' };
  if (!c.email && (c.phone || c.website)) return { key: 'need_email', label: 'Falta email', color: 'var(--warning)', action: 'Reintentar scraping' };
  if (c.email && !c.decision_maker) return { key: 'need_decision', label: 'Falta decisor', color: 'var(--primary)', action: 'Buscar decisor' };
  if (!c.website && !c.phone) return { key: 'discard', label: 'Revisar/descartar', color: 'var(--danger)', action: 'Baja prioridad' };
  return { key: 'review', label: 'Revisar', color: 'var(--text-muted)', action: 'Completar datos' };
}

function getLeadUsefulnessScore(c) {
  const status = getLeadUXStatus(c).key;
  const statusScore = { ready: 500, need_decision: 390, need_email: 360, review: 250, crm: 120, discard: 50 }[status] || 0;
  return statusScore
    + (c.opportunityScore || 0)
    + (c.emailQuality === 'alta' ? 35 : c.emailQuality === 'media' ? 18 : 0)
    + (c.decision_maker_confidence || 0) / 3
    + (c.rating || 0) * 4
    + Math.min(c.ratingCount || 0, 200) / 10;
}

function normalizeLeadText(value = '') {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(sl|sa|slp|sau|slu|sll|sc|cb|sociedad|limitada|anonima|grupo|the)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeLeadPhone(value = '') {
  return String(value || '').replace(/[^\d]/g, '').replace(/^34/, '').slice(-9);
}

function getBusinessIdentity(c = {}) {
  const domain = (extractDomain(c.website || '') || '').replace(/^www\./, '');
  const phone = normalizeLeadPhone(c.phone || c.whatsapp || '');
  const name = normalizeLeadText(c.name || c.company || '');
  const address = normalizeLeadText(c.address || '').slice(0, 60);
  const email = String(c.email || '').trim().toLowerCase();
  return {
    placeId: c.placeId || '',
    domain,
    phone,
    name,
    address,
    email,
    emailDomain: email ? email.split('@')[1]?.replace(/^www\./, '') || '' : ''
  };
}

function similarityRatio(a = '', b = '') {
  a = normalizeLeadText(a);
  b = normalizeLeadText(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const aw = new Set(a.split(' ').filter(w => w.length > 2));
  const bw = new Set(b.split(' ').filter(w => w.length > 2));
  if (!aw.size || !bw.size) return 0;
  const inter = [...aw].filter(w => bw.has(w)).length;
  return inter / Math.max(aw.size, bw.size);
}

function isSameBusiness(a = {}, b = {}) {
  const ia = getBusinessIdentity(a);
  const ib = getBusinessIdentity(b);
  const nameScore = similarityRatio(ia.name, ib.name);
  const addressScore = similarityRatio(ia.address, ib.address);
  if (ia.placeId && ib.placeId && ia.placeId === ib.placeId) return true;
  if (ia.email && ib.email && ia.email === ib.email) return true;
  if (ia.phone && ib.phone && ia.phone === ib.phone) return true;
  if (ia.address && ib.address && ia.address === ib.address && nameScore >= 0.55) return true;

  const hasBothAddresses = !!(ia.address && ib.address);
  const addressLooksSame = !hasBothAddresses || addressScore >= 0.55;
  if (ia.domain && ib.domain && ia.domain === ib.domain && nameScore >= 0.82 && addressLooksSame) return true;
  if (ia.emailDomain && ib.emailDomain && ia.emailDomain === ib.emailDomain && nameScore >= 0.82 && addressLooksSame) return true;
  return nameScore >= 0.88 && (!hasBothAddresses || addressScore >= 0.65);
}

function getScrapeFingerprint(c = {}) {
  return [
    c.email || '',
    c.phone || '',
    c.website || '',
    c.decision_maker || '',
    (c.signals || []).slice(0, 8).join('|'),
    c.rating || '',
    c.ratingCount || '',
    c.webLoadMs || ''
  ].join('::');
}

function getScrapeMemoryForCompany(c = {}) {
  const domain = extractDomain(c.website || '');
  if (!domain) return null;
  return loadScrapeMemory(domain);
}

function annotateIncrementalScrape(c = {}) {
  const domain = extractDomain(c.website || '');
  if (!domain) return c;
  const mem = loadScrapeMemory(domain);
  c.scrapeLastRun = mem.lastRun || 0;
  c.scrapeLastFingerprint = mem.lastFingerprint || '';
  c.scrapeChanged = !!(mem.lastFingerprint && mem.lastFingerprint !== getScrapeFingerprint(c));
  c.scrapeStable = !!(mem.lastFingerprint && mem.lastFingerprint === getScrapeFingerprint(c));
  if (mem.lastRun) c.scrapeMemoryUsed = true;
  return c;
}

function detectCommercialScrapeSignals(company = {}, html = '') {
  const signals = [];
  const text = `${stripHtml(html).slice(0, 12000)} ${company.description || ''}`.toLowerCase();
  const has = rx => rx.test(text) || rx.test(html);
  const add = (key, label, points) => signals.push({ key, label, points });

  if (!company.website) add('no_website', 'Sin web visible', 18);
  if (company.website && /^http:\/\//i.test(company.website)) add('no_https', 'Web sin HTTPS', 16);
  if (company.webLoadMs && company.webLoadMs > 4000) add('slow_web', 'Web muy lenta', 14);
  else if (company.webLoadMs && company.webLoadMs > 2300) add('slow_web_mid', 'Web lenta', 8);
  if (!company.email && !/mailto:|@/.test(html)) add('no_email', 'Sin email visible', 9);
  if (!company.whatsapp && !/whatsapp|wa\.me/i.test(html)) add('no_whatsapp', 'Sin WhatsApp visible', 6);
  if (!has(/contacto|contactar|formulario|contact form|wpforms|gravityforms|caldera|contact-form-7/)) add('weak_contact', 'Contacto pobre o sin formulario', 10);
  if (!has(/analytics|gtag|googletagmanager|facebook.*pixel|fbq\(/)) add('no_tracking', 'Sin analitica/pixel detectado', 7);
  if (!has(/reserv|booking|cita|calendly|bookly|woocommerce|prestashop|shopify|checkout|carrito/)) add('no_booking', 'Sin reservas/venta online detectada', 10);
  if (/<table\b|frameset|font face=|dreamweaver|frontpage|jquery-1\./i.test(html)) add('legacy_web', 'Web antigua/legacy', 14);
  if ((company.rating || 0) < 4 && (company.ratingCount || 0) >= 15) add('review_pain', 'Resenas mejorables', 13);
  if ((company.ratingCount || 0) === 0) add('no_reviews', 'Sin traccion de resenas', 7);

  company.scrapeSignals = signals;
  company.signals = [...new Set([...(company.signals || []), ...signals.map(s => `${s.label} (+${s.points})`)])];
  return company;
}

function getLayerPriority(c = {}) {
  decorateOpportunity(c);
  return (c.opportunityScore || 0)
    + ((c.scrapeSignals || []).reduce((sum, s) => sum + (s.points || 0), 0))
    + (c.website ? 12 : 0)
    + (!c.email ? 10 : 0)
    + (!c.decision_maker ? 8 : 0)
    + Math.min(c.ratingCount || 0, 120) / 8;
}

function sortSearchResultsLive() {
  if (!Array.isArray(tempSearchResults) || !tempSearchResults.length) return;
  tempSearchResults.forEach(decorateOpportunity);
  tempSearchResults.sort((a, b) => getLeadUsefulnessScore(b) - getLeadUsefulnessScore(a));
}

function getNextBestAction() {
  const r = tempSearchResults || [];
  const ready = r.filter(c => getLeadUXStatus(c).key === 'ready');
  const needEmail = r.filter(c => getLeadUXStatus(c).key === 'need_email');
  const needDecision = r.filter(c => getLeadUXStatus(c).key === 'need_decision');
  if (ready.length) return { title: `${ready.length} listos para contactar`, body: 'Importa los mejores y genera el primer mensaje. Ya tienen email y decisor.', cta: 'Ver listos', filter: 'ready' };
  if (needEmail.length) return { title: `${needEmail.length} necesitan email`, body: 'Prioriza reintento de scraping en webs con telefono o dominio localizado.', cta: 'Ver sin email', filter: 'need_email' };
  if (needDecision.length) return { title: `${needDecision.length} necesitan decisor`, body: 'Ya hay email. Falta identificar a quien dirigir el mensaje.', cta: 'Ver sin decisor', filter: 'need_decision' };
  return { title: 'Resultados preparados', body: 'Revisa los leads de mayor score o importa los que quieras trabajar.', cta: 'Ver todos', filter: 'all' };
}

function renderUXCommandCenter() {
  const panel = document.getElementById('search-results-panel');
  if (!panel || !tempSearchResults?.length) return;
  let el = document.getElementById('ux-command-center');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ux-command-center';
    el.style.cssText = 'margin-bottom:1rem;padding:1rem 1.1rem;border-radius:12px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.035)';
    const stats = document.getElementById('enrich-stats-bar');
    panel.insertBefore(el, stats || panel.firstChild);
  }
  const counts = tempSearchResults.reduce((acc, c) => {
    const k = getLeadUXStatus(c).key;
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const next = getNextBestAction();
  const tabs = [
    ['all', 'Todos', tempSearchResults.length],
    ['ready', 'Listos', counts.ready || 0],
    ['need_email', 'Falta email', counts.need_email || 0],
    ['need_decision', 'Falta decisor', counts.need_decision || 0],
    ['crm', 'Ya en CRM', counts.crm || 0],
    ['discard', 'Descartar', counts.discard || 0],
  ];
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap">
      <div>
        <div style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Siguiente accion</div>
        <div style="font-weight:800;font-size:1.05rem;margin-top:.15rem">${next.title}</div>
        <div style="font-size:.8rem;color:var(--text-muted);margin-top:.18rem">${next.body}</div>
      </div>
      <div style="display:flex;gap:.45rem;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn-primary btn-sm" onclick="filterUXStatus('${next.filter}')">${next.cta}</button>
        <button class="btn-outline btn-sm" onclick="sortSearchResultsLive();renderSearchCards();applyAdvancedFilters()">Ordenar por calidad</button>
        <button class="btn-outline btn-sm" onclick="createProspectingCampaignFromSearch()">Crear campana</button>
      </div>
    </div>
    <div style="display:flex;gap:.55rem;flex-wrap:wrap;margin-top:.85rem;align-items:end">
      <div style="min-width:120px">
        <label style="display:block;font-size:.68rem;color:var(--text-dim);margin-bottom:.2rem">Score minimo</label>
        <input id="prospecting-min-score" type="number" min="0" max="100" value="${document.getElementById('prospecting-min-score')?.value || 55}" style="height:32px;width:100%;font-size:.78rem">
      </div>
      <div style="min-width:220px;flex:1">
        <label style="display:block;font-size:.68rem;color:var(--text-dim);margin-bottom:.2rem">Nombre campana</label>
        <input id="prospecting-campaign-name" type="text" placeholder="Campana scraping ${new Date().toLocaleDateString('es-ES')}" value="${document.getElementById('prospecting-campaign-name')?.value || ''}" style="height:32px;width:100%;font-size:.78rem">
      </div>
    </div>
    <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.85rem">
      ${tabs.map(([key, label, count]) => `<button class="rfilt ${currentUXStatusFilter === key ? 'active' : ''}" onclick="filterUXStatus('${key}')">${label} <span style="opacity:.7">${count}</span></button>`).join('')}
    </div>`;
}

function filterUXStatus(status) {
  currentUXStatusFilter = status || 'all';
  renderUXCommandCenter();
  applyAdvancedFilters();
}

// ── Cache de Enriquecimiento (Idea 5) ────────────────────────────────────────
// Evita re-scrapear empresas en la misma sesión/días para ahorrar tiempo y APIs
const _enrichCache = {
  get: (id) => {
    try {
      const entry = JSON.parse(localStorage.getItem('gordi_enrich_cache') || '{}')[id];
      if (entry && (Date.now() - entry.ts < 1000 * 60 * 60 * 24 * 7)) return entry.data; // 7 días
    } catch(e) {}
    return null;
  },
  set: (id, data) => {
    try {
      const cache = JSON.parse(localStorage.getItem('gordi_enrich_cache') || '{}');
      cache[id] = { ts: Date.now(), data };
      // Mantener tamaño razonable (< 2MB)
      const keys = Object.keys(cache);
      if (keys.length > 500) delete cache[keys[0]];
      localStorage.setItem('gordi_enrich_cache', JSON.stringify(cache));
    } catch(e) {}
  },
  setMany: (items) => {
    try {
      const cache = JSON.parse(localStorage.getItem('gordi_enrich_cache') || '{}');
      const ts = Date.now();
      (items || []).forEach(data => {
        if (data?.id) cache[data.id] = { ts, data };
      });
      const keys = Object.keys(cache);
      while (keys.length > 500) delete cache[keys.shift()];
      localStorage.setItem('gordi_enrich_cache', JSON.stringify(cache));
    } catch(e) {}
  }
};

// ── Cache de rendimiento de proxies (sesión) ─────────────────────────────────
// Aprendemos qué proxies funcionan y los priorizamos durante la sesión
const _proxyStats = {};
CORS_PROXIES.forEach((p, i) => { _proxyStats[i] = { ok: 0, fail: 0, ms: 999 }; });

function _getSortedProxies() {
  // Si el usuario tiene un proxy personalizado configurado, va siempre primero
  const customProxyUrl = localStorage.getItem('gordi_custom_proxy')?.trim();
  const base = CORS_PROXIES
    .map((p, i) => ({ proxy: p, idx: i, stats: _proxyStats[i] }))
    .sort((a, b) => {
      // Primero los que han funcionado, luego por velocidad
      const aScore = a.stats.ok * 100 - a.stats.fail * 50 - a.stats.ms / 100;
      const bScore = b.stats.ok * 100 - b.stats.fail * 50 - b.stats.ms / 100;
      return bScore - aScore;
    })
    .map(x => ({ ...x.proxy, _idx: x.idx }));

  if (customProxyUrl) {
    // El proxy personalizado ocupa la posición 0 siempre, con modo raw
    return [{ url: customProxyUrl, mode: 'raw', _idx: -1 }, ...base];
  }
  return base;
}

function isScrapeableHtml(content = '', expected = 'html') {
  if (!content || content.length < 200) return false;
  const sample = content.slice(0, 4000).toLowerCase();
  if (/^(\d{1,3}\.){3}\d{1,3}:\d+/m.test(sample)) return false;
  if (/request=getproxies|proxy list|protocol=http|anonymity=/i.test(sample)) return false;
  if (/access denied|forbidden|blocked|security check|cloudflare|hcaptcha/i.test(sample)) return false;
  if (expected === 'xml') return /<urlset|<sitemapindex|<loc>/.test(sample);
  return /<html|<head|<body|<title|<meta|<script|<a\s|mailto:|schema\.org|application\/ld\+json/i.test(sample);
}

// ── Diagnóstico de proxies — exportado para el botón de configuración ─────────
async function testAllProxies() {
  const testUrl = 'https://httpbin.org/get';
  const results = [];
  const customProxyUrl = localStorage.getItem('gordi_custom_proxy')?.trim();
  const proxiesToTest = [
    ...(customProxyUrl ? [{ url: customProxyUrl, mode: 'raw', label: '⭐ Tu proxy' }] : []),
    ...CORS_PROXIES.map(p => ({ ...p, label: p.url.split('/')[2] })),
  ];
  for (const proxy of proxiesToTest) {
    const t0 = Date.now();
    try {
      const fullUrl = proxy.url + encodeURIComponent(testUrl);
      const res = await fetch(fullUrl, { signal: AbortSignal.timeout(7000) });
      const content = proxy.mode === 'allorigins'
        ? (await res.json()).contents || ''
        : await res.text();
      const ms = Date.now() - t0;
      results.push({ label: proxy.label, ok: res.ok && content.length > 50, ms });
    } catch (e) {
      results.push({ label: proxy.label, ok: false, ms: Date.now() - t0, err: e.message });
    }
  }
  return results;
}

async function fetchWithProxy(targetUrl, timeoutMs = 9000, options = {}) {
  // FIX-SCRAPING 2026: Detección activa de proxies saturados (429/503)
  const expected = options.expected || 'html';
  const maxProxies = options.maxProxies || 3;
  const deadlineMs = options.deadlineMs || timeoutMs;
  const startedAt = Date.now();
  const sortedProxies = _getSortedProxies().slice(0, maxProxies);

  for (const proxy of sortedProxies) {
    const remaining = deadlineMs - (Date.now() - startedAt);
    if (remaining <= 250) break;
    const t0 = Date.now();
    try {
      const fullUrl = proxy.url + encodeURIComponent(targetUrl);
      const res = await fetch(fullUrl, { 
        signal: AbortSignal.timeout(Math.min(timeoutMs, remaining)),
        headers: { 'Cache-Control': 'no-cache' } 
      });

      // Si el proxy responde que está saturado, penalizarlo fuertemente en esta sesión
      if (res.status === 429 || res.status === 503 || res.status === 403) {
        if (proxy._idx >= 0) _proxyStats[proxy._idx].fail += 5; 
        continue;
      }

      if (!res.ok) {
        if (proxy._idx >= 0) _proxyStats[proxy._idx].fail++;
        continue;
      }

      let content = '';
      if (proxy.mode === 'allorigins') {
        const j = await res.json();
        content = j.contents || '';
      } else {
        content = await res.text();
      }

      // Validacion de contenido: evitar paginas de error o respuestas que no son HTML.
      if (isScrapeableHtml(content, expected)) {
        const ms = Date.now() - t0;
        if (proxy._idx >= 0) {
          _proxyStats[proxy._idx].ok++;
          // Media móvil ponderada para el tiempo de respuesta
          _proxyStats[proxy._idx].ms = Math.round((_proxyStats[proxy._idx].ms * 0.6) + (ms * 0.4));
        }
        return content;
      }
      
      if (proxy._idx >= 0) _proxyStats[proxy._idx].fail++;
    } catch (err) {
      if (proxy._idx >= 0) _proxyStats[proxy._idx].fail++;
      // Si el error es timeout, es una señal de que el proxy es lento
      if (err.name === 'TimeoutError' && proxy._idx >= 0) _proxyStats[proxy._idx].ms = Math.max(_proxyStats[proxy._idx].ms, timeoutMs);
    }
  }

  // Wayback es lento y no debe bloquear el flujo principal. Solo se usa si se pide explicitamente.
  if (options.useArchive && targetUrl.startsWith('http')) {
    const remaining = deadlineMs - (Date.now() - startedAt);
    if (remaining <= 250) return '';
    try {
      const archiveUrl = `https://web.archive.org/web/2/${targetUrl}`;
      const res = await fetch(archiveUrl, { signal: AbortSignal.timeout(Math.min(5000, remaining)) });
      if (res.ok) {
        const txt = await res.text();
        if (isScrapeableHtml(txt, expected)) return txt;
      }
    } catch {}
  }

  // ── Último recurso: fetch directo ──────────────────────────────────────────
  const remaining = deadlineMs - (Date.now() - startedAt);
  if (remaining <= 250) return '';
  try {
    const res = await fetch(targetUrl, {
      signal: AbortSignal.timeout(Math.min(timeoutMs, 4000, remaining)),
      mode: 'cors',
      headers: { 'Accept': 'text/html' }
    });
    if (res.ok) {
      const txt = await res.text();
      if (isScrapeableHtml(txt, expected)) return txt;
    }
  } catch {}
  return '';
}



// ── Palabras clave de roles decisores (ES + EN) ──────────────────────────────
const ROLE_KEYWORDS = [
  'gerente general','director general','director ejecutivo','director de operaciones',
  'director','gerente','propietario','propietaria','ceo','coo','cfo','cio',
  'responsable','manager','jefe','encargado','encargada','administrador','administradora',
  'socio','socia','fundador','fundadora','presidente','presidenta',
  'facility manager','operations manager','director de instalaciones',
  'director de compras','director de obra','project manager'
];

// ── Dominios a ignorar en emails ─────────────────────────────────────────────
const EMAIL_BLACKLIST = new Set([
  'example.com','test.com','domain.com','email.com','mail.com',
  'wixpress.com','wix.com','squarespace.com','wordpress.com','shopify.com',
  'sentry.io','google.com','googleapis.com','gstatic.com','googletagmanager.com',
  'facebook.com','twitter.com','instagram.com','linkedin.com','youtube.com',
  'w3.org','schema.org','fontawesome.com','bootstrap.com','jquery.com',
  'cloudflare.com','cdnjs.com','amazonaws.com','cloudfront.net',
  'hotjar.com','intercom.io','hubspot.com','mailchimp.com','sendgrid.net',
  'doubleclick.net','googleadservices.com','analytics.google.com',
  'gravatar.com','akismet.com','yoast.com','elementor.com',
]);

// ── Prefijos de email prioritarios (más probables que sean del decisor) ──────
const EMAIL_PRIORITY_PREFIXES = [
  'info','contacto','contact','hola','hello','direccion','director','gerencia',
  'gerente','administracion','admin','ventas','comercial','gestion',
  'oficina','secretaria','recepcion','comunicacion'
];

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getRoleRegexSource() {
  return `\\b(?:${ROLE_KEYWORDS.map(escapeRegex).join('|')})\\b`;
}

// ── Patrones redes sociales (más robustos, capturan URL completa limpia) ─────
const SOCIAL_REGEXES = {
  instagram: [
    /https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9_.]{1,30})\/?(?:[^"'\s<>])?/gi,
    /instagram\.com\/([A-Za-z0-9_.]{1,30})/gi,
  ],
  facebook: [
    /https?:\/\/(?:www\.)?facebook\.com\/([A-Za-z0-9_./-]{2,60})\/?(?:[^"'\s<>])?/gi,
    /fb\.com\/([A-Za-z0-9_./-]{2,40})/gi,
  ],
  linkedin: [
    /https?:\/\/(?:www\.)?linkedin\.com\/(company|in)\/([A-Za-z0-9_.-]{2,60})\/?/gi,
  ],
  twitter: [
    /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]{1,30})\/?/gi,
  ],
  youtube: [
    /https?:\/\/(?:www\.)?youtube\.com\/(?:channel|c|user)\/([A-Za-z0-9_-]{2,60})\/?/gi,
    /https?:\/\/(?:www\.)?youtube\.com\/@([A-Za-z0-9_.-]{2,40})\/?/gi,
  ],
};

// Cuentas genéricas de redes a ignorar
const SOCIAL_BLACKLIST = new Set([
  'sharer','share','login','signup','intent','hashtag',
  'home','feed','search','explore','reels','stories',
  'pages','groups','events','marketplace','watch','shorts',
]);

// ── Helper: extraer URL social limpia ────────────────────────────────────────
function extractSocialUrl(html, network) {
  const regexes = SOCIAL_REGEXES[network] || [];
  const candidates = new Set();
  for (const regex of regexes) {
    let match;
    regex.lastIndex = 0;
    while ((match = regex.exec(html)) !== null) {
      const handle = (match[2] || match[1] || '').toLowerCase().replace(/\/$/, '');
      if (!handle || handle.length < 2) continue;
      if (SOCIAL_BLACKLIST.has(handle)) continue;
      if (/^(p|r|s|\d{1,2})$/.test(handle)) continue; // paths cortos probablemente no son handles
      candidates.add(match[0].split(/['"?\s]/)[0]); // URL limpia
    }
  }
  return [...candidates][0] || '';
}

// ── Helper: limpiar texto HTML ────────────────────────────────────────────────
function stripHtml(str) {
  return str.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ─── CAPA 1: Google Places — Multi-query con dedup ──────────────────────────
// Radio center coordinates (set when geocoding location)
let radiusCenterCoords = null;

function clearRadiusCenter() {
  radiusCenterCoords = null;
  const lbl = document.getElementById('radius-center-label');
  if (lbl) lbl.textContent = 'Centrado en la ciudad introducida';
}



// --------------------------------------------------------------------------
// ██  MÓDULO: SEARCH
// ──  Búsqueda de empresas via Google Places API
// ──  Funciones: geocodeLocation, buildSearchGrid, fetchPlaces, searchBusinesses
// --------------------------------------------------------------------------

const GEO_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
const _geoCacheMem = {};

function getGeoCacheKey(locationStr = '') {
  return 'gordi_geo_cache_' + String(locationStr || '').toLowerCase().trim().replace(/[^a-z0-9]/gi, '_').slice(0, 80);
}

function getCachedGeocode(locationStr) {
  const key = getGeoCacheKey(locationStr);
  if (!key || key === 'gordi_geo_cache_') return null;
  const mem = _geoCacheMem[key];
  if (mem && Date.now() - mem.ts < GEO_CACHE_TTL) return mem.data;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.data || Date.now() - parsed.ts > GEO_CACHE_TTL) {
      localStorage.removeItem(key);
      return null;
    }
    _geoCacheMem[key] = parsed;
    return parsed.data;
  } catch { return null; }
}

function setCachedGeocode(locationStr, data) {
  if (!data || data.lat == null || data.lng == null) return;
  const key = getGeoCacheKey(locationStr);
  if (!key || key === 'gordi_geo_cache_') return;
  const entry = { ts: Date.now(), data: { lat: data.lat, lng: data.lng } };
  _geoCacheMem[key] = entry;
  try { localStorage.setItem(key, JSON.stringify(entry)); } catch {}
}

async function geocodeLocation(locationStr) {
  const cached = getCachedGeocode(locationStr);
  if (cached) return cached;
  // Use Google Geocoding API to get lat/lng for the location string
  const apiKey = localStorage.getItem('gordi_api_key');
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(locationStr)}&key=${apiKey}&language=es`,
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    if (data.results?.[0]?.geometry?.location) {
      const loc = data.results[0].geometry.location; // { lat, lng }
      setCachedGeocode(locationStr, loc);
      return loc;
    }
  } catch {}
  return null;
}

// ─── Haversine — distancia real en km entre dos coordenadas ──────────────────
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── Enriquecer distancias reales desde el centro de búsqueda ────────────────
async function enrichDistances(companies, locationStr) {
  try {
    const center = await geocodeLocation(locationStr);
    if (!center) return companies;
    radiusCenterCoords = center;
    return companies.map(c => {
      if (c.lat != null && c.lng != null) {
        return { ...c, distKm: Math.round(haversineKm(center.lat, center.lng, c.lat, c.lng) * 10) / 10 };
      }
      return c;
    });
  } catch { return companies; }
}

// ─── HELPERS GRID SEARCH ────────────────────────────────────────────────────
// Geocodifica una dirección y devuelve {lat, lng}
// ── Esperar a que el SDK de Google Maps esté disponible ──────────────────────
// Race condition: loadGoogleMapsScript inyecta un <script> asíncrono.
// Si el usuario pulsa "Buscar" antes de que cargue, google es undefined -> crash.
// Esta función espera hasta 15 segundos antes de lanzar un error claro.
async function waitForGoogleMaps(timeoutMs = 15000) {
  if (typeof google !== 'undefined' && google.maps) return; // ya cargado

  // Si no hay API Key ni script en el DOM, cargar ahora
  const apiKey = localStorage.getItem('gordi_api_key');
  if (apiKey && !document.getElementById('google-maps-script')) {
    loadGoogleMapsScript(apiKey);
  }
  if (!apiKey) {
    throw new Error('API Key de Google no configurada. Ve a Configuración -> API Keys.');
  }

  // Esperar con polling cada 200ms hasta que google.maps esté disponible
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (typeof google !== 'undefined' && google.maps) {
        resolve();
      } else if (Date.now() - start > timeoutMs) {
        reject(new Error('Google Maps tardó demasiado en cargar. Recarga la página (F5) e inténtalo de nuevo.'));
      } else {
        setTimeout(check, 200);
      }
    };
    check();
  });
}

async function geocodeSearch(locationStr) {
  const cached = getCachedGeocode(locationStr);
  if (cached) return cached;
  await waitForGoogleMaps();
  const { Geocoder } = await google.maps.importLibrary('geocoding');
  const geocoder = new Geocoder();
  return new Promise((resolve, reject) => {
    geocoder.geocode({ address: locationStr, language: 'es' }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const loc = results[0].geometry.location;
        const data = { lat: loc.lat(), lng: loc.lng() };
        setCachedGeocode(locationStr, data);
        resolve(data);
      } else {
        reject(new Error('No se pudo geocodificar: ' + locationStr));
      }
    });
  });
}

// FIX 5: Mapa de distritos reales por ciudad
// Las ciudades tienen formas irregulares — un grid cuadrado cubre mal las zonas periféricas.
// Usar distritos reales garantiza cobertura uniforme y más resultados únicos.
const CITY_DISTRICTS = {
  'madrid': [
    'Salamanca Madrid','Chamberí Madrid','Retiro Madrid','Centro Madrid',
    'Tetuán Madrid','Carabanchel Madrid','Vallecas Madrid','Hortaleza Madrid',
    'Alcobendas Madrid','Pozuelo de Alarcón','Getafe Madrid','Leganés Madrid',
    'Las Rozas Madrid','Majadahonda Madrid','Alcorcón Madrid'
  ],
  'barcelona': [
    'Eixample Barcelona','Gràcia Barcelona','Sants Barcelona','Sant Martí Barcelona',
    'Sarrià Sant Gervasi Barcelona','Nou Barris Barcelona','Sant Andreu Barcelona',
    'Horta Guinardó Barcelona','Les Corts Barcelona','Hospitalet de Llobregat'
  ],
  'valencia': [
    'Eixample Valencia','Campanar Valencia','Rascanya Valencia',
    'Benicalap Valencia','Poblats Marítims Valencia','Quatre Carreres Valencia',
    'Jesús Valencia','Patraix Valencia','L\'Olivereta Valencia'
  ],
  'sevilla': [
    'Centro Sevilla','Triana Sevilla','Nervión Sevilla','Los Remedios Sevilla',
    'Macarena Sevilla','Cerro Amate Sevilla','San Pablo Santa Justa Sevilla'
  ],
  'bilbao': [
    'Abando Bilbao','Deusto Bilbao','Begoña Bilbao','Uribarri Bilbao',
    'Basurto Bilbao','Getxo Bilbao','Barakaldo Bilbao'
  ],
  'zaragoza': [
    'Centro Zaragoza','Delicias Zaragoza','Universidad Zaragoza',
    'Oliver Valdefierro Zaragoza','La Almozara Zaragoza'
  ],
  'málaga': [
    'Centro Málaga','Cruz de Humilladero Málaga','Campanillas Málaga',
    'Palma Palmilla Málaga','Martiricos La Trinidad Málaga'
  ],
};

// Devuelve distritos adicionales si la ciudad está en el mapa
function getCityDistricts(locationStr) {
  const loc = locationStr.toLowerCase().trim();
  for (const [city, districts] of Object.entries(CITY_DISTRICTS)) {
    if (loc.includes(city) || loc === city) return districts;
  }
  return [];
}

// ─── HELPER CENTRALIZADO: locationBias para Google Places API v3 ──────────────
// IMPORTANTE: La Places API v3 (Place.searchByText) NO acepta el formato
// { circle: { center, radius } } — solo acepta un bounding box rectangular.
// Esta función es el ÚNICO lugar donde se construye locationBias.
// Si Google cambia el formato en el futuro, solo hay que tocar AQUÍ.
//
// @param {number} lat       - Latitud del centro
// @param {number} lng       - Longitud del centro
// @param {number} radiusM   - Radio en METROS
// @returns {Object}         - Bounding box { south, west, north, east }
function buildLocationBias(lat, lng, radiusM) {
  const latDelta = radiusM / 111320;
  const lngDelta = radiusM / (111320 * Math.cos(lat * Math.PI / 180));
  return {
    south: lat - latDelta,
    west:  lng - lngDelta,
    north: lat + latDelta,
    east:  lng + lngDelta,
  };
}

// Genera una cuadrícula de puntos dentro del radio dado (en km)
// gridSize = número de celdas por lado (2=4 puntos, 3=9 puntos, 4=16 puntos...)
function buildSearchGrid(centerLat, centerLng, radiusKm, gridSize) {
  const points = [];
  // 1° lat ≈ 111 km; 1° lng ≈ 111 km * cos(lat)
  const latDeg = radiusKm / 111;
  const lngDeg = radiusKm / (111 * Math.cos(centerLat * Math.PI / 180));
  const step = 2 / (gridSize - 1 || 1);
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const lat = centerLat + latDeg * (-1 + i * step);
      const lng = centerLng + lngDeg * (-1 + j * step);
      // Solo incluir puntos dentro del círculo (distancia al centro <= radio)
      const dLat = (lat - centerLat) * 111;
      const dLng = (lng - centerLng) * 111 * Math.cos(centerLat * Math.PI / 180);
      if (Math.sqrt(dLat*dLat + dLng*dLng) <= radiusKm * 1.1) {
        points.push({ lat, lng });
      }
    }
  }
  return points;
}

function getLocationKind(locationStr = '') {
  const loc = String(locationStr || '').trim();
  if (/^\d{5}$/.test(loc)) return 'cp';
  if (/\b(calle|avenida|avda|plaza|barrio|zona|poligono|poligono industrial)\b/i.test(loc)) return 'zona';
  if (loc.includes(',')) return 'zona';
  return 'ciudad';
}

function uniqueList(items = []) {
  return [...new Set(items.map(x => String(x || '').trim()).filter(Boolean))];
}

async function buildSearchPlan(segment, location, maxResults, opts = {}) {
  const requestedRadiusKm = Math.max(1, parseInt(document.getElementById('plan-radius')?.value || 10, 10));
  const exhaustive = maxResults >= 9999;
  const effectiveMax = exhaustive ? 500 : maxResults;
  const kind = getLocationKind(location);
  const isMulti = !!opts.multiSector || !!document.getElementById('plan-multi-toggle')?.checked;
  let allQueries = uniqueList(getSegmentQueries(segment));
  try {
    const stats = JSON.parse(localStorage.getItem(`gordi_query_stats_${segment}`) || '{}');
    allQueries = allQueries.sort((a, b) => {
      const sa = stats[a] ? (stats[a].hits || 0) / Math.max(1, stats[a].runs || 1) : 0;
      const sb = stats[b] ? (stats[b].hits || 0) / Math.max(1, stats[b].runs || 1) : 0;
      return sb - sa;
    });
  } catch {}
  const coreSize = Math.max(2, Math.min(allQueries.length, isMulti ? 4 : kind === 'cp' ? 5 : 7));
  const queryBatches = [
    { name: 'core', queries: allQueries.slice(0, coreSize), expansion: false },
  ];
  const longTail = allQueries.slice(coreSize);
  if (longTail.length) queryBatches.push({ name: 'long-tail', queries: longTail, expansion: true });

  let center = null;
  let gridSize = 1;
  if (kind === 'ciudad') {
    if (effectiveMax > 20)  gridSize = 2;
    if (effectiveMax > 100) gridSize = 3;
    if (effectiveMax > 200) gridSize = 4;
  } else if (kind === 'zona' && effectiveMax > 60) {
    gridSize = 2;
  }

  const points = [];
  try {
    center = await geocodeSearch(location);
    if (kind === 'cp') {
      const firstRadius = Math.min(requestedRadiusKm, 3);
      const radii = uniqueList([firstRadius, effectiveMax > 20 ? 5 : '', effectiveMax > 80 ? Math.min(requestedRadiusKm, 10) : ''])
        .map(Number)
        .filter(n => Number.isFinite(n) && n > 0);
      radii.forEach(radiusKm => points.push({ ...center, label: location, radiusKm, source: 'cp-radio' }));
    } else if (gridSize === 1) {
      points.push({ ...center, label: location, radiusKm: requestedRadiusKm, source: kind });
    } else {
      buildSearchGrid(center.lat, center.lng, requestedRadiusKm, gridSize)
        .forEach((pt, i) => points.push({ ...pt, label: `${location} #${i + 1}`, radiusKm: Math.max(1, Math.round((requestedRadiusKm / gridSize) * 10) / 10), source: 'grid' }));
    }

    const districts = kind === 'ciudad' ? getCityDistricts(location) : [];
    if (districts.length && effectiveMax > 50 && !isMulti) {
      districts.forEach(d => points.push({ lat: null, lng: null, label: d, radiusKm: requestedRadiusKm, source: 'distrito' }));
    }
  } catch (e) {
    logEnrich(`  Geocoding fallo, usando busqueda por texto: ${e.message}`, 'warn');
    points.push({ lat: null, lng: null, label: location, radiusKm: requestedRadiusKm, source: 'texto' });
  }

  const targetBeforeExpansion = Math.max(5, Math.ceil(effectiveMax * 0.6));
  return {
    segment,
    location,
    kind,
    requestedRadiusKm,
    effectiveMax,
    exhaustive,
    gridSize,
    center,
    points,
    queryBatches,
    targetBeforeExpansion,
    summary: `${kind} · ${points.length} zonas · ${allQueries.length} queries${isMulti ? ' · multi-sector' : ''}`,
  };
}

// Convierte un resultado de Place API a objeto empresa normalizado
function normalizePlaceResult(p) {
  return {
    name:          p.displayName || 'Sin nombre',
    address:       p.formattedAddress || '',
    rating:        p.rating || null,
    ratingCount:   p.userRatingCount || 0,
    website:       p.websiteURI || '',
    placeId:       p.id || '',
    phone:         p.internationalPhoneNumber || p.nationalPhoneNumber || '',
    types:         (p.types || []).join(', '),
    status:        p.businessStatus || '',
    description:   p.editorialSummary || '',
    priceLevel:    p.priceLevel || null,
    hasParking:    p.parkingOptions ? Object.values(p.parkingOptions).some(v => v === true) : null,
    isAccessible:  p.accessibilityOptions?.wheelchairAccessibleEntrance || null,
    lat:           p.location?.lat() ?? null,
    lng:           p.location?.lng() ?? null,
    signals:       [],
    webLoadMs:     null,
    sslValid:      null,
    hasSitemap:    false,
    techStack:     [],
    email: '', emails: [],
    decision_maker: '',
    instagram: '', facebook: '', linkedin: '', twitter: '', youtube: '',
    distKm:        null,
    enriched: false, enrichSource: [],
    foundBy: 'Google Places',
    querySource: '',
    searchPoint: '',
    radiusUsed: null,
    searchPlanKind: '',
  };
}

function normalizeSearchCompany(c = {}) {
  c.signals = Array.isArray(c.signals) ? c.signals : [];
  c.enrichSource = Array.isArray(c.enrichSource) ? c.enrichSource : [];
  c.emails = Array.isArray(c.emails) ? c.emails : [];
  c.techStack = Array.isArray(c.techStack) ? c.techStack : [];
  c.scrapeDiagnostics = Array.isArray(c.scrapeDiagnostics) ? c.scrapeDiagnostics : [];
  c.scrapeSignals = Array.isArray(c.scrapeSignals) ? c.scrapeSignals : [];
  decorateContactQuality(c);
  decorateResultExplanation(c);
  return c;
}

async function fetchPlaces(segment, location, maxResults, opts = {}) {
  const apiKey = localStorage.getItem('gordi_api_key');
  if (!apiKey) throw new Error('API Key de Google no configurada. Ve a Configuración.');

  await waitForGoogleMaps();
  const { Place } = await google.maps.importLibrary('places');
  const seenIds = new Set();
  const allPlaces = [];
  const plan = await buildSearchPlan(segment, location, maxResults, opts);
  const exhaustive = plan.exhaustive;
  const effectiveMax = plan.effectiveMax;
  logEnrich(`  Plan inteligente: ${plan.summary}`, 'ok');

  // Iterar sobre puntos del grid × queries del segmento
  let queryAttempts = 0;
  let failedQueries = 0;
  let lastQueryError = '';
  for (const batch of plan.queryBatches) {
    if (batch.expansion && !exhaustive && allPlaces.length >= plan.targetBeforeExpansion) {
      logEnrich(`  Expansion omitida: ${allPlaces.length}/${effectiveMax} resultados con queries core`);
      break;
    }
    if (batch.expansion) logEnrich(`  Expansion long-tail: ${batch.queries.length} queries extra`);
    for (const point of plan.points) {
      if (!exhaustive && allPlaces.length >= effectiveMax) break;

      for (const query of batch.queries) {
        if (!exhaustive && allPlaces.length >= effectiveMax) break;
        queryAttempts++;
        try {
          const request = {
            textQuery: point.lat
              ? `${query} en ${point.label || location}`   // Incluir ubicación siempre, aunque haya locationBias
              : `${query} en ${point.label || location}`,
            fields: [
              'displayName','formattedAddress','rating','websiteURI','id',
              'nationalPhoneNumber','internationalPhoneNumber',
              'regularOpeningHours','types','userRatingCount','businessStatus',
              'editorialSummary','priceLevel','parkingOptions','accessibilityOptions','location',
            ],
            language: 'es',
            region: 'es',
            maxResultCount: 20, // Máximo que permite la API por llamada
          };

          // Añadir bias geográfico — usar SIEMPRE buildLocationBias(), nunca construir aquí
          if (point.lat) {
            const cellRadiusM = Math.max(500, (point.radiusKm || plan.requestedRadiusKm || 10) * 1000);
            request.locationBias = buildLocationBias(point.lat, point.lng, cellRadiusM);
          }

          const { places } = await Place.searchByText(request);
          if (!places?.length) continue;

          // ── FILTRO DE EXCLUSIÓN: tipos de negocio no deseados ─────────
          // Se aplica ANTES de añadir al resultado para no contaminar el pool.
          const EXCLUDED_TYPES = new Set([
            'car_repair','car_dealer','car_wash','auto_parts_store',
            'car_rental','taxi_service','moving_company','storage',
            'gas_station','parking','vehicle_registration','driving_school',
            'motorcycle_dealer','bicycle_store',
          ]);
          const EXCLUDED_NAME_PATTERNS = /taller\s*(mecánico|mecanico|auto|automovil|automóvil|coches?|vehiculos?|motor)|mecánico|mecanico\s+auto|chapa\s*y\s*pintura|automoción|autoservice|car\s*service|garaje\s*(mecán|taller)|talleres?\s+\w+\s+(s\.?l\.?|s\.?a\.?)/i;

          let newInThisQuery = 0;
          for (const p of places) {
            if (seenIds.has(p.id)) continue;
            if (p.businessStatus === 'CLOSED_PERMANENTLY') continue;
            // Excluir tipos de negocio no deseados
            const pTypes = (p.types || []);
            if (pTypes.some(t => EXCLUDED_TYPES.has(t))) continue;
            // Excluir por nombre si coincide con patrón de taller mecánico
            const pName = (p.displayName || '').toLowerCase();
            if (EXCLUDED_NAME_PATTERNS.test(pName)) continue;
            seenIds.add(p.id);
            const normalized = normalizePlaceResult(p);
            normalized.querySource = query;
            normalized.queryBatch = batch.name;
            normalized.searchPoint = point.label || location;
            normalized.searchPointSource = point.source || '';
            normalized.radiusUsed = point.radiusKm || plan.requestedRadiusKm;
            normalized.searchPlanKind = plan.kind;
            normalized.searchPlanSummary = plan.summary;
            allPlaces.push(normalizeSearchCompany(normalized));
            newInThisQuery++;
            if (!exhaustive && allPlaces.length >= effectiveMax) break;
          }

          if (newInThisQuery) {
            try {
              const statsKey = `gordi_query_stats_${segment}`;
              const stats = JSON.parse(localStorage.getItem(statsKey) || '{}');
              const stat = stats[query] || { hits: 0, runs: 0 };
              stat.hits += newInThisQuery;
              stat.runs += 1;
              stats[query] = stat;
              localStorage.setItem(statsKey, JSON.stringify(stats));
            } catch {}
          }

          // Log de progreso en modo exhaustivo
          if (exhaustive || effectiveMax > 100) {
            logEnrich(`  -> ${allPlaces.length} empresas únicas encontradas...`);
          }

          await sleep(250); // Pausa entre llamadas API
        } catch(e) {
          failedQueries++;
          lastQueryError = e?.message || String(e);
          console.warn('Query fallida:', query, e.message);
          if (failedQueries <= 3 || failedQueries === queryAttempts) {
            logEnrich(`  Places fallo: "${query}" (${lastQueryError})`, 'warn');
          }
        }
      }
      if (plan.gridSize > 1) await sleep(100); // Pausa entre puntos del grid
    }
  }

  if (!allPlaces.length && failedQueries) {
    const failMessage = `Places no produjo resultados. Fallaron ${failedQueries}/${queryAttempts} consultas; ultimo error: ${lastQueryError || 'sin detalle'}. Revisa cuota/API key o prueba otra zona.`;
    logEnrich(failMessage, 'err');
    if (queryAttempts > 0 && failedQueries >= queryAttempts) {
      throw new Error(failMessage);
    }
  } else if (!allPlaces.length) {
    logEnrich(`Places devolvio 0 empresas tras ${queryAttempts} consultas. Prueba otra zona, mas radio o otro sector.`, 'warn');
  }
  logEnrich(`✅ Cobertura total: ${allPlaces.length} empresas únicas (${seenIds.size} IDs deduplicados)`, allPlaces.length ? 'ok' : 'warn');
  return allPlaces;
}

// ─── CACHÉ DE ENRIQUECIMIENTO — TTL ADAPTATIVO ────────────────────────────────
// MEJORA 5: TTL adaptativo según calidad:
//   · Con email confirmado -> 30 días (dato fiable, raramente cambia)
//   · Enriquecido pero sin email -> 7 días (igual que antes)
//   · Sin enriquecer / falló -> 2 días (vale la pena reintentar pronto)
const ENRICH_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // fallback base (7 días)

function getEnrichTTL(data) {
  if (data && data.email) return 30 * 24 * 60 * 60 * 1000;  // 30 días — email confirmado
  if (data && data.enriched) return 7 * 24 * 60 * 60 * 1000; // 7 días — enriquecido sin email
  return 2 * 24 * 60 * 60 * 1000;                            // 2 días — falló / sin datos
}

function getCachedEnrich(domain) {
  try {
    const key = 'gordi_ecache_' + domain.replace(/[^a-z0-9]/gi, '_').slice(0, 60);
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { ts, ttl, data } = JSON.parse(raw);
    // MEJORA 5: respetar el TTL guardado junto al dato (adaptativo), o fallback base
    const effectiveTTL = ttl || ENRICH_CACHE_TTL;
    if (Date.now() - ts > effectiveTTL) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function setCachedEnrich(domain, data) {
  try {
    const key = 'gordi_ecache_' + domain.replace(/[^a-z0-9]/gi, '_').slice(0, 60);
    // Guardar solo los campos enriquecidos (no todo el objeto company)
    const toCache = {
      email: data.email, emails: data.emails, phone: data.phone,
      emailQuality: data.emailQuality, emailCandidates: data.emailCandidates,
      decision_maker: data.decision_maker, description: data.description,
      decision_maker_confidence: data.decision_maker_confidence,
      decision_maker_source: data.decision_maker_source,
      instagram: data.instagram, facebook: data.facebook,
      linkedin: data.linkedin, twitter: data.twitter, youtube: data.youtube,
      signals: data.signals, techStack: data.techStack,
      enrichSource: data.enrichSource, enriched: data.enriched,
      scrapeSignals: data.scrapeSignals,
      scrapeChanged: data.scrapeChanged,
      scrapeStable: data.scrapeStable,
      scrapeLastRun: data.scrapeLastRun,
      domainAge: data.domainAge, domainYear: data.domainYear,
      hasSitemap: data.hasSitemap, webLoadMs: data.webLoadMs,
      scrapeDiagnostics: data.scrapeDiagnostics,
      scrapeMemoryUsed: data.scrapeMemoryUsed,
      deepPagesVisited: data.deepPagesVisited,
    };
    // MEJORA 5: TTL adaptativo según calidad del resultado
    const ttl = getEnrichTTL(toCache);
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), ttl, data: toCache }));
  } catch { /* localStorage lleno, ignorar */ }
}

function purgeStaleCaches() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || (!k.startsWith('gordi_ecache_') && !k.startsWith('gordi_geo_cache_'))) continue;
      try {
        const { ts, ttl } = JSON.parse(localStorage.getItem(k) || '{}');
        const maxAge = k.startsWith('gordi_geo_cache_') ? GEO_CACHE_TTL : (ttl || ENRICH_CACHE_TTL);
        if (!ts || Date.now() - ts > maxAge) toRemove.push(k);
      } catch { toRemove.push(k); }
    }
    toRemove.forEach(k => localStorage.removeItem(k));
  } catch {}
}

function getScrapeMemoryKey(domain) {
  return 'gordi_scrape_memory_' + String(domain || 'unknown').replace(/[^a-z0-9]/gi, '_').slice(0, 60);
}

function loadScrapeMemory(domain) {
  try {
    const raw = localStorage.getItem(getScrapeMemoryKey(domain));
    if (!raw) return { pages: [], bestEmailUrl: '', bestDecisionUrl: '', diagnostics: [] };
    const parsed = JSON.parse(raw);
    return {
      pages: Array.isArray(parsed.pages) ? parsed.pages.slice(-40) : [],
      bestEmailUrl: parsed.bestEmailUrl || '',
      bestDecisionUrl: parsed.bestDecisionUrl || '',
      diagnostics: Array.isArray(parsed.diagnostics) ? parsed.diagnostics.slice(-12) : [],
      lastFingerprint: parsed.lastFingerprint || '',
      lastSummary: parsed.lastSummary || null,
      lastRun: parsed.lastRun || 0,
    };
  } catch {
    return { pages: [], bestEmailUrl: '', bestDecisionUrl: '', diagnostics: [] };
  }
}

function saveScrapeMemory(domain, patch = {}) {
  try {
    const current = loadScrapeMemory(domain);
    const next = { ...current, ...patch, lastRun: Date.now() };
    next.pages = Array.isArray(next.pages) ? next.pages.slice(-40) : [];
    next.diagnostics = Array.isArray(next.diagnostics) ? next.diagnostics.slice(-12) : [];
    localStorage.setItem(getScrapeMemoryKey(domain), JSON.stringify(next));
  } catch {}
}

function recordScrapePage(domain, url, result = {}) {
  const memory = loadScrapeMemory(domain);
  const cleanUrl = String(url || '').slice(0, 260);
  const pages = memory.pages.filter(p => p.url !== cleanUrl);
  pages.push({
    url: cleanUrl,
    ts: Date.now(),
    ok: !!result.ok,
    emailFound: !!result.emailFound,
    decisionFound: !!result.decisionFound,
    reason: result.reason || '',
    ms: result.ms || 0,
  });
  saveScrapeMemory(domain, {
    ...memory,
    pages,
    bestEmailUrl: result.emailFound ? cleanUrl : memory.bestEmailUrl,
    bestDecisionUrl: result.decisionFound ? cleanUrl : memory.bestDecisionUrl,
    diagnostics: result.reason ? [...(memory.diagnostics || []), result.reason].slice(-12) : memory.diagnostics,
  });
}

function diagnoseScrapeFailure({ url = '', html = '', error = '', ms = 0 } = {}) {
  const text = String(html || '').slice(0, 4000).toLowerCase();
  const err = String(error || '').toLowerCase();
  if (!url) return 'sin-web';
  if (/timeout|abort|timed out/.test(err) || ms >= 9500) return 'timeout';
  if (/429|too many|rate limit/.test(text + err)) return 'rate-limit';
  if (/access denied|forbidden|blocked|cloudflare|hcaptcha|captcha|security check/.test(text + err)) return 'bloqueo';
  if (/certificate|ssl|expired cert/.test(text + err) || /^http:\/\//i.test(url)) return 'ssl-http';
  if (!html || html.length < 200) return 'proxy-cors';
  const textOnly = stripHtml(html);
  const scriptCount = (html.match(/<script\b/gi) || []).length;
  if (scriptCount > 8 && textOnly.length < 350) return 'js-only';
  return 'desconocido';
}

function decodeHtmlEntitiesSimple(str = '') {
  return String(str)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&commat;|&commat/gi, '@')
    .replace(/&period;|&dot;/gi, '.')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&');
}

function normalizeObfuscatedEmails(text = '') {
  return decodeHtmlEntitiesSimple(text)
    .replace(/\s*(?:\[|\(|\{)\s*(?:at|arroba)\s*(?:\]|\)|\})\s*/gi, '@')
    .replace(/\s+(?:at|arroba)\s+/gi, '@')
    .replace(/\s*(?:\[|\(|\{)\s*(?:dot|punto)\s*(?:\]|\)|\})\s*/gi, '.')
    .replace(/\s+(?:dot|punto)\s+/gi, '.');
}

function classifyEmail(email, companyDomain = '') {
  const e = String(email || '').toLowerCase().trim();
  const [local = '', dom = ''] = e.split('@');
  const root = (companyDomain || '').split('.')[0] || '';
  let score = 45;
  const reasons = [];

  if (!isValidEmail(e)) return { email: e, quality: 'descartado', score: 0, reason: 'email invalido' };
  if (companyDomain && (dom === companyDomain || dom.endsWith('.' + companyDomain) || (root && dom.includes(root)))) {
    score += 28;
    reasons.push('dominio propio');
  } else if (/gmail|hotmail|outlook|yahoo|icloud|protonmail/i.test(dom)) {
    score -= 6;
    reasons.push('email generico externo');
  } else {
    score -= 14;
    reasons.push('dominio ajeno');
  }

  if (/^(direccion|director|gerencia|gerente|ceo|administracion|comercial|ventas|contacto|info|hola|reservas|recepcion)$/i.test(local)) {
    score += 18;
    reasons.push('buzon operativo');
  }
  if (/^[a-z]+[._-][a-z]+$/.test(local) || /^[a-z]\.?[a-z]{3,}$/.test(local)) {
    score += 14;
    reasons.push('posible persona');
  }
  if (/^(noreply|no-reply|donotreply|privacy|privacidad|rgpd|legal|abuse|postmaster|webmaster)$/i.test(local)) {
    score -= 42;
    reasons.push('no comercial');
  }
  if (/\d{4,}|test|example|dummy/.test(local)) score -= 20;

  score = Math.max(0, Math.min(100, score));
  const quality = score >= 74 ? 'alta' : score >= 50 ? 'media' : 'baja';
  return { email: e, quality, score, reason: reasons.join(', ') || 'email valido' };
}

function extractEmailsAdvanced(html = '', company = {}) {
  const domain = extractDomain(company.website || '') || '';
  const normalized = normalizeObfuscatedEmails(html);
  const mailtoEmails = [...normalized.matchAll(/href=["']mailto:([^"'?\s]+)/gi)].map(m => m[1]);
  const attrEmails = [...normalized.matchAll(/(?:alt|title|data-email|data-mail|data-mailto|aria-label)=["']([^"']{5,100})["']/gi)]
    .map(m => m[1]);
  const rawRegex = /[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,12}/g;
  const raw = [...new Set([
    ...mailtoEmails,
    ...attrEmails,
    ...(normalized.match(rawRegex) || []),
  ].map(e => e.toLowerCase().replace(/^mailto:/, '').replace(/[.,;:)\]]+$/g, '').trim()))];

  return raw
    .filter(isValidEmail)
    .map(e => classifyEmail(e, domain))
    .filter(x => x.quality !== 'descartado' && x.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

function applyEmailCandidates(company, candidates, source = 'Web-email') {
  if (!Array.isArray(candidates) || !candidates.length) return false;
  const current = Array.isArray(company.emailCandidates) ? company.emailCandidates : [];
  const merged = [...current, ...candidates]
    .reduce((acc, item) => acc.some(x => x.email === item.email) ? acc : [...acc, item], [])
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  company.emailCandidates = merged;
  company.emails = [...new Set([...(company.emails || []), ...merged.map(x => x.email)])].slice(0, 6);
  const best = merged[0];
  if (best && (!company.email || best.score > (classifyEmail(company.email, extractDomain(company.website || '') || '').score || 0))) {
    company.email = best.email;
    company.emailQuality = best.quality;
  } else if (company.email && !company.emailQuality) {
    company.emailQuality = classifyEmail(company.email, extractDomain(company.website || '') || '').quality;
  }
  if (company.email && !company.enrichSource.includes(source)) company.enrichSource.push(source);
  return !!company.email;
}

function extractDecisionMakerAdvanced(html = '', sourceUrl = '') {
  const clean = stripHtml(normalizeObfuscatedEmails(html)).replace(/\s+/g, ' ');
  const roleStr = getRoleRegexSource();
  const namePattern = '([A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñA-ZÁÉÍÓÚÑ]+){1,3})';
  const patterns = [
    { re: new RegExp(`(${roleStr})[^a-záéíóúñ]{0,45}${namePattern}`, 'i'), roleIdx: 1, nameIdx: 2, conf: 86 },
    { re: new RegExp(`${namePattern}[^a-záéíóúñ]{0,55}(${roleStr})`, 'i'), nameIdx: 1, roleIdx: 2, conf: 82 },
    { re: /(?:fundador|fundadora|ceo|gerente|director(?:a)?)[^<]{0,80}/i, conf: 55 },
  ];
  for (const p of patterns) {
    const m = clean.match(p.re);
    if (!m) continue;
    const name = p.nameIdx ? (m[p.nameIdx] || '').trim() : '';
    const role = p.roleIdx ? (m[p.roleIdx] || '').trim() : (m[0] || '').trim();
    if (name && role) {
      return { value: `${name} (${role})`, name, role, source: sourceUrl, confidence: p.conf };
    }
  }
  const author = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']{3,80})["']/i);
  if (author) return { value: `${author[1].trim()} (Autor/a web)`, name: author[1].trim(), role: 'Autor/a web', source: sourceUrl, confidence: 45 };
  return null;
}

function buildDeepScrapePlan(company, html = '', domain = '', memory = {}) {
  const base = company.website || '';
  const urls = new Map();
  const add = (url, score = 0) => {
    try {
      const u = new URL(url, base);
      if (!/^https?:$/i.test(u.protocol)) return;
      const host = u.hostname.replace(/^www\./, '');
      const own = !domain || host === domain || host.endsWith('.' + domain);
      if (!own) return;
      u.hash = '';
      const clean = u.toString().replace(/\/$/, '');
      urls.set(clean, Math.max(urls.get(clean) || 0, score));
    } catch {}
  };

  [memory.bestEmailUrl, memory.bestDecisionUrl].filter(Boolean).forEach(u => add(u, 120));
  (memory.pages || []).filter(p => p.ok && (p.emailFound || p.decisionFound)).forEach(p => add(p.url, 100));

  const anchors = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)];
  anchors.forEach(m => {
    const href = decodeHtmlEntitiesSimple(m[1]);
    const label = stripHtml(m[2] || '');
    const hay = `${href} ${label}`.toLowerCase();
    let score = 0;
    if (/contact|contacto|ubicacion|localizacion|sedes|centros/.test(hay)) score += 80;
    if (/equipo|team|staff|nosotros|quienes|about|direccion|gerencia/.test(hay)) score += 75;
    if (/aviso-legal|legal|privacidad|privacy|politica/.test(hay)) score += 45;
    if (/blog|noticias|news/.test(hay)) score += 15;
    if (score > 0) add(href, score);
  });

  [
    '/contacto', '/contact', '/contactar', '/sobre-nosotros', '/nosotros',
    '/quienes-somos', '/equipo', '/team', '/staff', '/about', '/aviso-legal',
    '/legal', '/privacidad'
  ].forEach((path, i) => add(path, 70 - i));

  return [...urls.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
    .filter(url => url.replace(/\/$/, '') !== base.replace(/\/$/, ''))
    .slice(0, 3);
}

// ─── CAPA 2: Web Scraping PRO ─────────────────────────────────────────────────
async function enrichFromWeb(company) {
  company = normalizeSearchCompany(company);
  if (!company.website) {
    company.scrapeDiagnostics = ['sin-web'];
    return company;
  }

  // ── Comprobar caché ──────────────────────────────────────────────────────
  const domainKey = extractDomain(company.website) || company.website;
  const scrapeMemory = loadScrapeMemory(domainKey);
  company.scrapeDiagnostics = [];
  company.scrapeMemoryUsed = !!(scrapeMemory.bestEmailUrl || scrapeMemory.bestDecisionUrl || (scrapeMemory.pages || []).length);
  company.deepPagesVisited = 0;
  const cached = getCachedEnrich(domainKey);
  if (cached) {
    // Mezclar datos cacheados con los actuales (no sobreescribir si ya tenemos datos)
    Object.keys(cached).forEach(k => {
      if (cached[k] !== undefined && cached[k] !== null && cached[k] !== '') {
        if (Array.isArray(cached[k]) && Array.isArray(company[k])) {
          company[k] = [...new Set([...company[k], ...cached[k]])];
        } else if (!company[k]) {
          company[k] = cached[k];
        }
      }
    });
    if (!company.enrichSource.includes('Caché')) company.enrichSource.push('Caché');
    return company;
  }

  let html = '';
  // FIX 1: Medir el tiempo del fetch original — antes se hacía un 2º fetch idéntico
  // solo para medir velocidad (línea ~3892), duplicando todas las peticiones al proxy.
  // Ahora medimos el tiempo del fetch que ya necesitamos hacer de todas formas.
  const t0Fetch = Date.now();
  try {
    html = await fetchWithProxy(company.website, 10000, { deadlineMs: 11000, maxProxies: 3 }); // deadline global: evita bloqueos por web
  } catch (err) {
    const reason = diagnoseScrapeFailure({ url: company.website, error: err?.message, ms: Date.now() - t0Fetch });
    company.scrapeDiagnostics = [reason];
    recordScrapePage(domainKey, company.website, { ok: false, reason, ms: Date.now() - t0Fetch });
    return company;
  }
  company.webLoadMs = Date.now() - t0Fetch;
  if (!html || html.length < 200) {
    // Todos los proxies fallaron — marcar como intento fallido para no reintentar desde caché
    const reason = diagnoseScrapeFailure({ url: company.website, html, ms: company.webLoadMs });
    company.scrapeDiagnostics = [reason];
    recordScrapePage(domainKey, company.website, { ok: false, reason, ms: company.webLoadMs });
    company.enrichSource.push('Proxy-fallo');
    return company;
  }

  detectCommercialScrapeSignals(company, html);
  annotateIncrementalScrape(company);

  // ─── 0. SSL / HTTPS check ────────────────────────────────────────────────
  {
    const reason = diagnoseScrapeFailure({ url: company.website, html, ms: company.webLoadMs });
    if (reason !== 'desconocido') company.scrapeDiagnostics.push(reason);
    recordScrapePage(domainKey, company.website, { ok: true, reason: reason !== 'desconocido' ? reason : '', ms: company.webLoadMs });
  }

  try {
    const url = company.website;
    if (/^http:\/\//i.test(url)) {
      company.sslValid = false;
      company.signals.push('🔓 Sin HTTPS — web sin cifrar, señal de abandono tecnológico');
      if (!company.enrichSource.includes('SSL:HTTP')) company.enrichSource.push('SSL:HTTP');
    } else if (/^https:\/\//i.test(url)) {
      if (/certificate|ssl.*error|expired.*cert|cert.*expired|ssl_error/i.test(html)) {
        company.sslValid = false;
        company.signals.push('⚠️ SSL caducado detectado — web con certificado expirado');
      } else {
        company.sslValid = true;
      }
    }
  } catch {}

  const domain = extractDomain(company.website) || '';
  const domainRoot = domain.split('.')[0] || '';

  // ─── 1. JSON-LD / Schema.org (fuente más fiable) ─────────────────────────
  const jsonLdBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const block of jsonLdBlocks) {
    try {
      const ld = JSON.parse(block[1].trim());
      const items = Array.isArray(ld) ? ld : [ld, ...(ld['@graph'] || [])];
      for (const item of items) {
        if (!item) continue;
        // Email
        if (item.email && !company.email) {
          const e = item.email.replace('mailto:','').trim().toLowerCase();
          if (isValidEmail(e)) { company.email = e; company.enrichSource.push('JSON-LD'); }
        }
        // Teléfono
        if (item.telephone && !company.phone) company.phone = item.telephone.trim();
        // Descripción
        if (item.description && !company.description)
          company.description = stripHtml(item.description).slice(0, 220);
        // Nombre alternativo
        if (item.name && !company.description)
          company.description = stripHtml(item.name).slice(0, 220);
        // Fundador / director
        if (!company.decision_maker) {
          const person = item.founder || item.employee || item.author || item.creator;
          if (person?.name) {
            const role = item.founder ? 'Fundador/a' : (item.jobTitle || 'Responsable');
            company.decision_maker = `${person.name} (${role})`;
          }
        }
        // Redes sociales en sameAs
        const sameAs = Array.isArray(item.sameAs) ? item.sameAs : (item.sameAs ? [item.sameAs] : []);
        for (const url of sameAs) {
          if (!company.instagram && /instagram\.com/i.test(url)) company.instagram = url;
          if (!company.facebook  && /facebook\.com/i.test(url))  company.facebook  = url;
          if (!company.linkedin  && /linkedin\.com/i.test(url))  company.linkedin  = url;
          if (!company.twitter   && /(?:twitter|x)\.com/i.test(url)) company.twitter = url;
          if (!company.youtube   && /youtube\.com/i.test(url))   company.youtube   = url;
        }
      }
    } catch { /* JSON malformado, ignorar */ }
  }

  // ─── 2. Meta tags ────────────────────────────────────────────────────────
  if (!company.description) {
    const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{20,300})["']/i)
                  || html.match(/<meta[^>]+content=["']([^"']{20,300})["'][^>]+name=["']description["']/i);
    if (metaDesc) company.description = metaDesc[1].trim();
  }
  if (!company.description) {
    const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{20,300})["']/i)
             || html.match(/<meta[^>]+content=["']([^"']{20,300})["'][^>]+property=["']og:description["']/i);
    if (og) company.description = og[1].trim();
  }

  // ─── 3. Extracción de emails ─────────────────────────────────────────────
  // Deshabilitar obfuscación tipo "info [at] empresa [dot] com"
  const deobfHtml = html
    .replace(/\[at\]/gi, '@').replace(/\(at\)/gi, '@').replace(/ at /gi, '@')
    .replace(/\[dot\]/gi, '.').replace(/\(dot\)/gi, '.').replace(/ dot /gi, '.');

  // Buscar también en atributos href="mailto:..."
  const mailtoEmails = [...deobfHtml.matchAll(/href=["']mailto:([^"'?\s]+)/gi)]
    .map(m => m[1].toLowerCase().trim());

  // Regex general
  const rawRegex = /[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10}/g;
  const rawEmails = [...new Set([
    ...mailtoEmails,
    ...(deobfHtml.match(rawRegex) || []).map(e => e.toLowerCase()),
  ])];

  const validEmails = rawEmails.filter(e => {
    const parts = e.split('@');
    if (parts.length !== 2) return false;
    const [local, dom] = parts;
    if (local.length < 2 || dom.length < 4) return false;
    if (!dom.includes('.')) return false;
    // Ignorar dominios de bibliotecas/plataformas
    const domLower = dom.toLowerCase();
    for (const bl of EMAIL_BLACKLIST) { if (domLower === bl || domLower.endsWith('.'+bl)) return false; }
    // Ignorar emails con extensiones de archivo
    if (/\.(png|jpg|jpeg|gif|svg|css|js|woff|ttf|eot|ico|webp)$/i.test(e)) return false;
    return true;
  });

  // Ordenar: primero los del dominio propio, luego por prefijo prioritario
  const ownEmails = validEmails.filter(e => {
    const d = e.split('@')[1] || '';
    return d === domain || d.endsWith('.'+domain) || (domainRoot && d.includes(domainRoot));
  });
  const otherEmails = validEmails.filter(e => !ownEmails.includes(e));

  // Priorizar dentro de ownEmails los que tienen prefijos conocidos
  ownEmails.sort((a, b) => {
    const pa = EMAIL_PRIORITY_PREFIXES.findIndex(p => a.startsWith(p));
    const pb = EMAIL_PRIORITY_PREFIXES.findIndex(p => b.startsWith(p));
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
  });

  company.emails = [...new Set([...ownEmails, ...otherEmails])].slice(0, 6);
  if (!company.email && company.emails.length) {
    company.email = company.emails[0];
    company.enrichSource.push('Web-email');
  }

  // ─── 3b. Emails ocultos en atributos HTML (alt, title, data-*) ───────────
  if (!company.email) {
    const attrEmailRegex = /(?:alt|title|data-email|data-mail|data-mailto|aria-label)=["']([^"']{5,80}@[^"']{3,40}\.[a-z]{2,8})["']/gi;
    const attrMatches = [...deobfHtml.matchAll(attrEmailRegex)].map(m => m[1].toLowerCase().trim());
    const validAttr = attrMatches.filter(isValidEmail);
    if (validAttr.length) {
      company.email = validAttr[0];
      company.emails = [...new Set([...company.emails, ...validAttr])].slice(0, 6);
      company.enrichSource.push('HTML-attr');
    }
  }

  // ─── 3c. Emails en comentarios HTML ──────────────────────────────────────
  if (!company.email) {
    const commentMatches = [...deobfHtml.matchAll(/<!--[\s\S]*?([a-zA-Z0-9._%+\-]{2,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10})[\s\S]*?-->/g)]
      .map(m => m[1].toLowerCase()).filter(isValidEmail);
    if (commentMatches.length) {
      company.email = commentMatches[0];
      company.enrichSource.push('HTML-comment');
    }
  }

  // ─── 4. Teléfonos ────────────────────────────────────────────────────────
  // 3d. Validador real: ranking por dominio, rol y descartes no comerciales.
  applyEmailCandidates(company, extractEmailsAdvanced(html, company), 'Email-validado');

  if (!company.phone) {
    // href="tel:..."
    const telHref = html.match(/href=["']tel:([\d\s+\-().]{7,20})["']/i);
    if (telHref) {
      company.phone = telHref[1].trim();
    } else {
      // Patrones ES: móviles 6xx/7xx, fijos 8xx/9xx, con o sin +34
      const phoneRegex = /(?:\+34|0034)?[\s.-]?(?:6\d{2}|7[0-9]\d|8\d{2}|9\d{2})[\s.-]?\d{3}[\s.-]?\d{3}/g;
      const phones = deobfHtml.match(phoneRegex);
      if (phones?.length) company.phone = phones[0].replace(/[\s.-]/g, '');
    }
  }

  // ─── 4b. Teléfonos adicionales y WhatsApp ────────────────────────────────
  {
    const phoneRegexAll = /(?:\+34|0034)?[\s.-]?(?:6\d{2}|7[0-9]\d|8\d{2}|9\d{2})[\s.-]?\d{3}[\s.-]?\d{3}/g;
    const allRawPhones = (deobfHtml.match(phoneRegexAll) || [])
      .map(p => p.replace(/[\s.-]/g, '').replace(/^0034/, '+34'));
    company.phones = [...new Set(allRawPhones)].slice(0, 4);

    // WhatsApp: wa.me/XXXXXXXXX o whatsapp.com/send?phone=XXXXXXXXX
    if (!company.whatsapp) {
      const waMatch = html.match(/wa\.me\/(\d{9,15})|whatsapp[^"']*[?&]phone=(\d{9,15})/i);
      if (waMatch) {
        const num = waMatch[1] || waMatch[2];
        company.whatsapp = num.startsWith('34') ? '+' + num : (num.length === 9 ? '+34' + num : '+' + num);
        if (!company.enrichSource.includes('WhatsApp')) company.enrichSource.push('WhatsApp');
      }
    }
  }

  // ─── 5. Redes sociales ───────────────────────────────────────────────────
  if (!company.instagram) company.instagram = extractSocialUrl(html, 'instagram');
  if (!company.facebook)  company.facebook  = extractSocialUrl(html, 'facebook');
  if (!company.linkedin)  company.linkedin  = extractSocialUrl(html, 'linkedin');
  if (!company.twitter)   company.twitter   = extractSocialUrl(html, 'twitter');
  if (!company.youtube)   company.youtube   = extractSocialUrl(html, 'youtube');

  // ─── 6. Decisor — detección avanzada ────────────────────────────────────
  if (!company.decision_maker) {
    // Patrón: "Cargo: Nombre Apellido" o "Nombre Apellido, Cargo"
    const namePattern = /([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,20}(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,20}){1,2})/
    const roleStr = getRoleRegexSource();

    // Patrón 1: Cargo seguido de nombre
    const p1 = new RegExp(`(${roleStr})[^a-záéíóúñ]{0,30}(?:[:–|]\\s*)${namePattern.source}`, 'i');
    const m1 = html.match(p1);
    if (m1) { company.decision_maker = `${m1[2]} (${m1[1]})`; }

    // Patrón 2: Nombre seguido de cargo (típico en páginas de equipo)
    if (!company.decision_maker) {
      const p2 = new RegExp(`${namePattern.source}[^a-záéíóúñ]{0,40}(${roleStr})`, 'i');
      const m2 = html.match(p2);
      if (m2) { company.decision_maker = `${m2[1]} (${m2[2]})`; }
    }

    // Patrón 3: Buscar en meta "author"
    if (!company.decision_maker) {
      const author = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']{3,60})["']/i);
      if (author) company.decision_maker = `${author[1].trim()} (Autor/a web)`;
    }
  }

  // ─── 7. Descripción fallback: primer párrafo relevante ──────────────────
  {
    const dm = extractDecisionMakerAdvanced(html, company.website);
    if (dm && (!company.decision_maker || dm.confidence > (company.decision_maker_confidence || 0))) {
      company.decision_maker = dm.value;
      company.decision_maker_confidence = dm.confidence;
      company.decision_maker_source = dm.source;
      if (!company.enrichSource.includes('Decisor-validado')) company.enrichSource.push('Decisor-validado');
    } else if (company.decision_maker && !company.decision_maker_confidence) {
      company.decision_maker_confidence = 55;
      company.decision_maker_source = company.website;
    }
  }

  if (!company.description) {
    // Buscar primer <p> con contenido razonable
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]{50,400}?)<\/p>/gi)];
    for (const p of paras) {
      const txt = stripHtml(p[1]).trim();
      if (txt.length > 60 && !/copyright|cookie|privacidad|legal|aviso/i.test(txt)) {
        company.description = txt.slice(0, 220);
        break;
      }
    }
  }

  // ─── 8. Scraping profundo: equipo, nosotros, contacto ───────────────────
  // OPTIMIZACIÓN v2.1.1: Procesamos en paralelo para mayor velocidad
  const useLegacyDeepScrape = false;
  if (useLegacyDeepScrape && (!company.email || !company.decision_maker)) {
    const baseUrl = company.website.replace(/\/$/, '');
    // FIX-50+: Reducido a 3 rutas (mayor hit-rate comprobado) para evitar timeout
    const deepPaths = ['/contacto', '/contact', '/about'];
    try {
      // FIX-SCRAPING: Loop secuencial en lugar de Promise.allSettled para evitar saturar proxies
      for (const path of deepPaths) {
        if (company.email && company.decision_maker) break; // Ya tenemos todo, parar
        let pageHtml = null;
        try {
          pageHtml = await fetchWithProxy(baseUrl + path, 6000);
        } catch(e) {}
        
        if (pageHtml && pageHtml.length > 200) {
          // Extracción de emails
          if (!company.email) {
            const deobf = pageHtml.replace(/\[at\]/gi,'@').replace(/\(at\)/gi,'@').replace(/ at /gi,'@')
              .replace(/\[dot\]/gi,'.').replace(/\(dot\)/gi,'.').replace(/ dot /gi,'.');
            const mailtos = [...deobf.matchAll(/href=["']mailto:([^"'?\s]+)/gi)].map(m=>m[1].toLowerCase().trim());
            const rawEmails = [...new Set([...mailtos, ...(deobf.match(/[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10}/g)||[]).map(e=>e.toLowerCase())])];
            const validCtEmails = rawEmails.filter(isValidEmail);
            if (validCtEmails.length) {
              company.email = validCtEmails[0];
              company.emails = [...new Set([...company.emails, ...validCtEmails])].slice(0, 6);
              if (!company.enrichSource.includes('Pág-profunda')) company.enrichSource.push('Pág-profunda');
            }
          }
          // Extracción de decisor
          if (!company.decision_maker && /equipo|team|nosotros|about/i.test(path)) {
            const roleStr = getRoleRegexSource();
            const namePattern = /([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,20}\s+(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,20}\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,25})/;
            const p1 = new RegExp(`(${roleStr})[^a-z]{0,30}[:–|]?\\s*${namePattern.source}`, 'i');
            const p2 = new RegExp(`${namePattern.source}[^a-z]{0,40}(${roleStr})`, 'i');
            const m1 = pageHtml.match(p1);
            const m2 = pageHtml.match(p2);
            if (m1) company.decision_maker = `${m1[2]} (${m1[1]})`;
            else if (m2) company.decision_maker = `${m2[1]} (${m2[2]})`;
          }
        }
      }
    } catch {}
  }
  // ─── 8b. Tech Stack Detection (Idea 5) ─────────────────────────────────
  // 8c. Scraping profundo inteligente: usa enlaces reales + memoria local por dominio.
  if (!company.email || !company.decision_maker) {
    const deepUrls = buildDeepScrapePlan(company, html, domain, scrapeMemory);
    try {
      for (const deepUrl of deepUrls) {
        if (company.email && company.decision_maker) break;
        const t0Deep = Date.now();
        let pageHtml = '';
        let reason = '';
        try {
          pageHtml = await fetchWithProxy(deepUrl, 5000, { deadlineMs: 5500, maxProxies: 2 });
        } catch (e) {
          reason = diagnoseScrapeFailure({ url: deepUrl, error: e?.message, ms: Date.now() - t0Deep });
        }
        if (pageHtml && pageHtml.length > 200) {
          const hadEmail = !!company.email;
          const hadDecision = !!company.decision_maker;
          applyEmailCandidates(company, extractEmailsAdvanced(pageHtml, company), 'Pag-profunda');
          const dm = extractDecisionMakerAdvanced(pageHtml, deepUrl);
          if (dm && (!company.decision_maker || dm.confidence > (company.decision_maker_confidence || 0))) {
            company.decision_maker = dm.value;
            company.decision_maker_confidence = dm.confidence;
            company.decision_maker_source = dm.source;
            if (!company.enrichSource.includes('Decisor-profundo')) company.enrichSource.push('Decisor-profundo');
          }
          company.deepPagesVisited = (company.deepPagesVisited || 0) + 1;
          recordScrapePage(domainKey, deepUrl, {
            ok: true,
            emailFound: !hadEmail && !!company.email,
            decisionFound: !hadDecision && !!company.decision_maker,
            ms: Date.now() - t0Deep,
          });
        } else {
          reason = reason || diagnoseScrapeFailure({ url: deepUrl, html: pageHtml, ms: Date.now() - t0Deep });
          company.scrapeDiagnostics = [...new Set([...(company.scrapeDiagnostics || []), reason])];
          recordScrapePage(domainKey, deepUrl, { ok: false, reason, ms: Date.now() - t0Deep });
        }
      }
    } catch {}
  }

  company.techStack = [];
  if (/wp-content|wp-includes|wordpress/i.test(html)) company.techStack.push('WordPress');
  if (/wix\.com|wixstatic/i.test(html)) company.techStack.push('Wix');
  if (/squarespace/i.test(html)) company.techStack.push('Squarespace');
  if (/shopify/i.test(html)) company.techStack.push('Shopify');
  if (/google-analytics|ga4|googletagmanager/i.test(html)) company.techStack.push('Google Analytics');
  if (/facebook-jssdk|fbevents\.js/i.test(html)) company.techStack.push('Facebook Pixel');
  if (company.techStack.length > 0) {
    company.signals.push(`🛠️ Stack: ${company.techStack.join(', ')}`);
  } else {
    company.signals.push('🕸️ Web básica o personalizada (sin CMS detectado)');
  }
  // Detección de web antigua
  if (/<meta[^>]+name=["']generator["'][^>]+content=["'](?:frontpage|dreamweaver|adobe)/i.test(html) || /<table[^>]+border=["']0["'][^>]*>\s*<tr>\s*<td>/i.test(html)) {
    company.signals.push('🦖 Tecnología web obsoleta detectada — urgente modernización');
    company.techStack.push('Legacy');
  }

  // ─── 9. Detección de señales de oportunidad ──────────────────────────────
  if (!company.signals) company.signals = [];
  detectCommercialScrapeSignals(company, html);

  // Señal: rating bajo (oportunidad de mejora)
  if (company.rating && company.rating < 3.8 && company.ratingCount > 5)
    company.signals.push(`⚠️ Rating bajo (${company.rating}★) — oportunidad de mejora`);

  // Señal: muchas reseñas -> negocio activo
  if (company.ratingCount > 100)
    company.signals.push(`🔥 Negocio activo (${company.ratingCount} reseñas)`);

  // Señal: sin web -> potencial de digitalización
  if (!company.website)
    company.signals.push('🌐 Sin web detectada — alta necesidad de digitalización');

  // Señal: keywords de reforma/obras en descripción
  if (company.description && /reforma|renovac|ampliación|traslado|nueva sede|obra|apertura/i.test(company.description))
    company.signals.push('🏗️ Señal de obra/reforma detectada en descripción');

  // ─── 10. Detección de tecnología web ampliada (CMS + PMS + Reservas) ────────
  if (html) {
    if (!company.techStack) company.techStack = [];
    // CMS
    if (/wp-content|wordpress/i.test(html))       company.techStack.push('WordPress');
    else if (/shopify/i.test(html))               company.techStack.push('Shopify');
    else if (/wix\.com|wixsite/i.test(html))      company.techStack.push('Wix');
    else if (/squarespace/i.test(html))           company.techStack.push('Squarespace');
    else if (/webflow/i.test(html))               company.techStack.push('Webflow');
    else if (/prestashop/i.test(html))            company.techStack.push('PrestaShop');
    else if (/joomla/i.test(html))                company.techStack.push('Joomla');
    // PMS / Reservas (hoteles)
    if (/cloudbeds/i.test(html))                  company.techStack.push('PMS:Cloudbeds');
    else if (/mews\.com|mewssystems/i.test(html)) company.techStack.push('PMS:Mews');
    else if (/opera.*pms|oracle.*hospitality/i.test(html)) company.techStack.push('PMS:Opera');
    else if (/siteminder/i.test(html))            company.techStack.push('PMS:SiteMinder');
    else if (/booking\.com.*widget|bwidget/i.test(html)) company.techStack.push('Reservas:Booking-Widget');
    // Analítica
    if (/gtag|google-analytics|G-[A-Z0-9]+/i.test(html)) company.techStack.push('GA4');
    if (/fbq|facebook.*pixel/i.test(html))         company.techStack.push('MetaPixel');
    // Sin sistema de reservas online = señal de digitalización baja
    if (company.techStack.length === 0 || company.techStack.every(t => /WordPress|Wix|Joomla|Squarespace/.test(t)))
      company.signals.push('📱 Sin sistema de reservas digital detectado');
    if (company.techStack.length) company.enrichSource.push('Tech:' + company.techStack[0]);
  }

  // ─── 11. Sitemap.xml — detección de páginas clave ──────────────────────────
  // MEJORA — Early-exit de sitemap:
  // El sitemap solo aporta valor en dos casos: (a) encontrar decisor vía teamUrl,
  // (b) detectar URLs con año reciente como señal de actividad.
  // Si ya tenemos email + decisor desde una fuente fiable (JSON-LD / Hunter / Apollo / caché)
  // nos ahorramos el fetch de 5000ms por empresa -> en un batch de 3 = hasta 15s ganados.
  const _sitemapSources = company.enrichSource || [];
  const _skipSitemap = !!(
    company.email &&
    company.decision_maker &&
    _sitemapSources.some(s => /JSON-LD|Hunter|Apollo|Caché/.test(s))
  );
  try {
    if (_skipSitemap) { /* early-exit: datos completos, no merece el fetch */ }
    else {
    const sitemapUrl = company.website.replace(/\/$/, '') + '/sitemap.xml';
    const sitemapHtml = await fetchWithProxy(sitemapUrl, 4500, { deadlineMs: 5000, maxProxies: 2, expected: 'xml' });
    if (sitemapHtml && /<loc>/i.test(sitemapHtml)) {
      company.hasSitemap = true;
      const urls = [...sitemapHtml.matchAll(/<loc>([^<]+)<\/loc>/gi)].map(m => m[1].trim());
      // Buscar URLs de equipo, blog reciente, inauguraciones
      const teamUrl   = urls.find(u => /equipo|team|nosotros|about|staff/i.test(u));
      const blogUrls  = urls.filter(u => /blog|noticias|news|post/i.test(u)).slice(0, 3);
      const freshUrls = urls.filter(u => /202[34]|202[56]/i.test(u)).slice(0, 3); // URLs con año reciente

      if (freshUrls.length) company.signals.push(`📰 ${freshUrls.length} páginas de contenido reciente (${new Date().getFullYear()-1}-${new Date().getFullYear()})`);

      // Scraping de página de equipo desde sitemap
      if (teamUrl && !company.decision_maker) {
        try {
          const teamHtml = await fetchWithProxy(teamUrl, 5000, { deadlineMs: 5500, maxProxies: 2 });
          if (teamHtml) {
            const roleStr = getRoleRegexSource();
            const namePattern = /([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,20}\s+(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,20}\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]{1,25})/;
            const p1 = new RegExp(`(${roleStr})[^a-z]{0,30}[:–|]?\s*${namePattern.source}`, 'i');
            const m1 = teamHtml.match(p1);
            if (m1) { company.decision_maker = `${m1[2]} (${m1[1]})`; company.enrichSource.push('Sitemap'); }
          }
        } catch {}
      }
    }
    } // end else (!_skipSitemap)
  } catch {}

  // ─── 12. Velocidad web como señal de abandono tecnológico ───────────────────
  // FIX 1: webLoadMs ya fue medido en el fetch inicial (sin petición extra)
  {
    const loadMs = company.webLoadMs || 0;
    if (loadMs > 4000) {
      company.signals.push(`🐢 Web muy lenta (${(loadMs/1000).toFixed(1)}s) — posible abandono tecnológico`);
    } else if (loadMs > 2000) {
      company.signals.push(`⏱️ Web lenta (${(loadMs/1000).toFixed(1)}s)`);
    }
  }

  // ─── 13. PriceLevel × Rating — señal de oportunidad cruzada ────────────────
  if (company.priceLevel !== null && company.rating) {
    // Hotel caro con rating bajo = en riesgo, máxima urgencia
    if (company.priceLevel >= 3 && company.rating < 4.0)
      company.signals.push(`⚡ Precio alto + rating bajo (${company.rating}★) — riesgo de pérdida de clientes`);
    // Hotel barato con muchas reseñas = potencial sin explotar
    if (company.priceLevel <= 2 && company.ratingCount > 80 && company.rating >= 4.2)
      company.signals.push(`💎 Buena reputación a precio bajo — potencial de subida de categoría`);
  }

  company.enriched = true;
  if (company.email && !company.emailQuality) {
    company.emailQuality = classifyEmail(company.email, domainKey).quality;
  }
  {
    const mem = loadScrapeMemory(domainKey);
    saveScrapeMemory(domainKey, {
      ...mem,
      bestEmailUrl: company.email ? (mem.bestEmailUrl || company.website) : mem.bestEmailUrl,
      bestDecisionUrl: company.decision_maker ? (company.decision_maker_source || mem.bestDecisionUrl || company.website) : mem.bestDecisionUrl,
      lastFingerprint: getScrapeFingerprint(company),
      lastSummary: {
        email: company.email || '',
        phone: company.phone || '',
        decision_maker: company.decision_maker || '',
        signals: (company.signals || []).slice(0, 8),
        scrapeSignals: (company.scrapeSignals || []).slice(0, 8),
      },
      diagnostics: (company.scrapeDiagnostics || mem.diagnostics || []).slice(-12),
    });
  }

  // ── Guardar en caché ─────────────────────────────────────────────────────
  setCachedEnrich(domainKey, company);

  return company;
}

// ── Validador de email ────────────────────────────────────────────────────────
function isValidEmail(e) {
  if (!e || !e.includes('@')) return false;
  const [local, dom] = e.split('@');
  if (!local || local.length < 2 || !dom || !dom.includes('.')) return false;
  const domLower = dom.toLowerCase();
  for (const bl of EMAIL_BLACKLIST) { if (domLower === bl || domLower.endsWith('.'+bl)) return false; }
  if (/\.(png|jpg|jpeg|gif|svg|css|js|woff)$/i.test(e)) return false;
  return true;
}

// ─── CAPA 3: Hunter.io ────────────────────────────────────────────────────────
async function enrichFromHunter(company) {
  const hunterKey = localStorage.getItem('gordi_hunter_key');
  if (!hunterKey || !company.website) return company;

  try {
    const domain = extractDomain(company.website);
    if (!domain) return company;

    const res = await fetch(
      `https://api.hunter.io/v2/domain-search?domain=${domain}&api_key=${hunterKey}&limit=5`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();

    if (data.data?.emails?.length) {
      const hunterEmails = data.data.emails;

      // Elegir mejor email: prioridad a director/manager/ceo
      const priorityEmail = hunterEmails.find(e =>
        /director|ceo|gerente|manager|owner|founder|president/i.test(e.position || '')
      ) || hunterEmails[0];

      if (!company.email) {
        company.email = priorityEmail.value;
        company.enrichSource.push('Hunter.io');
      }

      // Decisor desde Hunter
      if (!company.decision_maker && priorityEmail.first_name) {
        const full = [priorityEmail.first_name, priorityEmail.last_name].filter(Boolean).join(' ');
        const pos  = priorityEmail.position || '';
        company.decision_maker = pos ? `${full} (${pos})` : full;
      }

      // Añadir todos los emails de Hunter (sin duplicados)
      const newEmails = hunterEmails.map(e => e.value).filter(Boolean);
      company.emails = [...new Set([...company.emails, ...newEmails])].slice(0, 6);
    }

    // Descripción de Hunter (tipo empresa)
    if (data.data?.organization && !company.description)
      company.description = data.data.organization;

    // Twitter de Hunter
    if (data.data?.twitter && !company.twitter)
      company.twitter = `https://twitter.com/${data.data.twitter}`;

  } catch (err) {
    console.warn(`Hunter fallido para ${company.name}:`, err.message);
  }

  return company;
}


// ─── CAPA 4: Apollo.io (gratuito, 50 créditos/mes) ────────────────────────────
async function enrichFromApollo(company) {
  const apolloKey = localStorage.getItem('gordi_apollo_key');
  if (!apolloKey || !company.website) return company;

  try {
    const domain = extractDomain(company.website);
    if (!domain) return company;

    // Apollo People Search por dominio — endpoint público
    const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apolloKey,
      },
      body: JSON.stringify({
        api_key: apolloKey,
        q_organization_domains: domain,
        page: 1,
        per_page: 5,
        person_titles: ['director','gerente','ceo','owner','propietario','manager','presidente','coo','responsable'],
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return company;
    const data = await res.json();
    const people = data.people || [];

    if (people.length) {
      // Buscar el de mayor seniority
      const priority = ['c_suite','vp','director','manager','individual_contributor'];
      const best = people.sort((a, b) => {
        const ai = priority.indexOf(a.seniority || '');
        const bi = priority.indexOf(b.seniority || '');
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })[0];

      // Email (Apollo lo devuelve si está verificado)
      if (!company.email && best.email) {
        company.email = best.email;
        company.enrichSource.push('Apollo.io');
      }

      // Decisor
      if (!company.decision_maker && best.name) {
        const title = best.title || best.seniority || '';
        company.decision_maker = title ? `${best.name} (${title})` : best.name;
        if (!company.enrichSource.includes('Apollo.io')) company.enrichSource.push('Apollo.io');
      }

      // LinkedIn del decisor
      if (!company.linkedin && best.linkedin_url) {
        company.linkedin = best.linkedin_url;
      }

      // Añadir todos los emails encontrados
      const apolloEmails = people.map(p => p.email).filter(Boolean);
      company.emails = [...new Set([...company.emails, ...apolloEmails])].slice(0, 8);

      // Señal: tamaño de empresa
      const orgSize = best.organization?.estimated_num_employees;
      if (orgSize && !company.signals.find(s => s.includes('empleados'))) {
        company.signals.push(`👥 ~${orgSize} empleados (Apollo)`);
      }
    }

    // Datos de la organización
    if (data.organizations?.length) {
      const org = data.organizations[0];
      if (!company.description && org.short_description)
        company.description = org.short_description.slice(0, 220);
      if (!company.linkedin && org.linkedin_url)
        company.linkedin = org.linkedin_url;
    }

  } catch (err) {
    console.warn(`Apollo fallido para ${company.name}:`, err.message);
  }

  return company;
}


// ─── CAPA 5: WHOIS / RDAP (sin key, gratis total) ────────────────────────────
async function enrichFromWhois(company) {
  if (!company.website) return company;
  try {
    const domain = extractDomain(company.website);
    if (!domain) return company;
    // RDAP es el sucesor oficial de WHOIS, API pública sin autenticación
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      signal: AbortSignal.timeout(6000),
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) return company;
    const data = await res.json();

    // Fecha de registro del dominio
    const events = data.events || [];
    const regEvent = events.find(e => e.eventAction === 'registration');
    const updEvent = events.find(e => e.eventAction === 'last changed');
    if (regEvent?.eventDate) {
      const regYear = new Date(regEvent.eventDate).getFullYear();
      const age = new Date().getFullYear() - regYear;
      company.domainAge = age;
      company.domainYear = regYear;
      if (age <= 2) {
        company.signals.push(`🆕 Dominio muy reciente (${regYear}) — empresa nueva`);
      } else if (age >= 15) {
        company.signals.push(`🏛️ Empresa consolidada (web desde ${regYear})`);
      }
    }

    // Registrante (a veces disponible)
    const entities = data.entities || [];
    for (const entity of entities) {
      if (!company.decision_maker && entity.vcardArray) {
        const vcard = entity.vcardArray[1] || [];
        const nameProp = vcard.find(p => p[0] === 'fn');
        const orgProp  = vcard.find(p => p[0] === 'org');
        const candidate = nameProp?.[3] || orgProp?.[3];
        if (candidate && candidate.length > 2 && candidate.length < 60
            && !/privacy|redacted|whoisguard|protect/i.test(candidate)) {
          company.decision_maker = `${candidate} (Registrante)`;
          company.enrichSource.push('WHOIS');
        }
      }
    }

  } catch(e) {
    console.warn('WHOIS fallido:', e.message);
  }
  return company;
}

// ─── CAPA 6: OpenCorporates (sin key para búsquedas básicas) ─────────────────
async function enrichFromOpenCorporates(company) {
  if (!company.name) return company;
  try {
    const query = encodeURIComponent(company.name.split(' ').slice(0,4).join(' '));
    const res = await fetch(
      `https://api.opencorporates.com/v0.4/companies/search?q=${query}&jurisdiction_code=es&per_page=3`,
      { signal: AbortSignal.timeout(7000) }
    );
    if (!res.ok) return company;
    const data = await res.json();
    const companies = data.results?.companies || [];
    if (!companies.length) return company;

    // Buscar el match más probable por nombre similar
    const best = companies.find(r => {
      const ocName = (r.company?.name || '').toLowerCase();
      const ourName = company.name.toLowerCase();
      return ocName.includes(ourName.split(' ')[0]) || ourName.includes(ocName.split(' ')[0]);
    }) || companies[0];

    const corp = best?.company;
    if (!corp) return company;

    // Año de incorporación
    if (corp.incorporation_date) {
      const yr = new Date(corp.incorporation_date).getFullYear();
      company.incorporationYear = yr;
      const age = new Date().getFullYear() - yr;
      if (!company.signals.find(s => s.includes('años')))
        company.signals.push(`🏢 Empresa de ${age} años (fundada ${yr})`);
    }

    // Estado legal
    if (corp.current_status) {
      company.legalStatus = corp.current_status;
      if (/dissolv|liquidat|struck/i.test(corp.current_status)) {
        company.signals.push('⚠️ Empresa en proceso de disolución');
      } else if (/active|activa/i.test(corp.current_status)) {
        if (!company.enrichSource.includes('OpenCorporates'))
          company.enrichSource.push('OpenCorporates');
      }
    }

    // Tipo de empresa
    if (corp.company_type) company.companyType = corp.company_type;

    // Número de registro
    if (corp.company_number) company.regNumber = corp.company_number;

  } catch(e) {
    console.warn('OpenCorporates fallido:', e.message);
  }
  return company;
}

// ─── CAPA 7: Clearbit Logo (sin key, gratis) ──────────────────────────────────
function getClearbitLogo(website) {
  if (!website) return '';
  try {
    const domain = extractDomain(website);
    if (!domain) return '';
    return `https://logo.clearbit.com/${domain}`;
  } catch { return ''; }
}

// ─── DEDUPLICACIÓN por nombre similar ────────────────────────────────────────
// ─── CAPA 7: IA Email Rescue (Gemini Flash) ─────────────────────────────────
async function extractEmailWithAI(websiteUrl, companyName, geminiKey) {
  if (!geminiKey || !websiteUrl) return null;
  try {
    // Obtener HTML de la página web usando el proxy existente
    const html = await fetchWithProxy(websiteUrl, 10000);
    if (!html || html.length < 200) return null;

    // Limpiar HTML -> solo texto visible (máximo 3000 chars para no gastar tokens)
    const textSnippet = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 3000);

    if (textSnippet.length < 100) return null;

    const prompt = `Eres un experto extrayendo emails de contacto de webs de empresas. Busca el email de contacto de la empresa "${companyName}" en este texto extraído de su web. Responde ÚNICAMENTE con el email encontrado, o con la palabra "null" si no hay ninguno. No añadas explicaciones ni texto adicional.\n\nTexto:\n${textSnippet}`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(12000),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const answer = (data.candidates?.[0]?.content?.parts?.[0]?.text || '').trim().toLowerCase();

    // Validar que la respuesta sea un email real
    if (answer === 'null' || !answer.includes('@')) return null;
    const emailMatch = answer.match(/[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10}/);
    if (emailMatch && isValidEmail(emailMatch[0])) return emailMatch[0];
  } catch { /* Gemini falló, continuar */ }
  return null;
}

function deduplicateResults(results) {
  const seen = new Map();
  const deduped = [];

  const getReasons = (a, b) => {
    const ia = getBusinessIdentity(a);
    const ib = getBusinessIdentity(b);
    return [
      ia.placeId && ib.placeId && ia.placeId === ib.placeId ? 'placeId' : '',
      ia.email && ib.email && ia.email === ib.email ? 'email exacto' : '',
      ia.phone && ib.phone && ia.phone === ib.phone ? 'telefono' : '',
      ia.address && ib.address && ia.address === ib.address ? 'direccion' : '',
      similarityRatio(ia.name, ib.name) >= 0.86 ? 'nombre similar' : '',
    ].filter(Boolean);
  };

  const mergeCompany = (existing, incoming) => {
    const best = getLeadUsefulnessScore(incoming) > getLeadUsefulnessScore(existing) ? incoming : existing;
    const other = best === incoming ? existing : incoming;
    const merged = { ...other, ...best };
    merged.emails = uniqueList([...(existing.emails || []), existing.email, ...(incoming.emails || []), incoming.email]).slice(0, 8);
    merged.phones = uniqueList([...(existing.phones || []), existing.phone, ...(incoming.phones || []), incoming.phone]).slice(0, 6);
    merged.enrichSource = uniqueList([...(existing.enrichSource || []), ...(incoming.enrichSource || [])]);
    merged.signals = uniqueList([...(existing.signals || []), ...(incoming.signals || [])]);
    merged.scrapeDiagnostics = uniqueList([...(existing.scrapeDiagnostics || []), ...(incoming.scrapeDiagnostics || [])]);
    merged.scrapeSignals = [...(existing.scrapeSignals || []), ...(incoming.scrapeSignals || [])]
      .reduce((acc, s) => acc.some(x => x.key === s.key || x.label === s.label) ? acc : [...acc, s], []);
    merged.matchedSectors = uniqueList([...(existing.matchedSectors || []), existing.sourceSector, existing.segment, ...(incoming.matchedSectors || []), incoming.sourceSector, incoming.segment]);
    merged.duplicateCount = (existing.duplicateCount || 0) + (incoming.duplicateCount || 0) + 1;
    merged.duplicateReasons = uniqueList([...(existing.duplicateReasons || []), ...(incoming.duplicateReasons || []), ...getReasons(existing, incoming)]);
    decorateContactQuality(merged);
    decorateResultExplanation(merged);
    return merged;
  };

  for (const company of results) {
    const identity = getBusinessIdentity(company);
    const keys = [
      identity.placeId && `p:${identity.placeId}`,
      identity.phone && `t:${identity.phone}`,
      identity.email && `m:${identity.email}`,
      identity.name && identity.address && `na:${identity.name}|${identity.address}`,
      identity.domain && identity.name && identity.address && `dna:${identity.domain}|${identity.name}|${identity.address}`,
    ].filter(Boolean);
    let isDuplicate = false;

    for (const key of keys) {
      if (!seen.has(key)) continue;
      const seenIdx = seen.get(key);
      const existing = deduped[seenIdx];
      deduped[seenIdx] = mergeCompany(existing, company);
      keys.forEach(k => seen.set(k, seenIdx));
      isDuplicate = true;
      break;
    }

    if (!isDuplicate) {
      for (let idx = 0; idx < deduped.length; idx++) {
        if (isSameBusiness(company, deduped[idx])) {
          deduped[idx] = mergeCompany(deduped[idx], company);
          keys.forEach(k => seen.set(k, idx));
          isDuplicate = true;
          break;
        }
      }
    }

    if (!isDuplicate) {
      keys.forEach(key => seen.set(key, deduped.length));
      deduped.push(company);
    }
  }

  return deduped;
}


// --- CAPA SOCIAL: LinkedIn + Instagram + Facebook Ads + Name Change ───────────
async function enrichFromSocial(company) {
  // ── 3. LinkedIn Company Page (público, sin key) ──────────────────────────
  if (company.linkedin && !company.decision_maker) {
    try {
      const liHtml = await fetchWithProxy(company.linkedin, 8000);
      if (liHtml) {
        // Buscar "Recently hired" o cargos directivos en la página pública
        const expansionSignals = [];
        if (/hiring|contratando|we.re growing|estamos creciendo/i.test(liHtml))
          expansionSignals.push('🚀 Empresa en contratación activa (LinkedIn)');
        if (/new office|nueva oficina|nueva sede|new location/i.test(liHtml))
          expansionSignals.push('🏢 Apertura de nueva sede detectada (LinkedIn)');
        if (/award|premio|reconocimiento|certified/i.test(liHtml))
          expansionSignals.push('🏆 Premio o certificación reciente (LinkedIn)');
        expansionSignals.forEach(s => {
          if (!company.signals.includes(s)) company.signals.push(s);
        });
        // Tamaño de empresa desde LinkedIn
        const sizeMatch = liHtml.match(/(\d[\d,]+)\s*(?:employee|empleado)/i);
        if (sizeMatch && !company.signals.find(s => s.includes('empleados'))) {
          const n = parseInt(sizeMatch[1].replace(',',''));
          if (n > 0) company.signals.push(`👥 ~${n} empleados (LinkedIn)`);
        }
        if (expansionSignals.length) company.enrichSource.push('LinkedIn');
      }
    } catch {}
  }

  // ── 4. Instagram bio — email directo y señales ───────────────────────────
  if (company.instagram && !company.email) {
    try {
      const igUrl = company.instagram.replace(/\/$/, '') + '/';
      const igHtml = await fetchWithProxy(igUrl, 7000);
      if (igHtml) {
        // Email en bio de Instagram
        const bioMatch = igHtml.match(/"biography":"([^"]{0,300})"/);
        if (bioMatch) {
          const bio = bioMatch[1];
          const bioEmail = bio.match(/[a-zA-Z0-9._%+\-]{1,64}@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,10}/);
          if (bioEmail && isValidEmail(bioEmail[0])) {
            company.email = bioEmail[0].toLowerCase();
            company.enrichSource.push('Instagram-bio');
          }
          // Señales en bio
          if (/nuevo|nueva|abrimos|apertura|inauguramos/i.test(bio))
            company.signals.push('📸 Apertura o novedad detectada en bio de Instagram');
          if (/reforma|renovaci|obras/i.test(bio))
            company.signals.push('🏗️ Reforma mencionada en Instagram bio');
        }
        // Número de posts como indicador de actividad
        const postsMatch = igHtml.match(/"edge_owner_to_timeline_media":\{"count":(\d+)/);
        if (postsMatch) {
          const posts = parseInt(postsMatch[1]);
          if (posts < 10) company.signals.push('📱 Instagram poco activo (< 10 publicaciones)');
          else if (posts > 500) company.signals.push('📸 Instagram muy activo (+500 posts) — negocio con presencia digital');
        }
      }
    } catch {}
  }

  // ── 7. Facebook Ads Library — detectar si invierte en publicidad ──────────
  if (company.name) {
    try {
      const q = encodeURIComponent(company.name.split(' ').slice(0,3).join(' '));
      const adRes = await fetch(
        `https://www.facebook.com/ads/library/api/?fields=ad_archive_id,page_name,ad_delivery_start_time&search_terms=${q}&ad_reached_countries=ES&ad_active_status=ACTIVE&limit=3`,
        { signal: AbortSignal.timeout(6000) }
      );
      if (adRes.ok) {
        const adData = await adRes.json();
        const ads = adData.data || [];
        if (ads.length > 0) {
          company.signals.push(`💰 ${ads.length} anuncio(s) activo(s) en Facebook/Instagram — empresa con presupuesto de marketing`);
          company.enrichSource.push('FB-Ads');
        }
      }
    } catch {}
  }

  // ── 10. Detección de cambio de nombre ────────────────────────────────────
  if (company.website && company.name) {
    try {
      const domain = extractDomain(company.website) || '';
      const domainName = domain.split('.')[0].toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');
      const companyNorm = company.name.toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '');

      // Si el nombre en Google Maps es muy distinto al dominio web = posible cambio de nombre
      if (domainName.length > 4 && companyNorm.length > 4) {
        const overlap = [...domainName].filter(c => companyNorm.includes(c)).length;
        const similarity = overlap / Math.max(domainName.length, companyNorm.length);
        if (similarity < 0.35) {
          company.signals.push(`🔄 Posible cambio de nombre reciente (Maps: "${company.name}" vs dominio: "${domain}") — nueva gestión`);
        }
      }
    } catch {}
  }

  return company;
}


// ─── CAPA REVIEWS: Análisis de reseñas Google para detectar dolor real ────────
async function enrichFromReviews(company) {
  const apiKey = localStorage.getItem('gordi_api_key');
  if (!apiKey || !company.placeId) return company;
  try {
    // Usar fetchGoogleReviews para aprovechar la doble fuente (Places New + legacy)
    // y el análisis estadístico cuando hay 8+ reseñas
    const reviews = await fetchGoogleReviews(company.placeId);
    if (!reviews.length) return company;

    const PAIN_KEYWORDS = {
      instalaciones: /instalaci[oó]n(?:es)?|cableado|enchufes|luz|iluminaci[oó]n|electricidad|cuadro el[eé]ctrico/i,
      temperatura:   /fr[ií]o|calor(?:es)?|temperatura|aire acondicionado|calefacci[oó]n|t[eé]rmico/i,
      deterioro:     /viejo|antiguo|deteriorado|descuidado|sucio|roto|desperfecto|anticuado|desgastado/i,
      obras:         /obra|reforma|renovaci[oó]n|remodelado|remodelaci[oó]n|construcci[oó]n/i,
      ruido:         /ruido|ac[uú]stica|aisla(?:miento)?|paredes finas|se escucha todo/i,
      humedad:       /humedad|gotera|grieta|hongos|moho|h[uú]medo/i,
      banos:         /ba[ñn]o|aseo|ducha|váter|inodoro|grifo/i,
    };

    // Analizar TODAS las reseñas negativas disponibles (no solo las primeras 5)
    const negativeReviews = reviews.filter(r => r.rating <= 3);
    const painCounts = {}; // {tipo: [{snippet, rating}]}

    for (const review of negativeReviews) {
      const text = review.text || '';
      for (const [type, regex] of Object.entries(PAIN_KEYWORDS)) {
        if (regex.test(text)) {
          if (!painCounts[type]) painCounts[type] = [];
          painCounts[type].push({
            snippet: text.replace(/\n/g, ' ').slice(0, 90),
            rating: review.rating,
            time: review.time || '',
          });
          break; // una reseña = un tipo de dolor (el primero que coincide)
        }
      }
    }

    // Ordenar tipos de dolor por frecuencia (el más mencionado primero)
    const painFound = Object.entries(painCounts)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([type, instances]) => ({
        type,
        count: instances.length,
        snippet: instances[0].snippet,
        rating: Math.min(...instances.map(i => i.rating)),
        instances,
      }));

    if (painFound.length) {
      const top = painFound[0];
      // Señal con temporalidad real si hay stats disponibles
      const isActive   = reviews._stats?.topPains?.find(p => p.label?.includes(top.type))?.isActive;
      const isHistoric = reviews._stats?.topPains?.find(p => p.label?.includes(top.type))?.isHistorical;
      const freqNote = top.count >= 3 ? ` · ${top.count}x mencionado` : '';
      const timeNote = isActive ? ' · ACTIVO (reciente)' : isHistoric ? ' · histórico (puede estar resuelto)' : '';
      company.signals.push(
        `🔥 Problema recurrente: ${top.type}${freqNote}${timeNote} — "${top.snippet.slice(0, 60)}..."`
      );
      company.reviewPain = painFound;
      if (!company.enrichSource.includes('Reviews-Pain')) company.enrichSource.push('Reviews-Pain');
    }

    // Señal de trending si está disponible
    if (reviews._stats?.ratingTrend) {
      const { avgRecent, avgOld, delta } = reviews._stats.ratingTrend;
      if (delta <= -0.4)
        company.signals.push(`📉 Rating cayendo: ${avgOld}★ -> ${avgRecent}★ en últimos meses — urgencia alta`);
      else if (delta >= 0.4)
        company.signals.push(`📈 Rating mejorando: ${avgOld}★ -> ${avgRecent}★ — puede estar recuperándose`);
    }

    // reviewSummary usa el conjunto completo ahora disponible
    company.reviewSummary = reviews
      .filter(r => r.text)
      .slice(0, 20)
      .map(r => `[${r.rating}\u2605${r.time ? ' \u00B7 ' + r.time : ''}] ${r.text.slice(0, 120)}`)
      .join('\n');

    // Guardar estadísticas si están disponibles (8+ reseñas)
    if (reviews._stats) company.reviewStats = reviews._stats;

  } catch(e) {
    console.warn('enrichFromReviews error:', e.message);
  }
  return company;
}

// ─── CAPA COMPETENCIA: Detectar competidores directos con mejor rating ────────
async function enrichCompetitivePressure(company, location) {
  const apiKey = localStorage.getItem('gordi_api_key');
  if (!apiKey || !company.rating || !company.name) return company;
  try {
    await waitForGoogleMaps();
    const { Place } = await google.maps.importLibrary('places');
    const typeRaw = (company.types || '').split(',')[0]?.trim().replace(/_/g, ' ') || 'negocio';
    const { places } = await Place.searchByText({
      textQuery: `${typeRaw} en ${location}`,
      fields: ['displayName','rating','userRatingCount','id'],
      maxResultCount: 6,
    });

    const competitors = (places || [])
      .filter(p => p.id !== company.placeId && p.rating && p.rating > (company.rating + 0.3) && (p.userRatingCount || 0) > 10)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 2);

    if (competitors.length) {
      const best = competitors[0];
      const diff = (best.rating - company.rating).toFixed(1);
      company.signals.push(
        `\u2694\uFE0F "${best.displayName}" (competidor) tiene +${diff}\u2605 \u00B7 ${best.rating}\u2605 vs ${company.rating}\u2605 — presión competitiva`
      );
      company.competitorBetter = { name: best.displayName, rating: best.rating, diff: parseFloat(diff) };
      if (!company.enrichSource.includes('Competencia')) company.enrichSource.push('Competencia');
    }
  } catch(e) {
    console.warn('enrichCompetitivePressure error:', e.message);
  }
  return company;
}

// ─── CAPA NEWS: Google News RSS (sin key, gratis) ────────────────────────────
async function enrichFromNews(company) {
  if (!company.name) return company;
  try {
    const q = encodeURIComponent('"' + company.name.split(' ').slice(0, 3).join(' ') + '"');
    const rss = await fetchWithProxy(
      `https://news.google.com/rss/search?q=${q}&hl=es&gl=ES&ceid=ES:es`, 5000
    );
    if (!rss || rss.length < 100) return company;

    // Extraer títulos y fechas de publicación
    const titles   = [...rss.matchAll(/<title><!\[CDATA\[([^\]]{10,200})\]\]><\/title>/gi)].slice(1, 6);
    const titles2  = titles.length ? titles : [...rss.matchAll(/<title>([^<]{10,200})<\/title>/gi)].slice(1, 6);
    const pubDates = [...rss.matchAll(/<pubDate>([^<]+)<\/pubDate>/gi)];

    for (let i = 0; i < titles2.length; i++) {
      const title   = stripHtml(titles2[i][1]).trim();
      const pubDate = pubDates[i] ? new Date(pubDates[i][1]) : null;
      const daysAgo = pubDate && !isNaN(pubDate) ? Math.floor((Date.now() - pubDate) / 86400000) : 999;

      if (daysAgo <= 60) {
        let signal = '';
        if (/inaugura|abre|apertura|nuevo local|nueva sede|abierto/i.test(title))
          signal = `📰 Apertura reciente (hace ${daysAgo}d): "${title.slice(0, 60)}"`;
        else if (/contrato|adjudicac|licitac|concurso público/i.test(title))
          signal = `📋 Contrato/licitación (hace ${daysAgo}d): "${title.slice(0, 60)}"`;
        else if (/venta|adquiere|compra|fusión|nuevo propietario/i.test(title))
          signal = `🔄 Operación corporativa (hace ${daysAgo}d): "${title.slice(0, 60)}"`;
        else if (/reforma|renovac|obra|ampliación/i.test(title))
          signal = `🏗️ Obra/reforma en prensa (hace ${daysAgo}d): "${title.slice(0, 60)}"`;
        else if (daysAgo <= 14)
          signal = `🗞️ En prensa esta semana (hace ${daysAgo}d): "${title.slice(0, 60)}"`;

        if (signal && !company.signals.some(s => s.includes(title.slice(0, 20)))) {
          company.signals.push(signal);
          if (!company.enrichSource.includes('Google-News')) company.enrichSource.push('Google-News');
          break; // Solo la noticia más reciente relevante
        }
      }
    }
  } catch { /* Google News falló, ignorar */ }
  return company;
}


// ─── VENTANA DE CONTACTO ÓPTIMA (síncrona, sin API extra) ────────────────────
function detectOptimalContactWindow(company) {
  const type = (company.types || '').toLowerCase();
  let w = null;
  if (/restaurant|bar|cafe|cafeter|bakery|food/.test(type))
    w = { slot: 'Lun–Mié 10:00–11:30', reason: 'Antes del servicio de comidas' };
  else if (/hotel|hostel|lodging|aparthotel/.test(type))
    w = { slot: 'Mar–Jue 09:00–10:00', reason: 'Antes del check-in matinal' };
  else if (/gym|fitness|sports_complex/.test(type))
    w = { slot: 'Lun–Mié 14:00–16:00', reason: 'Hueco entre turno mañana y tarde' };
  else if (/school|university|education|training/.test(type))
    w = { slot: 'Mar–Jue 08:30–09:30', reason: 'Antes de la jornada lectiva' };
  else if (/hospital|clinic|doctor|health|medical/.test(type))
    w = { slot: 'Lun–Mié 13:00–14:00', reason: 'Pausa entre consultas' };
  else if (/store|shop|retail|supermarket/.test(type))
    w = { slot: 'Mar–Jue 09:30–10:30', reason: 'Apertura antes de la afluencia' };
  else
    w = { slot: 'Mar–Mié 08:30–09:30', reason: 'Primera hora antes del trabajo operativo' };
  if (company.decision_maker) {
    const dm = (company.decision_maker || '').toLowerCase();
    if (/director|gerente|ceo|propietario|dueño|owner/.test(dm))
      w = { slot: 'Mar–Mié 07:30–08:30', reason: 'Directivos revisan email antes del día operativo' };
    else if (/manager|jefe|responsable/.test(dm))
      w = { slot: 'Mar–Jue 08:30–09:30', reason: 'Managers activos en primera hora' };
  }
  company.optimalContact = w;
  if (w) company.signals.push('🕐 Mejor contacto: ' + w.slot + ' · ' + w.reason);
  return company;
}

// ─── GOLDEN PROFILE + LOOKALIKE SCORE ────────────────────────────────────────
function buildGoldenProfile() {
  const converted = leads.filter(l =>
    (l.status === 'Cliente' || l.status === 'Convertido' || l.status === 'Cerrado ganado') && !l.archived
  );
  if (converted.length < 2) return null;
  const avgRating      = converted.reduce((s,l) => s + (l.rating     || 0), 0) / converted.length;
  const avgRatingCount = converted.reduce((s,l) => s + (l.ratingCount || 0), 0) / converted.length;
  const segs = converted.map(l => l.segment).filter(Boolean);
  const segCounts = segs.reduce((acc,s) => { acc[s]=(acc[s]||0)+1; return acc; }, {});
  const commonSegments = Object.entries(segCounts).sort((a,b)=>b[1]-a[1]).slice(0,3).map(e=>e[0]);
  const hasEmailRatio  = converted.filter(l => l.email).length          / converted.length;
  const hasDMRatio     = converted.filter(l => l.decision_maker).length / converted.length;
  const allWords = converted.flatMap(l => (l.signals||[]).join(' ').toLowerCase().split(/\s+/));
  const wc = allWords.reduce((acc,w) => { if (w.length>5) acc[w]=(acc[w]||0)+1; return acc; }, {});
  const topKeywords = Object.entries(wc).sort((a,b)=>b[1]-a[1]).slice(0,10).map(e=>e[0]);
  return { avgRating, avgRatingCount, commonSegments, hasEmailRatio, hasDMRatio, topKeywords, count: converted.length };
}

let _goldenProfile = null;

function getLookalikeSimilarity(company) {
  if (!_goldenProfile) _goldenProfile = buildGoldenProfile();
  if (!_goldenProfile) return 0;
  const gp = _goldenProfile;
  let sim = 0;
  sim += Math.max(0, Math.round(30 - Math.abs((company.rating||0) - gp.avgRating) * 20));
  if (gp.commonSegments.includes(company.segment)) sim += 20;
  if (company.email && gp.hasEmailRatio > 0.6) sim += 15;
  if (company.decision_maker && gp.hasDMRatio > 0.5) sim += 10;
  sim += Math.round(Math.min(1, (company.ratingCount||0) / Math.max(1, gp.avgRatingCount)) * 15);
  const sigText = (company.signals||[]).join(' ').toLowerCase();
  sim += Math.min(10, gp.topKeywords.filter(k => sigText.includes(k)).length * 3);
  return Math.min(100, Math.round(sim));
}

// ─── CAPA STREETVIEW: Análisis visual de fachada con Gemini Vision ────────────
async function enrichFromStreetView(company) {
  const apiKey    = localStorage.getItem('gordi_api_key');
  const geminiKey = getGeminiKey();
  if (!apiKey || !geminiKey || !company.address) return company;
  try {
    const svUrl = 'https://maps.googleapis.com/maps/api/streetview?size=640x400'
      + '&location=' + encodeURIComponent(company.address)
      + '&fov=90&pitch=0&return_error_code=true&key=' + apiKey;
    const imgRes = await fetch(svUrl, { signal: AbortSignal.timeout(8000) });
    if (!imgRes.ok || !(imgRes.headers.get('content-type')||'').includes('image')) return company;
    const blob   = await imgRes.blob();
    const base64 = await new Promise(res => {
      const reader = new FileReader();
      reader.onloadend = () => res(reader.result.split(',')[1]);
      reader.readAsDataURL(blob);
    });
    if (!base64 || base64.length < 500) return company;
    const gemRes = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + geminiKey,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [
          { inline_data: { mime_type: 'image/jpeg', data: base64 } },
          { text: 'Analiza esta fachada. ¿Ves signos de deterioro (pintura, óxido, cables sueltos, iluminación vieja)? ¿Parece un local vacío o en obras? Responde en una frase corta enfocada en necesidades de reforma.' }
        ]}]}),
        signal: AbortSignal.timeout(14000) }
    );
    const gemData = await gemRes.json();
    const analysis = gemData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    if (!analysis) return company;
    company.fachadaAnalysis = analysis;
    company.signals.push('📸 Fachada: ' + analysis.slice(0, 100));
    if (!company.enrichSource.includes('StreetView')) company.enrichSource.push('StreetView');
  } catch(e) { console.warn('enrichFromStreetView:', e.message); }
  return company;
}

// ─── CAPA BORME: Trámites y cambios societarios recientes ─────────────────────
async function enrichFromBorme(company) {
  if (!company.name) return company;
  try {
    const q = encodeURIComponent(company.name.split(' ').slice(0,3).join(' '));
    const d = new Date();
    const url = 'https://boe.es/borme/datos/dias/' + d.getFullYear() + '/'
      + String(d.getMonth()+1).padStart(2,'0') + '/borme_json.php?q=' + q;
    const raw = await fetchWithProxy(url, 6000);
    if (!raw || raw.length < 50) return company;
    let data; try { data = JSON.parse(raw); } catch { return company; }
    const actos = data?.actos || data?.results || [];
    const firstWord = company.name.toLowerCase().split(' ')[0];
    for (const acto of actos.slice(0, 8)) {
      const texto  = (acto.texto || acto.descripcion || '').toLowerCase();
      const nombre = (acto.razon_social || acto.nombre || '').toLowerCase();
      if (firstWord.length > 3 && !nombre.includes(firstWord)) continue;
      if (/constituci.n|nueva sociedad/.test(texto))
        { company.signals.push('🎉 Empresa recién constituida (BORME)'); company.enrichSource.push('BORME'); break; }
      else if (/ampliaci.n de capital/.test(texto))
        { company.signals.push('💰 Ampliación de capital (BORME) — presupuesto disponible'); company.enrichSource.push('BORME'); break; }
      else if (/cambio de domicilio|traslado/.test(texto))
        { company.signals.push('📍 Cambio domicilio (BORME) — mudanza/obra probable'); company.enrichSource.push('BORME'); break; }
      else if (/disoluci.n|liquidaci.n/.test(texto))
        { company.signals.push('⚠️ En disolución (BORME) — descartar'); company.enrichSource.push('BORME'); break; }
      else if (/nombramiento|nuevo administrador/.test(texto))
        { company.signals.push('👤 Nuevo administrador (BORME) — cambio de gestión'); company.enrichSource.push('BORME'); break; }
    }
  } catch(e) {}
  return company;
}

// ─── CAPA LINKEDIN DORKING: Encontrar decisores reales (Idea 3 - Gratis) ──────
async function enrichFromLinkedInDorking(company) {
  if (!company.name || company.decision_maker) return company;
  try {
    // Buscamos Gerentes/Directores de la empresa en LinkedIn via proxy de búsqueda
    const q = encodeURIComponent(`site:linkedin.com/in "Gerente" OR "Director" OR "CEO" "${company.name}"`);
    const searchUrl = `https://api.allorigins.win/get?url=${encodeURIComponent('https://www.google.com/search?q=' + q)}`;
    const res = await fetch(searchUrl);
    const j = await res.json();
    const html = j.contents || '';
    
    // Extraer nombres probables de los títulos de LinkedIn
    const names = html.match(/>([^<|]+)\s*-\s*[^<]*LinkedIn</gi);
    if (names && names.length > 0) {
      const bestMatch = names[0].replace(/>/,'').split('-')[0].trim();
      if (bestMatch.length > 5 && bestMatch.length < 40) {
        company.decision_maker = bestMatch;
        company.signals.push(`👤 Decisor probable (LinkedIn Dorking): ${bestMatch}`);
        company.enrichSource.push('LinkedIn-Dork');
      }
    }
  } catch(e) {}
  return company;
}

// ─── CAPA EMPRESITE: Directorio empresarial español (gratis, sin key) ─────────
// Fuente: empresite.eleconomista.es
// Datos: NIF/CIF, CNAE, empleados, facturación estimada, año fundación, actividad
async function enrichFromEmpressite(company) {
  if (!company.name) return company;
  try {
    // Construir query: primeras 4 palabras del nombre para mejor matching
    const q = encodeURIComponent(
      company.name
        .replace(/\b(SL|SA|SLU|SLL|SLP|SC|CB|AIE|LTD|S\.L\.|S\.A\.)\b\.?/gi, '')
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join(' ')
    );

    // Empresite tiene una página por empresa en formato slug
    // también tiene búsqueda por nombre
    const searchUrl = `https://empresite.eleconomista.es/${encodeURIComponent(
      company.name.split(' ').slice(0, 3).join('-').toUpperCase()
    )}/`;

    const html = await fetchWithProxy(searchUrl, 8000);
    if (!html || html.length < 500) {
      // Fallback: búsqueda general
      const searchFallback = `https://empresite.eleconomista.es/busqueda/?q=${q}`;
      const searchHtml = await fetchWithProxy(searchFallback, 8000);
      if (!searchHtml) return company;
      return _parseEmpressiteHtml(company, searchHtml, true);
    }
    return _parseEmpressiteHtml(company, html, false);
  } catch(e) {
    console.warn('Empresite error:', e.message);
  }
  return company;
}

function _parseEmpressiteHtml(company, html, isSearch) {
  try {
    // ── NIF / CIF ────────────────────────────────────────────────────────────
    const nifMatch = html.match(/\b([A-Z]\d{7}[A-Z0-9]|\d{8}[A-Z])\b/);
    if (nifMatch && !company.nif) {
      company.nif = nifMatch[1];
    }

    // ── CNAE / Actividad ─────────────────────────────────────────────────────
    const cnaeMatch = html.match(/CNAE[:\s-]+(\d{4})/i) ||
                      html.match(/actividad[^<]{0,80}?(\d{4})/i);
    if (cnaeMatch && !company.cnae) {
      company.cnae = cnaeMatch[1];
    }

    // ── Número de empleados ──────────────────────────────────────────────────
    const empMatch = html.match(/(\d[\d.]+)\s*(?:empleados?|trabajadores?|personas?)/i) ||
                     html.match(/empleados?[^<]{0,30}?(\d[\d.]+)/i);
    if (empMatch && !company.signals.find(s => s.includes('empleados'))) {
      const n = parseInt(empMatch[1].replace(/\./g, ''));
      if (n > 0 && n < 500000) {
        company.employeeCount = n;
        company.signals.push(`👥 ${n.toLocaleString('es-ES')} empleados (Empresite)`);
      }
    }

    // ── Facturación / Ingresos ───────────────────────────────────────────────
    const revMatch = html.match(/facturaci[oó]n[^<]{0,60}?([\d,.]+)\s*(?:M|millones?|€|euros?|K)/i) ||
                     html.match(/([\d,.]+)\s*(?:M|millones?)\s*(?:de\s*)?€/i) ||
                     html.match(/ingresos?[^<]{0,60}?([\d,.]+)/i);
    if (revMatch && !company.revenue) {
      const rawNum = revMatch[1].replace(/\./g, '').replace(',', '.');
      const val = parseFloat(rawNum);
      if (!isNaN(val) && val > 0) {
        company.revenue = val;
        const label = val >= 1 ? `${val}M €` : `${Math.round(val * 1000)}K €`;
        company.signals.push(`💶 Facturación ~${label} (Empresite)`);
      }
    }

    // ── Año de fundación ─────────────────────────────────────────────────────
    const yearMatch = html.match(/(?:fundada?|constituida?|a[ñn]o\s+de\s+(?:creaci[oó]n|fundaci[oó]n))[^<]{0,30}?(\d{4})/i) ||
                      html.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
    if (yearMatch && !company.incorporationYear) {
      const yr = parseInt(yearMatch[1]);
      if (yr >= 1950 && yr <= new Date().getFullYear()) {
        company.incorporationYear = yr;
        const age = new Date().getFullYear() - yr;
        if (!company.signals.find(s => s.includes('años') || s.includes('fundada'))) {
          company.signals.push(`🏢 Fundada en ${yr} (${age} años) — Empresite`);
        }
      }
    }

    // ── Dirección / municipio ────────────────────────────────────────────────
    if (!company.address) {
      const addrMatch = html.match(/(?:direcci[oó]n|domicilio)[^<]{0,10}?<[^>]+>([^<]{10,80})</i) ||
                        html.match(/C\/?\.?\s+[A-ZÁÉÍÓÚ][a-záéíóú]+[^<]{5,50},\s*\d{5}/);
      if (addrMatch) {
        const addr = addrMatch[1].trim().replace(/\s+/g, ' ');
        if (addr.length > 8 && addr.length < 100) company.address = addr;
      }
    }

    // ── Señal: empresa destacada o activa ────────────────────────────────────
    if (/destacada|premium|verificada|activa/i.test(html)) {
      if (!company.enrichSource.includes('Empresite'))
        company.enrichSource.push('Empresite');
    } else if (nifMatch || empMatch || revMatch) {
      company.enrichSource.push('Empresite');
    }

  } catch(e) {
    console.warn('Empresite parse error:', e.message);
  }
  return company;
}

// ─── CAPA EXPERIAN: Riesgo crediticio y señales financieras (gratis) ──────────
// Fuente: www.experian.es/empresas (parte pública, sin registro)
// Datos: score de riesgo, morosidades, cambios recientes, tamaño estimado
async function enrichFromExperian(company) {
  if (!company.name) return company;
  try {
    // Experian España permite búsqueda pública de empresas por nombre/NIF
    const q = encodeURIComponent(
      company.name
        .replace(/\b(SL|SA|SLU|SLL|SLP|SC|CB|AIE|S\.L\.|S\.A\.)\b\.?/gi, '')
        .trim()
        .split(/\s+/)
        .slice(0, 4)
        .join(' ')
    );

    // Endpoint público de búsqueda de Experian España
    const url = `https://www.experian.es/empresas/informe-empresas?nombre=${q}${company.nif ? '&nif=' + encodeURIComponent(company.nif) : ''}`;
    const html = await fetchWithProxy(url, 9000);
    if (!html || html.length < 300) return company;

    return _parseExperianHtml(company, html);
  } catch(e) {
    console.warn('Experian error:', e.message);
  }
  return company;
}

function _parseExperianHtml(company, html) {
  try {
    // ── Score / Rating de riesgo ──────────────────────────────────────────────
    // Experian muestra un semáforo o puntuación pública de riesgo
    const riskMatch = html.match(/(?:riesgo|score|puntuaci[oó]n)[^<]{0,50}?(\d{1,3})\s*(?:\/\s*100)?/i) ||
                      html.match(/\b(muy\s+(?:bajo|alto)|bajo|medio|alto|m[ií]nimo|m[aá]ximo)\s+riesgo/i);
    if (riskMatch) {
      const raw = riskMatch[1].toLowerCase();
      if (!isNaN(parseInt(raw))) {
        const score = parseInt(raw);
        company.creditScore = score;
        if (score >= 70) {
          company.signals.push(`✅ Riesgo financiero bajo (${score}/100) — Experian`);
        } else if (score >= 40) {
          company.signals.push(`⚠️ Riesgo financiero medio (${score}/100) — Experian`);
        } else {
          company.signals.push(`🔴 Riesgo financiero alto (${score}/100) — Experian`);
        }
      } else {
        const label = raw.includes('bajo') ? 'bajo' : raw.includes('alto') ? 'alto' : 'medio';
        if (label === 'alto') {
          company.signals.push('🔴 Riesgo financiero alto detectado — Experian');
        } else if (label === 'bajo') {
          company.signals.push('✅ Empresa con riesgo financiero bajo — Experian');
        }
      }
    }

    // ── Incidencias / Morosidad ───────────────────────────────────────────────
    const moraMatch = html.match(/(\d+)\s*(?:incidencia[s]?|morosidad|impagos?|deuda[s]?)/i) ||
                      html.match(/(?:incidencia[s]?|morosidad)[^<]{0,40}?(\d+)/i);
    if (moraMatch) {
      const n = parseInt(moraMatch[1]);
      if (n > 0) {
        company.signals.push(`⚠️ ${n} incidencia(s) de morosidad registradas — Experian`);
      }
    }

    // ── Sin incidencias (señal positiva) ─────────────────────────────────────
    if (/sin\s+incidencias?|0\s+incidencias?|no\s+(?:constan|hay)\s+incidencias?/i.test(html)) {
      if (!company.signals.find(s => s.includes('morosidad') || s.includes('incidencia'))) {
        company.signals.push('✅ Sin incidencias de morosidad — Experian');
      }
    }

    // ── Tamaño / Clasificación ────────────────────────────────────────────────
    const sizeMatch = html.match(/(?:tama[ñn]o|clasificaci[oó]n)[^<]{0,40}?(microempresa|peque[ñn]a|mediana|grande)/i);
    if (sizeMatch && !company.companySize) {
      company.companySize = sizeMatch[1].toLowerCase();
    }

    // ── Cambios recientes (nuevo administrador, cambio domicilio) ────────────
    if (/nuevo\s+administrador|cambio\s+(?:de\s+)?(?:administrador|titular)/i.test(html)) {
      if (!company.signals.find(s => s.includes('administrador'))) {
        company.signals.push('👤 Cambio de administrador reciente — Experian (nueva gestión = oportunidad)');
      }
    }
    if (/cambio\s+(?:de\s+)?domicilio|traslado|nueva\s+sede/i.test(html)) {
      if (!company.signals.find(s => s.includes('domicilio') || s.includes('traslado'))) {
        company.signals.push('📍 Cambio de domicilio reciente — Experian (obra probable)');
      }
    }

    // ── NIF si no lo teníamos ─────────────────────────────────────────────────
    if (!company.nif) {
      const nifMatch = html.match(/\b([A-Z]\d{7}[A-Z0-9]|\d{8}[A-Z])\b/);
      if (nifMatch) company.nif = nifMatch[1];
    }

    // ── Año de constitución ───────────────────────────────────────────────────
    if (!company.incorporationYear) {
      const yrMatch = html.match(/(?:constituci[oó]n|fundaci[oó]n|alta)[^<]{0,30}?(\d{4})/i);
      if (yrMatch) {
        const yr = parseInt(yrMatch[1]);
        if (yr >= 1950 && yr <= new Date().getFullYear()) {
          company.incorporationYear = yr;
        }
      }
    }

    // ── Marcar fuente ─────────────────────────────────────────────────────────
    if (riskMatch || moraMatch || sizeMatch ||
        html.includes('Experian') || html.length > 1000) {
      company.enrichSource.push('Experian');
    }

  } catch(e) {
    console.warn('Experian parse error:', e.message);
  }
  return company;
}

// ─── SINCRONIZACIÓN GOOGLE SHEETS ─────────────────────────────────────────────
const SHEETS_HEADERS = ['ID','Empresa','Nombre','Email','Teléfono','Estado','Score',
  'Segmento','Dirección','Web','Rating','Reseñas','Decisor','Señales','Fuentes','Fecha','Notas','Próximo contacto'];

async function syncToSheets(leadsToSync) {
  const sheetsId = localStorage.getItem('gordi_sheets_id');
  const token    = localStorage.getItem('gordi_sheets_token');
  if (!sheetsId || !token) return;
  try {
    const rows = leadsToSync.filter(l => !l.archived).map(l => [
      l.id, l.company||'', l.name||'', l.email||'', l.phone||'',
      l.status||'Pendiente', l.score||0, l.segment||'', l.address||'', l.website||'',
      l.rating||'', l.ratingCount||'', l.decision_maker||'',
      (l.signals||[]).join(' | ').slice(0,300), (l.enrichSource||[]).join(', '),
      l.date ? new Date(l.date).toLocaleDateString('es-ES') : '',
      (l.notes||'').replace(/\n/g,' ').slice(0,200), l.next_contact||''
    ]);
    const res = await fetch(
      'https://sheets.googleapis.com/v4/spreadsheets/' + sheetsId + '/values/'
        + encodeURIComponent('Voltflow!A1:R' + (rows.length+1)) + '?valueInputOption=RAW',
      { method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [SHEETS_HEADERS, ...rows] }),
        signal: AbortSignal.timeout(10000) }
    );
    if (res.ok) showToast('✅ Sheets sincronizado (' + rows.length + ' leads)');
    else showToast('⚠️ Error Sheets ' + res.status + ' — verifica el token');
  } catch(e) { console.warn('Sheets sync:', e.message); }
}

function initSheetsOAuth(silent) {
  const cid = localStorage.getItem('gordi_sheets_client_id');
  if (!cid) { if (!silent) showToast('⚠️ Configura tu Client ID de Google en Ajustes'); return; }
  const sc = encodeURIComponent('https://www.googleapis.com/auth/spreadsheets');
  const redirectUri = location.href.split('?')[0].replace(/\/$/, '');
  const popup = window.open('https://accounts.google.com/o/oauth2/v2/auth?client_id=' + cid
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&response_type=token&scope=' + sc
    + '&prompt=none', '_blank', 'width=500,height=600');
  if (!silent) showToast('🔑 Autorizando con Google...');
  const timer = setInterval(() => {
    try {
      if (popup && popup.location && popup.location.href && popup.location.href.includes('access_token')) {
        const hash = popup.location.hash || popup.location.href.split('#')[1] || '';
        const params = new URLSearchParams(hash.replace('#',''));
        const token = params.get('access_token');
        const expiresIn = parseInt(params.get('expires_in') || '3600');
        if (token) {
          localStorage.setItem('gordi_sheets_token', token);
          localStorage.setItem('gordi_sheets_token_expiry', Date.now() + (expiresIn - 120) * 1000);
          const el = document.getElementById('sheets-token-input');
          if (el) el.value = token;
          popup.close();
          clearInterval(timer);
          if (!silent) showToast('✅ Token renovado. ¡Ya puedes sincronizar!');
          scheduleTokenRenewal();
        }
      }
      if (popup && popup.closed) { clearInterval(timer); }
    } catch(e) {}
  }, 500);
}

function isTokenValid() {
  const token = localStorage.getItem('gordi_sheets_token');
  const expiry = parseInt(localStorage.getItem('gordi_sheets_token_expiry') || '0');
  return token && Date.now() < expiry;
}

function scheduleTokenRenewal() {
  const expiry = parseInt(localStorage.getItem('gordi_sheets_token_expiry') || '0');
  const msUntilRenew = expiry - Date.now();
  if (msUntilRenew > 0) {
    setTimeout(() => {
      showToast('🔄 Renovando token de Google automáticamente...');
      initSheetsOAuth(true);
    }, msUntilRenew);
  }
}

function saveSheetsConfig() {
  const id  = document.getElementById('sheets-id-input')?.value?.trim();
  const cid = document.getElementById('sheets-client-input')?.value?.trim();
  const tok = document.getElementById('sheets-token-input')?.value?.trim();
  if (id)  localStorage.setItem('gordi_sheets_id', id);
  if (cid) localStorage.setItem('gordi_sheets_client_id', cid);
  if (tok) localStorage.setItem('gordi_sheets_token', tok);
  showToast('✅ Configuración de Sheets guardada');
}

(function detectOAuthToken() {
  const hash = location.hash;
  const mToken = hash.match(/access_token=([^&]+)/);
  const mExpiry = hash.match(/expires_in=([^&]+)/);
  if (mToken) {
    const expiresIn = parseInt(mExpiry ? mExpiry[1] : '3600');
    localStorage.setItem('gordi_sheets_token', mToken[1]);
    localStorage.setItem('gordi_sheets_token_expiry', Date.now() + (expiresIn - 120) * 1000);
    history.replaceState(null, '', location.pathname);
    showToast('✅ Token de Google Sheets guardado');
    scheduleTokenRenewal();
  }
})();

// ─── MOTOR PRINCIPAL ─────────────────────────────────────────────────────────
function setStep(step, state, msg) {
  const el = document.getElementById(`step-${step}`);
  const st = document.getElementById(`st-${step}`);
  if (el) el.className = `pipeline-step ${state}`;
  if (st) st.textContent = msg;
}

function emitSearchFlow(type, payload = {}) {
  const current = window.gordiSearchLifecycle || {};
  if (type === 'search:start') {
    window.gordiSearchLifecycle = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      status: 'running',
      phase: payload.mode === 'multi' ? 'multisector' : 'places',
      location: payload.location || '',
      sectors: Array.isArray(payload.sectors) ? payload.sectors.slice(0, 12) : [],
      mode: payload.mode || 'single',
      startedAt: new Date().toISOString(),
      resultCount: 0,
      error: ''
    };
  } else if (type === 'search:complete') {
    window.gordiSearchLifecycle = {
      ...current,
      status: payload.status || 'complete',
      phase: 'done',
      finishedAt: new Date().toISOString(),
      resultCount: payload.resultCount ?? payload.results?.length ?? current.resultCount ?? 0,
      error: ''
    };
  } else if (type === 'search:error') {
    window.gordiSearchLifecycle = {
      ...current,
      status: 'error',
      phase: 'failed',
      finishedAt: new Date().toISOString(),
      error: payload.error || 'error'
    };
  }
  if (typeof emitGordiFlowEvent === 'function') emitGordiFlowEvent(type, payload);
}

function createSearchSafetyPoint(reason) {
  if (typeof createSafetySnapshot !== 'function') return;
  try { createSafetySnapshot(reason, { silent: true }); } catch {}
}

function syncCoverageMissionSearchState(status, patch = {}) {
  if (typeof updateCoverageMission !== 'function') return;
  try {
    updateCoverageMission({ lastSearchStatus: status, ...patch });
  } catch {}
}

async function searchBusinesses() {
  clearScheduledSearchUI();
  const multiEnabled = document.getElementById('plan-multi-toggle')?.checked;
  if (!multiEnabled) {
    multiSectorSearchState = null;
    currentMultiSectorFilter = 'all';
    const msPanel = document.getElementById('multi-sector-results-panel');
    if (msPanel) msPanel.remove();
    const msProgress = document.getElementById('multi-sector-progress');
    if (msProgress) msProgress.remove();
    try {
      await searchBusinessesSingle();
    } catch (err) {
      console.error('Busqueda individual fallida:', err);
      logEnrich('Error inesperado en busqueda: ' + (err?.message || err), 'err');
      const location = document.getElementById('plan-location')?.value?.trim() || '';
      const sector = document.getElementById('plan-segment')?.value || '';
      emitSearchFlow('search:error', { location, sectors: [sector], mode: 'single', error: err?.message || String(err) });
      if (typeof recordSearchCoverage === 'function') {
        recordSearchCoverage({ location, sectors: [sector], mode: 'single', status: 'error', results: [], rawCount: 0, error: err?.message || String(err) });
      }
      syncCoverageMissionSearchState('error', { status: 'error' });
      resetSearchBtn();
    }
    return;
  }

  const sectors = getMultiSectorSelection();
  const location = document.getElementById('plan-location')?.value?.trim() || '';
  if (!location) { alert('Introduce una ciudad, zona o codigo postal.'); return; }
  if (sectors.length < 2) { alert('Selecciona al menos 2 sectores para busqueda multi-sector.'); return; }

  try {
    createSearchSafetyPoint('before_search_multisector');
    emitSearchFlow('search:start', { location, sectors, mode: 'multi' });
    await searchBusinessesMultiSector(sectors, location);
  } catch (err) {
    console.error('Busqueda multi-sector fallida:', err);
    logEnrich('Error inesperado en multi-sector: ' + (err?.message || err), 'err');
    emitSearchFlow('search:error', { location, sectors, mode: 'multi', error: err?.message || String(err) });
    if (typeof recordSearchCoverage === 'function') {
      recordSearchCoverage({ location, sectors, mode: 'multi', status: 'error', results: [], rawCount: 0, error: err?.message || String(err) });
    }
    syncCoverageMissionSearchState('error', { status: 'error' });
    resetSearchBtn();
  }
}

async function searchBusinessesMultiSector(sectors, location) {
  const originalSegment = document.getElementById('plan-segment')?.value;
  const parsedMax = parseInt(document.getElementById('plan-max')?.value || '20', 10);
  const maxRes = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 20;
  const btn = document.getElementById('btn-search');
  const allResults = [];
  const perSector = {};
  multiSectorSearchState = { location, sectors, rawCount: 0, perSector };
  tempSearchResults = [];
  resetSearchRuntimeFilters();

  document.getElementById('enrich-pipeline').style.display = 'block';
  document.getElementById('search-results-panel').style.display = 'none';
  document.getElementById('enrich-stats-bar').style.display = 'none';
  document.getElementById('search-dup-info')?.remove();
  document.getElementById('result-filters').style.display = 'none';
  const sfb0 = document.getElementById('search-sf-wrap'); if (sfb0) sfb0.style.display = 'none';
  setProgress(0);
  logEnrich('', 'clear');
  logEnrich(`Busqueda multi-sector: ${sectors.length} sectores en ${location}`);
  ensureMultiSectorProgressPanel(sectors);
  if (btn) { btn.disabled = true; btn.textContent = `Buscando ${sectors.length} sectores...`; }

  try {
    await waitForGoogleMaps(12000);
    let completedSectors = 0;
    const multiSectorConcurrency = sectors.length > 6 ? 2 : Math.min(3, sectors.length);
    await runLimitedBatches(sectors.map((seg, i) => ({ seg, i })), multiSectorConcurrency, async ({ seg, i }) => {
      const planSel = document.getElementById('plan-segment');
      if (planSel) planSel.value = seg;
      setMultiSectorProgress(seg, 'buscando', 12, i, sectors.length);
      try {
        const places = await searchSectorPlacesOnly(seg, location, maxRes);
        const sectorResults = places.map(c => ({
          ...normalizeSearchCompany(c),
          segment: seg,
          sourceSector: seg,
          matchedSectors: [...new Set([...(c.matchedSectors || []), seg])],
        }));
        perSector[seg] = { total: sectorResults.length, label: getSegmentLabel(seg) };
        allResults.push(...sectorResults);
        completedSectors++;
        setMultiSectorProgress(seg, `${sectorResults.length} resultados`, 100, completedSectors, sectors.length);
        logEnrich(`${getSegmentLabel(seg)}: ${sectorResults.length} empresas`, sectorResults.length ? 'ok' : 'warn');
      } catch (err) {
        perSector[seg] = { total: 0, label: getSegmentLabel(seg), error: err?.message || 'error' };
        emitSearchFlow('search:error', { location, sectors: [seg], mode: 'multi', error: err?.message || 'error' });
        if (typeof recordSearchCoverage === 'function') {
          recordSearchCoverage({ location, sectors: [seg], mode: 'multi', status: 'error', results: [], rawCount: 0, error: err?.message || 'error' });
        }
        completedSectors++;
        setMultiSectorProgress(seg, 'error, saltando', 100, completedSectors, sectors.length);
        logEnrich(`Multi-sector: ${getSegmentLabel(seg)} fallo (${err?.message || 'error'}) y se continua`, 'warn');
      }
      setProgress(Math.round((completedSectors / sectors.length) * 100));
      await yieldToUI();
    }, 0);

    multiSectorSearchState.rawCount = allResults.length;
    tempSearchResults = mergeMultiSectorResults(allResults);
    tempSearchResults.forEach(c => {
      c.segment = c.sourceSector || c.segment;
      decorateOpportunity(c);
    });
    const enrichMode = document.getElementById('plan-enrich')?.value || 'all';
    await enrichMultiSectorMergedResults(location, enrichMode);
    sortSearchResultsLive();
    renderSearchCards();
    showResultsPanel();
    document.getElementById('result-filters').style.display = 'flex';
    const sfb = document.getElementById('search-sf-wrap'); if (sfb) sfb.style.display = 'block';
    updateEnrichStats();
    renderMultiSectorResultsPanel();
    scheduleAdvancedFilters(80);
    logEnrich(`Multi-sector completado: ${allResults.length} resultados brutos, ${tempSearchResults.length} empresas unicas`, 'ok');
    emitSearchFlow('search:complete', {
      location,
      sectors,
      mode: 'multi',
      status: tempSearchResults.length ? 'complete' : 'partial',
      results: tempSearchResults,
      rawCount: allResults.length,
      resultCount: tempSearchResults.length,
    });
    if (typeof saveCurrentSearch === 'function' && tempSearchResults.length) {
      saveCurrentSearch(tempSearchResults, sectors.length > 1 ? 'Multi-sector' : (sectors[0] || 'Multi-sector'), location, 0);
    }
    if (!tempSearchResults.length) {
      logEnrich('Sin resultados multi-sector. Si arriba aparecen fallos de Places, revisa API key, Places API New, cuota o restricciones de dominio local.', 'warn');
    }
  } finally {
    if (originalSegment && document.getElementById('plan-segment')) document.getElementById('plan-segment').value = originalSegment;
    if (btn) { btn.disabled = false; btn.textContent = 'Buscar y Enriquecer'; }
  }
}

async function enrichMultiSectorMergedResults(location, enrichMode = 'all') {
  if (!Array.isArray(tempSearchResults) || !tempSearchResults.length) return;

  const shouldWeb = enrichMode === 'all' || enrichMode === 'web';
  const shouldExternal = enrichMode === 'all' || enrichMode === 'hunter' || enrichMode === 'apollo';
  const shouldSignals = enrichMode === 'all';

  if (enrichMode === 'none') {
    logEnrich('Multi-sector: modo Solo Google Places, scraping omitido por configuracion.', 'warn');
    return;
  }

  logEnrich(`Multi-sector: enriqueciendo ${tempSearchResults.length} empresas unicas (${enrichMode})`, 'ok');
  renderSearchCards();
  showResultsPanel();
  updateEnrichStats();

  if (shouldWeb) {
    setStep('web', 'active', 'Scraping multi-sector...');
    const candidates = tempSearchResults
      .map((c, i) => ({ c, i }))
      .filter(x => x.c.website && !x.c.fromCache)
      .sort((a, b) => getLayerPriority(b.c) - getLayerPriority(a.c));

    let done = 0;
    const total = candidates.length || 1;
    logEnrich(`Web scraping multi-sector: ${candidates.length} webs con dominio.`, candidates.length ? 'ok' : 'warn');
    for (let b = 0; b < candidates.length; b += PERF.webBatch) {
      const batch = candidates.slice(b, b + PERF.webBatch);
      batch.forEach(({ i }) => markCardEnriching(i, true));
      await Promise.all(batch.map(async ({ i, c }) => {
        try {
          tempSearchResults[i] = await enrichFromWeb(c);
        } catch (e1) {
          try {
            await sleep(1200);
            tempSearchResults[i] = await enrichFromWeb(c);
          } catch (e2) {
            tempSearchResults[i].scrapeDiagnostics = [...new Set([...(tempSearchResults[i].scrapeDiagnostics || []), 'web-fallo'])];
            console.warn('Multi-sector web scraping failed:', c.name, e2);
          }
        } finally {
          markCardEnriching(i, false);
          updateCard(i);
          done++;
        }
      }));
      setStep('web', 'active', `${done}/${candidates.length}`);
      setProgress(Math.min(95, 45 + Math.round((done / total) * 35)));
      logEnrich(`Web multi-sector: ${done}/${candidates.length} procesadas`);
      scheduleSearchCardsRender();
      scheduleEnrichStats();
      await yieldToUI();
      if (b + PERF.webBatch < candidates.length) await sleep(tempSearchResults.length > 30 ? 1600 : 800);
    }
    setStep('web', 'done', `${done} procesadas`);
    _enrichCache.setMany(tempSearchResults.filter(c => !c.fromCache));
  } else {
    setStep('web', 'done', 'Omitido');
  }

  if (shouldExternal) {
    const hunterKey = localStorage.getItem('gordi_hunter_key');
    const apolloKey = localStorage.getItem('gordi_apollo_key');
    const externalCandidates = tempSearchResults
      .map((c, i) => ({ c, i }))
      .filter(x => x.c.website && (!x.c.email || !x.c.decision_maker))
      .sort((a, b) => getLayerPriority(b.c) - getLayerPriority(a.c));

    if (externalCandidates.length) {
      setStep('hunter', hunterKey ? 'active' : 'done', hunterKey ? 'Buscando...' : 'Omitido');
      setStep('apollo', apolloKey ? 'active' : 'done', apolloKey ? 'Buscando...' : 'Omitido');
      let done = 0;
      await runLimitedBatches(externalCandidates, PERF.externalBatch, async ({ i }) => {
        markCardEnriching(i, true);
        try {
          if (hunterKey && !tempSearchResults[i].email) {
            tempSearchResults[i] = await enrichFromHunter(tempSearchResults[i]);
          }
          if (apolloKey && (!tempSearchResults[i].email || !tempSearchResults[i].decision_maker)) {
            tempSearchResults[i] = await enrichFromApollo(tempSearchResults[i]);
          }
        } catch (err) {
          tempSearchResults[i].scrapeDiagnostics = [...new Set([...(tempSearchResults[i].scrapeDiagnostics || []), 'externas-fallo'])];
        } finally {
          markCardEnriching(i, false);
          updateCard(i);
          done++;
        }
      }, 450);
      setStep('hunter', 'done', 'Completado');
      setStep('apollo', 'done', 'Completado');
      logEnrich(`Capas externas multi-sector: ${done} candidatos procesados.`, 'ok');
    }
  }

  if (shouldSignals) {
    setStep('social', 'active', 'Senales...');
    const signalCandidates = tempSearchResults
      .map((c, i) => ({ c, i }))
      .filter(x => getLayerPriority(x.c) >= 30)
      .slice(0, 40);
    await runLimitedBatches(signalCandidates, PERF.signalBatch, async ({ i }) => {
      try {
        tempSearchResults[i] = await enrichFromSocial(tempSearchResults[i]);
        if ((tempSearchResults[i].signals || []).length < 3) tempSearchResults[i] = await enrichFromNews(tempSearchResults[i]);
        tempSearchResults[i] = await enrichFromReviews(tempSearchResults[i]);
      } catch (err) {
        tempSearchResults[i].scrapeDiagnostics = [...new Set([...(tempSearchResults[i].scrapeDiagnostics || []), 'senales-fallo'])];
      } finally {
        updateCard(i);
      }
    }, 250);
    setStep('social', 'done', 'Analizado');
  }

  tempSearchResults = deduplicateResults(tempSearchResults);
  tempSearchResults.forEach(c => {
    normalizeSearchCompany(c);
    decorateOpportunity(c);
    if (!c.logo && c.website) c.logo = getClearbitLogo(c.website);
  });
  sortSearchResultsLive();
  _enrichCache.setMany(tempSearchResults.filter(c => !c.fromCache));
  recordLeadMemoryBulk(tempSearchResults, 'scraped_multisector', c => ({
    location,
    segment: c.sourceSector || c.segment,
    score: c.opportunityScore || 0,
    hasEmail: !!c.email,
    hasDecisionMaker: !!c.decision_maker
  }));
  setStep('done', 'done', `${tempSearchResults.filter(c => c.email).length} con email`);
  setProgress(100);
}

async function searchSectorPlacesOnly(segment, location, maxRes) {
  let places = await fetchPlaces(segment, location, maxRes, { multiSector: true });
  places = await enrichDistances(places, location);
  places = places.map(c => detectOptimalContactWindow(c));
  places = places.map(c => {
    try {
      const cached = _enrichCache.get(c.id);
      const hydrated = cached ? annotateIncrementalScrape({ ...c, ...cached, fromCache: true }) : annotateIncrementalScrape(c);
      return normalizeSearchCompany(hydrated);
    } catch (err) {
      console.warn('Postprocesado multisector omitido:', c?.name, err);
      return normalizeSearchCompany(c);
    }
  });
  places = deduplicateResults(places);
  places.slice(0, 20).forEach(c => {
    if (!c.logo && c.website) c.logo = getClearbitLogo(c.website);
    if (!c.domain) c.domain = extractDomain(c.website);
  });
  try {
    recordLeadMemoryBulk(places, 'seen_in_multisector', () => ({ segment, location }));
  } catch (err) {
    console.warn('Memoria multisector no guardada:', err);
  }
  return places;
}

async function searchBusinessesSingle(options = {}) {
  const isMultiChild = !!options.multiChild;
  const segment  = options.sectorOverride || document.getElementById('plan-segment').value;
  const location = document.getElementById('plan-location').value.trim();
  const parsedMax = parseInt(document.getElementById('plan-max')?.value || '20', 10);
  const maxRes = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 20;
  const selectedEnrichMode = document.getElementById('plan-enrich').value;
  const enrichMode = isMultiChild ? 'none' : selectedEnrichMode;

  if (!location) { alert('Introduce una ciudad o zona.'); return; }
  if (!isMultiChild) {
    createSearchSafetyPoint('before_search_single');
    emitSearchFlow('search:start', { location, sectors: [segment], mode: 'single' });
  }

  // WRAPPER: Verificar inicialización de Google Maps antes de iniciar la UI de búsqueda
  if (typeof google === 'undefined' || !google.maps) {
    document.getElementById('btn-search').textContent = '⏳ Iniciando Maps...';
    try {
      await waitForGoogleMaps(12000);
    } catch (err) {
      alert('Error al inicializar Google Maps. Revisa tu API Key en Configuración.\n' + err.message);
      if (!isMultiChild) {
        emitSearchFlow('search:error', { location, sectors: [segment], mode: 'single', error: err?.message || String(err) });
        if (typeof recordSearchCoverage === 'function') {
          recordSearchCoverage({ location, sectors: [segment], mode: 'single', status: 'error', results: [], rawCount: 0, error: err?.message || String(err) });
        }
        syncCoverageMissionSearchState('error', { status: 'error' });
      }
      if (!isMultiChild) document.getElementById('btn-search').textContent = '🔍 Buscar y Enriquecer';
      return;
    }
  }

  try {
  saveSearchHistory(segment, location);

  // UI: mostrar pipeline
  document.getElementById('enrich-pipeline').style.display = 'block';
  document.getElementById('search-results-panel').style.display = 'none';
  document.getElementById('enrich-stats-bar').style.display = 'none';
  document.getElementById('search-dup-info')?.remove();
  document.getElementById('result-filters').style.display = 'none';
  const siBox = document.getElementById('session-intel-box');
  if (siBox) siBox.style.display = 'none';
  const apBox = document.getElementById('autoprospect-panel');
  if (apBox) apBox.style.display = 'none';
  const sqBox = document.getElementById('scraping-quality-panel');
  if (sqBox) sqBox.style.display = 'none';
  document.getElementById('btn-search').disabled = true;
  document.getElementById('btn-search').textContent = '⏳ Buscando...';
  tempSearchResults = [];
  resetSearchRuntimeFilters();
  setProgress(0);
  logEnrich('', 'clear');

  // ── Capa 1 ───────────────────────────────────────────────
  setStep('places','active','Buscando...');
  logEnrich('🔍 Google Places: buscando empresas en ' + location);

  let places = [];
  try {
    places = await fetchPlaces(segment, location, maxRes);
    // Calcular distancias reales con Haversine desde el centro de búsqueda
    places = await enrichDistances(places, location);
    // Ventana de contacto óptima (síncrona, datos de Places ya disponibles)
    places = places.map(c => detectOptimalContactWindow(c));
    setStep('places','done', places.length + ' encontradas');
    logEnrich(`✅ ${places.length} empresas encontradas`, 'ok');
    setProgress(20);
  } catch (err) {
    setStep('places','error','Error');
    logEnrich('❌ ' + err.message, 'err');
    tempSearchResults = [];
    renderSearchCards();
    showResultsPanel();
    updateEnrichStats();
    setProgress(100);
    if (!isMultiChild) {
      emitSearchFlow('search:error', { location, sectors: [segment], mode: 'single', error: err?.message || String(err) });
      if (typeof recordSearchCoverage === 'function') {
        recordSearchCoverage({ location, sectors: [segment], mode: 'single', status: 'error', results: [], rawCount: 0, error: err?.message || String(err) });
      }
      syncCoverageMissionSearchState('error', { status: 'error' });
    }
    if (!isMultiChild) resetSearchBtn();
    return;
  }

  if (!places.length) {
    setStep('places','done','0 resultados');
    setStep('done','done','0 resultados');
    logEnrich('⚠️ Sin resultados. Prueba otra zona.', 'warn');
    tempSearchResults = [];
    renderSearchCards();
    showResultsPanel();
    updateEnrichStats();
    setProgress(100);
    if (!isMultiChild) {
      emitSearchFlow('search:complete', {
        location,
        sectors: [segment],
        mode: 'single',
        status: 'empty',
        results: [],
        rawCount: 0,
        resultCount: 0,
      });
      if (typeof recordSearchCoverage === 'function') {
        recordSearchCoverage({ location, sectors: [segment], mode: 'single', status: 'empty', results: [], rawCount: 0 });
      }
      syncCoverageMissionSearchState('empty', { status: 'empty', searchedCount: 0, readyCount: 0 });
    }
    if (!isMultiChild) resetSearchBtn();
    return;
  }

  tempSearchResults = places;
  tempSearchResults.forEach(normalizeSearchCompany);

  // Renderizar resultado rápido de Places mientras enriquecemos
  renderSearchCards();
  showResultsPanel();
  updateEnrichStats();

  // ── MEJORA 3: Pre-caché de logos + dominios en paralelo (capa 0) ─────────
  // Los primeros 20 resultados reciben logos y dominios inmediatamente,
  // sin esperar al batch de enriquecimiento completo
  places.slice(0, 20).forEach(c => {
    if (!c.logo && c.website) c.logo = getClearbitLogo(c.website);
    if (!c.domain) c.domain = extractDomain(c.website);
  });
  renderSearchCards(); // re-render con logos ya listos

  // ── Modo Turbo: Solo Places — salida instantánea sin enriquecimiento ──────
  if (enrichMode === 'none') {
    setStep('places','done', places.length + ' listas');
    // Marcar todos los steps restantes como omitidos para UI limpia
    ['web','hunter','apollo','social','whois','opencorp'].forEach(s => setStep(s,'done','Omitido'));
    setStep('done','done', places.length + ' listas ⚡');
    setProgress(100);
    document.getElementById('result-filters').style.display = 'flex';
    const sfb1 = document.getElementById('search-sf-wrap'); if(sfb1) sfb1.style.display='block';
    logEnrich(`⚡ Modo Turbo: ${places.length} empresas en segundos. Pulsa ✨ en cada card para enriquecer individualmente.`, 'ok');
    // Añadir logos Clearbit también en modo turbo
    tempSearchResults.forEach(c => { if (!c.logo) c.logo = getClearbitLogo(c.website); });
    renderSearchCards();
    updateEnrichStats();
    if (!isMultiChild && typeof recordSearchCoverage === 'function') {
      recordSearchCoverage({ location, sectors: [segment], mode: 'single', status: places.length ? 'complete' : 'partial', results: tempSearchResults, rawCount: places.length });
    }
    if (!isMultiChild) {
      emitSearchFlow('search:complete', {
        location,
        sectors: [segment],
        mode: 'single',
        status: places.length ? 'complete' : 'partial',
        results: tempSearchResults,
        rawCount: places.length,
        resultCount: tempSearchResults.length,
      });
    }
    if (!isMultiChild) resetSearchBtn();
    return;
  }

  // ── Capa 2: Web Scraping (paralelo, batches de 8 con retry) ─────────────
  if (enrichMode === 'all' || enrichMode === 'web') {
    setStep('web','active','Procesando...');
    if (isMultiChild) setMultiSectorProgress(segment, 'web scraping', 35);
    const websiteCount = tempSearchResults.filter(c => c.website).length;
    logEnrich(`Web scraping: ${websiteCount}/${places.length} empresas tienen web para rastrear.`, websiteCount ? 'ok' : 'warn');
    let done = 0;
    // FIX-SCRAPING: BATCH_SIZE reducido a 3 para no saturar los proxies CORS gratuitos.
    const BATCH_SIZE = PERF.webBatch;

    // Reordenar por potencial — mejores leads se enriquecen primero
    const enrichOrder = [...tempSearchResults.keys()].sort((a, b) => {
      const ca = tempSearchResults[a], cb = tempSearchResults[b];
      const scoreA = (ca.rating||0)*20 + Math.min(ca.ratingCount||0,200)/10 + (ca.website?15:0);
      const scoreB = (cb.rating||0)*20 + Math.min(cb.ratingCount||0,200)/10 + (cb.website?15:0);
      return scoreB - scoreA;
    });
    logEnrich(`  -> Procesando en orden de potencial (rating + reseñas + web)`);

    for (let b = 0; b < enrichOrder.length; b += BATCH_SIZE) {
      const batchIndices = enrichOrder.slice(b, b + BATCH_SIZE);

      // Marcar todas las cards del batch como "enriqueciendo"
      batchIndices.forEach(i => { if (tempSearchResults[i].website) markCardEnriching(i, true); });

      // Procesar batch en paralelo con RETRY automático
      await Promise.all(batchIndices.map(async i => {
        const company = tempSearchResults[i];
        if (!company.website) { done++; return; }
        try {
          tempSearchResults[i] = await enrichFromWeb(company);
        } catch (e1) {
          // Retry automático con proxy alternativo tras pausa corta
          try {
            await sleep(1500); 
            tempSearchResults[i] = await enrichFromWeb(company);
          } catch (e2) {
            console.warn('Enrich failed after retry:', company.name);
          }
        }
        done++;
      }));

      // Actualizar UI y deduplicar PROGRESIVAMENTE
      // (Si detectamos duplicados por website o email que Places no pilló)
      batchIndices.forEach(i => {
        markCardEnriching(i, false);
        updateCard(i);
        const c = tempSearchResults[i];
        const proxyFail = (c.enrichSource||[]).includes('Proxy-fallo');
        logEnrich(`  -> ${c.name}: ${c.email ? '✉️ ' + c.email : '—'}${proxyFail ? ' ⚠️retry-needed' : ''}`);
      });

      setProgress(20 + Math.round(done / tempSearchResults.length * 40));
      setStep('web','active', `${done}/${tempSearchResults.length}`);
      if (isMultiChild) setMultiSectorProgress(segment, `web ${done}/${tempSearchResults.length}`, 35 + Math.round(done / tempSearchResults.length * 55));
      scheduleSearchCardsRender();
      scheduleEnrichStats();
      await yieldToUI();

      // Pausa adaptativa para no quemar proxies
      if (b + BATCH_SIZE < enrichOrder.length) {
        await sleep(tempSearchResults.length > 30 ? 2000 : 1000);
      }
    }

    // Guardar en cache tras scraping web
    _enrichCache.setMany(tempSearchResults.filter(c => !c.fromCache));

    // DEDUP FINAL post-scraping (Places no detecta cadenas que comparten misma web)
    const originalLen = tempSearchResults.length;
    tempSearchResults = deduplicateResults(tempSearchResults);
    if (tempSearchResults.length < originalLen) {
      logEnrich(`✨ Deduplicación inteligente: eliminadas ${originalLen - tempSearchResults.length} sucursales duplicadas detectadas por web/email`, 'ok');
      renderSearchCards();
      updateEnrichStats();
    }

    setStep('web','done', done + ' procesadas');
    setProgress(60);
  }

  // ── Capa 3: Hunter & Apollo (Pipeline Priorizado) ──────────────────────────
  // Agrupamos Hunter y Apollo para evitar loops redundantes y priorizar leads sin email
  const hunterKey = localStorage.getItem('gordi_hunter_key');
  const apolloKey = localStorage.getItem('gordi_apollo_key');

  if (enrichMode === 'all' || enrichMode === 'hunter' || enrichMode === 'apollo') {
    const externalCandidates = tempSearchResults
      .map((c, i) => ({ i, c }))
      .filter(x => x.c.website && (!x.c.email || !x.c.decision_maker))
      .sort((a, b) => getLayerPriority(b.c) - getLayerPriority(a.c));

    if (externalCandidates.length > 0) {
      logEnrich(`🔍 Capas Externas (Hunter/Apollo): procesando ${externalCandidates.length} candidatos...`);
      setStep('hunter', hunterKey ? 'active' : 'done', hunterKey ? 'Buscando...' : 'Omitido');
      setStep('apollo', apolloKey ? 'active' : 'done', apolloKey ? 'Buscando...' : 'Omitido');

      let extDone = 0;
      await runLimitedBatches(externalCandidates, PERF.externalBatch, async (item) => {
        const i = item.i;
        markCardEnriching(i, true);
        try {
          // Hunter.io (solo si no hay email)
          if (hunterKey && !tempSearchResults[i].email) {
            tempSearchResults[i] = await enrichFromHunter(tempSearchResults[i]);
          }
          
          // Apollo.io (si no hay decisor o email después de Hunter)
          if (apolloKey && (!tempSearchResults[i].email || !tempSearchResults[i].decision_maker)) {
            tempSearchResults[i] = await enrichFromApollo(tempSearchResults[i]);
          }
        } catch (err) {
          tempSearchResults[i].scrapeDiagnostics = [...new Set([...(tempSearchResults[i].scrapeDiagnostics || []), 'externas-fallo'])];
          console.warn('External enrichment failed:', tempSearchResults[i].name, err);
        } finally {
          markCardEnriching(i, false);
          updateCard(i);
          extDone++;
          if (extDone % 3 === 0) scheduleEnrichStats();
        }
      }, 500);
      setStep('hunter','done', 'Completado');
      setStep('apollo','done', 'Completado');
    }
  }

  // ── Capa Social & Señales (Pipeline de Análisis de Bajo Coste) ─────────────
  // Consolidamos News, Social, Whois, OpenCorp y Reviews en un solo flujo eficiente
  if (enrichMode === 'all') {
    setStep('social','active','Pipeline Señales...');
    logEnrich('🧠 Pipeline de Señales: ejecutando análisis multicapa...');
    
    // Procesar en pequeños grupos para mantener la UI fluida pero rápida
    const SIGNAL_BATCH = PERF.signalBatch; 
    for (let i = 0; i < tempSearchResults.length; i += SIGNAL_BATCH) {
      const batch = tempSearchResults.slice(i, i + SIGNAL_BATCH);
      await Promise.all(batch.map(async (c, idx) => {
        const realIdx = i + idx;
        try {
          // 1. Social & Web Signals
          tempSearchResults[realIdx] = await enrichFromSocial(tempSearchResults[realIdx]);
          // 2. Google News (solo si no tenemos muchas señales aún)
          if (tempSearchResults[realIdx].signals.length < 3) {
            tempSearchResults[realIdx] = await enrichFromNews(tempSearchResults[realIdx]);
          }
          // 3. Whois (edad de dominio)
          if (tempSearchResults[realIdx].website) {
            tempSearchResults[realIdx] = await enrichFromWhois(tempSearchResults[realIdx]);
          }
          // 4. OpenCorporates (registro legal)
          tempSearchResults[realIdx] = await enrichFromOpenCorporates(tempSearchResults[realIdx]);
          // 5. Análisis de Reseñas (dolor del cliente)
          tempSearchResults[realIdx] = await enrichFromReviews(tempSearchResults[realIdx]);
        } catch (err) {
          tempSearchResults[realIdx].scrapeDiagnostics = [...new Set([...(tempSearchResults[realIdx].scrapeDiagnostics || []), 'senales-fallo'])];
          console.warn('Signal enrichment failed:', tempSearchResults[realIdx].name, err);
        } finally {
          updateCard(realIdx);
        }
      }));
      
      setProgress(80 + Math.round((i / tempSearchResults.length) * 20));
      await yieldToUI();
      await sleep(250); 
    }
    setStep('social', 'done', 'Analizado');
    ['news', 'whois', 'opencorp'].forEach(s => {
      const el = document.getElementById(`step-${s}`);
      if (el) el.className = 'pipeline-step done';
    });
  }

  // ── Capa Especial Avanzada (Borme + Street View + LinkedIn + IA Rescue) ────
  const geminiKey = getGeminiKey();
  if (enrichMode === 'all') {
    logEnrich('💎 Capas Avanzadas: ejecutando análisis de alto valor...');
    setStep('empresite', 'active', 'Consultando...');
    setStep('experian', 'active', 'Consultando...');
    
    let empresiteOk = 0, experianOk = 0, advancedDone = 0;
    const advancedIndices = tempSearchResults
      .map((c, i) => ({ i, c }))
      .filter(x => !x.c.fromCache && getLayerPriority(x.c) >= 35)
      .sort((a, b) => getLayerPriority(b.c) - getLayerPriority(a.c))
      .map(x => x.i);
    await runLimitedBatches(advancedIndices, PERF.advancedBatch, async (i) => {
      if (tempSearchResults[i].fromCache) return;
      try {
        // 1. LinkedIn Dorking (Idea 3 - Decisor probable)
        tempSearchResults[i] = await enrichFromLinkedInDorking(tempSearchResults[i]);

        // 2. BORME (Trámites legales reales)
        tempSearchResults[i] = await enrichFromBorme(tempSearchResults[i]);
        
        // 3. Empresite (NIF, empleados, facturación)
        tempSearchResults[i] = await enrichFromEmpressite(tempSearchResults[i]);
        if (tempSearchResults[i].enrichSource.includes('Empresite')) empresiteOk++;

        // 4. Experian (Riesgo, morosidad)
        tempSearchResults[i] = await enrichFromExperian(tempSearchResults[i]);
        if (tempSearchResults[i].enrichSource.includes('Experian')) experianOk++;

        // 5. Street View Vision (Idea 4 - Análisis necesidades reforma)
        if (geminiKey && tempSearchResults[i].address) {
          tempSearchResults[i] = await enrichFromStreetView(tempSearchResults[i]);
        }
        
        // 6. IA Email Rescue (Último recurso con Gemini)
        if (geminiKey && !tempSearchResults[i].email && tempSearchResults[i].website) {
          const rescued = await extractEmailWithAI(tempSearchResults[i].website, tempSearchResults[i].name, geminiKey);
          if (rescued) {
            tempSearchResults[i].email = rescued;
            tempSearchResults[i].enrichSource.push('IA-Rescue');
          }
        }
      } catch (err) {
        tempSearchResults[i].scrapeDiagnostics = [...new Set([...(tempSearchResults[i].scrapeDiagnostics || []), 'avanzadas-fallo'])];
        console.warn('Advanced enrichment failed:', tempSearchResults[i].name, err);
      }
      
      updateCard(i);
      advancedDone++;
      if (advancedDone % 4 === 0) scheduleEnrichStats();
    }, tempSearchResults.length > 20 ? 250 : 80);
    setStep('empresite', 'done', empresiteOk + ' enriquecidas');
    setStep('experian',  'done', experianOk  + ' con datos');
  }

  // ── Mostrar info de duplicados ──────────────────────────────────────────────
  const normN = n => (n||'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,25);
  const dupCount = tempSearchResults.filter(c =>
    leads.find(l => !l.archived && isSameBusiness({ ...c, company: c.name }, l))
  ).length;
  if (dupCount > 0) {
    const dupBar = document.createElement('div');
    dupBar.id = 'search-dup-info';
    dupBar.style.cssText = 'margin-bottom:.75rem;padding:.6rem 1rem;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:10px;display:flex;align-items:center;gap:.75rem;flex-wrap:wrap;font-size:.82rem';
    dupBar.innerHTML = `<span>📋 <strong>${dupCount}</strong> empresa${dupCount>1?'s':''} de los resultados ya ${dupCount>1?'están':'está'} en tu CRM</span>
      <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer;color:var(--text-muted)">
        <input type="checkbox" id="filter-no-leads-auto" onchange="document.getElementById('filter-no-leads').checked=this.checked;applyAdvancedFilters()" checked style="cursor:pointer">
        Mostrando solo nuevas (clic para ver todas)
      </label>`;
    const statsBar = document.getElementById('enrich-stats-bar');
    if (statsBar && statsBar.parentNode) {
      statsBar.parentNode.insertBefore(dupBar, statsBar.nextSibling);
    }
    // Aplicar filtro automáticamente — ocultar duplicados por defecto
    const staticNoLeads = document.getElementById('filter-no-leads');
    if (staticNoLeads) staticNoLeads.checked = true;
    setTimeout(() => applyAdvancedFilters(), 50);
  }

  // ── Deduplicación final por nombre similar ───────────────
  const before = tempSearchResults.length;
  tempSearchResults = deduplicateResults(tempSearchResults);
  const removed = before - tempSearchResults.length;
  if (removed > 0) logEnrich(`🔁 ${removed} duplicados eliminados por nombre similar`, 'warn');

  // ── Añadir logos Clearbit a los resultados ───────────────
  tempSearchResults.forEach(c => { if (!c.logo) c.logo = getClearbitLogo(c.website); });
  decorateAllOpportunities();
  sortSearchResultsLive();
  recordLeadMemoryBulk(tempSearchResults, 'scraped', c => ({
    segment,
    location,
    score: c.opportunityScore || 0,
    hasEmail: !!c.email,
    hasDecisionMaker: !!c.decision_maker
  }));

  // ── Finalizar ─────────────────────────────────────────────
  setProgress(100);
  const withEmail = tempSearchResults.filter(c => c.email).length;
  setStep('done','done', `${withEmail} con email`);
  logEnrich(`✅ Enriquecimiento completado. ${withEmail}/${tempSearchResults.length} empresas con email.`, 'ok');
  renderSearchCards();
  applyAdvancedFilters();
  scheduleSearchTableRender();
  document.getElementById('result-filters').style.display = 'flex';
  const sfb2 = document.getElementById('search-sf-wrap'); if(sfb2) sfb2.style.display='block';
  updateEnrichStats();
  
  // ── Guardar todo en cache (Final) ──────────────────────────
  _enrichCache.setMany(tempSearchResults.filter(c => !c.fromCache));
  if (!isMultiChild) {
    emitSearchFlow('search:complete', {
      location,
      sectors: [segment],
      mode: 'single',
      status: tempSearchResults.length ? 'complete' : 'partial',
      results: tempSearchResults,
      rawCount: places.length,
      resultCount: tempSearchResults.length,
    });
  }

  if (!isMultiChild) resetSearchBtn();

  // ── Inteligencia de sesión (asíncrona, no bloquea el pipeline) ────────────
  generateSessionIntel(tempSearchResults, segment, location);
  } catch (err) {
    console.error('searchBusinessesSingle failed:', err);
    setStep('done', 'error', 'Error');
    logEnrich('Error inesperado: ' + (err?.message || err), 'err');
    if (!isMultiChild && typeof recordSearchCoverage === 'function') {
      recordSearchCoverage({ location, sectors: [segment], mode: 'single', status: 'error', results: [], rawCount: 0, error: err?.message || String(err) });
    }
    if (!isMultiChild) {
      emitSearchFlow('search:error', { location, sectors: [segment], mode: 'single', error: err?.message || String(err) });
    }
    throw err;
  } finally {
    if (!isMultiChild) resetSearchBtn();
  }
}

// ─── UI HELPERS ──────────────────────────────────────────────────────────────

function resetSearchBtn() {
  const btn = document.getElementById('btn-search');
  btn.disabled = false;
  btn.textContent = '🔍 Buscar y Enriquecer';
}

// ── Enriquecimiento individual bajo demanda (para Modo Turbo) ─────────────────
async function enrichSingleCard(idx) {
  if (idx < 0 || idx >= tempSearchResults.length) return;
  const btn = document.getElementById(`rebtn-${idx}`);
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="reenrich-icon">⏳</span> Buscando...'; }
  markCardEnriching(idx, true);

  const hunterKey  = localStorage.getItem('gordi_hunter_key');
  const apolloKey  = localStorage.getItem('gordi_apollo_key');
  const geminiKey  = getGeminiKey();
  let hadError = false;

  try {
    // Ejecutar capas disponibles en secuencia, pero sin dejar la card bloqueada si falla una capa.
    tempSearchResults[idx] = await enrichFromWeb(tempSearchResults[idx]);
    if (hunterKey && !tempSearchResults[idx].email)
      tempSearchResults[idx] = await enrichFromHunter(tempSearchResults[idx]);
    if (apolloKey && (!tempSearchResults[idx].email || !tempSearchResults[idx].decision_maker))
      tempSearchResults[idx] = await enrichFromApollo(tempSearchResults[idx]);
    tempSearchResults[idx] = await enrichFromSocial(tempSearchResults[idx]);
    tempSearchResults[idx] = await enrichFromNews(tempSearchResults[idx]);
    tempSearchResults[idx] = await enrichFromBorme(tempSearchResults[idx]);
    tempSearchResults[idx] = await enrichFromEmpressite(tempSearchResults[idx]);
    tempSearchResults[idx] = await enrichFromExperian(tempSearchResults[idx]);
    if (!tempSearchResults[idx].email && geminiKey)
      tempSearchResults[idx].email = await extractEmailWithAI(
        tempSearchResults[idx].website, tempSearchResults[idx].name, geminiKey
      ) || '';
    if (!tempSearchResults[idx].logo)
      tempSearchResults[idx].logo = getClearbitLogo(tempSearchResults[idx].website);
  } catch (err) {
    hadError = true;
    console.warn('Single card enrichment failed:', tempSearchResults[idx]?.name, err);
    tempSearchResults[idx].scrapeDiagnostics = [...new Set([...(tempSearchResults[idx].scrapeDiagnostics || []), 'enriquecimiento-fallo'])];
    showToast(`${tempSearchResults[idx].name}: enriquecimiento parcial, revisa diagnostico`);
  } finally {
    markCardEnriching(idx, false);
    updateCard(idx);
    updateEnrichStats();

    const c = tempSearchResults[idx];
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span class="reenrich-icon">${c.enriched ? '🔄' : '✨'}</span> ${!c.email ? (c.enriched ? 'Buscar email' : 'Enriquecer') : 'Buscar decisor'}`;
    }
    if (!hadError) showToast(`${c.name}: ${c.email ? '✉️ ' + c.email : 'sin email'} ${c.decision_maker ? '· 👤 ' + c.decision_maker.split('(')[0] : ''} ✓`);
  }
}

// ── Panel de Inteligencia de Sesión (Gemini) ───────────────────────────────────
async function generateSessionIntel(results, segment, location) {
  const geminiKey = getGeminiKey();
  const el = document.getElementById('session-intel-box');
  if (!geminiKey || !results.length || !el) return;

  // Ocultar si ya había inteligencia de sesión previa
  el.style.display = 'block';
  el.innerHTML = '<div style="font-size:.78rem;color:var(--text-muted);display:flex;align-items:center;gap:.5rem"><span style="animation:spin 1s linear infinite;display:inline-block">⏳</span> Generando inteligencia de sesión con IA...</div>';

  // Top 5 leads por score
  const top = [...results]
    .map((c, i) => ({ ...c, _idx: i }))
    .sort((a, b) => ((b.score || 0) - (a.score || 0)) || ((b.signals?.length || 0) - (a.signals?.length || 0)))
    .slice(0, 5);

  const summary = top.map((c, i) => {
    const painSnippet = c.reviewPain?.length ? ` | Dolor detectado: "${c.reviewPain[0].snippet.slice(0, 60)}"` : '';
    const compSnippet = c.competitorBetter ? ` | Competidor: ${c.competitorBetter.name} (+${c.competitorBetter.diff}★)` : '';
    const newsSnippet = (c.signals || []).find(s => s.includes('prensa') || s.includes('Apertura') || s.includes('Contrato')) || '';
    return `${i+1}. ${c.name} | ${c.rating ? c.rating + '★ (' + c.ratingCount + ' reseñas)' : 'Sin rating'} | Email:${c.email ? 'SÍ' : 'NO'} | Decisor:${c.decision_maker ? 'SÍ' : 'NO'}${painSnippet}${compSnippet}${newsSnippet ? ' | Prensa: ' + newsSnippet.slice(0, 60) : ''}`;
  }).join('\n');

  const prompt = `Eres un experto en ventas B2B para Voltium Madrid, empresa de instalaciones eléctricas y reformas integrales. Analiza los ${top.length} mejores leads encontrados en "${location}" (sector: ${segment}) y crea un briefing ejecutivo CONCISO. Para cada lead: una frase de por qué es prioritario y una frase con el mejor ángulo de primer contacto. Sin listas con guiones, sin markdown, texto en prosa con saltos de línea entre leads. Máximo 220 palabras.\n\nLeads:\n${summary}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        signal: AbortSignal.timeout(18000),
      }
    );
    const data = await res.json();
    const intel = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!intel) { el.style.display = 'none'; return; }

    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem">
        <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.1em;color:var(--primary);font-weight:700">🧠 Inteligencia de sesión — Top ${top.length} leads</div>
        <button onclick="document.getElementById('session-intel-box').style.display='none'" style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:.85rem;padding:0">✕</button>
      </div>
      <div style="font-size:.8rem;line-height:1.65;color:var(--text)">${intel.replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>')}</div>`;
  } catch {
    el.style.display = 'none';
  }
}

function setProgress(pct) {
  const el = document.getElementById('enrich-progress-fill');
  if (el) el.style.width = pct + '%';
}

function logEnrich(msg, type='') {
  const log = document.getElementById('enrich-log');
  if (!log) return;
  if (type === 'clear') { log.innerHTML = ''; return; }
  const line = document.createElement('span');
  line.className = `enrich-log-line ${type}`;
  line.textContent = msg;
  log.appendChild(line);
  while (log.children.length > 160) log.removeChild(log.firstElementChild);
  log.scrollTop = log.scrollHeight;
}

function showResultsPanel() {
  document.getElementById('search-results-panel').style.display = 'block';
  document.getElementById('enrich-stats-bar').style.display = 'flex';
  document.getElementById('search-count').innerText = `${tempSearchResults.length} empresas`;
}

function updateEnrichStats() {
  const r = tempSearchResults;
  const s = id => { const el = document.getElementById(id); if (el) el.textContent = 0; };
  decorateAllOpportunities();
  renderUXCommandCenter();
  document.getElementById('es-total').textContent = r.length;
  document.getElementById('es-email').textContent = r.filter(c => c.email).length;
  document.getElementById('es-phone').textContent = r.filter(c => c.phone).length;
  document.getElementById('es-social').textContent = r.filter(c => c.instagram || c.facebook || c.linkedin).length;
  document.getElementById('es-desc').textContent = r.filter(c => c.description).length;
  renderScrapingQualityPanel(false);
  renderAutonomousProspectingPanel(false);
}

function getCommercialMemoryKey(c) {
  const domain = extractDomain(c?.website || '');
  const raw = domain || c?.placeId || c?.name || '';
  return String(raw).toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.-]/g, '').slice(0, 90);
}

function loadCommercialMemory() {
  try { return JSON.parse(localStorage.getItem('gordi_commercial_memory') || '{}'); }
  catch { return {}; }
}

function saveCommercialMemory(memory) {
  localStorage.setItem('gordi_commercial_memory', JSON.stringify(memory));
}

function getLeadMemory(c) {
  const key = getCommercialMemoryKey(c);
  if (!key) return null;
  return loadCommercialMemory()[key] || null;
}

function recordLeadMemory(c, event, extra = {}) {
  const key = getCommercialMemoryKey(c);
  if (!key) return;
  const memory = loadCommercialMemory();
  const prev = memory[key] || { firstSeen: new Date().toISOString(), events: [] };
  prev.company = c.name || prev.company || '';
  prev.website = c.website || prev.website || '';
  prev.email = c.email || prev.email || '';
  prev.phone = c.phone || prev.phone || '';
  prev.lastSeen = new Date().toISOString();
  prev.events = [...(prev.events || []).slice(-14), { event, date: new Date().toISOString(), ...extra }];
  memory[key] = prev;
  saveCommercialMemory(memory);
}

function recordLeadMemoryBulk(items, event, extraFn = () => ({})) {
  if (!Array.isArray(items) || !items.length) return;
  const memory = loadCommercialMemory();
  const now = new Date().toISOString();
  items.forEach((c, i) => {
    const key = getCommercialMemoryKey(c);
    if (!key) return;
    const prev = memory[key] || { firstSeen: now, events: [] };
    prev.lastSeen = now;
    prev.events = Array.isArray(prev.events) ? prev.events : [];
    prev.events.push({ event, date: now, ...(extraFn(c, i) || {}) });
    prev.events = prev.events.slice(-12);
    memory[key] = prev;
  });
  saveCommercialMemory(memory);
}

function detectOpportunitySignals(c) {
  let score = 0;
  const reasons = [];
  const add = (points, text) => { score += points; reasons.push(text); };
  const text = `${c.name || ''} ${c.description || ''} ${(c.signals || []).join(' ')} ${c.reviewSummary || ''} ${c.fachadaAnalysis || ''}`.toLowerCase();

  decorateContactQuality(c);
  if (c.email) add(18, `email ${c.contactEmailRole || 'directo'}`);
  if (c.phone || c.whatsapp) add(8, 'telefono disponible');
  if (c.decision_maker) add(18, 'decisor detectado');
  if ((c.contactQualityScore || 0) >= 76) add(12, 'contacto de alta confianza');
  else if ((c.contactQualityScore || 0) >= 52) add(6, 'contacto de confianza media');
  if (c.website) add(8, 'web localizada');
  if (!c.website) add(12, 'sin web visible');
  if ((c.rating || 0) >= 4.4 && (c.ratingCount || 0) >= 20) add(12, 'buena reputacion');
  if ((c.rating || 0) < 4 && (c.ratingCount || 0) >= 20) add(14, 'dolor en resenas');
  if ((c.signals || []).length) add(Math.min(18, c.signals.length * 5), `${c.signals.length} senales comerciales`);
  if ((c.scrapeSignals || []).length) add(Math.min(24, c.scrapeSignals.reduce((sum, s) => sum + (s.points || 0), 0) / 2), `${c.scrapeSignals.length} dolores web detectados`);
  if (c.domainAge !== undefined && c.domainAge >= 7) add(8, 'dominio antiguo');
  if (c.webLoadMs && c.webLoadMs > 2500) add(10, 'web lenta');
  if ((c.techStack || []).some(t => /wordpress|wix|joomla|prestashop/i.test(t))) add(8, 'stack mejorable');
  if (/reforma|renovaci|obra|ampliac|traslado|apertura|nuevo local|nueva sede/.test(text)) add(16, 'momento de cambio');
  if (/queja|mal|lento|espera|sucio|antiguo|deterior|pequeno|ruido|calor|frio/.test(text)) add(10, 'dolor operativo');
  if (c.fromCache) add(4, 'memoria tecnica previa');
  if (getLeadMemory(c)) add(10, 'memoria comercial previa');

  score = Math.max(0, Math.min(100, score));
  const level = score >= 75 ? 'Alta' : score >= 50 ? 'Media' : 'Baja';
  const angle = reasons.includes('momento de cambio') ? 'reforma o ampliacion'
    : reasons.includes('dolor en resenas') || reasons.includes('dolor operativo') ? 'mejora de experiencia'
    : reasons.includes('web lenta') || reasons.includes('stack mejorable') ? 'captacion digital'
    : reasons.includes('sin web visible') ? 'presencia online'
    : 'contacto consultivo';
  return { score, level, reasons: reasons.slice(0, 5), angle };
}

function decorateOpportunity(c) {
  if (!c) return c;
  decorateContactQuality(c);
  const sig = [
    c.email, c.phone, c.whatsapp, c.decision_maker, c.website,
    c.rating, c.ratingCount, c.domainAge, c.webLoadMs,
    (c.signals || []).length, (c.scrapeSignals || []).map(s => s.key).join(','), c.description, c.reviewSummary, c.fachadaAnalysis,
    c.fromCache, c.contactQualityScore
  ].join('|');
  if (c._oppSig === sig) return c;
  const opp = detectOpportunitySignals(c);
  c.opportunityScore = opp.score;
  c.opportunityLevel = opp.level;
  c.opportunityReasons = opp.reasons;
  c.opportunityAngle = opp.angle;
  const mem = getLeadMemory(c);
  c.memorySummary = mem ? `${mem.events?.length || 0} eventos previos` : '';
  c._oppSig = sig;
  decorateResultExplanation(c);
  return c;
}

function decorateAllOpportunities() {
  if (!Array.isArray(tempSearchResults)) return;
  tempSearchResults.forEach(decorateOpportunity);
}

function getScrapingQualitySnapshot() {
  const r = tempSearchResults || [];
  const total = r.length || 1;
  const pct = n => Math.round((n / total) * 100);
  const diagCounts = {};
  r.forEach(c => (c.scrapeDiagnostics || []).forEach(d => {
    if (!d) return;
    diagCounts[d] = (diagCounts[d] || 0) + 1;
  }));
  const topDiag = Object.entries(diagCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    total: r.length,
    website: pct(r.filter(c => c.website).length),
    email: pct(r.filter(c => c.email).length),
    phone: pct(r.filter(c => c.phone).length),
    social: pct(r.filter(c => c.instagram || c.facebook || c.linkedin).length),
    decision: pct(r.filter(c => c.decision_maker).length),
    signals: pct(r.filter(c => (c.signals || []).length).length),
    cache: pct(r.filter(c => c.fromCache).length),
    proxyFail: r.filter(c => (c.enrichSource || []).includes('Proxy-fallo')).length,
    highEmail: pct(r.filter(c => c.emailQuality === 'alta').length),
    highContact: pct(r.filter(c => (c.contactQualityScore || 0) >= 76).length),
    memory: pct(r.filter(c => c.scrapeMemoryUsed).length),
    diagnostics: topDiag,
    avgOpp: r.length ? Math.round(r.reduce((sum, c) => sum + (c.opportunityScore || 0), 0) / r.length) : 0
  };
}

function renderScrapingQualityPanel(forceShow = true) {
  const el = document.getElementById('scraping-quality-panel');
  if (!el) return;
  const s = getScrapingQualitySnapshot();
  if (!forceShow && el.style.display === 'none') return;
  el.style.display = 'block';
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap">
      <div>
        <div style="font-weight:700;margin-bottom:.25rem">Calidad del scraping</div>
        <div style="font-size:.78rem;color:var(--text-muted)">Cobertura real de los datos capturados en esta busqueda.</div>
      </div>
      <button class="btn-outline btn-sm" onclick="toggleScrapingQualityPanel(false)">Ocultar</button>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:.55rem;margin-top:.8rem">
      ${[
        ['Web', s.website + '%'], ['Email', s.email + '%'], ['Telefono', s.phone + '%'],
        ['Redes', s.social + '%'], ['Decisor', s.decision + '%'], ['Senales', s.signals + '%'],
        ['Cache', s.cache + '%'], ['Memoria', s.memory + '%'], ['Email alta', s.highEmail + '%'],
        ['Contacto alto', s.highContact + '%'], ['Fallos proxy', s.proxyFail], ['Score medio', s.avgOpp]
      ].map(([k,v]) => `<div style="padding:.6rem;border:1px solid var(--glass-border);border-radius:10px;background:rgba(255,255,255,.03)"><div style="font-size:1rem;font-weight:700">${v}</div><div style="font-size:.68rem;color:var(--text-dim)">${k}</div></div>`).join('')}
    </div>
    ${s.diagnostics.length ? `<div style="margin-top:.65rem;font-size:.74rem;color:var(--text-muted)">Diagnosticos: ${s.diagnostics.map(([k,v]) => `${k} (${v})`).join(' · ')}</div>` : ''}`;
}

function toggleScrapingQualityPanel(show = null) {
  const el = document.getElementById('scraping-quality-panel');
  if (!el) return;
  const next = show === null ? el.style.display === 'none' : show;
  if (next) renderScrapingQualityPanel(true);
  else el.style.display = 'none';
}

function renderAutonomousProspectingPanel(forceShow = true) {
  const el = document.getElementById('autoprospect-panel');
  if (!el) return;
  if (!forceShow && el.style.display === 'none') return;
  decorateAllOpportunities();
  const top = [...tempSearchResults].sort((a, b) => (b.opportunityScore || 0) - (a.opportunityScore || 0)).slice(0, 5);
  el.style.display = 'block';
  el.innerHTML = `
    <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap">
      <div>
        <div style="font-weight:700;margin-bottom:.25rem">Prospeccion autonoma</div>
        <div style="font-size:.78rem;color:var(--text-muted)">Prioriza los leads con mas senales y marca automaticamente los mejores para volcar.</div>
      </div>
      <div style="display:flex;gap:.45rem;flex-wrap:wrap">
        <button class="btn-primary btn-sm" onclick="createProspectingCampaignFromSearch()">Crear campana</button>
        <button class="btn-outline btn-sm" onclick="document.getElementById('autoprospect-panel').style.display='none'">Ocultar</button>
      </div>
    </div>
    <div style="display:grid;gap:.45rem;margin-top:.8rem">
      ${top.map(c => `<div style="display:flex;justify-content:space-between;gap:.75rem;padding:.55rem .7rem;border:1px solid var(--glass-border);border-radius:10px;background:rgba(255,255,255,.03)">
        <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name || 'Empresa'} <small style="color:var(--text-dim)">(${c.opportunityAngle || 'contacto'})</small></span>
        <strong style="color:${(c.opportunityScore || 0) >= 75 ? 'var(--success)' : 'var(--warning)'}">${c.opportunityScore || 0}/100</strong>
      </div>`).join('') || '<div style="color:var(--text-muted);font-size:.82rem">Aun no hay resultados.</div>'}
    </div>`;
}

async function runAutonomousProspecting() {
  const btn = document.getElementById('autoprospect-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Analizando...'; }
  try {
    if (!tempSearchResults.length) await searchBusinesses();
    decorateAllOpportunities();
    const picks = new Set(getVisibleSearchResultEntries()
      .sort((a, b) => ((b.c.opportunityScore || 0) - (a.c.opportunityScore || 0)) || (a.i - b.i))
      .filter(({ c }) => (c.email || c.phone || c.website) && (c.opportunityScore || 0) >= 35)
      .slice(0, 20)
      .map(({ i }) => i));
    tempSearchResults.forEach((c, i) => {
      c.autonomousPick = picks.has(i);
      if (c.autonomousPick) c._selectedForImport = true;
    });
    renderSearchCards();
    renderSearchTable();
    document.querySelectorAll('.search-check').forEach(ch => {
      const idx = parseInt(ch.getAttribute('data-index'));
      ch.checked = !!tempSearchResults[idx]?._selectedForImport;
    });
    renderAutonomousProspectingPanel(true);
    renderScrapingQualityPanel(true);
    updateEnrichStats();
    showToast('Prospeccion autonoma aplicada');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Prospeccion autonoma'; }
  }
}

function buildCommercialAudit(c) {
  decorateOpportunity(c);
  const memory = getLeadMemory(c);
  const reasons = (c.opportunityReasons || []).map(r => `<li>${r}</li>`).join('') || '<li>Sin senales fuertes todavia.</li>';
  const contactReasons = (c.contactQualityReasons || []).map(r => `<li>${r}</li>`).join('') || '<li>Sin contacto verificado.</li>';
  const whyRows = (c.resultExplanation || buildResultExplanation(c)).map(x => `
    <div style="display:flex;justify-content:space-between;gap:.7rem;padding:.45rem .55rem;border:1px solid var(--glass-border);border-radius:8px;background:rgba(255,255,255,.025)">
      <span style="font-size:.78rem;color:${x.ok ? 'var(--text-muted)' : 'var(--danger)'}">${x.label}</span>
      <strong style="font-size:.78rem;text-align:right;color:${x.ok ? 'var(--text)' : 'var(--danger)'}">${x.value}</strong>
    </div>`).join('');
  return `
    <div style="display:grid;gap:1rem">
      <div style="display:flex;justify-content:space-between;gap:1rem;align-items:center">
        <div>
          <h3 style="margin:0">${c.name || 'Empresa'}</h3>
          <div style="font-size:.82rem;color:var(--text-muted)">${c.website || c.address || ''}</div>
        </div>
        <div style="font-size:1.7rem;font-weight:800;color:${(c.opportunityScore || 0) >= 75 ? 'var(--success)' : 'var(--warning)'}">${c.opportunityScore || 0}</div>
      </div>
      <div style="padding:.8rem;border:1px solid var(--glass-border);border-radius:10px;background:rgba(255,255,255,.03)">
        <strong>Angulo recomendado:</strong> ${c.opportunityAngle || 'contacto consultivo'}
        <ul style="margin:.55rem 0 0 1rem;color:var(--text-muted);font-size:.85rem">${reasons}</ul>
      </div>
      <div style="padding:.8rem;border:1px solid var(--glass-border);border-radius:10px;background:rgba(255,255,255,.03)">
        <strong>Calidad de contacto:</strong> ${c.contactQuality || 'pendiente'} (${c.contactQualityScore || 0}/100)
        <ul style="margin:.55rem 0 0 1rem;color:var(--text-muted);font-size:.85rem">${contactReasons}</ul>
      </div>
      <div style="padding:.8rem;border:1px solid var(--glass-border);border-radius:10px;background:rgba(255,255,255,.03)">
        <strong>Por que aparece:</strong>
        <div style="display:grid;gap:.4rem;margin-top:.55rem">${whyRows}</div>
      </div>
      <div style="padding:.8rem;border:1px solid var(--glass-border);border-radius:10px;background:rgba(255,255,255,.03)">
        <strong>Auditoria visual/web:</strong>
        <div style="margin-top:.45rem;color:var(--text-muted);font-size:.85rem;line-height:1.45">
          ${c.fachadaAnalysis || c.reviewSummary || c.description || 'Sin auditoria visual todavia. Ejecuta enriquecimiento completo para activar Street View/IA si hay clave Gemini.'}
          ${c.webLoadMs ? `<br>Web: ${(c.webLoadMs / 1000).toFixed(1)}s de carga.` : ''}
          ${(c.techStack || []).length ? `<br>Stack: ${(c.techStack || []).slice(0, 6).join(', ')}` : ''}
        </div>
      </div>
      <div style="padding:.8rem;border:1px solid var(--glass-border);border-radius:10px;background:rgba(255,255,255,.03)">
        <strong>Memoria local:</strong> ${memory ? `${memory.events?.length || 0} eventos, ultimo ${new Date(memory.lastSeen).toLocaleDateString()}` : 'sin historial previo'}
      </div>
    </div>`;
}

function showCommercialAudit(idx) {
  const c = tempSearchResults[idx];
  if (!c) return;
  recordLeadMemory(c, 'audit_opened', { score: c.opportunityScore || 0 });
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:1rem';
  modal.innerHTML = `<div style="width:min(720px,96vw);max-height:86vh;overflow:auto;background:var(--bg-card);border:1px solid var(--glass-border);border-radius:14px;padding:1.25rem;box-shadow:0 20px 60px rgba(0,0,0,.35)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
      <h2 style="margin:0;font-size:1.1rem">Auditoria comercial</h2>
      <button class="btn-outline btn-sm" onclick="this.closest('div[style*=fixed]').remove()">Cerrar</button>
    </div>
    ${buildCommercialAudit(c)}
  </div>`;
  document.body.appendChild(modal);
}

function markCardEnriching(idx, on) {
  const card = document.getElementById(`sc-${idx}`);
  if (card) card.classList.toggle('enriching', on);
}

function updateCard(idx) {
  const card = document.getElementById(`sc-${idx}`);
  if (!card) return;
  card.outerHTML = buildCardHTML(tempSearchResults[idx], idx);
}

function buildCardHTML(c, i) {
  const initials = (c.name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  const ratingStr = c.rating ? `⭐ ${c.rating} (${c.ratingCount})` : '';
  const enrichStatus = c.email
    ? `<span class="sc-enrich-status enriched">● Enriquecida</span>`
    : c.enriched
    ? `<span class="sc-enrich-status partial">◐ Parcial</span>`
    : `<span class="sc-enrich-status pending">○ Sin enriquecer</span>`;

  // Check if already in leads — por placeId (fiable) o nombre normalizado (fallback)
  const normName = n => (n||'').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,25);
  const alreadyIn = leads.find(l => !l.archived && (
    (c.placeId && l.placeId && l.placeId === c.placeId) ||
    normName(l.company) === normName(c.name)
  ));

  // Color y texto según estado del lead existente
  const statusColors = {
    'Pendiente':      'rgba(245,158,11,.15)',
    'Contactado':     'rgba(10,132,255,.15)',
    'En negociación': 'rgba(94,92,230,.15)',
    'Cliente':        'rgba(16,217,124,.15)',
    'Convertido':     'rgba(16,217,124,.15)',
    'Descartado':     'rgba(239,68,68,.12)',
    'Archivado':      'rgba(100,100,100,.15)',
  };
  const statusTextColors = {
    'Pendiente':      'var(--warning)',
    'Contactado':     'var(--primary)',
    'En negociación': 'var(--secondary)',
    'Cliente':        'var(--success)',
    'Convertido':     'var(--success)',
    'Descartado':     'var(--danger)',
    'Archivado':      'var(--text-muted)',
  };
  const sBg   = alreadyIn ? (statusColors[alreadyIn.status]      || 'rgba(16,217,124,.15)') : '';
  const sTxt  = alreadyIn ? (statusTextColors[alreadyIn.status]  || 'var(--success)') : '';
  const daysSinceAdded = alreadyIn ? Math.floor((Date.now() - new Date(alreadyIn.date)) / 86400000) : 0;
  const addedAgo = daysSinceAdded === 0 ? 'hoy' : daysSinceAdded === 1 ? 'ayer' : `hace ${daysSinceAdded}d`;
  const alreadyBadge = alreadyIn
    ? `<span style="font-size:.65rem;background:${sBg};color:${sTxt};padding:2px 8px;border-radius:10px;border:1px solid ${sBg.replace(',.15','.4').replace(',.12','.35')};cursor:pointer" onclick="openLeadDetail('${alreadyIn.id}')" title="Ver lead · añadido ${addedAgo}">
        📋 Ya en CRM · <strong>${alreadyIn.status}</strong> · ${addedAgo}
        ${alreadyIn.email ? ' · ✉️' : ''}${alreadyIn.phone ? ' · 📞' : ''}
      </span>`
    : '';

  // Keyword detection in description
  const oppKeywords = ['reforma','renovaci','instalaci','obra','ampliac','traslado','apertura','nuevo local','nueva sede','abierto recientemente'];
  const hasOpp = oppKeywords.some(k => (c.description||'').toLowerCase().includes(k));
  const oppBadge = hasOpp ? `<span style="font-size:.65rem;background:rgba(245,158,11,.15);color:var(--warning);padding:1px 7px;border-radius:10px;border:1px solid rgba(245,158,11,.3)">🔥 Señal de oportunidad</span>` : '';

  // Possible chain/franchise detection
  const chainLeads = tempSearchResults.filter(r => r !== c && r.name === c.name);
  const chainBadge = chainLeads.length ? `<span style="font-size:.65rem;background:rgba(94,92,230,.15);color:var(--secondary);padding:1px 7px;border-radius:10px">⛓️ Posible cadena</span>` : '';

  const _ll = getLookalikeSimilarity(c);
  const llBadge = (_ll >= 70 && _goldenProfile)
    ? `<span style="font-size:.65rem;background:rgba(16,217,124,.15);color:var(--success);padding:1px 7px;border-radius:10px;border:1px solid rgba(16,217,124,.3)">🎯 ${_ll}% lookalike</span>`
    : '';

  // MEJORA 1: Temperatura del Lead
  const temp = calculateLeadTemperature(c);
  const tempBadge = `<span style="font-size:.65rem;background:${temp.color}22;color:${temp.color};padding:2px 8px;border-radius:10px;border:1px solid ${temp.color}44" title="${temp.desc}">
    ${temp.icon} ${temp.label}
  </span>`;
  const uxStatus = getLeadUXStatus(c);
  const uxStatusBadge = `<span style="font-size:.65rem;background:rgba(255,255,255,.05);color:${uxStatus.color};padding:2px 8px;border-radius:10px;border:1px solid ${uxStatus.color}44" title="${uxStatus.action}">${uxStatus.label}</span>`;
  decorateOpportunity(c);
  const oppColor = (c.opportunityScore || 0) >= 75 ? 'var(--success)' : (c.opportunityScore || 0) >= 50 ? 'var(--warning)' : 'var(--text-muted)';
  const opportunityBadge = `<span style="font-size:.65rem;background:rgba(255,255,255,.05);color:${oppColor};padding:2px 8px;border-radius:10px;border:1px solid ${oppColor}55" title="${(c.opportunityReasons || []).join(' | ')}">Score ${c.opportunityScore || 0} - ${c.opportunityLevel || 'Baja'}</span>`;
  const contactColor = (c.contactQualityScore || 0) >= 76 ? 'var(--success)' : (c.contactQualityScore || 0) >= 52 ? 'var(--warning)' : 'var(--text-muted)';
  const contactQualityBadge = `<span style="font-size:.65rem;background:rgba(255,255,255,.05);color:${contactColor};padding:2px 8px;border-radius:10px;border:1px solid ${contactColor}55" title="${(c.contactQualityReasons || []).join(' | ')}">Contacto ${c.contactQuality || 'pendiente'} ${c.contactQualityScore || 0}/100</span>`;
  const memoryBadge = c.memorySummary
    ? `<span style="font-size:.65rem;background:rgba(10,132,255,.12);color:var(--primary);padding:2px 8px;border-radius:10px;border:1px solid rgba(10,132,255,.25)">Memoria: ${c.memorySummary}</span>`
    : '';
  const sectorBadge = (c.matchedSectors || []).length
    ? `<span style="font-size:.65rem;background:rgba(94,92,230,.12);color:var(--secondary);padding:2px 8px;border-radius:10px;border:1px solid rgba(94,92,230,.25)" title="${c.matchedSectors.map(getSegmentLabel).join(' | ')}">${c.matchedSectors.length > 1 ? c.matchedSectors.length + ' sectores' : getSegmentLabel(c.matchedSectors[0])}</span>`
    : '';

  const socials = [
    c.instagram ? `<a href="${c.instagram}" target="_blank" class="sc-social-badge instagram">📸 IG</a>` : '',
    c.facebook  ? `<a href="${c.facebook}"  target="_blank" class="sc-social-badge facebook">👍 FB</a>` : '',
    c.linkedin  ? `<a href="${c.linkedin}"  target="_blank" class="sc-social-badge linkedin">💼 LI</a>` : '',
    c.twitter   ? `<a href="${c.twitter}"   target="_blank" class="sc-social-badge twitter">🐦 TW</a>` : '',
    c.youtube   ? `<a href="${c.youtube}"   target="_blank" class="sc-social-badge youtube">▶️ YT</a>` : '',
  ].filter(Boolean).join('');

  const sources = c.enrichSource?.length
    ? `<span style="font-size:.65rem;color:var(--text-dim);margin-left:auto">${c.enrichSource.join(' · ')}</span>`
    : '';

  const signalBadges = (c.signals && c.signals.length)
    ? `<div style="margin-top:.4rem;display:flex;flex-wrap:wrap;gap:.3rem">${c.signals.map(s =>
        `<span style="font-size:.62rem;background:rgba(245,158,11,.12);color:var(--warning);padding:1px 6px;border-radius:8px;border:1px solid rgba(245,158,11,.25)">${s}</span>`
      ).join('')}</div>`
    : '';

  const emailsExtra = c.emails?.length > 1
    ? c.emails.slice(1).map(e => `<span style="font-size:.7rem;color:var(--text-muted)">${e}</span>`).join(' ')
    : '';
  const emailQualityBadge = c.emailQuality
    ? `<span style="font-size:.62rem;background:${c.emailQuality === 'alta' ? 'rgba(16,217,124,.13)' : c.emailQuality === 'media' ? 'rgba(245,158,11,.13)' : 'rgba(239,68,68,.10)'};color:${c.emailQuality === 'alta' ? 'var(--success)' : c.emailQuality === 'media' ? 'var(--warning)' : 'var(--text-muted)'};padding:1px 6px;border-radius:8px">email ${c.emailQuality}</span>`
    : '';
  const decisionBadge = c.decision_maker_confidence
    ? `<span style="font-size:.62rem;background:rgba(10,132,255,.10);color:var(--primary);padding:1px 6px;border-radius:8px">decisor ${c.decision_maker_confidence}%</span>`
    : '';
  const scrapeDiagBadge = (c.scrapeDiagnostics || []).length
    ? `<span style="font-size:.62rem;background:rgba(239,68,68,.10);color:var(--danger);padding:1px 6px;border-radius:8px" title="${(c.scrapeDiagnostics || []).join(' | ')}">${(c.scrapeDiagnostics || [])[0]}</span>`
    : '';
  const commercialPainBadge = (c.scrapeSignals || []).length
    ? `<span style="font-size:.62rem;background:rgba(245,158,11,.12);color:var(--warning);padding:1px 6px;border-radius:8px" title="${c.scrapeSignals.map(s => s.label).join(' | ')}">${c.scrapeSignals.length} dolores web</span>`
    : '';
  const incrementalBadge = c.scrapeChanged
    ? '<span style="font-size:.62rem;background:rgba(16,217,124,.12);color:var(--success);padding:1px 6px;border-radius:8px">cambios nuevos</span>'
    : (c.scrapeStable ? '<span style="font-size:.62rem;background:rgba(255,255,255,.06);color:var(--text-muted);padding:1px 6px;border-radius:8px">sin cambios</span>' : '');
  const scrapeBadges = [emailQualityBadge, decisionBadge, c.scrapeMemoryUsed ? '<span style="font-size:.62rem;background:rgba(255,255,255,.06);color:var(--text-muted);padding:1px 6px;border-radius:8px">memoria scraping</span>' : '', incrementalBadge, commercialPainBadge, scrapeDiagBadge].filter(Boolean).join('');
  const whyPreview = (c.resultExplanation || buildResultExplanation(c)).slice(0, 4);
  const whyLine = whyPreview.length
    ? `<div style="display:flex;gap:.25rem;flex-wrap:wrap;margin:.45rem 0 .1rem">${whyPreview.map(x =>
        `<span style="font-size:.61rem;background:${x.ok ? 'rgba(10,132,255,.08)' : 'rgba(239,68,68,.08)'};color:${x.ok ? 'var(--primary)' : 'var(--danger)'};padding:1px 6px;border-radius:8px;border:1px solid ${x.ok ? 'rgba(10,132,255,.18)' : 'rgba(239,68,68,.18)'}" title="${x.value}">${x.label}: ${String(x.value || '').slice(0, 34)}</span>`
      ).join('')}</div>`
      : '';
  const isSelected = c._selectedForImport !== false && !alreadyIn;

  return `<div class="search-card" id="sc-${i}" data-idx="${i}" data-index="${i}" ${alreadyIn ? 'style="opacity:.65"' : ''} onclick="if(!event.target.closest('button') && !event.target.closest('a') && !event.target.closest('input')) openSidePanel(${i})">
    <input type="checkbox" class="search-check sc-check search-card-check" data-index="${i}" onchange="setSearchResultSelected(${i}, this.checked)" ${isSelected ? 'checked' : ''}>
    ${alreadyBadge || oppBadge || chainBadge || llBadge || tempBadge || sectorBadge ? `<div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-bottom:.4rem">${alreadyBadge}${sectorBadge}${uxStatusBadge}${tempBadge}${opportunityBadge}${contactQualityBadge}${memoryBadge}${oppBadge}${chainBadge}${llBadge}</div>` : ''}
    <div class="sc-header">
      <div class="sc-avatar" style="${c.logo ? 'padding:0;overflow:hidden' : ''}">
        ${c.logo
          ? `<img src="${c.logo}" alt="${c.name}" style="width:100%;height:100%;object-fit:contain;border-radius:inherit"
               onerror="this.parentNode.innerHTML='${initials}';this.parentNode.style.padding='';">`
          : initials}
      </div>
      <div>
        <div class="sc-name">${c.name}</div>
        <div class="sc-addr">${c.address}${c.distKm !== null && c.distKm !== undefined ? ` <span style="font-size:.62rem;background:rgba(10,132,255,.1);color:var(--primary);padding:1px 5px;border-radius:4px;margin-left:3px">📍 ${c.distKm}km</span>` : ''}</div>
        ${ratingStr ? `<div class="sc-rating">${ratingStr}</div>` : ''}
        ${c.domainAge !== undefined ? `<div style="font-size:.65rem;color:var(--text-dim)">🌐 Dominio: ${c.domainYear} (${c.domainAge} años)</div>` : ''}
        ${c.incorporationYear ? `<div style="font-size:.65rem;color:var(--text-dim)">🏢 Fundada: ${c.incorporationYear}${c.legalStatus ? ' · ' + c.legalStatus : ''}</div>` : ''}
        ${c.techStack && c.techStack.length ? `<div style="font-size:.63rem;color:var(--text-dim)">⚙️ ${c.techStack.join(' · ')}</div>` : ''}
        ${c.webLoadMs && c.webLoadMs > 2000 ? `<div style="font-size:.63rem;color:${c.webLoadMs > 4000 ? 'var(--danger)' : 'var(--warning)'}">⏱️ Web: ${(c.webLoadMs/1000).toFixed(1)}s</div>` : ''}
        ${scrapeBadges ? `<div style="display:flex;gap:.25rem;flex-wrap:wrap;margin-top:.2rem">${scrapeBadges}</div>` : ''}
      </div>
    </div>
    ${whyLine}
    <div class="sc-data">
      <div class="sc-row">
        <span class="sc-icon">✉️</span>
        <div class="sc-val ${c.email ? '' : 'empty'}">
          ${c.email
            ? `<span style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap">${c.email}${emailsExtra ? '<br>' + emailsExtra : ''}<button onclick="event.stopPropagation(); copyToClipboard('${c.email.split('<br>')[0]}', 'Email: ${c.email.split('<br>')[0]}')" title="Copiar email al portapapeles" class="sc-copy-email-btn">📋 Copiar</button></span>`
            : `<input type="email" placeholder="Añadir email..." onchange="tempSearchResults[${i}].email=this.value;updateEnrichStats()" style="background:none;border:none;border-bottom:1px solid var(--glass-border);padding:.15rem 0;color:var(--text);font-size:.78rem;outline:none;width:100%">`
          }
        </div>
      </div>
      <div class="sc-row">
        <span class="sc-icon">📞</span>
        <div class="sc-val ${c.phone ? '' : 'empty'}">
          ${c.phone || `<input type="text" placeholder="Añadir teléfono..." onchange="tempSearchResults[${i}].phone=this.value" style="background:none;border:none;border-bottom:1px solid var(--glass-border);padding:.15rem 0;color:var(--text);font-size:.78rem;outline:none;width:100%">`}
          ${c.whatsapp ? `<a href="https://wa.me/${c.whatsapp.replace(/[^0-9]/g,'')}" target="_blank" style="margin-left:6px;font-size:.68rem;color:#25d366;background:rgba(37,211,102,.1);padding:1px 6px;border-radius:8px;text-decoration:none">💬 WA</a>` : ''}
        </div>
      </div>
      ${c.decision_maker ? `<div class="sc-row"><span class="sc-icon">👤</span><div class="sc-val">${c.decision_maker}</div></div>` : ''}
      ${c.description ? `<div class="sc-row"><span class="sc-icon">ℹ️</span><div class="sc-val" style="font-size:.78rem;color:var(--text-muted)">${c.description.slice(0,120)}...</div></div>` : ''}
      ${c.website ? `<div class="sc-row"><span class="sc-icon">🌐</span><div class="sc-val"><a href="${c.website}" target="_blank">${c.website.replace(/^https?:\/\//,'').slice(0,40)}</a></div></div>` : ''}
    </div>
    ${socials ? `<div class="sc-socials">${socials}</div>` : ''}
    <div class="sc-footer">
      ${enrichStatus}
      ${sources}
      </div>${signalBadges}
      <div class="reenrich-progress" id="rep-${i}"><div class="reenrich-progress-fill" id="repf-${i}"></div></div>
      <div class="reenrich-log-mini" id="rel-${i}"></div>
      <div style="display:flex;gap:.4rem;margin-top:.4rem;align-items:center;flex-wrap:wrap">
        ${!c.email || !c.decision_maker ? `<button class="btn-reenrich" id="rebtn-${i}" onclick="${c.enriched ? 'reEnrichOne' : 'enrichSingleCard'}(${i})" title="${c.enriched ? 'Reintentar scraping' : 'Enriquecer esta empresa'}">
          <span class="reenrich-icon">${c.enriched ? '🔄' : '✨'}</span> ${!c.email ? (c.enriched ? 'Buscar email' : 'Enriquecer') : 'Buscar decisor'}
        </button>` : `<span style="font-size:.65rem;color:var(--success)">✅ Completo</span>`}
        ${c.email ? `<button class="btn-action" style="font-size:.7rem;margin-left:auto" onclick="quickImportOne(${i})">Volcar -></button>` : ''}
        <button class="btn-action secondary" style="padding:0 8px;font-size:.7rem" onclick="showCommercialAudit(${i})" title="Auditoria comercial">Score</button>
        <button class="btn-action secondary" style="padding:0 8px;font-size:.7rem" onclick="showMicroAudit(${i})" title="Ver Auditoría">📋</button>
        <button class="btn-action secondary" style="padding:0 8px;font-size:.7rem" onclick="findSimilarLeads(${i})" title="Buscar Similares">🔍</button>
      </div>
    </div>
  </div>`;
}

function renderSearchCards() {
  const grid = document.getElementById('search-cards-grid');
  if (!grid) return;
  const entries = getVisibleSearchResultEntries();
  grid.innerHTML = entries.length
    ? entries.map(({ c, i }) => buildCardHTML(c, i)).join('')
    : `<div style="grid-column:1/-1;padding:1.25rem;border:1px solid var(--glass-border);border-radius:12px;background:rgba(255,255,255,.03);color:var(--text-muted);text-align:center">
        No hay empresas que cumplan los filtros activos.
      </div>`;
}

function renderSearchTable() {
  const tbody = document.getElementById('search-results-body');
  if (!tbody) return;
  const entries = getVisibleSearchResultEntries();
  tbody.innerHTML = entries.length ? entries
  .map(({ c, i }) => {
    const bc = c.email ? 'badge-high' : 'badge-low';
    const socLinks = [
      c.instagram ? `<a href="${c.instagram}" target="_blank" class="sc-social-badge instagram" style="font-size:.68rem">IG</a>` : '',
      c.facebook  ? `<a href="${c.facebook}"  target="_blank" class="sc-social-badge facebook"  style="font-size:.68rem">FB</a>` : '',
      c.linkedin  ? `<a href="${c.linkedin}"  target="_blank" class="sc-social-badge linkedin"  style="font-size:.68rem">LI</a>` : '',
    ].filter(Boolean).join(' ');
    const temp = calculateLeadTemperature(c);
    decorateOpportunity(c);
    const why = (c.resultExplanation || buildResultExplanation(c)).slice(0, 3).map(x => `${x.label}: ${x.value}`).join(' | ');
    const contactColor = (c.contactQualityScore || 0) >= 76 ? 'var(--success)' : (c.contactQualityScore || 0) >= 52 ? 'var(--warning)' : 'var(--text-muted)';
    const rowSelected = c._selectedForImport !== false && !resultAlreadyInLeads(c);
    return `<tr onclick="if(!event.target.closest('button') && !event.target.closest('a') && !event.target.closest('input')) openSidePanel(${i})" style="cursor:pointer">
      <td><input type="checkbox" class="search-check" data-index="${i}" onchange="setSearchResultSelected(${i}, this.checked)" ${rowSelected ? 'checked' : ''}></td>
      <td>
        <div class="lead-name">${temp.icon} ${c.name} <span style="font-size:.68rem;color:var(--primary)">Score ${c.opportunityScore || 0}</span></div>
        <div class="lead-company">${c.address}</div>
        <div style="font-size:.67rem;color:${contactColor};margin-top:.15rem">Contacto ${c.contactQuality || 'pendiente'} ${c.contactQualityScore || 0}/100</div>
        ${why ? `<div style="font-size:.66rem;color:var(--text-dim);margin-top:.15rem">${why.slice(0, 140)}</div>` : ''}
        ${c.website ? `<a href="${c.website}" target="_blank" style="color:var(--primary);font-size:.7rem">🔗 web</a>` : ''}
      </td>
      <td style="font-size:.8rem">${c.phone || '—'}</td>
      <td style="font-size:.78rem;color:${c.email ? 'var(--success)' : 'var(--text-dim)'}">
        ${c.email ? `<span style="display:inline-flex;align-items:center;gap:.3rem">${c.email}<button onclick="event.stopPropagation(); copyToClipboard('${c.email}', 'Email: ${c.email}')" title="Copiar email" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.8rem;padding:2px;line-height:1">⧉</button></span>` : `<input type="email" placeholder="añadir..." onchange="tempSearchResults[${i}].email=this.value;updateEnrichStats()" style="background:none;border:none;border-bottom:1px solid var(--glass-border);color:var(--text);font-size:.78rem;outline:none;width:130px">`}
      </td>
      <td style="font-size:.78rem;color:var(--text-muted)">${c.decision_maker || '—'}</td>
      <td>${socLinks || '—'}</td>
      <td style="color:${c.rating ? 'var(--warning)' : 'var(--text-dim)'}">
        ${c.rating ? '⭐ ' + c.rating : '—'}
      </td>
      <td>
        <button class="btn-action" style="font-size:.72rem" onclick="quickImportOne(${i})">Volcar</button>
        <button class="btn-action secondary" style="font-size:.72rem;padding:2px 5px" onclick="showCommercialAudit(${i})">Score</button>
        <button class="btn-action secondary" style="font-size:.72rem;padding:2px 5px" onclick="showMicroAudit(${i})">📋</button>
        <button class="btn-action secondary" style="font-size:.72rem;padding:2px 5px" onclick="findSimilarLeads(${i})">🔍</button>
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:1.25rem">No hay empresas que cumplan los filtros activos.</td></tr>`;
}

function switchResultView(view) {
  document.getElementById('results-cards-view').style.display = view === 'cards' ? 'block' : 'none';
  document.getElementById('results-table-view').style.display = view === 'table' ? 'block' : 'none';
  document.getElementById('vtog-cards').classList.toggle('active', view === 'cards');
  document.getElementById('vtog-table').classList.toggle('active', view === 'table');
  if (view === 'table') renderSearchTable();
}

let currentResultFilter = 'all';
let currentSearchMinOpportunity = null;
function filterResults(type, btn) {
  currentResultFilter = type;
  currentSearchMinOpportunity = null;
  document.querySelectorAll('.rfilt:not(.ms-filt)').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  applyAdvancedFilters();
}

const SEARCH_DATA_FILTER_LABELS = {
  email: 'Email',
  phone: 'Telefono',
  address: 'Direccion',
  website: 'Web',
  social: 'Redes',
  whatsapp: 'WhatsApp',
  decision: 'Decisor',
  description: 'Descripcion',
  rating: 'Rating',
  reviews: 'Resenas',
  signals: 'Senales',
  pain: 'Dolores web',
  enriched: 'Enriquecido',
  coordinates: 'Coordenadas',
  not_imported: 'No esta en Leads',
  full_contact: 'Direccion + email + telefono',
};

const SEARCH_FILTER_VIEW_PRESETS = [
  { id: 'ready', name: 'Listos para volcar', filters: ['not_imported', 'full_contact'], match: 'all', sort: 'data_complete_desc' },
  { id: 'email_phone', name: 'Email + telefono', filters: ['email', 'phone', 'not_imported'], match: 'all', sort: 'contact_quality_desc' },
  { id: 'complete', name: 'Contacto completo', filters: ['full_contact'], match: 'all', sort: 'data_complete_desc' },
  { id: 'needs_enrich', name: 'Necesitan enriquecer', quick: 'noemail', filters: ['not_imported'], match: 'all', sort: 'opportunity_desc' },
  { id: 'high_opp', name: 'Alta oportunidad', filters: ['not_imported'], match: 'all', sort: 'opportunity_desc', minOpportunity: 55 },
];

function getSelectedSearchDataFilters() {
  return [...document.querySelectorAll('.search-data-filter:checked')].map(el => el.value);
}

function getSearchFilterState() {
  return {
    quick: currentResultFilter || 'all',
    ux: currentUXStatusFilter || 'all',
    multiSector: currentMultiSectorFilter || 'all',
    text: (document.getElementById('search-results-text')?.value || '').toLowerCase(),
    sort: document.getElementById('search-results-sort')?.value || 'default',
    dataFilters: getSelectedSearchDataFilters(),
    dataMatch: document.getElementById('search-data-match')?.value || 'all',
    ratingMin: parseFloat(document.getElementById('filter-rating-min')?.value || 0),
    reviewsMin: parseInt(document.getElementById('filter-reviews-min')?.value || 0),
    distMax: parseFloat(document.getElementById('filter-dist-max')?.value || 50),
    hasWeb: document.getElementById('filter-has-web')?.checked || false,
    noLeads: document.getElementById('filter-no-leads')?.checked || false,
    minOpportunity: currentSearchMinOpportunity,
  };
}

function getQuickSearchFilterButton(type = 'all') {
  return [...document.querySelectorAll('.rfilt:not(.ms-filt)')]
    .find(btn => btn.getAttribute('onclick')?.includes(`filterResults('${type}'`));
}

function applySearchFilterState(state = {}) {
  currentResultFilter = state.quick || 'all';
  currentUXStatusFilter = state.ux || 'all';
  currentMultiSectorFilter = state.multiSector || 'all';
  currentSearchMinOpportunity = state.minOpportunity ?? null;
  const textEl = document.getElementById('search-results-text');
  if (textEl) textEl.value = state.text || '';
  const sortEl = document.getElementById('search-results-sort');
  if (sortEl) sortEl.value = state.sort || 'default';
  const matchEl = document.getElementById('search-data-match');
  if (matchEl) matchEl.value = state.dataMatch || 'all';
  const wanted = new Set(Array.isArray(state.dataFilters) ? state.dataFilters : []);
  document.querySelectorAll('.search-data-filter').forEach(el => { el.checked = wanted.has(el.value); });
  const ratingEl = document.getElementById('filter-rating-min');
  const ratingVal = document.getElementById('filter-rating-val');
  if (ratingEl) ratingEl.value = state.ratingMin || 0;
  if (ratingVal) ratingVal.textContent = String(state.ratingMin || 0);
  const reviewsEl = document.getElementById('filter-reviews-min');
  if (reviewsEl) reviewsEl.value = state.reviewsMin || 0;
  const distEl = document.getElementById('filter-dist-max');
  const distVal = document.getElementById('filter-dist-val');
  if (distEl) distEl.value = state.distMax || 50;
  if (distVal) distVal.textContent = `${state.distMax || 50}km`;
  const webEl = document.getElementById('filter-has-web');
  if (webEl) webEl.checked = !!state.hasWeb;
  const leadsEl = document.getElementById('filter-no-leads');
  if (leadsEl) leadsEl.checked = !!state.noLeads;
  document.querySelectorAll('.rfilt:not(.ms-filt)').forEach(b => b.classList.remove('active'));
  const quickBtn = getQuickSearchFilterButton(currentResultFilter);
  if (quickBtn) quickBtn.classList.add('active');
}

function getSavedSearchFilterViews() {
  try { return JSON.parse(localStorage.getItem('gordi_search_filter_views') || '[]'); }
  catch { return []; }
}

function saveSearchFilterViews(views) {
  localStorage.setItem('gordi_search_filter_views', JSON.stringify((views || []).slice(0, 12)));
}

function resultAlreadyInLeads(c) {
  return leads.find(l => !l.archived && isSameBusiness({ ...c, company: c.name }, l));
}

function resultHasData(c, filter) {
  if (!c) return false;
  if (filter === 'email') return !!c.email;
  if (filter === 'phone') return !!c.phone;
  if (filter === 'address') return !!c.address;
  if (filter === 'website') return !!c.website;
  if (filter === 'social') return !!(c.instagram || c.facebook || c.linkedin || c.twitter || c.youtube);
  if (filter === 'whatsapp') return !!c.whatsapp;
  if (filter === 'decision') return !!c.decision_maker;
  if (filter === 'description') return !!c.description;
  if (filter === 'rating') return Number(c.rating || 0) > 0;
  if (filter === 'reviews') return Number(c.ratingCount || 0) > 0;
  if (filter === 'signals') return !!(c.signals && c.signals.length > 0);
  if (filter === 'pain') return !!(c.scrapeSignals && c.scrapeSignals.length > 0);
  if (filter === 'enriched') return !!(c.enriched || c.email || c.description || c.decision_maker || (c.enrichSource || []).length);
  if (filter === 'coordinates') return c.lat != null && c.lng != null;
  if (filter === 'not_imported') return !resultAlreadyInLeads(c);
  if (filter === 'full_contact') return !!(c.address && c.email && c.phone);
  return true;
}

function getResultCompletenessScore(c) {
  const weighted = [
    ['email', 18], ['phone', 14], ['address', 10], ['website', 10],
    ['decision', 10], ['social', 8], ['whatsapp', 8], ['description', 6],
    ['rating', 5], ['reviews', 5], ['signals', 4], ['pain', 4],
    ['coordinates', 3], ['enriched', 5],
  ];
  return weighted.reduce((sum, [key, points]) => sum + (resultHasData(c, key) ? points : 0), 0);
}

function searchResultTextMatches(c, text) {
  if (!text) return true;
  const hay = [
    c.name, c.email, c.website, c.phone, c.address, c.decision_maker,
    c.sourceSector, c.segment, c.description, c.whatsapp,
    ...(c.signals || []), ...(c.scrapeSignals || []).map(s => s.label || s.key || ''),
  ].join(' ').toLowerCase();
  return hay.includes(text);
}

function searchResultPassesState(c, state = getSearchFilterState()) {
  if (!c) return false;
  const type = state.quick || 'all';
  const dataFilters = Array.isArray(state.dataFilters) ? state.dataFilters : [];

  let show = true;
  if (type === 'email')      show = !!c.email;
  if (type === 'phone')      show = !!c.phone;
  if (type === 'social')     show = !!(c.instagram || c.facebook || c.linkedin);
  if (type === 'noemail')    show = !c.email;
  if (type === 'decision')   show = !!c.decision_maker;
  if (type === 'signals')    show = !!(c.signals && c.signals.length > 0);
  if (type === 'pain')       show = !!(c.scrapeSignals && c.scrapeSignals.length > 0);
  if (type === 'new_domain') show = !!(c.domainAge !== undefined && c.domainAge <= 2);
  if (type === 'verified')   show = !!(c.legalStatus && /active|activa/i.test(c.legalStatus));
  if (show && Number(state.ratingMin || 0) > 0)  show = !!(c.rating && c.rating >= Number(state.ratingMin || 0));
  if (show && Number(state.reviewsMin || 0) > 0) show = !!(c.ratingCount && c.ratingCount >= Number(state.reviewsMin || 0));
  if (show && Number(state.distMax || 50) < 50 && c.distKm != null) show = c.distKm <= Number(state.distMax || 50);
  if (show && state.hasWeb) show = !!c.website;
  if (show && state.noLeads) show = !resultAlreadyInLeads(c);
  if (show && !searchResultTextMatches(c, state.text || '')) show = false;
  if (show && dataFilters.length) {
    const matches = dataFilters.map(filter => resultHasData(c, filter));
    show = state.dataMatch === 'any' ? matches.some(Boolean) : matches.every(Boolean);
  }
  if (show && state.minOpportunity != null) show = Number(c.opportunityScore || 0) >= Number(state.minOpportunity || 0);
  if (show && state.ux && state.ux !== 'all') show = getLeadUXStatus(c).key === state.ux;
  if (show && state.multiSector && state.multiSector !== 'all') {
    show = (c.matchedSectors || [c.sourceSector || c.segment]).includes(state.multiSector);
  }
  return show;
}

function searchResultPassesFilters(c) {
  return searchResultPassesState(c, getSearchFilterState());
}

function compareSearchResultEntries(a, b, srSort) {
  const ca = a.c || {};
  const cb = b.c || {};
  const fallback = a.i - b.i;
  if (srSort === 'data_complete_desc') return (getResultCompletenessScore(cb) - getResultCompletenessScore(ca)) || fallback;
  if (srSort === 'opportunity_desc') return ((cb.opportunityScore || 0) - (ca.opportunityScore || 0)) || fallback;
  if (srSort === 'contact_quality_desc') return ((cb.contactQualityScore || 0) - (ca.contactQualityScore || 0)) || fallback;
  if (srSort === 'email_first') return (Number(!!cb.email) - Number(!!ca.email)) || fallback;
  if (srSort === 'phone_first') return (Number(!!cb.phone) - Number(!!ca.phone)) || fallback;
  if (srSort === 'website_first') return (Number(!!cb.website) - Number(!!ca.website)) || fallback;
  if (srSort === 'rating_desc') return (Number(cb.rating || 0) - Number(ca.rating || 0)) || fallback;
  if (srSort === 'reviews_desc') return (Number(cb.ratingCount || 0) - Number(ca.ratingCount || 0)) || fallback;
  if (srSort === 'name_asc') return String(ca.name || '').localeCompare(String(cb.name || '')) || fallback;
  if (srSort === 'sector_asc') {
    const sa = getSegmentLabel(ca.sourceSector || ca.segment || '');
    const sb = getSegmentLabel(cb.sourceSector || cb.segment || '');
    return sa.localeCompare(sb) || String(ca.name || '').localeCompare(String(cb.name || '')) || fallback;
  }
  if (srSort === 'distance_asc') return (Number(ca.distKm ?? 999999) - Number(cb.distKm ?? 999999)) || fallback;
  return fallback;
}

function getVisibleSearchResultEntries() {
  const state = getSearchFilterState();
  decorateAllOpportunities();
  const entries = tempSearchResults
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => searchResultPassesState(c, state));
  return entries.sort((a, b) => compareSearchResultEntries(a, b, state.sort || 'default'));
}

function applyAdvancedFilters() {
  renderSearchCards();
  const tableView = document.getElementById('results-table-view');
  if (tableView && tableView.style.display !== 'none') renderSearchTable();
  const visibleCount = getVisibleSearchResultEntries().length;
  const cntEl = document.getElementById('search-results-count');
  if (cntEl) cntEl.textContent = `${visibleCount} de ${tempSearchResults.length} resultados`;
  updateSearchFilterChips();
  renderSearchWorkflowPanel();
}

function removeSearchDataFilter(filter) {
  const el = document.querySelector(`.search-data-filter[value="${filter}"]`);
  if (el) el.checked = false;
  applyAdvancedFilters();
}

function setSearchDataFilterPreset(filters, match = 'all') {
  currentResultFilter = 'all';
  currentSearchMinOpportunity = null;
  document.querySelectorAll('.rfilt:not(.ms-filt)').forEach(b => b.classList.remove('active'));
  getQuickSearchFilterButton('all')?.classList.add('active');
  const wanted = new Set(Array.isArray(filters) ? filters : []);
  document.querySelectorAll('.search-data-filter').forEach(el => { el.checked = wanted.has(el.value); });
  const matchEl = document.getElementById('search-data-match');
  if (matchEl) matchEl.value = match;
  applyAdvancedFilters();
}

function updateSearchFilterChips() {
  const chipsEl = document.getElementById('search-sf-chips');
  const badgeEl = document.getElementById('search-sf-badge');
  const moreBtn = document.getElementById('search-more-btn');
  if (!chipsEl) return;

  const chips = [];
  const text = document.getElementById('search-results-text')?.value?.trim();
  const sort = document.getElementById('search-results-sort')?.value || 'default';
  const dataFilters = getSelectedSearchDataFilters();
  const dataMatch = document.getElementById('search-data-match')?.value || 'all';
  const ratingMin = parseFloat(document.getElementById('filter-rating-min')?.value || 0);
  const reviewsMin = parseInt(document.getElementById('filter-reviews-min')?.value || 0);
  const distMax = parseFloat(document.getElementById('filter-dist-max')?.value || 50);
  const hasWeb = document.getElementById('filter-has-web')?.checked || false;
  const noLeads = document.getElementById('filter-no-leads')?.checked || false;

  const quickLabels = {
    email: 'Con email', phone: 'Con telefono', social: 'Con redes', noemail: 'Sin email',
    decision: 'Con decisor', signals: 'Con senales', pain: 'Dolores web',
    new_domain: 'Dominio reciente', verified: 'Verificada',
  };
  const sortLabels = {
    data_complete_desc: 'Mas completos', opportunity_desc: 'Mayor oportunidad',
    contact_quality_desc: 'Mejor contacto', email_first: 'Email primero',
    phone_first: 'Telefono primero', website_first: 'Web primero',
    rating_desc: 'Mayor rating', reviews_desc: 'Mas resenas',
    name_asc: 'A-Z nombre', distance_asc: 'Mas cercano', sector_asc: 'Sector A-Z',
  };

  if (text) chips.push({ label: `Texto: "${text.slice(0, 24)}"`, clear: "document.getElementById('search-results-text').value='';applyAdvancedFilters()" });
  if (currentResultFilter && currentResultFilter !== 'all') chips.push({ label: quickLabels[currentResultFilter] || currentResultFilter, clear: "filterResults('all', getQuickSearchFilterButton('all'))" });
  if (dataFilters.length) {
    const prefix = dataMatch === 'any' ? 'Alguno' : 'Todos';
    dataFilters.forEach(filter => chips.push({
      label: `${prefix}: ${SEARCH_DATA_FILTER_LABELS[filter] || filter}`,
      clear: `removeSearchDataFilter('${filter}')`,
    }));
  }
  if (sort !== 'default') chips.push({ label: `Orden: ${sortLabels[sort] || sort}`, clear: "document.getElementById('search-results-sort').value='default';applyAdvancedFilters()" });
  if (ratingMin > 0) chips.push({ label: `Rating >= ${ratingMin}`, clear: "document.getElementById('filter-rating-min').value=0;document.getElementById('filter-rating-val').textContent='0';applyAdvancedFilters()" });
  if (reviewsMin > 0) chips.push({ label: `Resenas >= ${reviewsMin}`, clear: "document.getElementById('filter-reviews-min').value=0;applyAdvancedFilters()" });
  if (distMax < 50) chips.push({ label: `Distancia <= ${distMax}km`, clear: "document.getElementById('filter-dist-max').value=50;document.getElementById('filter-dist-val').textContent='50km';applyAdvancedFilters()" });
  if (hasWeb) chips.push({ label: 'Solo con web', clear: "document.getElementById('filter-has-web').checked=false;applyAdvancedFilters()" });
  if (noLeads) chips.push({ label: 'No esta en Leads', clear: "document.getElementById('filter-no-leads').checked=false;applyAdvancedFilters()" });
  if (currentSearchMinOpportunity != null) chips.push({ label: `Oportunidad >= ${currentSearchMinOpportunity}`, clear: "currentSearchMinOpportunity=null;applyAdvancedFilters()" });
  if (currentMultiSectorFilter && currentMultiSectorFilter !== 'all') chips.push({ label: `Sector: ${getSegmentLabel(currentMultiSectorFilter)}`, clear: "filterMultiSectorResults('all')" });

  chipsEl.innerHTML = chips.map(c => `
    <span class="sf-chip">
      ${c.label}
      <button onclick="${c.clear}" title="Quitar filtro">×</button>
    </span>`).join('');

  const count = chips.length;
  if (badgeEl) { badgeEl.textContent = count; badgeEl.style.display = count ? 'inline-block' : 'none'; }
  if (moreBtn) moreBtn.classList.toggle('has-active', count > 0);
}

function countSearchResultsForState(state) {
  decorateAllOpportunities();
  return tempSearchResults.filter(c => searchResultPassesState(c, state)).length;
}

function getSearchFlowStats() {
  const all = tempSearchResults || [];
  const visible = getVisibleSearchResultEntries().map(x => x.c);
  const count = list => list.length;
  const metric = (list, filter) => list.filter(c => resultHasData(c, filter)).length;
  return {
    total: all.length,
    visible: visible.length,
    email: metric(visible, 'email'),
    phone: metric(visible, 'phone'),
    full: metric(visible, 'full_contact'),
    notImported: metric(visible, 'not_imported'),
    needsEnrich: visible.filter(c => !c.email || !c.phone || !c.website).length,
    highOpportunity: visible.filter(c => Number(c.opportunityScore || 0) >= 55).length,
    selected: getVisibleSearchChecks().filter(ch => ch.checked).length,
    allEmail: metric(all, 'email'),
    allPhone: metric(all, 'phone'),
    allFull: metric(all, 'full_contact'),
    visibleList: visible,
  };
}

function renderSearchWorkflowPanel() {
  const panel = document.getElementById('search-workflow-panel');
  if (!panel) return;
  if (!Array.isArray(tempSearchResults) || !tempSearchResults.length) {
    panel.style.display = 'none';
    return;
  }
  const stats = getSearchFlowStats();
  const saved = getSavedSearchFilterViews();
  const current = getSearchFilterState();
  const views = [
    ...SEARCH_FILTER_VIEW_PRESETS.map(view => ({
      ...view,
      count: countSearchResultsForState({ ...current, quick: view.quick || 'all', dataFilters: view.filters || [], dataMatch: view.match || 'all', sort: view.sort || 'default', minOpportunity: view.minOpportunity }),
      builtIn: true,
    })),
    ...saved.map(view => ({
      ...view,
      count: countSearchResultsForState({ ...current, ...view.state }),
      builtIn: false,
    })),
  ];
  const next = getSearchNextBestAction(stats);
  panel.style.display = 'grid';
  panel.innerHTML = `
    <div class="search-flow-summary">
      ${[
        ['Visibles', `${stats.visible}/${stats.total}`],
        ['Email', stats.email],
        ['Telefono', stats.phone],
        ['Completos', stats.full],
        ['No importados', stats.notImported],
        ['Alta oportunidad', stats.highOpportunity],
      ].map(([label, value]) => `<div class="search-flow-stat"><strong>${value}</strong><span>${label}</span></div>`).join('')}
    </div>
    <div class="search-flow-board">
      <div class="search-flow-box">
        <div class="search-flow-title">
          <div><strong>Vistas de trabajo</strong><span>Filtra con un clic y conserva tus propias vistas.</span></div>
          <button class="btn-outline btn-sm" onclick="saveCurrentSearchFilterView()">Guardar vista</button>
        </div>
        <div class="search-view-pills">
          ${views.map(view => `
            <button class="search-view-pill" onclick="applySavedSearchFilterView('${view.id}', ${view.builtIn ? 'true' : 'false'})">
              ${view.name} <b>${view.count}</b>
            </button>`).join('')}
        </div>
      </div>
      <div class="search-flow-box search-next-action">
        <div class="search-flow-title">
          <div><strong>Siguiente mejor accion</strong><span>Basada en los resultados visibles.</span></div>
        </div>
        <p>${next.text}</p>
        <button class="${next.primary ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="${next.action}">${next.label}</button>
        <div class="search-flow-actions">
          <button class="btn-outline btn-sm" onclick="selectVisibleSearchResults(true)">Seleccionar visibles</button>
          <button class="btn-outline btn-sm" onclick="selectVisibleSearchResults(false)">Quitar visibles</button>
          <button class="btn-outline btn-sm" onclick="exportSearchCSV()">Exportar visibles</button>
          <button class="btn-outline btn-sm" onclick="createCampaignFromVisibleSearch()">Campana visibles</button>
          <button class="btn-outline btn-sm" onclick="enrichVisibleSearchResults()">Enriquecer visibles</button>
        </div>
      </div>
    </div>`;
}

function getSearchNextBestAction(stats) {
  if (!stats.visible) {
    return { label: 'Limpiar filtros', action: 'resetAdvancedFilters();resetSearchResultsFilters()', text: 'Los filtros actuales no dejan resultados visibles.', primary: false };
  }
  if (stats.full > 0) {
    return { label: `Volcar ${stats.full} completos`, action: "setSearchDataFilterPreset(['full_contact','not_imported']);selectVisibleSearchResults(true);importSelectedSearch()", text: 'Hay empresas con direccion, email y telefono listas para pasar a Leads.', primary: true };
  }
  if (stats.email && stats.phone) {
    return { label: 'Trabajar email + telefono', action: "setSearchDataFilterPreset(['email','phone','not_imported']);selectVisibleSearchResults(true)", text: 'Hay contactos accionables aunque no todos tengan el paquete completo.', primary: true };
  }
  if (stats.needsEnrich) {
    return { label: `Enriquecer ${stats.needsEnrich} visibles`, action: 'enrichVisibleSearchResults()', text: 'La mayor mejora ahora es completar datos antes de importar.', primary: false };
  }
  return { label: 'Seleccionar visibles', action: 'selectVisibleSearchResults(true)', text: 'La vista actual esta lista para una accion masiva.', primary: false };
}

function applySavedSearchFilterView(id, builtIn = false) {
  const view = builtIn
    ? SEARCH_FILTER_VIEW_PRESETS.find(v => v.id === id)
    : getSavedSearchFilterViews().find(v => v.id === id);
  if (!view) return;
  const state = builtIn
    ? { ...getSearchFilterState(), quick: view.quick || 'all', dataFilters: view.filters || [], dataMatch: view.match || 'all', sort: view.sort || 'default', minOpportunity: view.minOpportunity }
    : { ...getSearchFilterState(), ...(view.state || {}) };
  applySearchFilterState(state);
  applyAdvancedFilters();
}

function saveCurrentSearchFilterView() {
  const name = prompt('Nombre de la vista de filtros:', 'Mi vista de scraping');
  if (!name) return;
  const views = getSavedSearchFilterViews().filter(v => v.name !== name.trim());
  views.unshift({ id: `user_${Date.now()}`, name: name.trim().slice(0, 38), state: getSearchFilterState(), createdAt: new Date().toISOString() });
  saveSearchFilterViews(views);
  renderSearchWorkflowPanel();
  showToast('Vista de filtros guardada');
}

function selectVisibleSearchResults(checked = true) {
  getVisibleSearchChecks().forEach(ch => {
    const idx = parseInt(ch.getAttribute('data-index'), 10);
    setSearchResultSelected(idx, checked, false);
    ch.checked = checked;
  });
  renderSearchWorkflowPanel();
}

function createCampaignFromVisibleSearch() {
  const entries = getVisibleSearchResultEntries().filter(({ c }) => !resultAlreadyInLeads(c));
  if (!entries.length) { showToast('No hay resultados visibles nuevos para campana'); return; }
  const segment = document.getElementById('plan-segment')?.value || 'Otros';
  const location = document.getElementById('plan-location')?.value?.trim() || 'busqueda';
  const baseName = `Vista filtrada - ${location} - ${new Date().toLocaleDateString('es-ES')}`;
  if (!confirm(`Crear campana con ${entries.length} resultados visibles nuevos?`)) return;
  createSearchSafetyPoint('before_visible_scraping_campaign');
  const newLeads = entries.map(({ c }) => buildLeadFromSearchCompany(c, c.sourceSector || segment, location, baseName));
  leads = [...newLeads, ...leads];
  const leadIds = newLeads.map(l => l.id);
  campaigns.push({
    id: Date.now(),
    name: baseName,
    segment: currentMultiSectorFilter && currentMultiSectorFilter !== 'all' ? currentMultiSectorFilter : segment,
    sequence: 'cold',
    desc: `Campana creada desde resultados visibles filtrados: ${location}.`,
    leadCount: leadIds.length,
    leadIds,
    sent: 0,
    date: new Date().toISOString(),
    active: true
  });
  saveLeads();
  localStorage.setItem('gordi_campaigns', JSON.stringify(campaigns));
  recordLeadMemoryBulk(entries.map(x => x.c), 'visible_campaign_created', c => ({ segment: c.sourceSector || segment, location, score: c.opportunityScore || 0 }));
  renderAll();
  renderDashboardCharts();
  if (typeof renderCampaigns === 'function') renderCampaigns();
  emitSearchFlow('leads:imported-from-search', {
    source: 'visible_campaign',
    location,
    sectors: [...new Set(newLeads.map(l => l.coverageSector || l.segment).filter(Boolean))],
    leadIds,
    count: leadIds.length,
  });
  showToast(`Campana visible creada: ${leadIds.length} leads`);
}

async function enrichVisibleSearchResults() {
  const entries = getVisibleSearchResultEntries()
    .filter(({ c }) => !c.email || !c.phone || !c.website || !c.decision_maker)
    .slice(0, 25);
  if (!entries.length) { showToast('Los visibles ya estan suficientemente completos'); return; }
  if (!confirm(`Enriquecer hasta ${entries.length} resultados visibles?`)) return;
  for (const { c, i } of entries) {
    if (typeof enrichSingleCard === 'function') await enrichSingleCard(i);
    else if (typeof reEnrichOne === 'function') await reEnrichOne(i);
    else break;
    decorateOpportunity(c);
  }
  applyAdvancedFilters();
  updateEnrichStats();
  showToast(`Enriquecimiento visible finalizado: ${entries.length}`);
}

function resetSearchResultsFilters() {
  currentResultFilter = 'all';
  currentUXStatusFilter = 'all';
  currentMultiSectorFilter = 'all';
  currentSearchMinOpportunity = null;
  ['search-results-text','search-results-sort'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = id === 'search-results-sort' ? 'default' : '';
  });
  const ratingEl = document.getElementById('filter-rating-min');
  const ratingVal = document.getElementById('filter-rating-val');
  const reviewsEl = document.getElementById('filter-reviews-min');
  const distEl = document.getElementById('filter-dist-max');
  const distVal = document.getElementById('filter-dist-val');
  const webEl = document.getElementById('filter-has-web');
  const leadsEl = document.getElementById('filter-no-leads');
  if (ratingEl) ratingEl.value = 0;
  if (ratingVal) ratingVal.textContent = '0';
  if (reviewsEl) reviewsEl.value = 0;
  if (distEl) distEl.value = 50;
  if (distVal) distVal.textContent = '50km';
  if (webEl) webEl.checked = false;
  if (leadsEl) leadsEl.checked = false;
  document.querySelectorAll('.search-data-filter').forEach(el => { el.checked = false; });
  const matchEl = document.getElementById('search-data-match');
  if (matchEl) matchEl.value = 'all';
  document.querySelectorAll('.rfilt:not(.ms-filt)').forEach(b => b.classList.remove('active'));
  getQuickSearchFilterButton('all')?.classList.add('active');
  applyAdvancedFilters();
}

function resetAdvancedFilters() {
  currentUXStatusFilter = 'all';
  const ratingEl = document.getElementById('filter-rating-min');
  const reviewsEl = document.getElementById('filter-reviews-min');
  const distEl   = document.getElementById('filter-dist-max');
  const distValEl = document.getElementById('filter-dist-val');
  const webEl = document.getElementById('filter-has-web');
  const leadsEl = document.getElementById('filter-no-leads');
  const valEl = document.getElementById('filter-rating-val');
  if (ratingEl) ratingEl.value = 0;
  if (reviewsEl) reviewsEl.value = 0;
  if (distEl) distEl.value = 50;
  if (distValEl) distValEl.textContent = '50km';
  if (webEl) webEl.checked = false;
  if (leadsEl) leadsEl.checked = false;
  if (valEl) valEl.textContent = '0';
  document.querySelectorAll('.search-data-filter').forEach(el => { el.checked = false; });
  const matchEl = document.getElementById('search-data-match');
  if (matchEl) matchEl.value = 'all';
  currentSearchMinOpportunity = null;
  filterResults('all', getQuickSearchFilterButton('all'));
}


function toggleAllSearch(checked) {
  getVisibleSearchChecks().forEach(ch => {
    ch.checked = checked;
    const idx = parseInt(ch.getAttribute('data-index'), 10);
    setSearchResultSelected(idx, checked, false);
  });
  renderSearchWorkflowPanel();
}

function setSearchResultSelected(idx, checked, refresh = true) {
  const c = tempSearchResults[idx];
  if (!c) return;
  c._selectedForImport = !!checked;
  document.querySelectorAll(`.search-check[data-index="${idx}"]`).forEach(ch => { ch.checked = !!checked; });
  if (refresh) renderSearchWorkflowPanel();
}

function getVisibleSearchChecks() {
  const tableView = document.getElementById('results-table-view');
  const cardsView = document.getElementById('results-cards-view');
  if (tableView && tableView.style.display !== 'none') {
    return [...document.querySelectorAll('#search-results-body .search-check')];
  }
  if (cardsView && cardsView.style.display !== 'none') {
    return [...document.querySelectorAll('#search-cards-grid .search-check')];
  }
  return [...document.querySelectorAll('.search-check')];
}

// ─── VOLCAR A LEADS ───────────────────────────────────────────────────────────
async function importSelectedSearch() {
  createSearchSafetyPoint('before_import_selected_search');
  // Safe fallbacks for segment/location (may be empty in some search modes)
  const segEl  = document.getElementById('plan-segment');
  const locEl  = document.getElementById('plan-location');
  const segment  = segEl?.value  || 'Otros';
  const location = locEl?.value?.trim() || 'búsqueda';
  const checked = getVisibleSearchChecks().filter(c => c.checked);
  const indices = [...new Set([...checked].map(c => parseInt(c.getAttribute('data-index'))))]
    .filter(i => searchResultPassesFilters(tempSearchResults[i]));

  if (!indices.length) { showToast('⚠️ Selecciona al menos una empresa'); return; }

  let imported = 0;
  let skippedDuplicates = 0;
  const importedIds = [];
  indices.forEach(i => {
    const c = tempSearchResults[i];
    if (!c) return;
    decorateOpportunity(c);
    // Skip if already in leads
    if (leads.some(l => !l.archived && isSameBusiness({ ...c, company: c.name }, l))) {
      skippedDuplicates++;
      return;
    }
    const lead = buildLeadFromSearchCompany(c, c.sourceSector || segment, location);
    lead.activity = [{ action: `Volcado desde busqueda "${location}"`, date: lead.date }];
    leads.unshift(lead);
    importedIds.push(lead.id);
    recordLeadMemory(c, 'imported_bulk', { score: c.opportunityScore || 0, location });
    imported++;
  });

  if (!imported) {
    showToast(skippedDuplicates
      ? `No se importo nada: ${skippedDuplicates} ya estaban en Leads`
      : 'No se importo nada. Revisa filtros o resultados visibles.');
    return;
  }

  saveLeads();
  renderAll();
  renderDashboardCharts();
  if (typeof renderTracking === 'function') renderTracking();
  updateStreakData();
  emitSearchFlow('leads:imported-from-search', {
    source: 'bulk',
    location,
    sectors: [...new Set(indices.map(i => tempSearchResults[i]?.sourceSector || segment).filter(Boolean))],
    leadIds: importedIds,
    count: imported,
    skippedDuplicates,
  });
  showToast(`✅ ${imported} empresas volcadas a Leads${skippedDuplicates ? ` (${skippedDuplicates} duplicadas omitidas)` : ''}`);
}

function getProspectingMinScore() {
  const value = parseInt(document.getElementById('prospecting-min-score')?.value || '55', 10);
  return Number.isFinite(value) ? value : 55;
}

function buildLeadFromSearchCompany(c, segment, location, campaignName = '') {
  decorateOpportunity(c);
  const coverageLocation = typeof normalizeCoverageLocation === 'function'
    ? normalizeCoverageLocation(location)
    : String(location || '').trim().replace(/\s+/g, ' ');
  const coverageSector = c?.sourceSector || segment;
  let coverageMission = null;
  try {
    const mission = typeof getCoverageActiveMission === 'function'
      ? getCoverageActiveMission()
      : JSON.parse(localStorage.getItem('gordi_coverage_active_mission') || 'null');
    const missionSectors = Array.isArray(mission?.sectors) ? mission.sectors : [mission?.sector].filter(Boolean);
    const sameLocation = mission && String(mission.location || '').trim().toLowerCase() === coverageLocation.toLowerCase();
    const sameSector = !missionSectors.length || missionSectors.includes(coverageSector);
    if (sameLocation && sameSector) {
      coverageMission = {
        id: mission.id,
        label: mission.label,
        location: mission.location,
        sector: coverageSector || mission.sector,
      };
    }
  } catch {}
  const signalParts = [
    c.address ? `Ubicacion: ${c.address}` : '',
    c.rating ? `Rating: ${c.rating}/5 (${c.ratingCount || 0} resenas)` : '',
    c.opportunityReasons?.length ? `Motivos: ${c.opportunityReasons.join(', ')}` : '',
    c.scrapeSignals?.length ? `Dolores web: ${c.scrapeSignals.map(s => s.label).join(', ')}` : '',
    c.description ? c.description.slice(0, 120) : '',
    c.signals?.length ? c.signals.slice(0, 6).join(' | ') : '',
    c.domainAge !== undefined ? `Dominio ${c.domainYear || 'desconocido'} (${c.domainAge} anos)` : '',
    c.incorporationYear ? `Fundada ${c.incorporationYear}` : '',
  ].filter(Boolean);
  const socials = [c.instagram, c.facebook, c.linkedin, c.twitter, c.youtube].filter(Boolean).join(' | ');
  const now = new Date().toISOString();
  const lead = {
    id: Date.now() + Math.random(),
    name: c.decision_maker?.split('(')[0]?.trim() || 'Responsable',
    company: c.name,
    email: c.email || '',
    phone: c.phone || '',
    segment,
    website: c.website || '',
    signal: signalParts.join('. ') || `Encontrado en ${location}`,
    score: calculateScore(c.decision_maker ? 'manager' : 'otros', 'mediano', signalParts.join(' '), {
      rating: c.rating, ratingCount: c.ratingCount, email: c.email, phone: c.phone,
      decision_maker: c.decision_maker, signals: c.signals || [], techStack: c.techStack || [],
      webLoadMs: c.webLoadMs || null, enrichSource: c.enrichSource || [], segment
    }),
    status: 'Pendiente',
    date: now,
    status_date: now,
    notes: [
      campaignName ? `Campana scraping: ${campaignName}` : '',
      `Angulo: ${c.opportunityAngle || 'contacto consultivo'}`,
      `Calidad contacto: ${c.contactQuality || 'pendiente'} (${c.contactQualityScore || 0}/100)`,
      `Por que aparece: ${(c.resultExplanation || []).map(x => `${x.label}: ${x.value}`).join(' | ') || '-'}`,
      `Redes: ${socials || '-'}`,
      `Emails adicionales: ${c.emails?.join(', ') || '-'}`,
    ].filter(Boolean).join('\n'),
    activity: [{ action: `Creado por modo campana de scraping en "${location}"`, date: now }],
    source: 'search',
    rating: c.rating || null,
    ratingCount: c.ratingCount || 0,
    placeId: c.placeId || '',
    address: c.address || '',
    lat: c.lat ?? null,
    lng: c.lng ?? null,
    description: c.description || '',
    decision_maker: c.decision_maker || '',
    instagram: c.instagram || '',
    facebook: c.facebook || '',
    linkedin: c.linkedin || '',
    twitter: c.twitter || '',
    youtube: c.youtube || '',
    domainAge: c.domainAge,
    domainYear: c.domainYear,
    incorporationYear: c.incorporationYear,
    legalStatus: c.legalStatus || '',
    logo: c.logo || '',
    signals: c.signals || [],
    scrapeSignals: c.scrapeSignals || [],
    techStack: c.techStack || [],
    webLoadMs: c.webLoadMs || null,
    hasSitemap: c.hasSitemap || false,
    enrichSource: c.enrichSource || [],
    reviewSummary: c.reviewSummary || '',
    reviewPain: c.reviewPain || [],
    competitorBetter: c.competitorBetter || null,
    distKm: c.distKm || null,
    sslValid: c.sslValid,
    optimalContact: c.optimalContact || null,
    fachadaAnalysis: c.fachadaAnalysis || '',
    opportunityScore: c.opportunityScore || 0,
    opportunityAngle: c.opportunityAngle || '',
    tags: [...new Set([...(campaignName ? ['campana-scraping'] : []), ...(coverageLocation && coverageSector ? ['cobertura'] : [])])],
    coverageLocation,
    coverageSector,
    coverageMission,
    coverageMissionId: coverageMission?.id || '',
    coverageMissionLabel: coverageMission?.label || '',
    budget: 0,
    next_contact: ''
  };
  return lead;
}

function createProspectingCampaignFromSearch() {
  if (!Array.isArray(tempSearchResults) || !tempSearchResults.length) {
    showToast('No hay resultados scrapeados para crear campana');
    return;
  }
  const segment = document.getElementById('plan-segment')?.value || 'Otros';
  const location = document.getElementById('plan-location')?.value?.trim() || 'busqueda';
  const minScore = getProspectingMinScore();
  const baseName = document.getElementById('prospecting-campaign-name')?.value?.trim()
    || `${segment} - ${location} - ${new Date().toLocaleDateString('es-ES')}`;
  decorateAllOpportunities();
  const candidates = tempSearchResults
    .filter(c => currentMultiSectorFilter === 'all' || !currentMultiSectorFilter || (c.matchedSectors || [c.sourceSector || c.segment]).includes(currentMultiSectorFilter))
    .filter(c => (c.opportunityScore || 0) >= minScore)
    .filter(c => !leads.some(l => !l.archived && isSameBusiness({ ...c, company: c.name }, l)))
    .sort((a, b) => getLayerPriority(b) - getLayerPriority(a))
    .slice(0, 40);

  if (!candidates.length) {
    showToast(`No hay leads nuevos con score minimo ${minScore}`);
    return;
  }
  if (!confirm(`Crear campana con ${candidates.length} leads nuevos?\nFiltro: score scraping >= ${minScore}\n\nSe guardaran en Leads y se creara una campana lista para trabajar.`)) return;
  createSearchSafetyPoint('before_scraping_campaign');

  const campaignSegment = multiSectorSearchState
    ? (currentMultiSectorFilter && currentMultiSectorFilter !== 'all' ? currentMultiSectorFilter : 'Todos')
    : segment;
  const newLeads = candidates.map(c => buildLeadFromSearchCompany(c, c.sourceSector || campaignSegment || segment, location, baseName));
  leads = [...newLeads, ...leads];
  const leadIds = newLeads.map(l => l.id);
  campaigns.push({
    id: Date.now(),
    name: baseName,
    segment: campaignSegment,
    sequence: 'cold',
    desc: `Campana creada desde scraping: ${location}. Score minimo ${minScore}. Angulos: ${[...new Set(candidates.map(c => c.opportunityAngle).filter(Boolean))].slice(0, 4).join(', ') || 'contacto consultivo'}.`,
    leadCount: leadIds.length,
    leadIds,
    sent: 0,
    date: new Date().toISOString(),
    active: true
  });
  saveLeads();
  localStorage.setItem('gordi_campaigns', JSON.stringify(campaigns));
  recordLeadMemoryBulk(candidates, 'campaign_created', c => ({ segment, location, score: c.opportunityScore || 0 }));
  renderAll();
  renderDashboardCharts();
  if (typeof renderCampaigns === 'function') renderCampaigns();
  updateStreakData();
  emitSearchFlow('leads:imported-from-search', {
    source: 'campaign',
    location,
    sectors: [...new Set(newLeads.map(l => l.coverageSector || l.segment).filter(Boolean))],
    leadIds,
    count: leadIds.length,
  });
  showToast(`Campana creada: ${leadIds.length} leads`);
}

function quickImportOne(idx) {
  try {
    createSearchSafetyPoint('before_quick_import');
    const c = tempSearchResults[idx];
    if (!c) { showToast('No se encontro este resultado. Recarga la busqueda.'); return; }
    decorateOpportunity(c);
    if (leads.some(l => !l.archived && isSameBusiness({ ...c, company: c.name }, l))) {
      showToast(`${c.name} ya esta en Leads`);
      return;
    }
    const segment = c.sourceSector || document.getElementById('plan-segment')?.value || 'Otros';
    const location = document.getElementById('plan-location')?.value?.trim() || 'busqueda';
    const lead = buildLeadFromSearchCompany(c, segment, location);
    lead.activity = [{ action: `Lead importado desde busqueda en ${location}`, date: lead.date }];
    leads.unshift(lead);
    recordLeadMemory(c, 'imported_quick', { score: c.opportunityScore || 0, location });
    saveLeads();
    renderAll();
    renderDashboardCharts();
    if (typeof renderTracking === 'function') renderTracking();
    updateStats();
    updateStreakData();
    emitSearchFlow('leads:imported-from-search', {
      source: 'quick',
      location,
      sectors: [segment].filter(Boolean),
      leadIds: [lead.id],
      count: 1,
    });
    showToast(`OK: ${c.name} anadida a Leads`);
  } catch (err) {
    console.error('Error al volcar resultado a Leads:', err);
    showToast(`No se pudo volcar a Leads: ${err?.message || 'error desconocido'}`);
  }
}


function exportSearchCSV() {
  if (!tempSearchResults.length) { showToast('No hay resultados que exportar'); return; }
  const visibleEntries = getVisibleSearchResultEntries();
  if (!visibleEntries.length) { showToast('No hay resultados visibles para exportar. Revisa los filtros.'); return; }

  const headers = [
    'Empresa','Dirección','Rating','Reseñas','Email','Teléfono','Web',
    'Decisor','LinkedIn','Instagram','Facebook','Twitter','WhatsApp',
    'Descripción','Señales','Fuentes','TechStack','CMS',
    'Año dominio','Edad dominio','Año fundación','Estado legal',
    'Velocidad web (ms)','Emails adicionales','Teléfonos adicionales',
    'Calidad contacto','Score contacto','Tipo email','Query origen','Plan busqueda','Por que aparece'
  ];

  const rows = visibleEntries.map(({ c }) => {
    decorateOpportunity(c);
    return [
    c.name || '',
    c.address || '',
    c.rating || '',
    c.ratingCount || '',
    c.email || '',
    c.phone || '',
    c.website || '',
    c.decision_maker || '',
    c.linkedin || '',
    c.instagram || '',
    c.facebook || '',
    c.twitter || '',
    c.whatsapp || '',
    (c.description || '').replace(/"/g, '""').slice(0, 200),
    (c.signals || []).join(' | ').replace(/"/g, '""'),
    (c.enrichSource || []).join(', '),
    (c.techStack || []).join(', '),
    (c.techStack || []).find(t => /WordPress|Wix|Shopify|Squarespace|Webflow|PrestaShop|Joomla/i.test(t)) || '',
    c.domainYear || '',
    c.domainAge !== undefined ? c.domainAge + ' años' : '',
    c.incorporationYear || '',
    c.legalStatus || '',
    c.webLoadMs || '',
    (c.emails || []).slice(1).join(' | '),
    (c.phones || []).slice(1).join(' | '),
    c.contactQuality || '',
    c.contactQualityScore || '',
    c.contactEmailRole || '',
    c.querySource || '',
    c.searchPlanSummary || '',
    (c.resultExplanation || []).map(x => `${x.label}: ${x.value}`).join(' | ').replace(/"/g, '""'),
  ];
  });

  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  // BOM para que Excel en Windows abra correctamente con tildes
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `voltflow_${document.getElementById('plan-segment').value}_${document.getElementById('plan-location').value}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`CSV exportado: ${visibleEntries.length} empresas visibles con ${headers.length} columnas ✓`);
}



// --------------------------------------------------------------------------
// ██  MÓDULO: UTILS
// ──  Utilidades generales (sleep, formateo, validación, helpers)
// ──  Funciones: sleep, stripHtml, extractDomain, isValidEmail, formatPhone, normalizeText,
  //          scoreEmail, buildSignalCorrelation, applyContactWindow
// --------------------------------------------------------------------------

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ GOOGLE MAPS LOADER ============
function loadGoogleMapsScript(apiKey) {
  if (document.getElementById('google-maps-script')) return;
  const script = document.createElement('script');
  script.id = 'google-maps-script';
  script.textContent = `(g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]);for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src="https://maps.googleapis.com/maps/api/js?"+e.toString();d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once."):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({key:"${apiKey}",v:"weekly"});`;
  document.head.appendChild(script);
}



// --------------------------------------------------------------------------
// ██  MÓDULO: SEGMENT QUERIES
// ──  segmentQueries y getSegmentQueries están definidas en email-templates.js
// ──  (cargado antes que este módulo) — no redeclarar aquí.
// --------------------------------------------------------------------------

// ── Parche: añadir sectores extendidos a getSegmentQueries ───────────────
// Extiende la función original de email-templates.js sin modificar ese archivo.
// Sectores añadidos: Residencias, Dental, Medico, Estetico, Deportivo
(function patchExtendedSegmentQueries() {
  const _originalGetSegmentQueries = (typeof getSegmentQueries === 'function')
    ? getSegmentQueries
    : null;

  // ── Mapa de queries por sector ────────────────────────────────────────────
  // Cada array combina términos generales + específicos para maximizar cobertura
  // en Google Places API (textQuery). Orden: más probable -> menos probable.
  const EXTENDED_QUERIES = {

    // ── Residencias de Ancianos ────────────────────────────────────────────
    'Residencias': [
      'residencia de ancianos',
      'residencia de mayores',
      'centro de mayores',
      'centro geriátrico',
      'geriátrico',
      'residencia tercera edad',
      'centro día mayores',
    ],

    // ── Clínicas Dentales ─────────────────────────────────────────────────
    // Captura desde clínicas premium hasta dentistas de barrio y ortodoncias
    'Dental': [
      'clínica dental',
      'dentista',
      'clínica odontológica',
      'odontólogo',
      'ortodoncia',
      'implantes dentales clínica',
      'clínica de odontología',
      'dental clínica',
      'clínica estomatológica',
      'estomatólogo',
      'ortopedia dental',
      'clínica dental infantil',
    ],

    // ── Centros Médicos ───────────────────────────────────────────────────
    // Captura clínicas generales, policlínicas, especialidades y centros privados
    'Medico': [
      'centro médico',
      'clínica médica',
      'policlínica',
      'clínica privada',
      'consulta médica',
      'médico especialista',
      'centro de salud privado',
      'clínica especialidades médicas',
      'clínica traumatología',
      'clínica dermatología',
      'clínica ginecología',
      'clínica oftalmología',
      'clínica psicología',
      'clínica fisioterapia',
      'unidad médica',
    ],

    // ── Centros Estéticos ─────────────────────────────────────────────────
    // Captura centros de belleza, medicina estética, peluquerías premium y spas
    'Estetico': [
      'centro estético',
      'clínica de estética',
      'medicina estética',
      'centro de belleza',
      'spa',
      'salón de belleza',
      'peluquería y estética',
      'micropigmentación',
      'depilación láser centro',
      'tratamientos faciales centro',
      'centro estetica corporal',
      'instituto de belleza',
      'centro de depilación',
      'clínica estética corporal',
    ],

    // ── Centros Deportivos ────────────────────────────────────────────────
    // Captura gimnasios, clubs deportivos, centros de fitness y piscinas
    'Deportivo': [
      'gimnasio',
      'centro deportivo',
      'club deportivo',
      'polideportivo',
      'fitness center',
      'centro de fitness',
      'piscina municipal',
      'pádel club',
      'club de tenis',
      'yoga studio',
      'pilates centro',
      'crossfit box',
      'box fitness',
      'academia de artes marciales',
      'club de natación',
      'instalaciones deportivas',
    ],
  };

  window.getSegmentQueries = function(segment) {
    // Buscar primero en el mapa extendido
    if (EXTENDED_QUERIES[segment]) {
      return EXTENDED_QUERIES[segment];
    }
    // Delegar al original para el resto de segmentos (Industrial, Retail, Oficinas, etc.)
    if (_originalGetSegmentQueries) return _originalGetSegmentQueries(segment);
    return [segment]; // fallback de seguridad
  };
})();


// ── MEJORA: Panel Lateral de Vista Rápida (Side Panel) ──────────────────────
function openQuickView(lead, index) {
  let panel = document.getElementById('gordi-side-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'gordi-side-panel';
    panel.style = `
      position:fixed; top:0; right:-450px; width:450px; height:100%;
      background:var(--bg-card); border-left:1px solid var(--glass-border);
      box-shadow:-10px 0 30px rgba(0,0,0,0.3); z-index:9000;
      transition:right 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      display:flex; flex-direction:column; overflow:hidden; backdrop-filter:blur(15px);
    `;
    document.body.appendChild(panel);
  }

  const socials = [
    lead.instagram ? `<a href="${lead.instagram}" target="_blank">📸 IG</a>` : '',
    lead.facebook ? `<a href="${lead.facebook}" target="_blank">📘 FB</a>` : '',
    lead.linkedin ? `<a href="${lead.linkedin}" target="_blank">💼 LI</a>` : '',
  ].filter(Boolean).join(' · ');

  panel.innerHTML = `
    <div style="padding:25px; border-bottom:1px solid var(--glass-border); background:linear-gradient(to bottom right, rgba(255,255,255,0.05), transparent)">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:15px">
        <button onclick="closeQuickView()" style="background:none; border:none; color:var(--text-dim); font-size:20px; cursor:pointer">✕</button>
        <div style="display:flex; gap:10px">
          <button class="btn-action" onclick="quickImportOne(${index}); closeQuickView()">📥 Importar</button>
          <button class="btn-action" onclick="showMicroAudit(${index})">📋 Auditoría</button>
        </div>
      </div>
      <h2 style="margin:0; font-size:22px; color:var(--text)">${lead.name}</h2>
      <div style="color:var(--primary); font-weight:600; font-size:14px; margin-top:5px">${lead.category || 'Empresa'}</div>
    </div>
    
    <div style="flex:1; overflow-y:auto; padding:25px">
      <div style="display:grid; gap:20px">
        <section>
          <h3 style="font-size:12px; text-transform:uppercase; color:var(--text-dim); margin-bottom:10px">Información de Contacto</h3>
          <div style="background:rgba(255,255,255,0.03); padding:15px; border-radius:12px; border:1px solid rgba(255,255,255,0.05)">
            <div style="margin-bottom:8px">✉️ <a href="mailto:${lead.email}" style="color:var(--text)">${lead.email || 'No disponible'}</a></div>
            <div style="margin-bottom:8px">📞 ${lead.phone || 'No disponible'}</div>
            <div style="margin-bottom:8px">🌐 <a href="${lead.website}" target="_blank" style="color:var(--text)">${lead.website || 'No disponible'}</a></div>
            <div style="margin-top:10px; padding-top:10px; border-top:1px solid rgba(255,255,255,0.05)">${socials || 'Sin redes detectadas'}</div>
          </div>
        </section>

        <section>
          <h3 style="font-size:12px; text-transform:uppercase; color:var(--text-dim); margin-bottom:10px">Análisis de Oportunidad</h3>
          <div style="display:flex; gap:10px; margin-bottom:15px">
             <div style="flex:1; text-align:center; padding:10px; background:rgba(255,255,255,0.03); border-radius:10px">
                <div style="font-size:18px; font-weight:bold">${lead.rating || '—'}</div>
                <div style="font-size:10px; color:var(--text-dim)">RATING</div>
             </div>
             <div style="flex:1; text-align:center; padding:10px; background:rgba(255,255,255,0.03); border-radius:10px">
                <div style="font-size:18px; font-weight:bold">${lead.ratingCount || '0'}</div>
                <div style="font-size:10px; color:var(--text-dim)">RESEÑAS</div>
             </div>
          </div>
          <div style="background:rgba(255,255,255,0.03); padding:15px; border-radius:12px; border:1px solid rgba(255,255,255,0.05)">
            <p style="margin:0; font-size:13px; line-height:1.5; color:var(--text-dim)">${lead.description || 'Sin descripción disponible.'}</p>
          </div>
        </section>

        <section>
          <h3 style="font-size:12px; text-transform:uppercase; color:var(--text-dim); margin-bottom:10px">Señales de Ventas</h3>
          <div style="display:flex; flex-wrap:wrap; gap:8px">
            ${(lead.signals || []).map(s => `<span style="font-size:11px; background:rgba(10, 132, 255, 0.1); color:var(--primary); padding:4px 10px; border-radius:20px; border:1px solid rgba(10, 132, 255, 0.2)">${s}</span>`).join('')}
            ${(lead.techStack || []).slice(0,5).map(t => `<span style="font-size:11px; background:rgba(255,255,255,0.05); color:var(--text-dim); padding:4px 10px; border-radius:20px">${t}</span>`).join('')}
          </div>
        </section>
      </div>
    </div>

    <div style="padding:20px; border-top:1px solid var(--glass-border); display:flex; gap:10px">
       <button class="btn-primary" style="flex:1" onclick="quickImportOne(${index}); closeQuickView()">Añadir a mi Pipeline</button>
       <button class="btn-outline" onclick="findSimilarLeads(${index})">🔍 Similares</button>
    </div>
  `;

  setTimeout(() => panel.style.right = '0', 10);
}

function closeQuickView() {
  const panel = document.getElementById('gordi-side-panel');
  if (panel) panel.style.right = '-450px';
}

// ── MEJORA: Filtros Inteligentes de Un Clic ──────────────────────────────
function injectQuickFilters() {
  const container = document.querySelector('.search-results-header');
  if (!container || document.getElementById('gordi-quick-filters')) return;

  const filters = document.createElement('div');
  filters.id = 'gordi-quick-filters';
  filters.style = "display:flex; gap:10px; margin:15px 0; overflow-x:auto; padding-bottom:5px; scrollbar-width:none";
  filters.innerHTML = `
    <button class="btn-outline btn-sm q-filt" onclick="applyQuickFilter('hot')" style="border-radius:20px; white-space:nowrap">🔥 Muy Caliente</button>
    <button class="btn-outline btn-sm q-filt" onclick="applyQuickFilter('old')" style="border-radius:20px; white-space:nowrap">🦖 Web Obsoleta</button>
    <button class="btn-outline btn-sm q-filt" onclick="applyQuickFilter('low_rating')" style="border-radius:20px; white-space:nowrap">⭐ Rating Bajo</button>
    <button class="btn-outline btn-sm q-filt" onclick="applyQuickFilter('no_web')" style="border-radius:20px; white-space:nowrap">🌐 Sin Web</button>
    <button class="btn-outline btn-sm q-filt" onclick="applyQuickFilter('all')" style="border-radius:20px; white-space:nowrap; background:var(--glass)">Todos</button>
  `;
  container.after(filters);
}

function applyQuickFilter(type) {
  // Reset de filtros avanzados primero
  resetAdvancedFilters();
  
  const ratingEl = document.getElementById('filter-rating-min');
  const webEl = document.getElementById('filter-has-web');
  const srTextEl = document.getElementById('search-results-text');

  if (type === 'hot') {
    ratingEl.value = 4;
  } else if (type === 'old') {
    srTextEl.value = 'obsoleta';
  } else if (type === 'low_rating') {
    // Para rating bajo, usamos el filtro de texto o invertimos la lógica (custom)
    // Aquí simplificamos usando una señal específica
    srTextEl.value = 'rating bajo';
  } else if (type === 'no_web') {
    // Este requeriría un filtro "Does NOT have web" que no existe, lo simulamos
    // Pero para no romper, usamos un trigger que applyAdvancedFilters entienda
  }

  // Estética de botones
  document.querySelectorAll('.q-filt').forEach(b => b.style.background = 'none');
  event.target.style.background = 'var(--glass)';

  applyAdvancedFilters();
}

// ── MEJORA: Sugerencias de Búsqueda Predictiva ──────────────────────────
const GORDI_SUGGESTIONS = [
  'Clinica Dental', 'Reforma Viviendas', 'Gimnasio Crossfit', 
  'Residencia Mayores', 'Centro Estética', 'Abogados Laborales',
  'Taller Mecánico', 'Restaurante con Terraza', 'Escuela Infantil'
];

function initPredictiveSearch() {
  const input = document.getElementById('search-input');
  if (!input) return;

  const datalist = document.createElement('datalist');
  datalist.id = 'gordi-search-suggestions';
  GORDI_SUGGESTIONS.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    datalist.appendChild(opt);
  });
  document.body.appendChild(datalist);
  input.setAttribute('list', 'gordi-search-suggestions');
}

// Inyectar al cargar
setTimeout(() => {
  injectQuickFilters();
  initPredictiveSearch();
}, 2000);

// ─── MEJORAS DE USABILIDAD (Side Panel, Temperature, Audit) ──────────────────

function calculateLeadTemperature(c) {
  let score = 0;
  if (c.email) score += 30;
  if (c.phone) score += 10;
  if (c.decision_maker) score += 20;
  if (c.rating && c.rating < 4) score += 15; // Oportunidad de mejora
  if (c.ratingCount && c.ratingCount > 50) score += 10; // Empresa establecida
  if (c.signals && c.signals.length > 0) score += 15;

  if (score >= 70) return { label: 'Hirviendo', icon: '🔥', color: '#ff4d4d', desc: 'Lead de alta prioridad con múltiples señales de cierre.' };
  if (score >= 40) return { label: 'Templado', icon: '⛅', color: '#ffa500', desc: 'Lead interesado con datos de contacto verificados.' };
  return { label: 'Gélido', icon: '❄️', color: '#00ccff', desc: 'Lead frío, requiere más investigación o primer contacto.' };
}

function openSidePanelLegacy(idx) {
  const c = tempSearchResults[idx];
  if (!c) return;

  let panel = document.getElementById('search-side-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'search-side-panel';
    panel.className = 'glass-panel';
    panel.style = "position:fixed;top:0;right:-450px;width:450px;height:100%;z-index:2000;background:rgba(15,15,20,0.95);backdrop-filter:blur(20px);border-left:1px solid var(--glass-border);box-shadow:-10px 0 30px rgba(0,0,0,0.5);transition:right 0.4s cubic-bezier(0.16, 1, 0.3, 1);padding:2rem;overflow-y:auto";
    document.body.appendChild(panel);
  }

  const temp = calculateLeadTemperature(c);
  const initials = (c.name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2rem">
      <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted)">Ficha del Lead</div>
      <button onclick="closeSidePanel()" style="background:none;border:none;color:var(--text);cursor:pointer;font-size:1.5rem">×</button>
    </div>

    <div style="display:flex;gap:1.5rem;align-items:center;margin-bottom:2rem">
      <div class="sc-avatar" style="width:80px;height:80px;font-size:1.5rem">
        ${c.logo ? `<img src="${c.logo}" onerror="this.parentElement.innerHTML='${initials}'">` : initials}
      </div>
      <div>
        <h2 style="margin:0;font-size:1.4rem">${c.name}</h2>
        <div style="display:flex;gap:0.5rem;margin-top:0.5rem">
           <span style="background:${temp.color}22;color:${temp.color};padding:2px 10px;border-radius:12px;font-size:0.75rem;border:1px solid ${temp.color}44">${temp.icon} ${temp.label}</span>
           ${c.rating ? `<span style="background:rgba(255,215,0,0.1);color:#ffd700;padding:2px 10px;border-radius:12px;font-size:0.75rem;border:1px solid rgba(255,215,0,0.3)">⭐ ${c.rating}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="panel-section" style="margin-bottom:2rem">
      <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.5rem">Descripción</div>
      <div style="font-size:0.9rem;line-height:1.6">${c.description || 'Sin descripción detallada.'}</div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:2rem">
      <div class="info-box" style="background:rgba(255,255,255,0.03);padding:1rem;border-radius:12px;border:1px solid var(--glass-border)">
        <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.3rem">Email</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:.5rem">
          <div style="font-size:0.85rem;word-break:break-all">${c.email || '—'}</div>
          ${c.email ? `<button onclick="copyToClipboard('${c.email}', 'Email: ${c.email}')" title="Copiar email" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:.9rem;padding:2px">⧉</button>` : ''}
        </div>
      </div>
      <div class="info-box" style="background:rgba(255,255,255,0.03);padding:1rem;border-radius:12px;border:1px solid var(--glass-border)">
        <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.3rem">Teléfono</div>
        <div style="font-size:0.85rem">${c.phone || '—'}</div>
      </div>
      <div class="info-box" style="background:rgba(255,255,255,0.03);padding:1rem;border-radius:12px;border:1px solid var(--glass-border)">
        <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.3rem">Web</div>
        <div style="font-size:0.85rem">${c.website ? `<a href="${c.website}" target="_blank" style="color:var(--primary)">${c.website.replace(/^https?:\/\/(www\.)?/,'').split('/')[0]}</a>` : '—'}</div>
      </div>
      <div class="info-box" style="background:rgba(255,255,255,0.03);padding:1rem;border-radius:12px;border:1px solid var(--glass-border)">
        <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:0.3rem">Decisor</div>
        <div style="font-size:0.85rem">${c.decision_maker || '—'}</div>
      </div>
    </div>

    <div style="margin-top:auto;display:flex;flex-direction:column;gap:0.75rem">
      <button class="btn-action" style="width:100%;padding:1rem" onclick="quickImportOne(${idx})">Volcar al CRM</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem">
        <button class="btn-action secondary" onclick="showMicroAudit(${idx})">📋 Auditoría</button>
        <button class="btn-action secondary" onclick="findSimilarLeads(${idx})">🔍 Similares</button>
      </div>
    </div>
  `;

  panel.style.right = '0';
}

function closeSidePanel() {
  const panel = document.getElementById('search-side-panel');
  if (panel) panel.style.right = '-450px';
}

function openSidePanel(idx) {
  const c = tempSearchResults[idx];
  if (!c) return;

  let panel = document.getElementById('search-side-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'search-side-panel';
    panel.className = 'glass-panel';
    panel.style = 'position:fixed;top:0;right:-470px;width:min(470px,96vw);height:100%;z-index:2000;background:rgba(15,15,20,0.96);backdrop-filter:blur(20px);border-left:1px solid var(--glass-border);box-shadow:-10px 0 30px rgba(0,0,0,0.5);transition:right 0.28s ease;padding:1.35rem;overflow-y:auto';
    document.body.appendChild(panel);
  }

  const temp = calculateLeadTemperature(c);
  const initials = (c.name || '?').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
  const uxStatus = getLeadUXStatus(c);
  const trust = getDataTrust(c);
  const angle = c.opportunityAngle || getAngleRecommendation(c);
  const whyRows = (c.resultExplanation || buildResultExplanation(c)).map(x => `
    <div style="display:flex;justify-content:space-between;gap:.75rem;padding:.55rem .65rem;border:1px solid var(--glass-border);border-radius:9px;background:rgba(255,255,255,.025)">
      <span style="font-size:.74rem;color:${x.ok ? 'var(--text-muted)' : 'var(--danger)'}">${x.label}</span>
      <strong style="font-size:.74rem;text-align:right;word-break:break-word;color:${x.ok ? 'var(--text)' : 'var(--danger)'}">${x.value}</strong>
    </div>`).join('');
  const trustRows = trust.length ? trust.map(t => `
    <div style="padding:.7rem .8rem;border:1px solid var(--glass-border);border-radius:10px;background:rgba(255,255,255,.03)">
      <div style="display:flex;justify-content:space-between;gap:.75rem;align-items:center">
        <strong style="font-size:.78rem">${t.label}</strong>
        <span style="font-size:.68rem;color:${t.confidence >= 80 ? 'var(--success)' : t.confidence >= 60 ? 'var(--warning)' : 'var(--danger)'}">${Math.round(t.confidence)}%</span>
      </div>
      <div style="font-size:.75rem;color:var(--text);margin-top:.25rem;word-break:break-word">${t.value}</div>
      <div style="font-size:.68rem;color:var(--text-dim);margin-top:.2rem">${t.source}</div>
    </div>`).join('') : '<div style="font-size:.78rem;color:var(--text-muted)">Aun no hay suficientes datos verificados.</div>';

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1.1rem">
      <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted)">Ficha ejecutiva</div>
      <button onclick="closeSidePanel()" style="background:none;border:none;color:var(--text);cursor:pointer;font-size:1.4rem">x</button>
    </div>
    <div style="display:flex;gap:1rem;align-items:center;margin-bottom:1rem">
      <div class="sc-avatar" style="width:72px;height:72px;font-size:1.25rem">${c.logo ? `<img src="${c.logo}" onerror="this.parentElement.innerHTML='${initials}'">` : initials}</div>
      <div style="min-width:0">
        <h2 style="margin:0;font-size:1.25rem;line-height:1.2">${c.name}</h2>
        <div style="display:flex;gap:.35rem;margin-top:.5rem;flex-wrap:wrap">
          <span style="background:rgba(255,255,255,.05);color:${uxStatus.color};padding:2px 9px;border-radius:12px;font-size:.72rem;border:1px solid ${uxStatus.color}44">${uxStatus.label}</span>
          <span style="background:${temp.color}22;color:${temp.color};padding:2px 9px;border-radius:12px;font-size:.72rem;border:1px solid ${temp.color}44">${temp.icon} ${temp.label}</span>
          ${c.rating ? `<span style="background:rgba(255,215,0,.10);color:#ffd700;padding:2px 9px;border-radius:12px;font-size:.72rem;border:1px solid rgba(255,215,0,.25)">${c.rating} estrellas</span>` : ''}
        </div>
      </div>
    </div>
    <div style="padding:1rem;border:1px solid rgba(16,217,124,.22);border-radius:12px;background:rgba(16,217,124,.055);margin-bottom:1rem">
      <div style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Proxima accion</div>
      <div style="font-weight:800;margin-top:.2rem">${uxStatus.action}</div>
      <div style="font-size:.82rem;color:var(--text-muted);line-height:1.45;margin-top:.4rem">${angle}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1rem">
      <div style="background:rgba(255,255,255,.03);padding:.85rem;border-radius:10px;border:1px solid var(--glass-border)">
        <div style="font-size:.68rem;color:var(--text-muted);margin-bottom:.25rem">Email</div>
        <div style="font-size:.8rem;word-break:break-word">${c.email || '-'}</div>
      </div>
      <div style="background:rgba(255,255,255,.03);padding:.85rem;border-radius:10px;border:1px solid var(--glass-border)">
        <div style="font-size:.68rem;color:var(--text-muted);margin-bottom:.25rem">Telefono</div>
        <div style="font-size:.8rem">${c.phone || '-'}</div>
      </div>
      <div style="background:rgba(255,255,255,.03);padding:.85rem;border-radius:10px;border:1px solid var(--glass-border)">
        <div style="font-size:.68rem;color:var(--text-muted);margin-bottom:.25rem">Web</div>
        <div style="font-size:.8rem">${c.website ? `<a href="${c.website}" target="_blank" style="color:var(--primary)">${c.website.replace(/^https?:\/\/(www\.)?/,'').split('/')[0]}</a>` : '-'}</div>
      </div>
      <div style="background:rgba(255,255,255,.03);padding:.85rem;border-radius:10px;border:1px solid var(--glass-border)">
        <div style="font-size:.68rem;color:var(--text-muted);margin-bottom:.25rem">Decisor</div>
        <div style="font-size:.8rem">${c.decision_maker || '-'}</div>
      </div>
    </div>
    <div style="margin-bottom:1rem">
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem">Confianza del dato</div>
      <div style="display:grid;gap:.5rem">${trustRows}</div>
    </div>
    <div style="margin-bottom:1rem">
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.5rem">Por que aparece este resultado</div>
      <div style="display:grid;gap:.4rem">${whyRows || '<div style="font-size:.78rem;color:var(--text-muted)">Sin senales auditables todavia.</div>'}</div>
    </div>
    <div style="margin-bottom:1.15rem">
      <div style="font-size:.78rem;color:var(--text-muted);margin-bottom:.45rem">Resumen</div>
      <div style="font-size:.84rem;line-height:1.55;color:var(--text-muted)">${c.description || 'Sin descripcion detallada.'}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:.7rem">
      <button class="btn-action" style="width:100%;padding:.9rem" onclick="quickImportOne(${idx})">Volcar al CRM</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.7rem">
        <button class="btn-action secondary" onclick="showMicroAudit(${idx})">Auditoria</button>
        <button class="btn-action secondary" onclick="findSimilarLeads(${idx})">Similares</button>
      </div>
    </div>`;

  panel.style.right = '0';
}

function showMicroAudit(idx) {
  const c = tempSearchResults[idx];
  if (!c) return;
  
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.style = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.8);backdrop-filter:blur(8px);z-index:3000;display:flex;align-items:center;justify-content:center;padding:2rem";
  
  const content = document.createElement('div');
  content.className = 'glass-card';
  content.style = "max-width:600px;width:100%;padding:2.5rem;position:relative;max-height:90vh;overflow-y:auto";
  
  const temp = calculateLeadTemperature(c);
  
  content.innerHTML = `
    <button onclick="this.closest('.modal-overlay').remove()" style="position:absolute;top:1.5rem;right:1.5rem;background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:1.2rem">×</button>
    <div style="text-align:center;margin-bottom:2rem">
      <div style="font-size:0.7rem;text-transform:uppercase;letter-spacing:0.2em;color:var(--primary);margin-bottom:0.5rem">Micro-Auditoría de Lead</div>
      <h2 style="margin:0">${c.name}</h2>
    </div>

    <div style="display:grid;gap:1.5rem">
      <div class="audit-item">
        <div style="display:flex;justify-content:space-between;margin-bottom:0.5rem">
          <span>Temperatura Comercial</span>
          <strong style="color:${temp.color}">${temp.label}</strong>
        </div>
        <div style="height:6px;background:rgba(255,255,255,0.1);border-radius:3px">
          <div style="width:${temp.label==='Hirviendo'?'100%':temp.label==='Templado'?'60%':'30%'};height:100%;background:${temp.color};border-radius:3px"></div>
        </div>
      </div>

      <div style="background:rgba(255,255,255,0.03);padding:1.5rem;border-radius:15px;border:1px solid var(--glass-border)">
        <h4 style="margin:0 0 1rem 0">Puntos Fuertes</h4>
        <ul style="margin:0;padding-left:1.2rem;font-size:0.85rem;line-height:1.8;color:var(--text-muted)">
          ${c.email ? '<li>Email verificado y listo para outreach</li>' : ''}
          ${c.phone ? '<li>Teléfono de contacto directo disponible</li>' : ''}
          ${c.decision_maker ? '<li>Persona de decisión identificada</li>' : ''}
          ${c.rating && c.rating > 4.5 ? '<li>Reputación excelente en el mercado</li>' : ''}
          ${c.signals?.length ? c.signals.map(s => `<li>Señal detectada: ${s}</li>`).join('') : '<li>Empresa establecida en la zona</li>'}
        </ul>
      </div>

      <div style="background:rgba(245,158,11,0.05);padding:1.5rem;border-radius:15px;border:1px solid rgba(245,158,11,0.2)">
        <h4 style="margin:0 0 1rem 0;color:var(--warning)">Ángulo de Venta Recomendado</h4>
        <p style="margin:0;font-size:0.85rem;line-height:1.6">${getAngleRecommendation(c)}</p>
      </div>
    </div>

    <button class="btn-action" style="width:100%;margin-top:2rem" onclick="quickImportOne(${idx});this.closest('.modal-overlay').remove()">Importar y Generar Email</button>
  `;
  
  modal.appendChild(content);
  document.body.appendChild(modal);
}

function getAngleRecommendation(c) {
  if (c.rating && c.rating < 3.5) return "Tienen una puntuación baja. El ángulo ideal es ofrecerles una mejora estética o de infraestructura que mejore la experiencia percibida de sus clientes.";
  if (c.signals?.some(s => s.toLowerCase().includes('apertura'))) return "Señal de local nuevo. El ángulo es ofrecer servicios de mantenimiento preventivo y puesta a punto de instalaciones para asegurar que el arranque sea perfecto.";
  if (c.decision_maker) return `Contacto directo con ${c.decision_maker.split('(')[0]}. El ángulo debe ser profesional y centrado en la eficiencia operativa y ahorro energético de sus instalaciones.`;
  return "Empresa consolidada. El ángulo es la modernización de sistemas eléctricos para mejorar la eficiencia y cumplir con normativas actuales.";
}

function findSimilarLeads(idx) {
  const c = tempSearchResults[idx];
  if (!c) return;
  
  const query = c.name + " " + (c.segment || "");
  showToast(`🔍 Buscando empresas similares a ${c.name}...`);
  
  // Pre-rellenar buscador y disparar
  const input = document.getElementById('search-input');
  if (input) {
    input.value = query;
    const btn = document.getElementById('btn-search');
    if (btn) btn.click();
  }
}
