import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

test("Workbench has one primary workspace canvas instead of stacked workspace shells", () => {
  const terminal = source("../pages/Terminal.tsx");
  const homeShell = source("../components/terminal/WaveCExperienceShell.tsx");

  assert.match(terminal, /<DockviewWorkspaceGrid/);
  assert.doesNotMatch(terminal, /<WorkbenchSurface/);
  assert.doesNotMatch(homeShell, /WorkbenchSurface/);
  assert.doesNotMatch(homeShell, /surface === "workbench" &&/);
});

test("advanced analytical dock is scoped to unobstructed Workbench only", () => {
  const overlays = source("../components/terminal/TerminalUxOverlays.tsx");
  assert.match(overlays, /experienceSurface === "workbench"/);
  assert.match(overlays, /!surface && !contextMenu && !peek && !inspector/);

  const dock = source("../components/terminal/ImmersiveDock.tsx");
  assert.equal((dock.match(/onOpenSurface\("workbench"\)/g) ?? []).length, 0);
});

test("Dockview default geometry cannot create floating overlapping groups", () => {
  const grid = source("../components/terminal/DockviewWorkspaceGrid.tsx");
  assert.match(grid, /disableFloatingGroups/);
  assert.doesNotMatch(grid, /disableFloatingGroups=\{false\}/);
});

test("legacy workspace manager can shrink inside a Dockview pane without fixed-width collision", () => {
  const workspacePanel = source("../components/panels/WorkspacePanel.tsx");
  assert.match(workspacePanel, /min-w-0 flex flex-col/);
  assert.match(workspacePanel, /w-\[clamp\(180px,28%,256px\)\]/);
  assert.match(workspacePanel, /min-w-0 flex-1 overflow-y-auto/);
});

test("Workspaces stacks internally when its Dockview pane becomes narrow", () => {
  const workspacePanel = source("../components/panels/WorkspacePanel.tsx");
  const shell = source("../terminal-shell.css");

  assert.match(workspacePanel, /data-workspaces-body="true"/);
  assert.match(workspacePanel, /data-workspaces-list="true"/);
  assert.match(workspacePanel, /data-workspaces-detail="true"/);
  assert.match(shell, /container-name:\s*lios-workspaces-manager/);
  assert.match(shell, /@container lios-workspaces-manager \(max-width: 620px\)/);
  assert.match(shell, /\[data-workspaces-body='true'\][\s\S]*flex-direction:\s*column/);
  assert.match(shell, /\[data-workspaces-list='true'\][\s\S]*width:\s*100%\s*!important/);
});

test("production and rendered smoke harnesses share one CSS entry point", () => {
  for (const file of ["../main.tsx", "../visualSmoke.tsx", "../analyticalVisualSmoke.tsx", "../valuationSmoke.tsx"]) {
    const value = source(file);
    assert.match(value, /import "\.\/terminalStyles";/);
    assert.equal((value.match(/import "\.\/.+\.css";/g) ?? []).length, 0);
    assert.doesNotMatch(value, /visualSmokeLatestStyles/);
  }
});

test("standalone visual HTML cannot bypass the canonical CSS entry", () => {
  const valuationHtml = source("../../valuation-smoke.html");
  assert.doesNotMatch(valuationHtml, /rel="stylesheet".*terminal-/);
});

test("canonical style entry excludes obsolete shell generations", () => {
  const styles = source("../terminalStyles.ts");
  const imports = [...styles.matchAll(/import "\.\/(.+\.css)";/g)].map((match) => match[1]);

  assert.deepEqual(imports, [
    "index.css",
    "immersive-terminal-innovation.css",
    "terminal-visualization-v5.css",
    "terminal-workstation-v7.css",
    "terminal-workstation-v8.css",
    "terminal-canvas-v10.css",
    "terminal-analytics-v11.css",
    "terminal-quant-trust-v8.css",
    "terminal-ux-phase1.css",
    "terminal-shell.css",
    "visual-intelligence-canvas.css",
  ]);

  const forbidden = [
    "immersive-terminal.css",
    "immersive-terminal-fixes.css",
    "immersive-terminal-chrome.css",
    "terminal-identity.css",
    "terminal-signature-v5.css",
    "terminal-workstation-v6.css",
    "terminal-branding-v9.css",
    "terminal-theme-lock.css",
    "terminal-ux-stabilization.css",
  ];
  for (const legacy of forbidden) assert.equal(imports.includes(legacy), false, legacy);
});

test("canonical shell owns structural palette, Dockview and Project readability", () => {
  const shell = source("../terminal-shell.css");
  assert.match(shell, /LiOS canonical terminal shell/);
  assert.match(shell, /--lios-bg-app: #09090b/);
  assert.match(shell, /\.lios-dockview-workspace\.dockview-theme-dark/);
  assert.match(shell, /\.lios-project-experience-shell/);
  assert.match(shell, /aside\[aria-label='LIOS advanced workspace navigation'\]/);
  assert.doesNotMatch(shell, /\.lios-phase2-workbench/);
});

test("advanced workspace navigation does not reintroduce the legacy primary taxonomy", () => {
  const sidebar = source("../components/terminal/Sidebar.tsx");
  assert.match(sidebar, /ADVANCED_NAV_ORDER:[\s\S]*"projects"[\s\S]*"workbench"[\s\S]*"data"[\s\S]*"settings"/);
  assert.doesNotMatch(sidebar, /ADVANCED_NAV_ORDER:[\s\S]*"pulse"/);
  assert.doesNotMatch(sidebar, /ADVANCED_NAV_ORDER:[\s\S]*"explore"/);
  assert.doesNotMatch(sidebar, /ADVANCED_NAV_ORDER:[\s\S]*"signals"/);
  assert.match(sidebar, /LIOS advanced workspace navigation/);
});

test("retained feature CSS cannot own global shell geometry", () => {
  const featureStyles = [
    "../immersive-terminal-innovation.css",
    "../terminal-visualization-v5.css",
    "../terminal-workstation-v7.css",
    "../terminal-workstation-v8.css",
    "../terminal-canvas-v10.css",
    "../terminal-analytics-v11.css",
    "../terminal-quant-trust-v8.css",
    "../terminal-ux-phase1.css",
  ];

  const forbiddenShellOwnership = [
    /terminal-root\s*>\s*header/,
    /LIOS primary product navigation/,
    /Context intelligence rail/,
    /lios-immersive-dock/,
    /data-testid=['"](?:equity-ticker-tape|macro-ticker-tape|function-bar|context-ribbon|terminal-tab-bar)['"]/,
    /data-focus-mode/,
    /data-presentation-mode/,
  ];

  for (const file of featureStyles) {
    const css = source(file);
    for (const pattern of forbiddenShellOwnership) {
      assert.doesNotMatch(css, pattern, `${file} must not own global shell geometry: ${pattern}`);
    }
  }
});

test("active component CSS contains no legacy Workbench orientation surface", () => {
  const phaseOne = source("../terminal-ux-phase1.css");
  assert.doesNotMatch(phaseOne, /\.lios-phase2-workbench/);
  assert.match(phaseOne, /Workbench geometry is owned by Dockview \+ terminal-shell\.css/);
});

test("Terminal emits the runtime state attributes used by the canonical shell", () => {
  const terminal = source("../pages/Terminal.tsx");
  assert.match(terminal, /data-intelligent-calm=\{intelligentCalm/);
  assert.match(terminal, /data-comfort-mode=\{uxPreferences\.comfortMode/);
  assert.match(terminal, /activeCapability\.workspace === "modeling"/);
  assert.match(terminal, /isWorkbenchSurface && !presentationMode/);
});

test("overlay coordination cannot rewrite declarative shell state", () => {
  const overlays = source("../components/terminal/TerminalUxOverlays.tsx");
  assert.doesNotMatch(overlays, /dataset\.(?:comfort|ambient|intelligentCalm|reducedMotion)/);
  assert.match(overlays, /root\.dataset\.dataState = atmosphere\.state/);
});

test("all analytical container queries target the actual Dockview pane container", () => {
  const workstation = source("../terminal-workstation-v8.css");
  const analytics = source("../terminal-analytics-v11.css");
  assert.match(workstation, /container-name:\s*lios-pane/);
  assert.doesNotMatch(analytics, /@container workspace-pane/);
  assert.match(analytics, /@container lios-pane/);
});

test("active feature CSS uses unambiguous semantic color-token forms", () => {
  for (const file of ["../immersive-terminal-innovation.css", "../terminal-analytics-v11.css"]) {
    const css = source(file);
    assert.doesNotMatch(css, /hsl\(var\(--lios-(?:amber|cyan|green|red)\)/);
  }
});


test("rendered UX smoke exercises real Dockview and the real workspace manager", () => {
  const visualSmoke = source("../visualSmoke.tsx");
  const capture = source("../../../script/visual_smoke_capture.cjs");
  assert.match(visualSmoke, /workbench-real/);
  assert.match(visualSmoke, /workbench-real-narrow/);
  assert.match(visualSmoke, /useMemo\(\(\) => layoutFor\(count\), \[count\]\)/);
  assert.match(visualSmoke, /\}\), \[narrow\]\);/);
  assert.match(visualSmoke, /<DockviewWorkspaceGrid/);
  assert.doesNotMatch(visualSmoke, /ProfessionalWorkspaceGrid/);
  assert.match(visualSmoke, /<WorkspacePanel/);
  assert.match(capture, /assertWorkbenchInvariants/);
  assert.match(capture, /orientationShells !== 0/);
  assert.match(capture, /workspaceBodyDirection !== "column"/);
});


test("permanent Workbench chrome stays minimal and accessibility controls live in settings", () => {
  const topBar = source("../components/terminal/TopBar.tsx");
  const settings = source("../components/terminal/TerminalUxSettings.tsx");
  const cursor = source("../components/terminal/SignatureCursor.tsx");

  assert.match(topBar, />LiOS Terminal<\/span>/);
  assert.doesNotMatch(topBar, /ThemeSwitcher/);
  assert.doesNotMatch(topBar, />REFRESH<\/span>/);
  assert.doesNotMatch(topBar, />ENVIRONMENT<\/span>/);
  assert.match(settings, /<ThemeSwitcher \/>/);
  assert.match(cursor, /getItem\(CURSOR_KEY\) === "true"/);
  assert.doesNotMatch(cursor, /getItem\(CURSOR_KEY\) !== "false"/);
});

test("desktop context intelligence rail participates in layout instead of covering panes", () => {
  const rail = source("../components/terminal/ContextRail.tsx");
  const shell = source("../terminal-shell.css");

  assert.match(rail, /xl:relative/);
  assert.match(rail, /xl:w-\[340px\]/);
  assert.match(rail, /xl:w-8/);
  assert.doesNotMatch(shell, /right:\s*5px\s*!important;[\s\S]*top:\s*68px\s*!important/);
});

test("function key chrome is explicit maximum-density UI, not permanent Workbench chrome", () => {
  const terminal = source("../pages/Terminal.tsx");
  assert.match(terminal, /uxPreferences\.density === "terminal"/);
  assert.match(terminal, /!intelligentCalm/);
  assert.match(terminal, /<FunctionBar/);
});


test("analytical overlay coordinator makes modal surfaces mutually exclusive", () => {
  const overlays = source("../components/terminal/TerminalUxOverlays.tsx");

  assert.match(overlays, /const openSurface = useCallback/);
  assert.match(overlays, /const openContextMenu = useCallback/);
  assert.match(overlays, /const openPeek = useCallback/);
  assert.match(overlays, /const openInspector = useCallback/);
  assert.doesNotMatch(overlays, /TerminalWorkbenchMenu/);
  assert.doesNotMatch(overlays, /surface === "workbench" && <TerminalWorkbenchMenu/);
});

test("pane-local responsive panels use Dockview container width instead of browser width", () => {
  const news = source("../components/panels/NewsPanel.tsx");
  const screener = source("../components/panels/ScreenerPanel.tsx");
  const shell = source("../terminal-shell.css");

  assert.doesNotMatch(news, /useIsMobile/);
  assert.match(news, /data-news-readthrough-layout="responsive"/);
  assert.match(screener, /data-screener-radar="true"/);
  assert.match(screener, /data-screener-radar-detail="true"/);
  assert.match(shell, /@container lios-pane \(max-width: 760px\)/);
  assert.match(shell, /@container lios-pane \(max-width: 900px\)/);
});

test("Standard density has a readable microcopy floor while Terminal density may stay ultra dense", () => {
  const shell = source("../terminal-shell.css");

  assert.match(shell, /--lios-micro-font-size:\s*\.5625rem/);
  assert.match(shell, /--lios-small-font-size:\s*\.59375rem/);
  assert.match(shell, /data-density='terminal'[\s\S]*--lios-micro-font-size:\s*\.46875rem/);
  assert.match(shell, /font-size:\s*var\(--lios-micro-font-size\)\s*!important/);
});

test("execution traces are cleared when another chat is selected, but never during an in-flight run", () => {
  const shell = source("../components/terminal/ProjectExperienceShell.tsx");
  // Quick Chats share projectId null, so the Project-scoped reset cannot cover them.
  assert.match(shell, /traceChatIdRef\.current === selection\.chatId/);
  assert.match(shell, /if \(busyRef\.current\) return;\s*traceOwnerChatRef\.current = selection\.chatId;\s*setRuntimeEvents\(selection\.chatId \? loadRuntimeReceipt\(selection\.chatId\) : \[\]\);/);
  assert.match(shell, /\[selection\.chatId\]\);/);
});



test("H2a sidebar: rare actions live in the account menu", () => {
  const navigation = source("../components/terminal/AuthenticatedNavigation.tsx");
  const project = source("../components/terminal/ProjectExperienceShell.tsx");
  assert.match(navigation, /DropdownMenuTrigger.*Account:/);
  assert.match(navigation, /act\(props.onTrash\).*Trash & archive/);
  assert.match(navigation, /act\(props.onMigrate\).*Import legacy workspaces/);
  assert.match(project, /onTrash=\{.*setShowLifecycleCenter\(true\)/);
  assert.match(project, /onMigrate=\{.*migrateLegacyWorkspaces\(/);
});

test("H2b receipts persist per chat and restore on reload without storing answers", () => {
  const shell = source("../components/terminal/ProjectExperienceShell.tsx");
  assert.match(shell, /loadRuntimeReceipt\(/);
  assert.match(shell, /saveRuntimeReceipt\(owner, runtimeEvents\)/);
  assert.match(shell, /traceOwnerChatRef\.current = chatId/);
});



test("chat management uses one in-app drawer and never hides the conversation for connectors or plugins", () => {
  const app = source("../App.tsx");
  const project = source("../components/terminal/ProjectExperienceShell.tsx");
  const center = source("../pages/DataConnectionCenter.tsx");
  const navigation = source("../components/terminal/AuthenticatedNavigation.tsx");
  const pluginPanel = source("../components/GovernedExtensionsPanel.tsx");

  assert.match(app, /<Sheet open=\{managementView !== null && !domainPickerOpen\}/);
  assert.match(app, /data-lios-workspace hidden=\{domainPickerOpen\}/);
  assert.doesNotMatch(app, /data-lios-workspace hidden=\{environmentSetupOpen/);
  assert.match(app, /data-testid="chat-management-drawer"/);
  assert.match(app, /<DataConnectionCenter embedded/);
  assert.match(app, /<GovernedExtensionsPanel/);
  assert.match(app, /lazy\(\(\) => import\("\.\/pages\/DataConnectionCenter"\)\)/);
  assert.match(app, /lazy\(\(\) => import\("@\/components\/GovernedExtensionsPanel"\)\)/);
  assert.match(center, /if \(embedded\) return <div/);
  assert.match(project, /if \(next === "plugins"\) \{ openPluginCenter\(\); return; \}/);
  assert.match(project, /onSelect=\{openPluginCenter\}/);
  assert.match(project, /onSelect=\{onOpenEnvironment\}/);
  assert.doesNotMatch(project, /section === "plugins" && <GovernedExtensionsPanel/);
  assert.match(navigation, /onClick=\{props.onConnectors\}/);
  assert.match(navigation, /onClick=\{props.onSettings\}/);
  assert.match(pluginPanel, /Registered P13 declarative contributions last only for this Home process session/);
});
