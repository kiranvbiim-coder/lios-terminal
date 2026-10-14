const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../client/src/components/panels");
const CLIENT_SRC = path.resolve(__dirname, "../client/src");
const SERVER_SRC = path.resolve(__dirname, "../server");
const SHARED_SRC = path.resolve(__dirname, "../shared");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readClient(relativePath) {
  return fs.readFileSync(path.join(CLIENT_SRC, relativePath), "utf8");
}

function readServer(relativePath) {
  return fs.readFileSync(path.join(SERVER_SRC, relativePath), "utf8");
}

function readShared(relativePath) {
  return fs.readFileSync(path.join(SHARED_SRC, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function numericResponsiveHeights(source) {
  return [...source.matchAll(/<ResponsiveContainer\b[^>]*\bheight=\{(\d+)\}/g)].map((match) => Number(match[1]));
}

function validateMonitor(relativePath, options = {}) {
  const source = read(relativePath);
  const heights = numericResponsiveHeights(source);
  const maxHeight = options.maxResponsiveHeight ?? 140;
  const oversized = heights.filter((height) => height > maxHeight);
  assert(oversized.length === 0, `${relativePath}: overview/monitor contains oversized ResponsiveContainer heights: ${oversized.join(", ")}`);

  for (const forbidden of options.forbiddenMarkers ?? []) {
    assert(!source.includes(forbidden), `${relativePath}: monitor contains forbidden architecture marker ${JSON.stringify(forbidden)}`);
  }

  if (options.maxRechartsImports !== undefined) {
    const imports = (source.match(/from ["']recharts["']/g) ?? []).length;
    assert(imports <= options.maxRechartsImports, `${relativePath}: expected at most ${options.maxRechartsImports} Recharts import(s), found ${imports}`);
  }
}

// Monitoring surfaces may carry compact trend context, but must not become a
// second chart workstation, duplicate deep drill-through, or manufacture data.
validateMonitor("QuotePanel.tsx", {
  maxResponsiveHeight: 80,
  maxRechartsImports: 0,
  forbiddenMarkers: ["Math.random(", "setInterval("],
});
validateMonitor("EconomicsOverviewPanel.tsx", {
  maxResponsiveHeight: 100,
  maxRechartsImports: 0,
  forbiddenMarkers: ["EVENT DETAIL", "RELEASE TABLES", "min-h-[420px]"],
});

// V4 allows workstation view state to be restored. These contracts are
// behavioral: fresh/invalid state must fall back to the operational surface,
// while a valid persisted section may be restored. Do not require one brittle
// literal useState implementation shape.
const quant = read("QuantWorkbenchPanel.tsx");
const quantHasDirectLabDefault = /useState<Section>\(["']lab["']\)/.test(quant);
const quantHasPersistedLabFallback = /const\s+section\s*=\s*[^;]*\?[^;]*:\s*["']lab["']\s*;/s.test(quant)
  && /useState<Section>\(initial\.section\)/.test(quant);
assert(
  quantHasDirectLabDefault || quantHasPersistedLabFallback,
  "QuantWorkbenchPanel.tsx: fresh/invalid state must open the operational Quant lab; persisted valid view state may be restored.",
);

const economics = read("EconomicsPanel.tsx");
const economicsHasDirectMacroDefault = /useState<Section>\(["']macro["']\)/.test(economics);
const economicsHasPersistedMacroFallback = /return\s+typeof\s+value\s*===\s*["']string["'][^;]*:\s*["']macro["']\s*;/s.test(economics)
  && /useState<Section>\(initialSection\)/.test(economics);
assert(
  economicsHasDirectMacroDefault || economicsHasPersistedMacroFallback,
  "EconomicsPanel.tsx: fresh/invalid state must open on live macro analysis; persisted valid view state may be restored.",
);

const options = read("OptionsPanel.tsx");
assert(
  !options.includes("{active.description}"),
  "OptionsPanel.tsx: do not restore the redundant active-tab description strip; tab descriptions belong in tooltips/workstation content.",
);

const productNav = readClient("lib/productNavigation.ts");
assert(productNav.includes('"pulse"'), "productNavigation.ts: Pulse must be a primary nav key.");
assert(productNav.includes('"explore"'), "productNavigation.ts: Explore must be a primary nav key.");
assert(productNav.includes('"workbench"'), "productNavigation.ts: Workbench must be a primary nav key.");
assert(productNav.includes('"signals"'), "productNavigation.ts: Signals must be a primary nav key.");
assert(productNav.includes('"library"'), "productNavigation.ts: Library must be a primary nav key.");
assert(
  /PRODUCT_NAV_ORDER[\s\S]*"pulse"[\s\S]*"explore"[\s\S]*"workbench"[\s\S]*"signals"[\s\S]*"library"/.test(productNav),
  "productNavigation.ts: default navigation order must be Pulse / Explore / Workbench / Signals / Library.",
);

const sidebar = readClient("components/terminal/Sidebar.tsx");
assert(sidebar.includes('data-testid={`product-nav-${navKey}`}'), "Sidebar.tsx: primary nav test ids must remain.");
assert(sidebar.includes("onSurface"), "Sidebar.tsx: Pulse/Explore/Signals/Library must switch the experience surface.");

const dock = readClient("components/terminal/ImmersiveDock.tsx");
assert(!dock.includes("Wave C"), "ImmersiveDock.tsx: do not expose Wave C as a product label.");
assert(!dock.includes("wave-c-shell"), "ImmersiveDock.tsx: the V4 shell is the default experience, not an overlay.");

const app = readClient("App.tsx");
assert(app.includes("pickDefaultDomain") || app.includes("FALLBACK_FINANCE_DOMAIN"), "App.tsx: Home Market/domain must default without a mandatory domain picker landing.");
assert(app.includes("domainPickerOpen"), "App.tsx: DomainPicker is an explicit Home Market switch, not the post-onboarding landing.");


// Retail UX convergence guard: keep first-run chrome quiet and keep one
// dominant discovery surface. Advanced/internal tooling remains available,
// but it must not silently return as permanent customer chrome.
const uxPreferences = readClient("lib/terminalUxPreferences.ts");
assert(uxPreferences.includes("DEFAULT_RETAIL_TERMINAL_UX_PREFERENCES"), "terminalUxPreferences.ts: retail defaults must remain explicit.");
assert(/DEFAULT_RETAIL_TERMINAL_UX_PREFERENCES[\s\S]*showImmersiveDock:\s*false/.test(uxPreferences), "terminalUxPreferences.ts: retail immersive dock must default off.");
assert(/DEFAULT_RETAIL_TERMINAL_UX_PREFERENCES[\s\S]*showTickerTape:\s*false/.test(uxPreferences), "terminalUxPreferences.ts: retail market ticker must default off.");
assert(/DEFAULT_RETAIL_TERMINAL_UX_PREFERENCES[\s\S]*showMacroTickerTape:\s*false/.test(uxPreferences), "terminalUxPreferences.ts: retail macro ticker must default off.");

const terminal = readClient("pages/Terminal.tsx");
assert(terminal.includes("DEFAULT_RETAIL_TERMINAL_UX_PREFERENCES"), "Terminal.tsx: client terminal must load retail UX defaults.");
assert(
  /showDenseChrome && !isClient\b[^\n]{0,240}!focusMode && !presentationMode && <FunctionBar/.test(terminal),
  "Terminal.tsx: legacy function bar must not be permanent retail chrome.",
);

const topBar = readClient("components/terminal/TopBar.tsx");
assert(topBar.includes("Search companies, data or tools"), "TopBar.tsx: retail must expose one dominant discovery entry.");
assert(topBar.includes('data-testid="ask-lios"'), "TopBar.tsx: Ask LiOS must remain directly reachable.");
assert(
  /\{isClient \? \([\s\S]*data-testid="cmd-open"[\s\S]*data-testid="ask-lios"/.test(topBar),
  "TopBar.tsx: retail discovery and Ask LiOS actions must remain explicit.",
);

const commandBar = readClient("components/terminal/CommandBar.tsx");
assert(commandBar.includes("Search companies, data, tools or actions"), "CommandBar.tsx: retail omnibox copy must stay task/data oriented.");
assert(commandBar.includes("!isClient && ("), "CommandBar.tsx: explanatory inspector must remain hidden from the default retail omnibox.");

const fundamentals = read("CompanyFundamentalsPanel.tsx");
assert(fundamentals.includes("!isClient && <ProvenanceBadge"), "CompanyFundamentalsPanel.tsx: provenance badge must not be permanent retail chrome.");
assert(fundamentals.includes("FINANCIAL DATA NOT CONNECTED"), "CompanyFundamentalsPanel.tsx: retail source failure must stay concise and actionable.");
assert(fundamentals.includes("OPEN DATA"), "CompanyFundamentalsPanel.tsx: retail source failure must link back to Data.");


// Retail cohesion guard: Pulse/Signals must be actually usable by executable
// client accounts, not merely rendered in the shell.
const waveD = readServer("waveDRoutes.ts");
assert(waveD.includes("requireWaveDRetailRead"), "waveDRoutes.ts: retail Pulse access guard must remain.");
for (const route of [
  'app.get("/api/wave-d/pulse", requireWaveDRetailRead',
  'app.get("/api/wave-d/briefs/:mode", requireWaveDRetailRead',
  'app.get("/api/wave-d/action-inbox", requireWaveDRetailRead',
]) {
  assert(waveD.includes(route), `waveDRoutes.ts: missing executable retail guard on ${route}`);
}

const experienceShell = readClient("components/terminal/WaveCExperienceShell.tsx");
assert(experienceShell.includes("waveDInboxItems"), "WaveCExperienceShell.tsx: retail Signals must render real Action Inbox items.");
assert(experienceShell.includes("briefHeadline={!isClient && briefHeadline ? briefHeadline : null}"), "WaveCExperienceShell.tsx: generated Pulse brief must stay out of default retail.");
// LIOS-P1-17: the Workbench is a single Dockview canvas; a second orientation shell above it is a defect.
assert(!experienceShell.includes("WorkbenchSurface"), "WaveCExperienceShell.tsx: a second Workbench shell must not be mounted above the Dockview canvas.");
assert(terminal.includes('data-testid="workbench-canvas"') && terminal.includes("<DockviewWorkspaceGrid"), "Terminal.tsx: the Workbench must render as one Dockview canvas.");
const terminalCatalog = readClient("lib/terminalCatalog.ts");
for (const view of ["financialstatements", "valuation", "advancedrisk"]) {
  assert(terminalCatalog.includes(`"${view}"`), `terminalCatalog.ts: retail core finance view ${view} must remain reachable.`);
}
assert(experienceShell.includes('<aside className={isClient ? "hidden" : "space-y-4"}>'), "WaveCExperienceShell.tsx: provider/orientation sidebar must stay hidden from retail.");

const agentPanel = read("AgentPanel.tsx");
assert(agentPanel.includes("JSON.stringify({ message: text, context })"), "AgentPanel.tsx: retail Ask LiOS must send bounded navigation context.");

const trialAccess = readServer("trialAccess.ts");
assert(trialAccess.includes("buildClientAiContextInstruction(context)"), "trialAccess.ts: Ask LiOS must ground the BYOAI system prompt in validated navigation context.");

const provenanceBadge = readClient("components/data/ProvenanceBadge.tsx");
assert(provenanceBadge.includes("isClient && !retailVisible"), "ProvenanceBadge.tsx: provenance must stay opt-in on retail analytical screens.");


const entityWorkspace = read("EntityWorkspacePanel.tsx");
assert(entityWorkspace.includes('data-audience="retail"'), "EntityWorkspacePanel.tsx: retail company workspace must remain explicitly separated from the internal diagnostic workspace.");
for (const label of ["Overview", "Financials", "Valuation", "Peers", "Risk", "Research"]) {
  assert(entityWorkspace.includes(`label: "${label}"`), `EntityWorkspacePanel.tsx: retail company workspace missing ${label} destination.`);
}
assert(
  entityWorkspace.indexOf('data-audience="retail"') < entityWorkspace.indexOf('EVIDENCE PASSPORT · SOURCE AND DATA STATE'),
  "EntityWorkspacePanel.tsx: retail branch must return before internal evidence/capability diagnostics render.",
);


const macroDashboard = read("MacroDashboardPanel.tsx");
assert(macroDashboard.includes('aria-label="Macro analysis"'), "MacroDashboardPanel.tsx: retail macro workspace navigation must remain explicit.");
for (const label of ["Overview", "Data", "Signals", "Policy", "Calendar", "FX"]) {
  assert(macroDashboard.includes(`label: "${label}"`), `MacroDashboardPanel.tsx: retail macro workspace missing ${label} destination.`);
}
assert(
  macroDashboard.includes("MACRO DATA IS NOT CONNECTED. ADD A SOURCE IN DATA TO POPULATE THIS VIEW."),
  "MacroDashboardPanel.tsx: retail disconnected state must stay concise and actionable.",
);

const portfolioWorkspace = read("PortfolioPanel.tsx");
assert(portfolioWorkspace.includes('data-audience="retail"'), "PortfolioPanel.tsx: retail portfolio workspace must remain audience-separated.");
assert(portfolioWorkspace.includes('["overview", "Overview"]'), "PortfolioPanel.tsx: retail Portfolio Overview must remain reachable.");
assert(portfolioWorkspace.includes('["attribution", "Attribution"]'), "PortfolioPanel.tsx: retail Portfolio Attribution must remain reachable.");
assert(
  portfolioWorkspace.indexOf('data-audience="retail"') < portfolioWorkspace.indexOf("<InstitutionalWorkspaceShell"),
  "PortfolioPanel.tsx: retail branch must return before internal advanced portfolio shell renders.",
);


assert(
  terminal.includes('openViewInNewPane(current, "agent"'),
  "Terminal.tsx: retail Ask LiOS must open beside the analytical canvas rather than replace it.",
);
assert(
  terminal.includes('"Open Ask LiOS beside analysis"'),
  "Terminal.tsx: contextual Ask LiOS split-pane action must remain explicit.",
);


assert(experienceShell.includes("RECENT ANALYSIS"), "WaveCExperienceShell.tsx: My LiOS must expose recent analytical contexts.");
assert(experienceShell.includes("FAVORITES"), "WaveCExperienceShell.tsx: My LiOS must expose saved favorite capabilities.");
assert(experienceShell.includes("loadRecentAnalyticalContexts"), "WaveCExperienceShell.tsx: My LiOS recents must use the canonical local personalization store.");
assert(experienceShell.includes("loadTerminalFavorites"), "WaveCExperienceShell.tsx: My LiOS favorites must use the canonical local personalization store.");


const connectionCenter = readClient("pages/DataConnectionCenter.tsx");
assert(connectionCenter.includes('useState(false);') && connectionCenter.includes('const [advancedOpen, setAdvancedOpen]'), "DataConnectionCenter.tsx: Advanced must default closed.");
assert(connectionCenter.includes('data-testid="connection-primary-actions"'), "DataConnectionCenter.tsx: default retail flow must expose Add source / Import / Enter actions.");
assert(connectionCenter.includes('data-testid="connect-ai"') && connectionCenter.includes('data-testid="connect-data"'), "DataConnectionCenter.tsx: Connect AI and Connect data must remain the two primary retail sections.");
assert(connectionCenter.includes('data-testid="connection-data-stack"'), "DataConnectionCenter.tsx: Source order must remain in the Connect data section.");
const advancedConnectionIndex = connectionCenter.indexOf('{advancedOpen && <div id="advanced-connection-tools"');
assert(advancedConnectionIndex >= 0, "DataConnectionCenter.tsx: Advanced render boundary must exist.");
const advancedConnectionSource = connectionCenter.slice(advancedConnectionIndex);
const advancedConnectionMarkers = [
  ["Advanced source registry", 'data-testid="connection-advanced-source-registry"'],
  ["Provider Health / Readiness", 'data-testid="connection-provider-health"'],
  ["Provider Conflict Review", 'data-testid="connection-provider-conflict"'],
  ["Provider Catalog", 'data-testid="connection-provider-catalog"'],
  ["Runtime & AI Settings", 'data-testid="connection-runtime-ai-settings"'],
];
for (const [label, marker] of advancedConnectionMarkers) {
  assert(
    advancedConnectionSource.includes(marker),
    `DataConnectionCenter.tsx: ${label} must stay behind Advanced.`,
  );
}
assert(connectionCenter.includes("connectionRecoveryPresentation(conn.status)"), "DataConnectionCenter.tsx: connection failures must use the canonical recovery presentation.");
assert(connectionCenter.includes('data-connection-state={recovery.needsAttention ? "attention" : "ready"}'), "DataConnectionCenter.tsx: connection cards must expose recovery state without provider-debug chrome.");

const connectionPresentation = readClient("lib/connectionCenterPresentation.ts");
const firstUseContract = readClient("lib/firstUseJourney.ts");
assert(firstUseContract.includes("connectionsRequiredToEnter: false"), "firstUseJourney.ts: zero-connector entry must remain permitted at the contract level.");
assert(
  connectionPresentation.includes("canEnterTerminal: !LIOS_FIRST_USE_CONTRACT.connectionsRequiredToEnter"),
  "connectionCenterPresentation.ts: zero-connector entry must remain permitted.",
);
assert(connectionPresentation.includes('testLabel: "Retry"'), "connectionCenterPresentation.ts: degraded sources must retain a Retry path.");
assert(connectionPresentation.includes('editLabel: "Fix"'), "connectionCenterPresentation.ts: degraded sources must retain a Fix path.");


const uxSettings = readClient("components/terminal/TerminalUxSettings.tsx");
for (const control of ["Immersive context dock", "Market ticker tape", "Macro ticker tape", "Focus mode", "Meeting / Presentation mode"]) {
  assert(uxSettings.includes(control), `TerminalUxSettings.tsx: expert control ${control} must remain user-enableable.`);
}

const uxOverlays = readClient("components/terminal/TerminalUxOverlays.tsx");
// Expert surfaces stay reachable: each must be rendered by the overlay host and have an opener
// (keyboard handler inside the host, or an openTerminalUxSurface call from the shell components).
const surfaceOpenerSources = [
  uxOverlays,
  readClient("components/terminal/HeroIntelligenceBar.tsx"),
  readClient("components/terminal/Sidebar.tsx"),
  readClient("pages/Terminal.tsx"),
].join("\n");
for (const expertSurface of ["evidence", "macros", "shortcuts", "settings"]) {
  assert(uxOverlays.includes(`surface === "${expertSurface}"`), `TerminalUxOverlays.tsx: advanced surface ${expertSurface} must be rendered.`);
  assert(
    surfaceOpenerSources.includes(`openSurface("${expertSurface}")`) || surfaceOpenerSources.includes(`openTerminalUxSurface("${expertSurface}")`),
    `Advanced surface ${expertSurface} must remain reachable.`,
  );
}
assert(terminal.includes("<ContextRail"), "Terminal.tsx: context rail must remain available as an expert layer.");
assert(terminal.includes("<LayoutManager"), "Terminal.tsx: saved/professional layouts must remain available as an expert layer.");

const immersiveDock = readClient("components/terminal/ImmersiveDock.tsx");
assert(
  immersiveDock.includes("!preferences.showImmersiveDock"),
  "ImmersiveDock.tsx: expert dock must remain preference-controlled rather than removed.",
);
assert(
  immersiveDock.includes('onOpenSurface("evidence")'),
  "ImmersiveDock.tsx: enabled expert dock must retain explicit Evidence access.",
);


const askLiosPanel = read("AgentPanel.tsx");
assert(askLiosPanel.includes("classifyAskLiosIntent(text)"), "AgentPanel.tsx: retail Ask LiOS must classify deterministic requests before BYOAI.");
assert(
  askLiosPanel.indexOf("classifyAskLiosIntent(text)") < askLiosPanel.indexOf('fetch("/api/client/trial/chat"'),
  "AgentPanel.tsx: deterministic routing must happen before any retail BYOAI request.",
);
assert(askLiosPanel.includes('data-testid="ask-lios-engine-action"'), "AgentPanel.tsx: deterministic delegation must remain an explicit user action.");
assert(askLiosPanel.includes("Open ${delegation.engineLabel}"), "AgentPanel.tsx: deterministic delegation must name the authoritative engine.");
assert(
  askLiosPanel.includes("onAction={(action) => onNav?.(action.view)}"),
  "AgentPanel.tsx: deterministic engine action must be user-click navigation, not silent execution.",
);

const askLiosRouter = readShared("askLiosRouter.ts");
assert(askLiosRouter.includes("I won’t invent this calculation."), "askLiosRouter.ts: deterministic requests must explicitly refuse invented calculations.");
assert(
  askLiosRouter.includes("LiOS should execute the governed engine when the required inputs are explicit."),
  "askLiosRouter.ts: deterministic requests must execute only through the governed LiOS engine when inputs are explicit.",
);
assert(
  askLiosRouter.includes("If inputs are missing, surface exactly what is required and a contextual workspace action rather than approximating the result."),
  "askLiosRouter.ts: missing deterministic inputs must become explicit governed recovery, never approximation.",
);

console.log("LiOS V4 terminal information architecture validation passed.");
