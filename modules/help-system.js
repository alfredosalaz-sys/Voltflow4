// ============ AYUDA CONTEXTUAL + MANUAL DEL ASISTENTE ============
(function () {
  'use strict';

  if (window.__gordiHelpSystemBooted) return;
  window.__gordiHelpSystemBooted = true;

  const HELP_BUILD = window.GORDI_APP_BUILD || '2026.06.04.0320';
  const COVERAGE_TOUR_KEY = 'gordi_coverage_update_tour';
  const UPDATE_TOUR_KEY = 'gordi_professional_update_tour';
  const MANUAL_STATE_KEY = 'gordi_manual_state';
  const applied = new WeakSet();
  let helpRenderTimer = null;
  let helpObserver = null;
  let activeTour = null;

  const TOPICS = {
    dashboard: 'Panel principal. Resume leads, prioridad, actividad y la siguiente accion recomendada para trabajar sin perder tiempo.',
    commandCenter: 'Centro de mando diario. Decide la siguiente accion conectando cobertura, scraping y leads: continuar mision, importar resultados o revisar pipeline.',
    dailyCopilot: 'Copiloto diario. Genera una agenda practica con tareas de seguimiento, leads prioritarios y acciones de ventas basadas en tus datos.',
    search: 'Buscador inteligente. Introduce sector, zona o codigo postal y radio. Usa Google Places y enriquecimiento web para encontrar empresas reales.',
    searchControls: 'Controles de scraping. Sector y zona definen que se busca; radio y resultados controlan alcance; enriquecer decide cuanta informacion se intenta rescatar.',
    multiSearch: 'Multibúsqueda. Permite lanzar varios sectores en la misma zona o codigo postal y registrar cobertura por cada CP/sector trabajado.',
    results: 'Resultados de scraping. Revisa empresas encontradas, selecciona las utiles y vuelcalas a leads. El sistema evita duplicados y prioriza las que tienen datos de contacto.',
    postScraping: 'Cierre post-scraping. Selecciona automaticamente resultados utiles, crea campana o importa leads recomendados sin repetir trabajo.',
    leads: 'Gestion de leads. Aqui se trabajan contactos ya importados: estado, score, siguiente contacto, emails, notas y trazabilidad de origen.',
    leadOrigin: 'Origen real del lead. Muestra cuantos leads mantienen CP/sector de procedencia para conectar scraping, cobertura y pipeline.',
    coverage: 'Cobertura. Controla que codigos postales y sectores ya buscaste, cuando, que salio bien y que queda pendiente.',
    coverageSearch: 'Buscador de cobertura. Escribe un CP para ver si ya se busco y que sectores estan completos, pendientes o con error.',
    coverageFunnel: 'Embudo por CP/sector. Compara encontrados, importados a leads y contactados para saber que zonas producen oportunidades reales.',
    map: 'Mapa operativo. Las chinchetas muestran cobertura por CP: completo, parcial, pendiente o con errores. Sirve para decidir donde buscar despues.',
    settings: 'Configuracion. Guarda perfil, API keys y opciones de datos. Las claves se conservan en este navegador/origen local.',
    health: 'Centro de salud. Comprueba build, datos locales, API keys, backups y eventos recientes sin borrar tu trabajo.',
    restore: 'Backups inteligentes. Crea puntos antes de búsquedas, importaciones y campanas para poder restaurar el estado anterior.',
    chat: 'Asistente. Puede explicar cualquier pestaña, diagnosticar APIs, guiar scraping, interpretar cobertura, priorizar leads y resolver dudas de flujo.'
  };

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function addIcon(target, topic, mode) {
    if (!target || !topic || applied.has(target)) return;
    const text = TOPICS[topic] || topic;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'help-tip-btn';
    btn.textContent = '?';
    btn.setAttribute('aria-label', text);
    btn.setAttribute('data-help', text);
    btn.onclick = event => {
      event.preventDefault();
      event.stopPropagation();
      showHelpPopover(btn, topic, text);
    };
    if (mode === 'prepend') target.insertBefore(btn, target.firstChild);
    else target.appendChild(btn);
    applied.add(target);
  }

  function showHelpPopover(anchor, topic, text) {
    let pop = document.getElementById('help-popover');
    if (!pop) {
      pop = document.createElement('div');
      pop.id = 'help-popover';
      pop.className = 'help-popover';
      document.body.appendChild(pop);
    }
    const actions = getTopicActions(topic);
    pop.innerHTML = `
      <button class="help-popover-close" onclick="document.getElementById('help-popover')?.remove()">x</button>
      <div class="help-popover-title">${esc(getTopicTitle(topic))}</div>
      <div class="help-popover-text">${esc(text)}</div>
      ${actions.length ? `<div class="help-popover-actions">${actions.map(action => `<button onclick="${esc(action.onclick)}">${esc(action.label)}</button>`).join('')}</div>` : ''}
    `;
    const rect = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 120, rect.bottom + 8);
    const left = Math.min(window.innerWidth - 330, Math.max(12, rect.left - 12));
    pop.style.top = `${Math.max(12, top)}px`;
    pop.style.left = `${left}px`;
  }

  function getTopicTitle(topic) {
    const titles = {
      dashboard: 'Panel de control',
      commandCenter: 'Centro de mando',
      dailyCopilot: 'Copiloto diario',
      search: 'Buscador',
      searchControls: 'Controles de búsqueda',
      multiSearch: 'Multibúsqueda',
      results: 'Resultados',
      postScraping: 'Cierre post-scraping',
      leads: 'Gestion de leads',
      leadOrigin: 'Origen de leads',
      coverage: 'Cobertura',
      coverageSearch: 'Buscar CP',
      coverageFunnel: 'Embudo CP/sector',
      map: 'Mapa operativo',
      settings: 'Configuracion',
      health: 'Salud del sistema',
      restore: 'Backups',
      chat: 'Asistente'
    };
    return titles[topic] || 'Ayuda';
  }

  function getTopicActions(topic) {
    if (topic === 'coverage') return [
      { label: 'Ver guia', onclick: 'startCoverageTour && startCoverageTour(true)' },
      { label: 'Novedades', onclick: 'startUpdateTour && startUpdateTour(true)' },
      { label: 'Abrir mapa', onclick: 'workflowOpenCoverageMap && workflowOpenCoverageMap()' },
      { label: 'Preguntar al asistente', onclick: "chatAsk('Explicame como usar la pestaña de cobertura')" }
    ];
    if (topic === 'map') return [
      { label: 'Ver novedades', onclick: 'startUpdateTour && startUpdateTour(true)' },
      { label: 'Cobertura', onclick: "setMapMode && setMapMode('coverage')" },
      { label: 'Leads', onclick: "setMapMode && setMapMode('leads')" }
    ];
    if (topic === 'dashboard') return [
      { label: 'Ver novedades', onclick: 'startUpdateTour && startUpdateTour(true)' },
      { label: 'Preguntar', onclick: `chatAsk('Explicame las novedades de ${getTopicTitle(topic).replace(/'/g, '')}')` }
    ];
    if (topic === 'search' || topic === 'searchControls') return [
      { label: 'Ver novedades', onclick: 'startUpdateTour && startUpdateTour(true)' },
      { label: 'Preguntar scraping', onclick: "chatAsk('Cómo hago una búsqueda correcta y como importo los resultados?')" }
    ];
    if (topic === 'leads') return [
      { label: 'Ver novedades', onclick: 'startUpdateTour && startUpdateTour(true)' },
      { label: 'Priorizar leads', onclick: "chatExecute('topLeads')" },
      { label: 'Preguntar flujo', onclick: "chatAsk('Cómo gestiono leads desde scraping hasta pipeline?')" }
    ];
    if (topic === 'health' || topic === 'restore') return [
      { label: 'Crear backup', onclick: "workflowCreateRestorePoint && workflowCreateRestorePoint('manual_help')" },
      { label: 'Diagnostico', onclick: "chatRunCommand('diagnostics')" }
    ];
    return [
      { label: 'Preguntar', onclick: `chatAsk('Explicame ${getTopicTitle(topic).replace(/'/g, '')}')` }
    ];
  }

  function addHelpToStaticUi() {
    addIcon(document.querySelector('#dashboard-view .page-header h1'), 'dashboard');
    addIcon(document.querySelector('#daily-copilot-panel .panel-header h3'), 'dailyCopilot');
    addIcon(document.querySelector('#planner-view .page-header h1'), 'search');
    addIcon(document.querySelector('#planner-view .search-engine-bar'), 'searchControls', 'prepend');
    addIcon(document.querySelector('#search-results-panel .panel-header h3'), 'results');
    addIcon(document.querySelector('#leads-view .page-header h1'), 'leads');
    addIcon(document.querySelector('#coverage-view .page-header h1'), 'coverage');
    addIcon(document.querySelector('#map-view .map-command-panel strong'), 'map');
    addIcon(document.querySelector('#settings-view .page-header h1'), 'settings');
    addIcon(document.querySelector('#chat-window .chat-header-info strong'), 'chat');
  }

  function addHelpToDynamicUi() {
    addIcon(document.querySelector('#workflow-command-center .ops-header h3'), 'commandCenter');
    addIcon(document.querySelector('#workflow-post-scraping-panel .ops-header h3'), 'postScraping');
    addIcon(document.querySelector('#workflow-coverage-funnel-board .ops-header h3'), 'coverageFunnel');
    addIcon(document.querySelector('#workflow-lead-origin-summary .ops-header h3'), 'leadOrigin');
    addIcon(document.querySelector('#workflow-system-health .ops-header h3'), 'health');
    addIcon(document.querySelector('#workflow-restore-panel .ops-header h3'), 'restore');
    const coverageSearch = document.querySelector('#coverage-root input[type="search"], #coverage-root input[placeholder*="CP"], #coverage-root input[placeholder*="codigo"]');
    if (coverageSearch && coverageSearch.parentElement) addIcon(coverageSearch.parentElement, 'coverageSearch');
  }

  function buildOperationalManual() {
    const coverage = (() => {
      try { return typeof getCoverageEntries === 'function' ? getCoverageEntries() : JSON.parse(localStorage.getItem('gordi_search_coverage') || '[]'); } catch { return []; }
    })();
    const restorePoints = (() => {
      try { return JSON.parse(localStorage.getItem('gordi_workflow_restore_points') || '[]'); } catch { return []; }
    })();
    const activeMission = (() => {
      try { return typeof getCoverageActiveMission === 'function' ? getCoverageActiveMission() : JSON.parse(localStorage.getItem('gordi_coverage_active_mission') || 'null'); } catch { return null; }
    })();
    return `

MANUAL OPERATIVO ACTUAL DE LA APP, BUILD ${HELP_BUILD}:
- Flujo principal: 1) Cobertura decide CP/sector a trabajar. 2) Buscador hace scraping individual o multisector. 3) Resultados se revisan y se vuelcan a leads. 4) Leads se gestionan con estado, score, email IA y pipeline. 5) Mapa muestra visualmente CP buscados y pendientes.
- Centro de mando diario: esta en Dashboard. Recomienda la siguiente accion: continuar mision, buscar pendiente, importar resultados utiles o revisar pipeline.
- Busqueda individual: sector + zona/CP + radio + max resultados. Guarda cobertura CP/sector y permite importar seleccionados.
- Multibúsqueda: varios sectores sobre una zona/CP. Debe registrar cada sector en cobertura y fusionar duplicados.
- No repetir trabajo: si una zona/sector ya fue buscada, el sistema avisa y ofrece abrir cobertura, mapa o buscar igualmente.
- Resultados: importar recomendadas selecciona empresas no duplicadas con email/telefono/web y score suficiente. Volcar a leads crea contactos trazables.
- Gestion de leads: cada lead debe conservar origen real si viene de scraping/cobertura. Estados: Pendiente, Contactado, Respuesta del cliente, Visita, Entrega de presupuesto, Cerrado.
- Cobertura: muestra que CP/sector estan completos, parciales, con error o pendientes; sirve para decidir que buscar y para filtrar leads por origen.
- Mapa: modo Cobertura usa chinchetas por CP/estado; modo Leads muestra contactos. Es una vista visual del trabajo hecho y pendiente.
- Configuracion: perfil, API keys y datos. Google Places es clave para buscar; Gemini para asistente/emails; Hunter/Apollo mejoran enriquecimiento.
- Persistencia local: los datos viven en localStorage del mismo navegador y mismo origen exacto. No cambiar de file:// a localhost/GitHub Pages si se quieren ver los mismos datos.
- Backups inteligentes: se crean antes de búsquedas/importaciones/campanas y se restauran desde Configuracion. No borran API keys ni leads al actualizar.
- Si el usuario pregunta donde esta algo, responde con la pestana exacta y una accion concreta. Si pregunta si perdera datos, explica origen/localStorage y backups.`;
  }

  function installAssistantKnowledge() {
    if (typeof buildRichAppContext !== 'function' || buildRichAppContext.__helpWrapped) return;
    const original = buildRichAppContext;
    buildRichAppContext = function () {
      return original.apply(this, arguments) + buildOperationalManual();
    };
    buildRichAppContext.__helpWrapped = true;
  }

  function addChatSuggestions() {
    const el = document.getElementById('chat-suggestions');
    if (!el || el.__helpSuggestions) return;
    el.__helpSuggestions = true;
    const btn = document.createElement('button');
    btn.className = 'chat-sug';
    btn.textContent = 'Ayuda app';
    btn.onclick = () => chatAsk('Explicame el flujo completo de la herramienta y que pestaña debo usar segun lo que quiera hacer');
    el.insertBefore(btn, el.firstChild);
  }

  const COVERAGE_TOUR_STEPS = [
    {
      selector: '#coverage-view .page-header h1',
      title: 'Cobertura es tu memoria de trabajo',
      text: 'Aqui ves que codigos postales y sectores ya buscaste, cuando lo hiciste y que queda pendiente. La idea es no repetir trabajo.',
      manual: 'coverage'
    },
    {
      selector: '#coverage-root .coverage-search-panel',
      title: 'Busca un CP o zona',
      text: 'Escribe un codigo postal como 28001 o una zona. La pantalla te dira si ya se busco y en que sectores.',
      manual: 'coverage'
    },
    {
      selector: '#coverage-root .coverage-simple-summary',
      title: 'Resumen en cuatro datos',
      text: 'CP visibles, combinaciones ya buscadas, pendientes y elementos para revisar. Si solo miras una linea, mira esta.',
      manual: 'coverage'
    },
    {
      selector: '#coverage-root .coverage-filter-bar-simple',
      title: 'Filtra lo importante',
      text: 'Usa Pendientes, Caducadas, Errores o Revisar para convertir la cobertura en una lista de trabajo.',
      manual: 'coverage'
    },
    {
      selector: '#coverage-root .coverage-main-simple',
      title: 'La matriz es el mapa principal',
      text: 'Cada fila es un CP o zona. Cada columna es un sector. Cada celda te dice si esta hecho, pendiente o necesita revision.',
      manual: 'coverage'
    },
    {
      selector: '#coverage-root .coverage-cell, #coverage-root .coverage-sector-location',
      title: 'Pulsa una celda para actuar',
      text: 'Desde una celda puedes relanzar búsqueda, ver resultados, ver leads o abrir el timeline de ese CP.',
      manual: 'coverage'
    },
    {
      selector: '#coverage-root .coverage-toolbar-actions .btn-primary',
      title: 'Siguiente búsqueda recomendada',
      text: 'Si no sabes por donde seguir, este boton elige el siguiente CP/sector mas util segun lo pendiente y lo caducado.',
      manual: 'coverage'
    },
    {
      selector: '#coverage-root .coverage-advanced-panel',
      title: 'Opciones avanzadas sin ruido',
      text: 'Objetivos, ruta diaria, filtros completos y embudo siguen disponibles aqui, pero plegados para que la vista principal sea limpia.',
      manual: 'coverage'
    },
    {
      selector: '#map-mode-coverage, #workflow-coverage-funnel-board',
      title: 'Mapa y flujo con leads',
      text: 'Cuando quieras verlo visualmente, abre el mapa de cobertura. Las chinchetas muestran CP buscados, parciales, pendientes o con errores.',
      manual: 'map'
    }
  ];

  function getTourTarget(step) {
    if (!step?.selector) return null;
    return step.selector
      .split(',')
      .map(selector => document.querySelector(selector.trim()))
      .filter(Boolean)
      .filter(isTourElementVisible)
      .find(Boolean) || null;
  }

  function isTourElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return rect.width > 8 && rect.height > 8 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function ensureCoverageTourView() {
    if (typeof showView === 'function') showView('coverage');
    if (typeof renderCoverage === 'function') renderCoverage();
    if (typeof renderWorkflowPanels === 'function') renderWorkflowPanels();
    setTimeout(renderHelpSystem, 50);
  }

  function waitUntilNoBlockingModal(callback, tries = 0) {
    const blocking = [...document.querySelectorAll('.modal-overlay, .coverage-modal, .ops-modal-overlay, #tutorial-overlay')]
      .find(isTourElementVisible);
    if (!blocking) return callback();
    if (tries > 20) return;
    setTimeout(() => waitUntilNoBlockingModal(callback, tries + 1), 500);
  }

  function startCoverageTour(force = false) {
    if (activeTour && activeTour !== 'coverage') return;
    if (!force && hasSeenCoverageTour()) return;
    waitUntilNoBlockingModal(() => {
      activeTour = 'coverage';
      ensureCoverageTourView();
      setTimeout(() => renderCoverageTourStep(0), 260);
    });
  }

  function closeCoverageTour(markSeen = true) {
    document.getElementById('coverage-tour-layer')?.remove();
    document.body.classList.remove('coverage-tour-active');
    activeTour = null;
    if (markSeen) saveCoverageTourSeen(true);
  }

  function snoozeCoverageTour() {
    sessionStorage.setItem('gordi_coverage_update_tour_snoozed', '1');
    closeCoverageTour(false);
  }

  function getTourCardPosition(rect) {
    const width = Math.min(360, window.innerWidth - 24);
    if (!rect) return `left:50%;top:50%;width:${width}px;transform:translate(-50%,-50%)`;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow > 250 ? rect.bottom + 18 : Math.max(12, rect.top - 230);
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.left + rect.width / 2 - width / 2));
    return `left:${left}px;top:${top}px;width:${width}px`;
  }

  function getTourSpotRect(rect, margin) {
    if (!rect) return null;
    const left = Math.max(8, rect.left - margin);
    const top = Math.max(8, rect.top - margin);
    const right = Math.min(window.innerWidth - 8, rect.right + margin);
    const bottom = Math.min(window.innerHeight - 8, rect.bottom + margin);
    return { left, top, width: right - left, height: bottom - top, right, bottom };
  }

  function renderTourMasks(spot) {
    if (!spot) return '<div class="coverage-tour-dim"></div>';
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const panels = [
      `left:0;top:0;width:${vw}px;height:${spot.top}px`,
      `left:0;top:${spot.bottom}px;width:${vw}px;height:${Math.max(0, vh - spot.bottom)}px`,
      `left:0;top:${spot.top}px;width:${spot.left}px;height:${spot.height}px`,
      `left:${spot.right}px;top:${spot.top}px;width:${Math.max(0, vw - spot.right)}px;height:${spot.height}px`
    ];
    return panels.map(style => `<div class="coverage-tour-mask" style="${style}"></div>`).join('');
  }

  function renderCoverageTourStep(index) {
    const safeIndex = Math.max(0, Math.min(index, COVERAGE_TOUR_STEPS.length - 1));
    const step = COVERAGE_TOUR_STEPS[safeIndex];
    let layer = document.getElementById('coverage-tour-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'coverage-tour-layer';
      layer.className = 'coverage-tour-layer';
      document.body.appendChild(layer);
    }
    document.body.classList.add('coverage-tour-active');

    const target = getTourTarget(step);
    if (!target && step.selector && safeIndex < COVERAGE_TOUR_STEPS.length - 1) {
      renderCoverageTourStep(safeIndex + 1);
      return;
    }
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });

    setTimeout(() => {
      const rect = target ? target.getBoundingClientRect() : null;
      const margin = 10;
      const spot = getTourSpotRect(rect, margin);
      const spotStyle = spot
        ? `left:${spot.left}px;top:${spot.top}px;width:${spot.width}px;height:${spot.height}px`
        : 'left:50%;top:50%;width:1px;height:1px';
      const cardPos = getTourCardPosition(rect);
      layer.innerHTML = `
        ${renderTourMasks(spot)}
        <div class="coverage-tour-spot" style="${spotStyle}"></div>
        <div class="coverage-tour-card" style="${cardPos}">
          <div class="coverage-tour-kicker">Guia rapida de Cobertura ${safeIndex + 1}/${COVERAGE_TOUR_STEPS.length}</div>
          <h3>${esc(step.title)}</h3>
          <p>${esc(step.text)}</p>
          ${step.manual ? `<button class="coverage-tour-manual-link" onclick="openAppManual('${esc(step.manual)}')">Ver manual detallado</button>` : ''}
          <div class="coverage-tour-progress">
            ${COVERAGE_TOUR_STEPS.map((_, i) => `<i class="${i <= safeIndex ? 'active' : ''}"></i>`).join('')}
          </div>
          <div class="coverage-tour-actions">
            <button class="btn-outline btn-sm" onclick="snoozeCoverageTour()">Ahora no</button>
            <button class="btn-outline btn-sm" onclick="closeCoverageTour(true)">Saltar</button>
            <button class="btn-outline btn-sm" onclick="renderCoverageTourStep(${safeIndex - 1})" ${safeIndex ? '' : 'disabled'}>Atras</button>
            <button class="btn-primary btn-sm" onclick="${safeIndex === COVERAGE_TOUR_STEPS.length - 1 ? 'closeCoverageTour(true)' : `renderCoverageTourStep(${safeIndex + 1})`}">${safeIndex === COVERAGE_TOUR_STEPS.length - 1 ? 'Entendido' : 'Siguiente'}</button>
          </div>
        </div>
      `;
    }, target ? 260 : 0);
  }

  function maybeStartCoverageTour() {
    if (!hasSeenUpdateTour()) return;
    if (hasSeenCoverageTour() || sessionStorage.getItem('gordi_coverage_update_tour_snoozed')) return;
    setTimeout(() => startCoverageTour(false), 1800);
  }

  function hasSeenCoverageTour() {
    try {
      const data = JSON.parse(localStorage.getItem(COVERAGE_TOUR_KEY) || 'null');
      return !!data && data.feature === 'coverage_simplified' && data.build === HELP_BUILD && data.completed;
    } catch {
      return false;
    }
  }

  function saveCoverageTourSeen(completed) {
    localStorage.setItem(COVERAGE_TOUR_KEY, JSON.stringify({
      feature: 'coverage_simplified',
      version: getHelpAppVersion(),
      build: HELP_BUILD,
      completed: !!completed,
      seenAt: new Date().toISOString()
    }));
  }

  const APP_MANUAL_SECTIONS = [
    {
      id: 'workflow',
      title: 'Flujo completo',
      intro: 'La herramienta funciona como un circuito: Cobertura decide donde trabajar, Buscar Empresas ejecuta scraping, Resultados selecciona oportunidades, Leads gestiona contactos y Mapa ayuda a entender el territorio.',
      points: [
        'Empieza revisando Cobertura o Dashboard para no repetir CP y sectores ya trabajados.',
        'Lanza una búsqueda individual o multisector desde Buscar Empresas.',
        'Revisa los resultados, descarta duplicados y vuelca solo oportunidades utiles a Leads.',
        'Gestiona los leads por estado, prioridad, siguiente contacto y origen CP/sector.',
        'Usa el mapa para ver visualmente donde hay trabajo hecho, parcial, pendiente o con error.'
      ],
      tips: 'La regla de oro es no buscar a ciegas: primero mira cobertura, despues busca, luego importa y finalmente gestiona.'
    },
    {
      id: 'dashboard',
      title: 'Dashboard',
      intro: 'El Dashboard es el punto de entrada diario. Su mision es decirte que hacer a continuacion sin tener que revisar toda la aplicacion manualmente.',
      points: [
        'El Centro de mando diario cruza leads, cobertura, búsquedas pendientes y resultados listos.',
        'El boton Ejecutar siguiente intenta llevarte al punto mas util del flujo: continuar una mision, buscar una celda pendiente o importar resultados.',
        'Los KPIs resumen leads, cobertura, pendientes CP/sector, resultados listos y alta prioridad.',
        'El Copiloto diario genera una agenda comercial con tareas concretas para el dia.',
        'Las secciones de conversion y rendimiento ayudan a detectar que sectores producen mejores oportunidades.'
      ],
      tips: 'Usalo al empezar la jornada. Si no sabes por donde seguir, el Dashboard debe darte la siguiente accion.'
    },
    {
      id: 'search',
      title: 'Buscar Empresas',
      intro: 'Buscar Empresas es el motor de scraping. Permite buscar empresas reales por sector y CP/zona, enriquecer datos y preparar leads utiles.',
      points: [
        'Sector define el tipo de empresa que quieres encontrar.',
        'Ciudad, zona o CP define el territorio de búsqueda. Para trabajar ordenado, usa codigos postales concretos.',
        'Radio controla el alcance. Un radio pequeno es mas preciso; uno grande encuentra mas empresas pero puede mezclar zonas.',
        'Resultados limita cuantas empresas se intentan rescatar.',
        'Enriquecimiento decide si se intenta completar web, email, telefono y datos adicionales.',
        'La multibúsqueda permite lanzar varios sectores sobre el mismo CP/zona y registrar cobertura por cada sector.',
        'Despues del scraping, el cierre post-scraping detecta resultados utiles, duplicados y contactos listos para Leads.'
      ],
      tips: 'Para trabajar profesionalmente, usa CP + sector, revisa resultados, importa recomendados y mira Cobertura antes de repetir.'
    },
    {
      id: 'coverage',
      title: 'Cobertura',
      intro: 'Cobertura es la memoria visual de lo buscado. Responde a tres preguntas: que CP he buscado, que sectores he buscado y que queda pendiente.',
      points: [
        'El buscador de CP te dice si una zona ya tiene historial.',
        'El resumen muestra CP visibles, combinaciones buscadas, pendientes y elementos para revisar.',
        'La matriz CP x sector es la vista principal: filas son CP/zonas y columnas son sectores.',
        'Cada celda indica estado: hecho, buscado, revisar, caducado, error o pendiente.',
        'Al pulsar una celda puedes relanzar búsqueda, ver resultados, ver leads o abrir timeline.',
        'Siguiente búsqueda recomienda una accion util para avanzar sin repetir trabajo.',
        'Opciones avanzadas conserva objetivos, rutas diarias, filtros completos y embudo.'
      ],
      tips: 'Antes de buscar, mira Cobertura. Es la forma mas rapida de saber donde ya trabajaste y que falta.'
    },
    {
      id: 'leads',
      title: 'Gestion de Leads',
      intro: 'Gestion de Leads es donde se trabaja comercialmente cada contacto importado o creado manualmente.',
      points: [
        'Los leads importados desde scraping pueden conservar CP, sector y mision de origen.',
        'El resumen de origen muestra cuantos leads tienen trazabilidad real desde Cobertura o búsqueda.',
        'El buscador y los filtros permiten localizar contactos por empresa, email, sector, estado o prioridad.',
        'El score ayuda a priorizar, pero la gestion real se hace con estado, proximo contacto, notas y seguimiento.',
        'Desde un lead se puede revisar informacion, preparar emails, cambiar estado y mantener historial.',
        'El pipeline usa los estados para entender en que fase esta cada oportunidad.'
      ],
      tips: 'No basta con importar leads. Cada lead debe tener estado, siguiente accion y notas claras.'
    },
    {
      id: 'map',
      title: 'Mapa',
      intro: 'El Mapa convierte leads y cobertura en una vista territorial. Sirve para entender donde hay oportunidades y donde falta trabajar.',
      points: [
        'Modo Leads muestra contactos geolocalizados y ayuda a ver concentraciones de oportunidades.',
        'Modo Cobertura muestra CP/zonas por estado: completas, parciales, pendientes, caducadas o con error.',
        'La leyenda explica los colores y evita interpretar el mapa a ojo.',
        'El mapa ayuda a decidir si conviene trabajar una zona cercana, completar sectores pendientes o revisar errores.',
        'Cuando una búsqueda importa leads con coordenadas, el mapa conserva esa informacion para visualizacion posterior.'
      ],
      tips: 'Usa el mapa para tomar decisiones por territorio, no para sustituir la gestion detallada de Cobertura o Leads.'
    },
    {
      id: 'settings',
      title: 'Configuracion y datos',
      intro: 'Configuracion controla perfil, API keys, backups y salud del sistema. Es la zona que protege la continuidad de trabajo.',
      points: [
        'Las API keys permiten Google Places, enriquecimiento, IA y servicios externos.',
        'Los datos se guardan en localStorage del mismo navegador y mismo origen.',
        'Si abres desde otro navegador, otro perfil o otra URL, puede parecer que los datos desaparecieron.',
        'Los backups y puntos de restauracion permiten proteger leads, cobertura, historial y claves antes de cambios importantes.',
        'La salud del sistema muestra build, origen, datos locales y posibles problemas de configuracion.'
      ],
      tips: 'Antes de publicar o actualizar, confirma build alineado y no cambies el origen desde el que el usuario abre la app.'
    }
  ];

  function getManualSection(id) {
    return APP_MANUAL_SECTIONS.find(section => section.id === id) || APP_MANUAL_SECTIONS[0];
  }

  function openAppManual(sectionId = 'workflow') {
    const current = getManualSection(sectionId);
    saveManualState(current.id);
    let modal = document.getElementById('app-manual-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'app-manual-modal';
      modal.className = 'app-manual-modal';
      document.body.appendChild(modal);
    }
    modal.onclick = event => {
      if (event.target === modal) modal.remove();
    };
    modal.innerHTML = `
      <div class="app-manual-box">
        <button class="app-manual-close" onclick="document.getElementById('app-manual-modal')?.remove()">x</button>
        <aside class="app-manual-nav">
          <span>Manual de la herramienta</span>
          ${APP_MANUAL_SECTIONS.map(section => `<button class="${section.id === current.id ? 'active' : ''}" onclick="openAppManual('${esc(section.id)}')">${esc(section.title)}</button>`).join('')}
        </aside>
        <main class="app-manual-content">
          <div class="app-manual-kicker">Explicacion detallada</div>
          <h2>${esc(current.title)}</h2>
          <p class="app-manual-intro">${esc(current.intro)}</p>
          <div class="app-manual-list">
            ${current.points.map((point, idx) => `<div><b>${idx + 1}</b><p>${esc(point)}</p></div>`).join('')}
          </div>
          <div class="app-manual-tip"><strong>Uso recomendado:</strong> ${esc(current.tips)}</div>
        </main>
      </div>`;
  }

  function saveManualState(sectionId) {
    try {
      const previous = JSON.parse(localStorage.getItem(MANUAL_STATE_KEY) || '{}');
      const readSections = Array.from(new Set([...(previous.readSections || []), sectionId]));
      localStorage.setItem(MANUAL_STATE_KEY, JSON.stringify({
        version: getHelpAppVersion(),
        build: HELP_BUILD,
        lastSection: sectionId,
        openedAt: new Date().toISOString(),
        readSections
      }));
    } catch {}
  }

  const UPDATE_TOUR_STEPS = [
    {
      view: 'dashboard',
      selector: '#dashboard-view',
      title: 'Carga bajo demanda',
      text: 'Chat, ayuda y backup en disco ya no bloquean el arranque. Se cargan cuando los necesitas o durante periodos de inactividad.',
      manual: 'dashboard'
    },
    {
      view: 'dashboard',
      selector: '#dashboard-view',
      title: 'Arranque mas ligero',
      text: 'Esta version carga menos paneles ocultos al abrir la app. El Dashboard aparece antes y las secciones pesadas se preparan cuando las necesitas.',
      manual: 'dashboard'
    },
    {
      view: 'dashboard',
      selector: '#workflow-command-center',
      title: 'Dashboard: centro de mando diario',
      text: 'La novedad principal es que el panel ya no solo muestra datos: te propone la siguiente accion entre cobertura, scraping y leads.',
      manual: 'dashboard'
    },
    {
      view: 'dashboard',
      selector: '#daily-copilot-panel',
      title: 'Dashboard: agenda comercial',
      text: 'El copiloto diario convierte tus leads y tareas en una lista practica para trabajar sin pensar por donde empezar.',
      manual: 'dashboard'
    },
    {
      view: 'planner',
      selector: '#planner-view .search-engine-bar',
      title: 'Buscar Empresas: búsqueda guiada',
      text: 'Sector, CP/zona, radio, resultados y enriquecimiento quedan en una sola barra para lanzar scraping con precision.',
      manual: 'search'
    },
    {
      view: 'planner',
      selector: '#multi-sector-toolbar',
      title: 'Buscar Empresas: multibúsqueda',
      text: 'Ahora puedes buscar varios sectores en el mismo CP o zona y registrar cada sector en Cobertura automaticamente.',
      manual: 'search'
    },
    {
      view: 'planner',
      selector: '#workflow-post-scraping-panel, #search-results-panel',
      title: 'Buscar Empresas: cierre post-scraping',
      text: 'Cuando haya resultados, la herramienta detecta utiles, duplicados y contactos listos para volcar a Leads.',
      manual: 'search'
    },
    {
      view: 'leads',
      selector: '#workflow-lead-origin-summary',
      title: 'Leads: origen real del contacto',
      text: 'Los leads importados desde scraping conservan CP y sector, para saber de donde vienen y volver a Cobertura cuando haga falta.',
      manual: 'leads'
    },
    {
      view: 'leads',
      selector: '#leads-sf-bar',
      title: 'Leads: filtros mas rapidos',
      text: 'La gestion de leads tiene búsqueda, orden y filtros para trabajar solo los contactos que importan en ese momento.',
      manual: 'leads'
    },
    {
      view: 'map',
      before: () => { if (typeof setMapMode === 'function') setMapMode('leads'); },
      selector: '#map-view .map-command-panel',
      title: 'Mapa: modo operativo',
      text: 'El mapa ya no es solo una vista: permite alternar entre leads y cobertura para entender el territorio trabajado.',
      manual: 'map'
    },
    {
      view: 'map',
      before: () => { if (typeof setMapMode === 'function') setMapMode('coverage'); },
      selector: '#map-mode-coverage, #leads-map',
      title: 'Mapa: cobertura por colores',
      text: 'El modo Cobertura muestra CP buscados, parciales, pendientes o con errores para decidir la siguiente zona.',
      manual: 'map'
    }
  ];

  function ensureUpdateTourStep(step) {
    if (step?.view && typeof showView === 'function') showView(step.view);
    if (typeof renderWorkflowPanels === 'function') renderWorkflowPanels();
    if (typeof renderHelpSystem === 'function') setTimeout(renderHelpSystem, 50);
    if (typeof step?.before === 'function') {
      try { step.before(); } catch {}
    }
  }

  function startUpdateTour(force = false) {
    if (activeTour && activeTour !== 'update') return;
    if (!force && hasSeenUpdateTour()) return;
    waitUntilNoBlockingModal(() => {
      activeTour = 'update';
      setTimeout(() => renderUpdateTourStep(0), 260);
    });
  }

  function closeUpdateTour(markSeen = true) {
    document.getElementById('coverage-tour-layer')?.remove();
    document.body.classList.remove('coverage-tour-active');
    activeTour = null;
    if (markSeen) saveUpdateTourSeen(true);
  }

  function snoozeUpdateTour() {
    sessionStorage.setItem('gordi_professional_update_tour_snoozed', '1');
    closeUpdateTour(false);
  }

  function renderUpdateTourStep(index) {
    const safeIndex = Math.max(0, Math.min(index, UPDATE_TOUR_STEPS.length - 1));
    const step = UPDATE_TOUR_STEPS[safeIndex];
    ensureUpdateTourStep(step);

    let layer = document.getElementById('coverage-tour-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'coverage-tour-layer';
      layer.className = 'coverage-tour-layer';
      document.body.appendChild(layer);
    }
    document.body.classList.add('coverage-tour-active');

    setTimeout(() => {
      const target = getTourTarget(step);
      if (!target && step.selector && safeIndex < UPDATE_TOUR_STEPS.length - 1) {
        renderUpdateTourStep(safeIndex + 1);
        return;
      }
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      setTimeout(() => {
        const rect = target ? target.getBoundingClientRect() : null;
        const spot = getTourSpotRect(rect, 10);
        const spotStyle = spot
          ? `left:${spot.left}px;top:${spot.top}px;width:${spot.width}px;height:${spot.height}px`
          : 'left:50%;top:50%;width:1px;height:1px';
        const cardPos = getTourCardPosition(rect);
        layer.innerHTML = `
          ${renderTourMasks(spot)}
          <div class="coverage-tour-spot" style="${spotStyle}"></div>
          <div class="coverage-tour-card" style="${cardPos}">
            <div class="coverage-tour-kicker">Novedades de la herramienta ${safeIndex + 1}/${UPDATE_TOUR_STEPS.length}</div>
            <h3>${esc(step.title)}</h3>
            <p>${esc(step.text)}</p>
            ${step.manual ? `<button class="coverage-tour-manual-link" onclick="openAppManual('${esc(step.manual)}')">Ver manual detallado</button>` : ''}
            <div class="coverage-tour-progress">
              ${UPDATE_TOUR_STEPS.map((_, i) => `<i class="${i <= safeIndex ? 'active' : ''}"></i>`).join('')}
            </div>
            <div class="coverage-tour-actions">
              <button class="btn-outline btn-sm" onclick="snoozeUpdateTour()">Ahora no</button>
              <button class="btn-outline btn-sm" onclick="closeUpdateTour(true)">Saltar</button>
              <button class="btn-outline btn-sm" onclick="renderUpdateTourStep(${safeIndex - 1})" ${safeIndex ? '' : 'disabled'}>Atras</button>
              <button class="btn-primary btn-sm" onclick="${safeIndex === UPDATE_TOUR_STEPS.length - 1 ? 'closeUpdateTour(true)' : `renderUpdateTourStep(${safeIndex + 1})`}">${safeIndex === UPDATE_TOUR_STEPS.length - 1 ? 'Entendido' : 'Siguiente'}</button>
            </div>
          </div>
        `;
      }, target ? 260 : 0);
    }, 220);
  }

  function maybeStartUpdateTour() {
    if (hasSeenUpdateTour() || sessionStorage.getItem('gordi_professional_update_tour_snoozed')) return;
    setTimeout(() => startUpdateTour(false), 2400);
  }

  function hasSeenUpdateTour() {
    try {
      const data = JSON.parse(localStorage.getItem(UPDATE_TOUR_KEY) || 'null');
      return !!data && data.feature === 'professional_update_tour' && data.build === HELP_BUILD && data.completed;
    } catch {
      return false;
    }
  }

  function saveUpdateTourSeen(completed) {
    localStorage.setItem(UPDATE_TOUR_KEY, JSON.stringify({
      feature: 'professional_update_tour',
      version: getHelpAppVersion(),
      build: HELP_BUILD,
      completed: !!completed,
      seenAt: new Date().toISOString()
    }));
  }

  function getHelpAppVersion() {
    try {
      if (typeof VOLTFLOW_VERSION !== 'undefined' && VOLTFLOW_VERSION) return VOLTFLOW_VERSION;
    } catch {}
    return '2.8.2';
  }

  function renderHelpSystem() {
    if (document.hidden) return;
    addHelpToStaticUi();
    addHelpToDynamicUi();
    installAssistantKnowledge();
    addChatSuggestions();
  }

  function scheduleHelpRender(delay = 90) {
    if (helpRenderTimer) clearTimeout(helpRenderTimer);
    helpRenderTimer = setTimeout(() => {
      helpRenderTimer = null;
      renderHelpSystem();
    }, delay);
  }

  function installHelpObserver() {
    if (helpObserver || typeof MutationObserver === 'undefined') return;
    const target = document.getElementById('app-content') || document.body;
    if (!target) return;
    helpObserver = new MutationObserver(mutations => {
      if (document.hidden || activeTour) return;
      if (mutations.some(mutation => mutation.addedNodes && mutation.addedNodes.length)) {
        scheduleHelpRender(450);
      }
    });
    helpObserver.observe(target, { childList: true, subtree: false });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) scheduleHelpRender(400);
    });
  }

  function bootHelp() {
    scheduleHelpRender(1400);
    setTimeout(installHelpObserver, 5000);
    setTimeout(maybeStartUpdateTour, 7000);
    setTimeout(maybeStartCoverageTour, 10000);
    setInterval(() => {
      if (!document.hidden && document.getElementById('help-popover')) scheduleHelpRender(0);
    }, 60000);
    document.addEventListener('click', event => {
      const pop = document.getElementById('help-popover');
      if (!pop) return;
      if (event.target.closest('.help-tip-btn') || event.target.closest('#help-popover')) return;
      pop.remove();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') document.getElementById('app-manual-modal')?.remove();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootHelp);
  else bootHelp();

  window.renderHelpSystem = renderHelpSystem;
  window.buildOperationalHelpManual = buildOperationalManual;
  window.startCoverageTour = startCoverageTour;
  window.closeCoverageTour = closeCoverageTour;
  window.renderCoverageTourStep = renderCoverageTourStep;
  window.snoozeCoverageTour = snoozeCoverageTour;
  window.startUpdateTour = startUpdateTour;
  window.closeUpdateTour = closeUpdateTour;
  window.renderUpdateTourStep = renderUpdateTourStep;
  window.snoozeUpdateTour = snoozeUpdateTour;
  window.openAppManual = openAppManual;
})();




