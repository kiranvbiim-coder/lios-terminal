import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("Phase 1 density is wired from preferences through the terminal and pane tier", () => {
  const preferences = read("./terminalUxPreferences.ts");
  const terminal = read("../pages/Terminal.tsx");
  const pane = read("../components/terminal/WorkspacePane.tsx");
  const grid = read("../components/terminal/ProfessionalWorkspaceGrid.tsx");

  assert.match(preferences, /TerminalDensity = "terminal" \| "compact" \| "standard" \| "comfortable"/);
  assert.match(terminal, /data-density=\{uxPreferences\.density\}/);
  assert.match(terminal, /density=\{uxPreferences\.density\}/);
  assert.match(grid, /density=\{density\}/);
  assert.match(pane, /resolveFusionPaneTier/);
  assert.match(pane, /data-fusion-tier=\{fusionTier\}/);
});

test("Phase 1 Pulse preserves channel selection and truthful source states", () => {
  const shell = read("../components/terminal/WaveCExperienceShell.tsx");
  const pulse = read("../components/terminal/FusionPulseBoard.tsx");

  assert.match(shell, /pulseChannel=\{pulseChannel\}/);
  assert.match(shell, /pulseStatus=\{waveDStatus\}/);
  // Switching the discovery channel must also invalidate the previous user-owned subject filter.
  assert.ok(shell.includes('onPulseChannelChange={(next) => { setPulseChannel(next); setActiveSavedSubject(null); }}'));
  assert.ok(shell.includes('onSelectSavedSubject={setActiveSavedSubject}'));
  const tabs = read("../components/terminal/PulseDiscoveryTabs.tsx");
  assert.ok(pulse.includes("<PulseDiscoveryTabs channel={pulseChannel} onChange={onPulseChannelChange}"));
  for (const channel of ["for_you", "following", "markets", "research"]) {
    assert.match(tabs, new RegExp(`id: "${channel}"`));
  }
  assert.match(tabs, /nextPulseChannel/);
  assert.match(tabs, /min-h-11/);
  assert.match(pulse, /PULSE UNAVAILABLE/);
  assert.match(pulse, /WHY IT MATTERS/);
});


test("Phase 1 rich workspaces participate in pane-container responsiveness", () => {
  const densityCss = read("../terminal-panel-density.css");
  const company = read("../components/panels/CompanyFundamentalsPanel.tsx");
  const macro = read("../components/panels/MacroDashboardPanel.tsx");
  const portfolio = read("../components/panels/PortfolioHoldingsPanel.tsx");

  assert.match(densityCss, /@container lios-pane \(max-width: 820px\)/);
  assert.match(densityCss, /data-fusion-responsive-grid/);
  assert.match(company, /data-fusion-responsive-grid="four"/);
  assert.match(macro, /data-fusion-responsive-grid="four"/);
  assert.match(portfolio, /data-fusion-responsive-grid="six"/);
  assert.match(portfolio, /data-fusion-portfolio-chart-grid/);
});

test("Phase 1 portfolio does not fabricate missing prices or blend native currencies", () => {
  const portfolio = read("../components/panels/PortfolioHoldingsPanel.tsx");

  assert.doesNotMatch(portfolio, /quote\?\.price \?\? position\.avgCost/);
  assert.match(portfolio, /evaluatePortfolioValuationCoverage/);
  assert.match(portfolio, /CROSS-CURRENCY GUARD/);
  assert.match(portfolio, /FX NORMALIZATION REQUIRED/);
  assert.match(portfolio, /position\.currentPrice !== null/);
});

test("Phase 1 visual system stays on the canonical Limuria theme", () => {
  const primitives = read("../components/terminal/FusionPrimitives.tsx");
  const shell = read("../components/terminal/WaveCExperienceShell.tsx");
  const phaseOneCss = read("../terminal-ux-phase1.css");
  const styles = read("../terminalStyles.ts");

  for (const primitive of ["FusionPanel", "FusionActionButton", "FusionSourceBadge", "FusionFreshnessBadge", "FusionEvidenceRow", "FusionStateBlock"]) {
    assert.match(primitives, new RegExp(`export function ${primitive}`));
  }
  assert.match(shell, /data-testid="experience-shell"/);
  assert.match(shell, /data-visual-system="phase-one"/);
  assert.match(styles, /terminal-ux-phase1\.css/);
  assert.match(phaseOneCss, /--limuria-amber/);
  assert.match(phaseOneCss, /--limuria-graphite-0/);
  assert.match(phaseOneCss, /--limuria-cyan/);
  assert.doesNotMatch(phaseOneCss, /#ffffff|#fff\b/i);
});

test("Explore keeps discovery, selection, and handoff in one visual contract", () => {
  const explore = read("../components/terminal/ExploreSurface.tsx");
  const shell = read("../components/terminal/WaveCExperienceShell.tsx");
  const phaseOneCss = read("../terminal-ux-phase1.css");

  assert.match(shell, /<ExploreSurface/);
  assert.match(explore, /data-testid="explore-surface"/);
  assert.match(explore, /aria-label="Search analytics fields"/);
  assert.match(shell, /onOpenChart={openChartWithSelectedSeries}/);
  assert.match(explore, /ArrowDown/);
  assert.match(explore, /NO MATCHING FIELDS/);
  assert.match(explore, /FusionActionButton/);
  assert.match(phaseOneCss, /lios-phase2-explore/);
  assert.match(phaseOneCss, /--limuria-amber/);
});

test("Phase 2 Workbench is one Dockview canvas with scenes, layouts and composition", () => {
  const terminal = read("../pages/Terminal.tsx");
  const layouts = read("../components/terminal/LayoutManager.tsx");

  assert.match(terminal, /data-testid="workbench-canvas"/);
  assert.match(terminal, /<DockviewWorkspaceGrid/);
  assert.match(terminal, /onApplyWorkspace=\{applyWorkspace\}/);
  assert.match(layouts, /getWorkspacePanes/);
  assert.match(layouts, /PRESET_LAYOUTS/);
});

test("Phase 3 next actions connect to the canonical Tool Graph through context surfaces", () => {
  const graph = read("./terminalToolGraph.ts");
  const contracts = read("./terminalActionContracts.ts");
  const terminal = read("../pages/Terminal.tsx");
  const rail = read("../components/terminal/ContextRail.tsx");
  const ribbon = read("../components/terminal/ContextRibbon.tsx");

  assert.match(rail, /getRelatedToolActions/);
  assert.match(ribbon, /getRelatedToolActions/);
  assert.match(ribbon, /getJourneyForView/);
  assert.match(graph, /export function getRelatedToolActions/);
  assert.match(graph, /export function getJourneyForView/);
  assert.match(contracts, /export function getOpenWithActions/);
  assert.match(contracts, /export function getSendToActions/);
  assert.match(terminal, /isInternal=\{isInternal\}/);
});

test("Workbench navigation uses progressive disclosure instead of rendering the full tool catalogue", () => {
  const sidebar = read("../components/terminal/Sidebar.tsx");

  assert.match(sidebar, /getProductSectionForView/);
  assert.match(sidebar, /expandedSection/);
  assert.match(sidebar, /aria-expanded=\{expanded\}/);
  assert.match(sidebar, /section\.items\.length/);
});

test("Phase 2 workspace continuity keeps named groups visible in the tab rail", () => {
  const tabs = read("../components/terminal/TerminalTabBar.tsx");
  const stabilization = read("../terminal-ux-stabilization.css");

  assert.match(tabs, /const groupCounts = useMemo/);
  assert.match(tabs, /data-testid=\{`terminal-tab-group-\$\{groupKey\}`\}/);
  assert.match(tabs, /data-group-id=\{groupKey \?\? "ungrouped"\}/);
  assert.match(tabs, /LINKED CONTEXT/);
  assert.match(tabs, /Control\+Shift\+ArrowLeft/);
  assert.match(tabs, /onKeyDown=\{\(event\) =>/);
  assert.match(stabilization, /lios-tab-group-marker/);
  assert.match(stabilization, /data-group-id/);
});
