// ============ FLOW EVENTS ============
// Bus persistente minimo para no perder flujo aunque modulos pesados carguen tarde.
(function () {
  'use strict';

  const FLOW_EVENTS_KEY = 'gordi_flow_events';
  const FLOW_MAX_EVENTS = 180;
  const FLOW_HANDLED_KEY = 'gordi_flow_events_handled';

  function safeJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function compactResult(result = {}) {
    return {
      name: result.name || result.company || '',
      placeId: result.placeId || '',
      website: result.website || '',
      email: result.email || '',
      phone: result.phone || '',
      segment: result.segment || '',
      sourceSector: result.sourceSector || '',
      matchedSectors: Array.isArray(result.matchedSectors) ? result.matchedSectors.slice(0, 8) : [],
      opportunityScore: result.opportunityScore || result.score || 0,
      lat: result.lat ?? null,
      lng: result.lng ?? null,
    };
  }

  function compactPayload(payload = {}) {
    const clean = { ...payload };
    if (Array.isArray(clean.results)) {
      clean.resultCount = clean.resultCount ?? clean.results.length;
      clean.results = clean.results.slice(0, 80).map(compactResult);
    }
    if (Array.isArray(clean.leadIds)) clean.leadIds = clean.leadIds.slice(0, 120);
    return clean;
  }

  function getFlowEvents() {
    return safeJson(FLOW_EVENTS_KEY, []);
  }

  function emitGordiFlowEvent(type, payload = {}, options = {}) {
    if (!type) return null;
    const event = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      date: new Date().toISOString(),
      payload: compactPayload(payload),
    };
    if (options.persist !== false) {
      const events = getFlowEvents();
      events.push(event);
      saveJson(FLOW_EVENTS_KEY, events.slice(-FLOW_MAX_EVENTS));
    }
    try {
      window.dispatchEvent(new CustomEvent('gordi:flow', { detail: event }));
    } catch {}
    return event;
  }

  function markGordiFlowEventHandled(id, consumer) {
    if (!id || !consumer) return;
    const handled = safeJson(FLOW_HANDLED_KEY, {});
    handled[consumer] = [...new Set([...(handled[consumer] || []), id])].slice(-FLOW_MAX_EVENTS);
    saveJson(FLOW_HANDLED_KEY, handled);
  }

  function replayGordiFlowEvents(handler, options = {}) {
    if (typeof handler !== 'function') return 0;
    const consumer = options.consumer || '';
    const handled = consumer ? safeJson(FLOW_HANDLED_KEY, {}) : {};
    const seen = consumer ? new Set(handled[consumer] || []) : new Set();
    let count = 0;
    getFlowEvents().forEach(event => {
      if (!event || seen.has(event.id)) return;
      if (Array.isArray(options.types) && !options.types.includes(event.type)) return;
      try {
        handler(event);
        count++;
        if (consumer) markGordiFlowEventHandled(event.id, consumer);
      } catch (err) {
        console.warn('No se pudo reproducir evento de flujo:', event.type, err);
      }
    });
    return count;
  }

  window.getGordiFlowEvents = getFlowEvents;
  window.emitGordiFlowEvent = emitGordiFlowEvent;
  window.replayGordiFlowEvents = replayGordiFlowEvents;
  window.markGordiFlowEventHandled = markGordiFlowEventHandled;
})();
