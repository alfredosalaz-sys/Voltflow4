// ============ REGISTRO DECLARATIVO DE TOUR ============
(function () {
  'use strict';

  if (window.__gordiTourRegistryBooted) return;
  window.__gordiTourRegistryBooted = true;

  const registry = new Map();
  const warned = new Set();

  function uniq(list) {
    return Array.from(new Set((list || []).filter(Boolean)));
  }

  function toList(value) {
    if (Array.isArray(value)) return uniq(value.map(String).map(v => v.trim()).filter(Boolean));
    if (typeof value === 'string') return uniq(value.split(',').map(v => v.trim()).filter(Boolean));
    return [];
  }

  function toBool(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return ['1', 'true', 'yes', 'si'].includes(value.trim().toLowerCase());
    return !!value;
  }

  function normalizePractice(feature) {
    if (feature.practice && feature.practice.action) {
      return { label: feature.practice.label || 'Probar', action: feature.practice.action };
    }
    if (feature.practiceAction) {
      return { label: feature.practiceLabel || 'Probar', action: feature.practiceAction };
    }
    return null;
  }

  function defaultContexts(feature) {
    const explicit = toList(feature.contexts || feature.context);
    if (explicit.length) return explicit;
    const contexts = ['update'];
    if (feature.view) contexts.push(String(feature.view).trim());
    return uniq(contexts);
  }

  function normalizeFeature(feature, source) {
    return {
      id: String(feature.id || '').trim(),
      view: String(feature.view || '').trim(),
      selector: String(feature.selector || '').trim(),
      title: String(feature.title || '').trim(),
      text: String(feature.text || '').trim(),
      manual: String(feature.manual || feature.view || 'workflow').trim(),
      topic: String(feature.topic || '').trim(),
      priority: Number(feature.priority || 100),
      release: feature.release ? String(feature.release).trim() : '',
      requiresResults: toBool(feature.requiresResults),
      requiresFeature: feature.requiresFeature ? String(feature.requiresFeature).trim() : '',
      modules: toList(feature.modules),
      contexts: defaultContexts(feature),
      practice: normalizePractice(feature),
      before: typeof feature.before === 'function' ? feature.before : null,
      beforeAction: typeof feature.beforeAction === 'string' ? feature.beforeAction : '',
      source: source || feature.source || 'programmatic'
    };
  }

  function featureSignature(feature) {
    return feature.id || `${feature.view}:${feature.selector}:${feature.title}`;
  }

  function validateFeature(feature) {
    const key = featureSignature(feature);
    const problems = [];
    if (!feature.id) problems.push('missing id');
    if (!feature.view) problems.push('missing view');
    if (!feature.selector) problems.push('missing selector');
    if (!feature.title) problems.push('missing title');
    if (!feature.text) problems.push('missing text');
    if (!feature.contexts.length) problems.push('missing contexts');
    if (!problems.length || warned.has(key)) return;
    warned.add(key);
    console.warn('[tour-registry] feature incompleta:', key, problems.join(', '), feature);
  }

  function readDomFeatures(root) {
    return Array.from((root || document).querySelectorAll('[data-tour-id]')).map(node => {
      const ds = node.dataset || {};
      const selector = ds.tourSelector || (node.id ? `#${node.id}` : '');
      return normalizeFeature({
        id: ds.tourId,
        view: ds.tourView,
        selector,
        title: ds.tourTitle,
        text: ds.tourText,
        manual: ds.tourManual,
        topic: ds.tourTopic,
        priority: ds.tourPriority,
        release: ds.tourRelease,
        contexts: ds.tourContexts,
        requiresResults: ds.tourRequiresResults,
        requiresFeature: ds.tourRequiresFeature,
        practiceLabel: ds.tourPracticeLabel,
        practiceAction: ds.tourPracticeAction,
        modules: ds.tourModules
      }, 'dom');
    });
  }

  function mergeFeatures(includeDom) {
    const merged = new Map();
    if (includeDom) {
      readDomFeatures(document).forEach(feature => {
        validateFeature(feature);
        if (feature.id) merged.set(feature.id, feature);
      });
    }
    registry.forEach(feature => {
      validateFeature(feature);
      if (feature.id) merged.set(feature.id, feature);
    });
    return Array.from(merged.values()).sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.title.localeCompare(b.title, 'es');
    });
  }

  function registerTourFeature(feature) {
    const normalized = normalizeFeature(feature, 'programmatic');
    validateFeature(normalized);
    if (!normalized.id) return null;
    registry.set(normalized.id, normalized);
    return normalized;
  }

  function getRegisteredTourFeatures(options = {}) {
    const features = mergeFeatures(options.includeDom !== false);
    const context = options.context ? String(options.context).trim() : '';
    if (!context) return features;
    return features.filter(feature => feature.contexts.includes(context));
  }

  function getTourRegistrySignature(context) {
    return getRegisteredTourFeatures(context ? { context } : {})
      .map(feature => feature.id)
      .join('|');
  }

  function getTourRegistryDiagnostics() {
    const features = mergeFeatures(true);
    return {
      total: features.length,
      update: features.filter(feature => feature.contexts.includes('update')).length,
      contexts: features.reduce((acc, feature) => {
        feature.contexts.forEach(ctx => { acc[ctx] = (acc[ctx] || 0) + 1; });
        return acc;
      }, {}),
      features
    };
  }

  window.registerTourFeature = registerTourFeature;
  window.getRegisteredTourFeatures = getRegisteredTourFeatures;
  window.getTourRegistrySignature = getTourRegistrySignature;
  window.getTourRegistryDiagnostics = getTourRegistryDiagnostics;
})();
