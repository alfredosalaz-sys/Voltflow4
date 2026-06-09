// ============ REGISTRO DECLARATIVO DE TOUR ============
(function () {
  'use strict';

  if (window.__gordiTourRegistryBooted) return;
  window.__gordiTourRegistryBooted = true;

  const registry = new Map();
  const warned = new Set();
  const COVERAGE_KEY = 'gordi_tour_dev_validator_seen';

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

  function isDevEnvironment() {
    try {
      const host = String(location.hostname || '').toLowerCase();
      const protocol = String(location.protocol || '').toLowerCase();
      return protocol === 'file:' || host === '127.0.0.1' || host === 'localhost';
    } catch {
      return false;
    }
  }

  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 24 && rect.height > 14 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function getCandidateSelectors() {
    return [
      'main .page-header h1',
      'main .panel-header h3',
      'main .search-engine-bar',
      'main .sf-bar',
      'main .kanban-board',
      'main .map-command-panel',
      'main .search-workflow-panel',
      'main .today-panel',
      'main .stats-grid',
      'main .glass-panel[id]',
      '#workflow-command-center',
      '#workflow-post-scraping-panel',
      '#workflow-lead-origin-summary',
      '#workflow-map-brief',
      '#workflow-system-health',
      '#workflow-restore-panel',
      '#workflow-mission-bar',
      '#mission-bar',
      '#ops-status-layer',
      '#visual-command-deck',
      '#result-decision-bar',
      '#tour-settings-panel'
    ];
  }

  function getFeatureSelectorList(features) {
    return uniq(features.flatMap(feature => toList(feature.selector)));
  }

  function elementHasDeclaredTour(el) {
    return !!el?.closest?.('[data-tour-id]');
  }

  function elementCoveredByFeature(el, features) {
    if (!el) return false;
    return features.some(feature => {
      const selectors = toList(feature.selector);
      return selectors.some(selector => {
        try {
          return el.matches(selector) || !!el.closest(selector);
        } catch {
          return false;
        }
      });
    });
  }

  function describeElement(el) {
    if (!el) return 'unknown';
    const id = el.id ? `#${el.id}` : '';
    const classes = typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      : '';
    const text = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    return `${el.tagName.toLowerCase()}${id}${classes}${text ? ` :: ${text}` : ''}`;
  }

  function findUncoveredCandidates() {
    const features = mergeFeatures(true);
    const nodes = uniq(getCandidateSelectors().flatMap(selector => {
      try {
        return Array.from(document.querySelectorAll(selector));
      } catch {
        return [];
      }
    }));
    return nodes
      .filter(isVisible)
      .filter(node => !elementHasDeclaredTour(node))
      .filter(node => !elementCoveredByFeature(node, features))
      .map(node => ({ node, description: describeElement(node) }));
  }

  function readValidatorSeen() {
    try { return JSON.parse(localStorage.getItem(COVERAGE_KEY) || '[]'); }
    catch { return []; }
  }

  function writeValidatorSeen(list) {
    try { localStorage.setItem(COVERAGE_KEY, JSON.stringify(list.slice(0, 200))); }
    catch {}
  }

  function validateTourCoverage(options = {}) {
    const uncovered = findUncoveredCandidates();
    const current = uncovered.map(item => item.description);
    const previous = new Set(readValidatorSeen());
    const fresh = current.filter(item => !previous.has(item));
    if (options.persist !== false) writeValidatorSeen(current);
    if (!uncovered.length) {
      if (options.verbose) console.info('[tour-validator] OK: no hay bloques visibles importantes sin cobertura de tour.');
      return { ok: true, uncovered: [] };
    }
    console.groupCollapsed(`[tour-validator] ${uncovered.length} bloque(s) visibles sin cobertura de tour`);
    uncovered.forEach(item => console.warn(item.description, item.node));
    console.info('Sugerencia: añade data-tour-* en HTML o registerTourFeature(...) en el módulo que renderiza ese bloque.');
    console.groupEnd();
    return { ok: false, uncovered, fresh };
  }

  function scheduleDevValidation() {
    if (!isDevEnvironment()) return;
    const run = () => setTimeout(() => validateTourCoverage({ persist: true, verbose: false }), 1800);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
    document.addEventListener('gordi:view-changed', () => setTimeout(() => validateTourCoverage({ persist: false }), 500));
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
      selectors: getFeatureSelectorList(features).length,
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
  window.validateTourCoverage = validateTourCoverage;
  window.findUncoveredTourCandidates = findUncoveredCandidates;

  scheduleDevValidation();
})();
