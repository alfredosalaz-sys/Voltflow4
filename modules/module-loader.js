// ============ LAZY MODULE LOADER ============
// Carga modulos pesados bajo demanda manteniendo funciones globales estables.
(function () {
  'use strict';

  const BUILD = window.GORDI_APP_BUILD || '2026.06.04.0320';
  const registry = {
    chat: { src: `modules/chat.js?v=${BUILD}` },
    help: { src: `modules/help-system.js?v=${BUILD}` },
    diskBackup: { src: `modules/disk-backup.js?v=${BUILD}` },
    coverage: { src: `modules/coverage.js?v=${BUILD}` },
    workflow: { src: `modules/workflow.js?v=${BUILD}`, deps: ['coverage'] },
    aiEmail: { src: `modules/ai-email.js?v=${BUILD}` },
    inbox: { src: `modules/inbox.js?v=${BUILD}` },
    smartImport: { src: `modules/smart-import.js?v=${BUILD}` },
  };
  const loading = {};
  const stubs = {};
  const safeModeBlockedModules = new Set(['chat', 'help', 'diskBackup', 'coverage', 'workflow', 'aiEmail', 'inbox', 'smartImport']);

  function isSafeModeBlocked(name) {
    return !!window.GORDI_SAFE_MODE && safeModeBlockedModules.has(name);
  }

  function notifySafeModeBlock(name) {
    if (typeof showToast === 'function') showToast(`${name} no disponible en modo seguro`);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-lazy-src="${src}"]`);
      if (existing?.dataset.loaded === 'true') return resolve(existing);
      if (existing) {
        existing.addEventListener('load', () => resolve(existing), { once: true });
        existing.addEventListener('error', () => reject(new Error(`No se pudo cargar ${src}`)), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.defer = true;
      script.charset = 'UTF-8';
      script.src = src;
      script.dataset.lazySrc = src;
      script.onload = () => {
        script.dataset.loaded = 'true';
        resolve(script);
      };
      script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.head.appendChild(script);
    });
  }

  function ensureGordiModule(name) {
    const item = registry[name];
    if (!item) return Promise.reject(new Error(`Modulo desconocido: ${name}`));
    if (isSafeModeBlocked(name)) {
      notifySafeModeBlock(name);
      return Promise.resolve(null);
    }
    if (!loading[name]) {
      const deps = Array.isArray(item.deps) ? item.deps : [];
      loading[name] = Promise.all(deps.map(ensureGordiModule))
        .then(() => loadScript(item.src))
        .catch(err => {
        delete loading[name];
        if (typeof showToast === 'function') showToast(`No se pudo cargar ${name}. Recarga la aplicacion.`);
        throw err;
      });
    }
    return loading[name];
  }

  function installLazyFunction(functionName, moduleName, fallback) {
    if (typeof window[functionName] === 'function') return;
    const lazy = function (...args) {
      if (typeof fallback === 'function') fallback(...args);
      return ensureGordiModule(moduleName).then(() => {
        const real = window[functionName];
        if (typeof real === 'function' && real !== lazy) return real.apply(this, args);
        return undefined;
      });
    };
    stubs[functionName] = lazy;
    window[functionName] = lazy;
  }

  function markChatLoading() {
    const status = document.getElementById('chat-status-label');
    if (status) status.textContent = ' Cargando asistente...';
  }

  [
    'toggleChat', 'toggleChatVoice', 'chatAsk', 'chatSend', 'chatExecute',
    'chatRunCommand', 'chatToggleCommands', 'generateWeeklyPlan',
    'toggleAgentMode', 'runAutoMaintenance', 'sendManualAlert',
    'chatShowDailyBriefing', 'stopChatVoice',
    'saveGmailConfig', 'testGmailAlert', 'toggleGmailAlerts',
    'githubPush', 'githubPull', 'toggleGithubAuto',
    'sfTogglePanel', 'sfUpdateChips', 'sfRemoveFilter'
  ].forEach(name => installLazyFunction(name, 'chat', markChatLoading));

  [
    'connectDiskBackupFolder', 'disconnectDiskBackupFolder', 'runDiskBackupNow',
    'maybeCreateDailyDiskBackup', 'renderDiskBackupStatus'
  ].forEach(name => installLazyFunction(name, 'diskBackup'));

  [
    'renderCoverage', 'renderCoverageFlowBar', 'openCoverageForLocation',
    'filterCoverageCellLeads', 'setCoverageLeadScope',
    'clearCoverageLeadScope', 'runCoverageBestNext', 'setCoverageSearch',
    'setCoverageSmartFilter', 'setCoverageViewMode', 'openCoveragePendingSearch',
    'openCoverageSectorPanel', 'runCoverageSectorBatch', 'openCoverageCell',
    'openCoverageLocationTimeline', 'loadCoverageSearch', 'loadCoverageSearchById',
    'runCoverageSearch', 'renderCoveragePostScrapingPanel'
  ].forEach(name => installLazyFunction(name, 'coverage'));

  if (typeof window.recordSearchCoverage !== 'function') {
    window.recordSearchCoverage = function (payload = {}) {
      if (typeof emitGordiFlowEvent === 'function') emitGordiFlowEvent('coverage:record', payload);
      ensureGordiModule('coverage');
      return undefined;
    };
  }
  if (typeof window.normalizeCoverageLocation !== 'function') {
    window.normalizeCoverageLocation = function (value = '') {
      ensureGordiModule('coverage');
      return String(value || '').trim().replace(/\s+/g, ' ');
    };
  }
  if (typeof window.getCoverageSectorLabel !== 'function') {
    window.getCoverageSectorLabel = function (sector) {
      ensureGordiModule('coverage');
      if (typeof getSegmentLabel === 'function') return getSegmentLabel(sector);
      return sector || 'Sector';
    };
  }
  if (typeof window.getCoverageTargets !== 'function') {
    window.getCoverageTargets = function () {
      ensureGordiModule('coverage');
      try { return JSON.parse(localStorage.getItem('gordi_coverage_targets') || '{"locations":[],"sectors":[]}'); } catch { return { locations: [], sectors: [] }; }
    };
  }
  if (typeof window.getCoverageActiveMission !== 'function') {
    window.getCoverageActiveMission = function () {
      ensureGordiModule('coverage');
      try { return JSON.parse(localStorage.getItem('gordi_coverage_active_mission') || 'null'); } catch { return null; }
    };
  }

  if (typeof window.getCoverageEntries !== 'function') {
    window.getCoverageEntries = function () {
      ensureGordiModule('coverage');
      try { return JSON.parse(localStorage.getItem('gordi_search_coverage') || '[]'); } catch { return []; }
    };
  }
  if (typeof window.getCoverageLeadScope !== 'function') {
    window.getCoverageLeadScope = function () {
      ensureGordiModule('coverage');
      try { return JSON.parse(localStorage.getItem('gordi_coverage_lead_filter') || 'null'); } catch { return null; }
    };
  }
  if (typeof window.getCoverageModel !== 'function') {
    window.getCoverageModel = function () {
      ensureGordiModule('coverage');
      return { entries: [], targets: { locations: [], sectors: [] }, locations: [], sectors: [], byKey: new Map() };
    };
  }
  if (typeof window.buildCoverageCells !== 'function') {
    window.buildCoverageCells = function () {
      ensureGordiModule('coverage');
      return [];
    };
  }
  if (typeof window.getCoverageCellFunnel !== 'function') {
    window.getCoverageCellFunnel = function () {
      ensureGordiModule('coverage');
      return { imported: 0, contacted: 0, won: 0 };
    };
  }
  if (typeof window.isCoverageActionable !== 'function') {
    window.isCoverageActionable = function () {
      ensureGordiModule('coverage');
      return false;
    };
  }

  [
    'workflowContinueMission', 'workflowOpenCoverage', 'workflowOpenCoverageMap',
    'workflowSelectRecommendedResults', 'workflowImportRecommended',
    'workflowCreateCampaignFromRecommended', 'workflowCreateRestorePoint',
    'workflowRestorePoint', 'workflowClearTechnicalCache',
    'workflowBypassRepeatAndSearch', 'renderWorkflowPanels'
  ].forEach(name => installLazyFunction(name, 'workflow'));

  [
    'renderHelpSystem', 'buildOperationalHelpManual',
    'startCoverageTour', 'closeCoverageTour', 'renderCoverageTourStep',
    'snoozeCoverageTour', 'startUpdateTour', 'closeUpdateTour',
    'renderUpdateTourStep', 'snoozeUpdateTour', 'openAppManual',
    'openTourCenter', 'startContextTour', 'renderTourProgressInline',
    'tourNeedsHelp', 'runTourPracticeAction', 'getTourDiagnostics',
    'resetTourLearningProgress', 'showTourChecklist'
  ].forEach(name => installLazyFunction(name, 'help'));

  [
    'openAiEmailModal', 'copySubjectOption', 'selectPainOption',
    'confirmPainAndGenerate', 'skipPainPicker', 'hidePainPicker',
    'openWhatsAppModal', 'closeWaModal', 'generateWhatsAppMessage',
    'sendWaManual', 'regenerateWaMessage', 'copyWaMessage',
    'registerWaSent', 'closeAiModal', 'formatText', 'clearFormat',
    'copyHtmlEmail', 'selectAiSubject', 'sendAiEmail',
    'regenerateAiEmail', 'retryAiEmail'
  ].forEach(name => installLazyFunction(name, 'aiEmail', (...args) => {
    if (name === 'closeAiModal') {
      const modal = document.getElementById('ai-email-modal');
      if (modal) modal.style.display = 'none';
    }
  }));

  if (typeof window.buildEmailThread !== 'function') {
    window.buildEmailThread = function (emails) {
      ensureGordiModule('inbox');
      const count = Array.isArray(emails) ? emails.length : 0;
      return `<div style="font-size:.75rem;color:var(--text-dim);padding:.4rem 0">${count ? `${count} emails registrados` : 'Sin emails registrados aun'}</div>`;
    };
  }

  [
    'expandInlinePaste', 'handleInlineDrop',
    'onInlinePasteInput', 'registerInlineReply', 'parseEmailsFromText',
    'matchEmailToLead', 'onInboxPaste', 'clearInboxPaste',
    'processInboxEmails', 'renderInboxResults', 'applyInboxMatch',
    'applySingleMatch', 'applyInboxMatches', 'createLeadFromInbox',
    'updateInboxBadge', 'openVoiceModal', 'closeVoiceModal',
    'startVoiceRecording', 'stopVoiceRecording', 'processVoiceNote',
    'saveVoiceNote', 'openScanModal', 'closeScanModal', 'handleScanFile',
    'analyzeScanImage', 'saveScanLead', 'openFocusMode',
    'closeFocusMode', 'focusMarkDone', 'setMapMode', 'initLeadsMap',
    'refreshMapMarkers', 'openBriefingModal', 'closeBriefingModal',
    'generateBriefing', 'sendBriefingMessage'
  ].forEach(name => installLazyFunction(name, 'inbox', (...args) => {
    if ((name === 'handleInlineDrop' || name === 'handleDragOver') && args[0]?.preventDefault) args[0].preventDefault();
  }));

  [
    'handleFileSelect', 'handleDrop', 'handleDragOver',
    'importSelectedLeads', 'processBulkImport', 'clearImportArea',
    'toggleAllImport'
  ].forEach(name => installLazyFunction(name, 'smartImport', (...args) => {
    if ((name === 'handleDrop' || name === 'handleDragOver') && args[0]?.preventDefault) args[0].preventDefault();
  }));

  window.ensureGordiModule = ensureGordiModule;
  window.__gordiLazyModules = { registry, loading, stubs };

  function idle(fn, delay = 0, timeout = 8000) {
    setTimeout(() => {
      if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout });
      else setTimeout(fn, 120);
    }, delay);
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.GORDI_SAFE_MODE) return;
    if (localStorage.getItem('gordi_disk_backup_enabled') === 'true') {
      idle(() => ensureGordiModule('diskBackup'), 30000, 60000);
    }

    const chatBubble = document.getElementById('chat-bubble');
    if (chatBubble) {
      chatBubble.addEventListener('mouseenter', () => ensureGordiModule('chat'), { once: true });
      chatBubble.addEventListener('focus', () => ensureGordiModule('chat'), { once: true });
    }
  });
})();


