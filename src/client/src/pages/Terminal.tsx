import { canHandleWorkspaceShortcut } from "@/lib/workspaceShortcutBoundary";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopBar from "@/components/terminal/TopBar";
import TickerTape from "@/components/terminal/TickerTape";
import MacroTickerTape from "@/components/terminal/MacroTickerTape";
import Sidebar from "@/components/terminal/Sidebar";
import CommandBar from "@/components/terminal/CommandBar";
import FunctionBar from "@/components/terminal/FunctionBar";
import PWAInstallBanner from "@/components/terminal/PWAInstallBanner";
import LicenseStatusBanner, { type LicenseBannerReason } from "@/components/terminal/LicenseStatusBanner";
import { PanelErrorBoundary } from "@/components/terminal/PanelErrorBoundary";
import LayoutManager from "@/components/terminal/LayoutManager";
import TerminalTabBar from "@/components/terminal/TerminalTabBar";
import ContextRibbon from "@/components/terminal/ContextRibbon";
import ContextRail from "@/components/terminal/ContextRail";
import QuickSwitcher from "@/components/terminal/QuickSwitcher";
import DockviewWorkspaceGrid from "@/components/terminal/DockviewWorkspaceGrid";
import TerminalUxOverlays from "@/components/terminal/TerminalUxOverlays";
import TerminalTimeContextControl from "@/components/terminal/TerminalTimeContextControl";
import WaveCExperienceShell from "@/components/terminal/WaveCExperienceShell";
import ProjectExperienceShell from "@/components/terminal/ProjectExperienceShell";
import WorkbenchArtifactPane from "@/components/terminal/WorkbenchArtifactPane";
import { openArtifactWorkbench, returnFromArtifactWorkbench } from "@/lib/artifactWorkbenchHandoff";
import type { ArtifactWorkbenchHandoff } from "@/lib/artifactWorkbenchHandoff";
import { loadDockviewLayoutState, requestDockviewLayoutRestore } from "@/lib/dockviewWorkspaceState";
import { TerminalArtifactRendererProvider } from "@/lib/terminalArtifactState";
import { NativeArtifactDraftOwnerContext } from "@/lib/nativeArtifactDraftRecovery";
import { returnToChatWorkbenchOrigin, type ChatWorkbenchOrigin } from "@/lib/chatWorkbenchHandoff";
import type { ChatTerminalControls } from "@/lib/chatTerminalContext";
import VisualCanvas from "@/components/terminal/VisualCanvas";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { subscribeDecisionReview } from "@/lib/decisionReviewNavigation";
import {
  isExperienceHomeSurface,
  loadExperienceSurface,
  requestExperienceField,
  setExperienceSurface,
  subscribeExperienceSurface,
} from "@/lib/experienceShell";
import type { ExperienceShellSurface } from "@shared/waveCContracts";
import { prefetchPanelData } from "@/lib/prefetch";
import { dispatchCanonicalNavigation, type CanonicalNavigationTarget, type ParsedTerminalCommand } from "@/lib/terminalCommands";
import { useAudience } from "@/lib/audience";
import { useIsMobile } from "@/hooks/use-mobile";
import { getWorkspaceShortcutAction, shouldIgnoreCommandShortcut } from "@/lib/terminalChrome";
import {
  closeWorkspacePane, focusPane, getWorkspacePane, getWorkspacePanes, navigateFocusedPane, openSecurityView, openSymbolInWorkspace,
  openViewInNewPane, sanitizeWorkspaceForAudience, saveActiveWorkspace, PRESET_LAYOUTS, getPersonalFinanceWorkspace,
} from "@/lib/terminalWorkspace";
import type { WorkspaceAudience } from "@/lib/featureRegistry";
import {
  activeTerminalTab, activateTerminalTab, closeTerminalTab, loadTerminalTabs, moveTerminalTab, openEntityTab,
  openTerminalTab, renameTerminalTab, reopenTerminalTab, saveTerminalTabs, setTerminalTabGroup,
  setTerminalTabLinkGroup, setTerminalTabLinkScopes, syncLinkedTerminalTabsSymbol, toggleTerminalTabPin, updateActiveTerminalWorkspace,
  type TerminalLinkGroup, type TerminalTab, type TerminalTabsState,
} from "@/lib/terminalTabs";
import {
  createTerminalNavigationHistory, goBackInTerminalHistory, goForwardInTerminalHistory, pushTerminalNavigation,
  type TerminalNavigationHistory,
} from "@/lib/terminalHistory";
import {
  loadRecentAnalyticalContexts, loadTerminalFavorites, recordRecentAnalyticalContext, saveRecentAnalyticalContexts,
  type RecentAnalyticalContext,
} from "@/lib/terminalPersonalization";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { isRegisteredView, isViewVisibleToAudience } from "@/lib/featureRegistry";
import {
  DEFAULT_RETAIL_TERMINAL_UX_PREFERENCES,
  loadTerminalUxPreferences, patchTerminalUxPreferences, saveTerminalUxPreferences,
  type TerminalUxPreferences,
} from "@/lib/terminalUxPreferences";
import { loadTerminalTimeContext, type TerminalTimeContext } from "@/lib/terminalTimeTravel";
import { openTerminalUxSurface, requestTerminalContextMenu } from "@/lib/terminalUxEvents";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import { flushTerminalTelemetryAggregate, recordCapabilityLaunch } from "@/lib/terminalTelemetry";
import {
  createTerminalUndoState, pushTerminalUndo, redoTerminalAction, undoTerminalAction,
  type TerminalUndoState,
} from "@/lib/terminalUndo";
import type { ArtifactWorkbenchContext, PaneId, PaneState, WorkspaceState, ViewMode } from "@/lib/terminalTypes";
import type { DomainSlug } from "@/lib/domains";
import type { ClientAiContext } from "@shared/clientAiContext";
import { subscribeProjectSessionRestore } from "@/lib/projectWorkspaceSession";
import { subscribeSafeWorkspaceActions, type SafeWorkspaceActionRequest } from "@/lib/livingWorkspaceActions";
import { createLivingWorkspaceAdapter } from "@/lib/livingWorkspaceAdapter";
import type { SafeWorkspaceAction } from "@shared/projectContracts";

// Lazily-loaded analytical panels keep the shell responsive and preserve
// compile-time internal/client physical exclusion guarantees.
const EntityWorkspacePanel = lazy(() => import("@/components/panels/EntityWorkspacePanel"));
const MissionControlPanel = lazy(() => import("@/components/panels/MissionControlPanel"));
const MarketOverview = lazy(() => import("@/components/panels/MarketOverview"));
const QuotePanel = lazy(() => import("@/components/panels/QuotePanel"));
const ChartPanel = lazy(() => import("@/components/panels/ChartPanel"));
const NewsPanel = lazy(() => import("@/components/panels/NewsPanel"));
const AgentPanel = lazy(() => import("@/components/panels/AgentPanel"));
const ScreenerPanel = lazy(() => import("@/components/panels/ScreenerPanel"));
const WatchlistPanel = lazy(() => import("@/components/panels/WatchlistPanel"));
const AlertsPanel = lazy(() => import("@/components/panels/AlertsPanel"));
const EconomicsPanel = lazy(() => import("@/components/panels/EconomicsPanel"));
const PortfolioPanel = lazy(() => import("@/components/panels/PortfolioPanel"));
const PersonalFinancePanel = lazy(() => import("@/components/panels/PersonalFinancePanel"));
const MonteCarloPanel = lazy(() => import("@/components/panels/MonteCarloPanel"));
const CorrelationPanel = lazy(() => import("@/components/panels/CorrelationPanel"));
const OptionsPanel = lazy(() => import("@/components/panels/OptionsPanel"));
const QuantDeskPanel = lazy(() => import("@/components/panels/QuantDeskPanel"));
const ForexPanel = lazy(() => import("@/components/panels/ForexPanel"));
const HeatMapPanel = lazy(() => import("@/components/panels/HeatMapPanel"));
const EarningsPanel = lazy(() => import("@/components/panels/EarningsPanel"));
const CoverageMapPanel = lazy(() => import("@/components/panels/CoverageMapPanel"));
const ConflictDetectorPanel = lazy(() => import("@/components/panels/ConflictDetectorPanel"));
const MacroStressPanel = lazy(() => import("@/components/panels/MacroStressPanel"));
const SentimentPanel = lazy(() => import("@/components/panels/SentimentPanel"));
const YieldCurvePanel = lazy(() => import("@/components/panels/YieldCurvePanel"));
const PeerCompPanel = lazy(() => import("@/components/panels/PeerCompPanel"));
const EconCalendarPanel = lazy(() => import("@/components/panels/EconCalendarPanel"));
const CrossAssetPanel = lazy(() => import("@/components/panels/CrossAssetPanel"));
const ScannerPanel = lazy(() => import("@/components/panels/ScannerPanel"));
const MorningBriefPanel = lazy(() => import("@/components/panels/MorningBriefPanel"));
const SectorRotationPanel = lazy(() => import("@/components/panels/SectorRotationPanel"));
const RiskCalcPanel = lazy(() => import("@/components/panels/RiskCalcPanel"));
const PortfolioStressPanel = lazy(() => import("@/components/panels/PortfolioStressPanel"));
const DividendPanel = lazy(() => import("@/components/panels/DividendPanel"));
const ShortInterestPanel = lazy(() => import("@/components/panels/ShortInterestPanel"));
const RegimeClassifierPanel = lazy(() => import("@/components/panels/RegimeClassifierPanel"));
const CryptoChainPanel = lazy(() => import("@/components/panels/CryptoChainPanel"));
const TradeIdeaPanel = lazy(() => import("@/components/panels/TradeIdeaPanel"));
const BacktestPanel = lazy(() => import("@/components/panels/BacktestPanel"));
const MnaDealDeskPanel = lazy(() => import("@/components/panels/MnaDealDeskPanel"));
const IntegrationTrackerPanel = lazy(() => import("@/components/panels/IntegrationTrackerPanel"));
const FpaDashboardPanel = lazy(() => import("@/components/panels/FpaDashboardPanel"));
const IndicatorExplorerPanel = lazy(() => import("@/components/panels/IndicatorExplorerPanel"));
const MacroDashboardPanel = lazy(() => import("@/components/panels/MacroDashboardPanel"));
const IndicatorWorkbenchPanel = lazy(() => import("@/components/panels/IndicatorWorkbenchPanel"));
const EconomicSignalsPanel = lazy(() => import("@/components/panels/EconomicSignalsPanel"));
const EconomicsPolicyQuantPanel = lazy(() => import("@/components/panels/EconomicsPolicyQuantPanel"));
const SupplyChainIndicatorPanel = lazy(() => import("@/components/panels/SupplyChainIndicatorPanel"));
const SupplyChainDashboardPanel = lazy(() => import("@/components/panels/SupplyChainDashboardPanel"));
const SupplyChainQuantPanel = lazy(() => import("@/components/panels/SupplyChainQuantPanel"));
const EnvironmentIndicatorPanel = lazy(() => import("@/components/panels/EnvironmentIndicatorPanel"));
const EnvironmentDashboardPanel = lazy(() => import("@/components/panels/EnvironmentDashboardPanel"));
const EnvironmentQuantPanel = lazy(() => import("@/components/panels/EnvironmentQuantPanel"));
const MediaTopicPanel = lazy(() => import("@/components/panels/MediaTopicPanel"));
const MediaDashboardPanel = lazy(() => import("@/components/panels/MediaDashboardPanel"));
const TourismIndicatorPanel = lazy(() => import("@/components/panels/TourismIndicatorPanel"));
const TourismDashboardPanel = lazy(() => import("@/components/panels/TourismDashboardPanel"));
const InsiderTradingPanel = lazy(() => import("@/components/panels/InsiderTradingPanel"));
const OptionsFlowScannerPanel = lazy(() => import("@/components/panels/OptionsFlowScannerPanel"));
const CotPositioningPanel = lazy(() => import("@/components/panels/CotPositioningPanel"));
const GlobalIndicatorExplorerPanel = lazy(() => import("@/components/panels/GlobalIndicatorExplorerPanel"));
const CompanyFundamentalsPanel = lazy(() => import("@/components/panels/CompanyFundamentalsPanel"));
const FinancialStatementsPanel = lazy(() => import("@/components/panels/FinancialStatementsPanel"));
const GlobalDevelopmentPanel = lazy(() => import("@/components/panels/GlobalDevelopmentPanel"));
const GlobalClimatePanel = lazy(() => import("@/components/panels/GlobalClimatePanel"));
const CarbonIntensityPanel = lazy(() => import("@/components/panels/CarbonIntensityPanel"));
const DataStatsExplorerPanel = lazy(() => import("@/components/panels/DataStatsExplorerPanel"));
const AssetPricingPanel = lazy(() => import("@/components/panels/AssetPricingPanel"));
const AdvancedRiskPanel = lazy(() => import("@/components/panels/AdvancedRiskPanel"));
const QuantWorkbenchPanel = lazy(() => import("@/components/panels/QuantWorkbenchPanel"));
const PortfolioAttributionPanel = lazy(() => import("@/components/panels/PortfolioAttributionPanel"));
const RiskReturnScatterPanel = lazy(() => import("@/components/panels/RiskReturnScatterPanel"));
const ShillerCapePanel = lazy(() => import("@/components/panels/ShillerCapePanel"));
const MarketBreadthPanel = lazy(() => import("@/components/panels/MarketBreadthPanel"));
const WorkspacePanel = lazy(() => import("@/components/panels/WorkspacePanel"));
const SpreadsheetStudioPanel = lazy(() => import("@/components/panels/SpreadsheetStudioPanel"));

const DeveloperConsolePanel = lazy(() => import("@/components/panels/DeveloperConsolePanel"));
const UideEnginePanel = lazy(() => import("@/components/panels/UideEnginePanel"));
const AdminConsolePanel = lazy(() => import("@/components/panels/AdminConsolePanel"));
const ConsultingAdminInboxPanel = lazy(() => import("@/components/panels/ConsultingAdminInboxPanel"));
const PublishDeskPanel = lazy(() => import("@/components/panels/PublishDeskPanel"));
const QualityGatePanel = lazy(() => import("@/components/panels/QualityGatePanel"));
const ResearchIntelligencePanel = lazy(() => import("@/components/panels/ResearchIntelligencePanel"));
const ConsensusIntelligencePanel = lazy(() => import("@/components/panels/ConsensusIntelligencePanel"));
const LimuriaBrainPanel = lazy(() => import("@/components/panels/LimuriaBrainPanel"));
const DecisionEnginePanel = lazy(() => import("@/components/panels/DecisionEnginePanel"));
const QuantModelRegistryPanel = lazy(() => import("@/components/panels/QuantModelRegistryPanel"));
const QuantLabPanel = lazy(() => import("@/components/panels/QuantLabPanel"));
const IntegratedModelStudioPanel = lazy(() => import("@/components/panels/IntegratedModelStudioPanel"));
const MarketDataFabricPanel = lazy(() => import("@/components/panels/MarketDataFabricPanel"));
const EconomicDataFabricPanel = lazy(() => import("@/components/panels/EconomicDataFabricPanel"));
const UniverseDataFabricPanel = lazy(() => import("@/components/panels/UniverseDataFabricPanel"));
const CrossAssetDataFabricPanel = lazy(() => import("@/components/panels/CrossAssetDataFabricPanel"));
const EngineReadinessPanel = lazy(() => import("@/components/panels/EngineReadinessPanel"));
const ConnectorRegistryPanel = lazy(() => import("@/components/panels/ConnectorRegistryPanel"));

const AdvisoryPanel = lazy(() => import("@/components/panels/AdvisoryPanel"));
const ActivityPanel = lazy(() => import("@/components/panels/ActivityPanel"));
const CrossDomainFusionPanel = lazy(() => import("@/components/panels/CrossDomainFusionPanel"));
const DecisionMemoryPanel = lazy(() => import("@/components/panels/DecisionMemoryPanel"));
const ClientDataPanel = lazy(() => import("@/components/panels/ClientDataPanel"));

function PanelLoadingFallback() {
  return (
    <div className="flex h-full items-center justify-center bg-[#050505]">
      <div className="flex items-center gap-2 font-terminal text-[9px] tracking-widest text-muted-foreground">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-300" /> HYDRATING ANALYTICAL SURFACE...
      </div>
    </div>
  );
}

export type { ViewMode } from "@/lib/terminalTypes";

interface TerminalProps {
  session: {
    email: string; role: string; name: string;
    lifecycleStage?: "trial" | "client" | "churned" | null;
    licenseStatus?: string | null;
    licenseReason?: string | null;
    licenseGraceEndsAt?: string | null;
    offline?: boolean;
  };
  onLogout: () => void;
  onOpenEnvironment: () => void;
  domain: DomainSlug;
  onSwitchDomain: () => void;
}

function workspaceEqual(left: WorkspaceState, right: WorkspaceState): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

type ProposedLayout = Extract<SafeWorkspaceAction, { type: "propose-layout" }>["preset"];

function workspaceForProposal(preset: ProposedLayout, symbol: string, audience: WorkspaceAudience): WorkspaceState {
  const normalized = symbol.trim().toUpperCase() || "AAPL";
  const base: WorkspaceState = preset === "research"
    ? PRESET_LAYOUTS["EQUITY RESEARCH"]
    : preset === "modeling"
      ? PRESET_LAYOUTS.VALUATION
      : preset === "portfolio"
        ? PRESET_LAYOUTS["PORTFOLIO PM"]
        : preset === "personal-finance"
          ? getPersonalFinanceWorkspace(audience)
        : preset === "quant"
          ? {
              primary: { view: "quantworkbench", symbol: normalized },
              secondary: { view: "backtesting", symbol: normalized },
              tertiary: { view: "montecarlo", symbol: normalized },
              quaternary: { view: "advancedrisk", symbol: normalized },
              focusedPane: "primary",
            }
          : {
              primary: { view: "research", symbol: normalized },
              secondary: { view: "chart", symbol: normalized },
              focusedPane: "secondary",
            };

  const withSymbol = (pane: PaneState | null | undefined): PaneState | null | undefined =>
    pane ? { ...pane, symbol: normalized } : pane;
  return {
    ...base,
    primary: withSymbol(base.primary)!,
    secondary: withSymbol(base.secondary) ?? null,
    ...("tertiary" in base ? { tertiary: withSymbol(base.tertiary) } : {}),
    ...("quaternary" in base ? { quaternary: withSymbol(base.quaternary) } : {}),
  };
}

export default function Terminal({ session, onLogout, onOpenEnvironment, domain, onSwitchDomain }: TerminalProps) {
  const runtimeAudience = useAudience();
  const isClient = runtimeAudience === "client";
  const isInternal = runtimeAudience === "internal";

  const isTrial = isClient && session.lifecycleStage === "trial";
  const audience: WorkspaceAudience = isInternal ? "internal" : isTrial ? "trial" : "client";
  const isMobile = useIsMobile();
  const [tabsState, setTabsStateRaw] = useState<TerminalTabsState>(() => loadTerminalTabs(audience));
  const artifactHandoffRef = useRef<ArtifactWorkbenchHandoff | null>(null);
  const workbenchDirtyRef = useRef(false);
  const [workbenchDirty, setWorkbenchDirty] = useState(false);
  const [workbenchReturn, setWorkbenchReturn] = useState<{ context: ArtifactWorkbenchContext; request: number; prompt?: string } | null>(null);
  const chatWorkbenchOriginRef = useRef<ChatWorkbenchOrigin | null>(null);
  const [chatWorkbenchReturn, setChatWorkbenchReturn] = useState<{ origin: ChatWorkbenchOrigin; request: number } | null>(null);
  const setTabsState = useCallback((update: TerminalTabsState | ((current: TerminalTabsState) => TerminalTabsState)) => {
    setTabsStateRaw(current => {
      const next = typeof update === "function" ? update(current) : update;
      if (!workbenchDirtyRef.current) return next;
      const before = activeTerminalTab(current), after = activeTerminalTab(next);
      const artifactPane = getWorkspacePanes(before.workspace).find(({ pane }) => pane.view === "artifact");
      return before.id === after.id && before.workspace.focusedPane === after.workspace.focusedPane && artifactPane && getWorkspacePane(after.workspace, artifactPane.id) === artifactPane.pane ? next : current;
    });
  }, []);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [maximizedPane, setMaximizedPaneRaw] = useState<PaneId | null>(null);
  const setMaximizedPane = useCallback((update: PaneId | null | ((current: PaneId | null) => PaneId | null)) => {
    setMaximizedPaneRaw(current => workbenchDirtyRef.current ? current : typeof update === "function" ? update(current) : update);
  }, []);
  const [magnetization, setMagnetization] = useState(0.0);
  const [orderIntensity, setOrderIntensity] = useState(1.0);
  const [linkIsingToQuantum, setLinkIsingToQuantum] = useState(false);
  const [linkHawkesToOptimizer, setLinkHawkesToOptimizer] = useState(false);
  const [contextRailOpen, setContextRailOpen] = useState(false);
  const [recentContexts, setRecentContexts] = useState<RecentAnalyticalContext[]>(() => loadRecentAnalyticalContexts());
  const [uxPreferences, setUxPreferences] = useState<TerminalUxPreferences>(() =>
    loadTerminalUxPreferences(isClient ? DEFAULT_RETAIL_TERMINAL_UX_PREFERENCES : undefined),
  );
  const [experienceSurface, setExperienceSurfaceState] = useState<ExperienceShellSurface>(() => loadExperienceSurface());
  const [timeContext, setTimeContext] = useState<TerminalTimeContext>(() => loadTerminalTimeContext());
  const [researchStarter, setResearchStarter] = useState<{ question: string; symbol: string } | null>(null);
  const [askLiosContext, setAskLiosContext] = useState<ClientAiContext | null>(null);
  const [askLiosPrompt, setAskLiosPrompt] = useState<string | null>(null);
  const [pendingWorkspaceProposal, setPendingWorkspaceProposal] = useState<SafeWorkspaceActionRequest | null>(null);
  const [reviewDecisionId, setReviewDecisionId] = useState<number | null>(null);
  const historyRef = useRef<Record<string, TerminalNavigationHistory>>({});
  const undoRef = useRef<Record<string, TerminalUndoState<WorkspaceState>>>({});
  const canOpenView = useCallback((view: ViewMode) => view !== "artifact" && isViewVisibleToAudience(view, audience), [audience]);
  const livingWorkspaceAdapter = useMemo(() => createLivingWorkspaceAdapter({ audience }), [audience]);

  const activeTab = useMemo(() => activeTerminalTab(tabsState), [tabsState]);
  const workspace = activeTab.workspace;
  const activePane = useMemo(() => getWorkspacePane(workspace, workspace.focusedPane) ?? workspace.primary, [workspace]);
  const activeHistory = historyRef.current[activeTab.id] ?? createTerminalNavigationHistory();
  const canGoBack = activeHistory.back.length > 0;
  const canGoForward = activeHistory.forward.length > 0;
  const focusMode = uxPreferences.focusMode;
  const presentationMode = uxPreferences.presentationMode;
  // LiOS Power: three deliberate density tiers over one experienceSurface
  // value -- LIOS_EXECUTION_ROADMAP.md LIOS-P1-17, "conversation remains
  // primary and cockpit density appears only on demand".
  //   "projects"                        -> cleanest: MinimalProjectsHeader only.
  //   "pulse"/"explore"/"signals"/"library" -> WaveCExperienceShell renders its
  //     own header (wordmark/Ask LiOS/Master AI); the outer TopBar would just
  //     duplicate it. WaveCExperienceShell's *internal* surface-switcher nav is
  //     intentionally hidden when embedded (see WaveCExperienceShell.tsx), so
  //     the outer Sidebar remains the way to move between these surfaces --
  //     it must stay visible here even though the rest of the dense chrome
  //     (TopBar/ticker tapes/ContextRail/FunctionBar) should not.
  //   "workbench"                       -> full dense professional Terminal.
  // Derived, not separate state: reuses the experience-surface event store,
  // and the Sidebar's existing Projects/Workbench
  // nav buttons already provide the way between tiers.
  const isProjectsSurface = experienceSurface === "projects";
  const isWorkbenchSurface = experienceSurface === "workbench";
  const showDenseChrome = isWorkbenchSurface;
  const showSidebarNav = !isProjectsSurface;
  const [projectNavigation, setProjectNavigation] = useState<{ id: number; section: Exclude<CanonicalNavigationTarget, "connections" | "doctor"> } | null>(null);
  const [navigationContext, setNavigationContext] = useState("Saved Project/Chat selection");
  const activeCapability = getTerminalCapability(activePane.view);
  const intelligentCalm = uxPreferences.adaptiveCalm && isWorkbenchSurface && !presentationMode && (
    activeCapability.workspace === "modeling"
    || activePane.view === "financialstatements"
    || activePane.view === "research"
    || activePane.view === "spreadsheet"
  );

  useEffect(() => {
    if (isMobile || focusMode || presentationMode) setContextRailOpen(false);
  }, [focusMode, isMobile, presentationMode]);

  useEffect(() => {
    saveTerminalTabs(tabsState);
    saveActiveWorkspace(workspace);
  }, [tabsState, workspace]);

  useEffect(() => {
    if (!isClient) return;
    const initial = window.setTimeout(() => { void flushTerminalTelemetryAggregate(); }, 30_000);
    const interval = window.setInterval(() => { void flushTerminalTelemetryAggregate(); }, 15 * 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") void flushTerminalTelemetryAggregate();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    setRecentContexts((current) => {
      const capability = getTerminalCapability(activePane.view);
      const next = recordRecentAnalyticalContext(current, activePane.view, capability.symbolAware ? activePane.symbol : "");
      saveRecentAnalyticalContexts(next);
      return next;
    });
  }, [activePane.symbol, activePane.view]);

  const setWorkspace = useCallback((updater: (current: WorkspaceState) => WorkspaceState, label = "Workspace change") => {
    setTabsState((current) => {
      const active = activeTerminalTab(current);
      const nextWorkspace = updater(active.workspace);
      if (workspaceEqual(active.workspace, nextWorkspace)) return current;
      historyRef.current[active.id] = pushTerminalNavigation(
        historyRef.current[active.id] ?? createTerminalNavigationHistory(),
        active.workspace,
        nextWorkspace,
      );
      undoRef.current[active.id] = pushTerminalUndo(
        undoRef.current[active.id] ?? createTerminalUndoState<WorkspaceState>(),
        label,
        active.workspace,
        nextWorkspace,
        workspaceEqual,
      );
      return updateActiveTerminalWorkspace(current, nextWorkspace);
    });
  }, []);

  const applyWorkspace = useCallback((nextWorkspace: WorkspaceState, label = "Apply workspace") => {
    const next = sanitizeWorkspaceForAudience(nextWorkspace, audience);
    if (workbenchDirtyRef.current) {
      const current = activeTerminalTab(tabsState).workspace;
      const artifactPane = getWorkspacePanes(current).find(({ pane }) => pane.view === "artifact");
      if (!artifactPane || current.focusedPane !== next.focusedPane || getWorkspacePane(next, artifactPane.id) !== artifactPane.pane) return false;
    }
    setWorkspace(() => next, label);
    return true;
  }, [audience, setWorkspace, tabsState]);

  const handleHistoryBack = useCallback(() => {
    setTabsState((current) => {
      const active = activeTerminalTab(current);
      const result = goBackInTerminalHistory(historyRef.current[active.id] ?? createTerminalNavigationHistory(), active.workspace);
      if (!result) return current;
      historyRef.current[active.id] = result.history;
      return updateActiveTerminalWorkspace(current, result.workspace);
    });
  }, []);

  const handleHistoryForward = useCallback(() => {
    setTabsState((current) => {
      const active = activeTerminalTab(current);
      const result = goForwardInTerminalHistory(historyRef.current[active.id] ?? createTerminalNavigationHistory(), active.workspace);
      if (!result) return current;
      historyRef.current[active.id] = result.history;
      return updateActiveTerminalWorkspace(current, result.workspace);
    });
  }, []);

  const handleUndo = useCallback(() => {
    setTabsState((current) => {
      const active = activeTerminalTab(current);
      const result = undoTerminalAction(undoRef.current[active.id] ?? createTerminalUndoState<WorkspaceState>());
      if (!result) return current;
      undoRef.current[active.id] = result.state;
      return updateActiveTerminalWorkspace(current, result.value);
    });
  }, []);

  const handleRedo = useCallback(() => {
    setTabsState((current) => {
      const active = activeTerminalTab(current);
      const result = redoTerminalAction(undoRef.current[active.id] ?? createTerminalUndoState<WorkspaceState>());
      if (!result) return current;
      undoRef.current[active.id] = result.state;
      return updateActiveTerminalWorkspace(current, result.value);
    });
  }, []);

  const handleSymbol = useCallback((symbol: string) => {
    setTabsState((current) => openEntityTab(current, symbol));
    recordCapabilityLaunch("entity", "other");
  }, []);

  const handleSurface = useCallback((surface: ExperienceShellSurface) => {
    setExperienceSurface(surface);
  }, []);

  useEffect(() => subscribeExperienceSurface(surface => {
    if (workbenchDirtyRef.current && surface !== "workbench") { setExperienceSurface("workbench"); return; }
    if (surface !== "workbench") chatWorkbenchOriginRef.current = null;
    setExperienceSurfaceState(surface);
  }), []);
  const handleOpenWorkbench = useCallback((context?: ArtifactWorkbenchContext, chatOrigin?: ChatWorkbenchOrigin) => {
    if (workbenchDirtyRef.current) return;
    if (context) {
      const result = openArtifactWorkbench(tabsState, context, loadDockviewLayoutState(), maximizedPane, workbenchDirtyRef.current);
      if (!result) return;
      artifactHandoffRef.current = artifactHandoffRef.current?.priorTab.id === result.handoff.priorTab.id
        ? { ...result.handoff, priorTab: artifactHandoffRef.current.priorTab, priorLayout: artifactHandoffRef.current.priorLayout, priorMaximizedPane: artifactHandoffRef.current.priorMaximizedPane }
        : result.handoff;
      setTabsState(() => result.state);
      setMaximizedPane(null);
      chatWorkbenchOriginRef.current = null;
    } else if (chatOrigin) {
      // Only a validated unique symbol from this Chat may select company context.
      // It opens an existing entity tab; all earlier professional tabs remain intact.
      // P5/source entitlements still govern data in the resulting panels.
      if (chatOrigin.symbol) setTabsState(current => openEntityTab(current, chatOrigin.symbol!));
      chatWorkbenchOriginRef.current = chatOrigin;
    }
    handleSurface("workbench");
  }, [tabsState, maximizedPane, handleSurface, setTabsState]);
  const handleReturnToChat = useCallback((context: ArtifactWorkbenchContext, dirty: boolean, prompt?: string) => {
    const handoff = artifactHandoffRef.current;
    if (!handoff) {
      if (dirty || workbenchDirtyRef.current) return false;
      setWorkbenchReturn(current => ({ context, request: (current?.request ?? 0) + 1, prompt }));
      handleSurface("projects");
      return true;
    }
    const result = returnFromArtifactWorkbench(tabsState, handoff, context, dirty || workbenchDirtyRef.current);
    if (!result) return false;
    setTabsState(() => result.state);
    setMaximizedPane(handoff.priorMaximizedPane);
    setWorkbenchReturn(current => ({ context: result.context, request: (current?.request ?? 0) + 1, prompt }));
    requestDockviewLayoutRestore(handoff.priorLayout);
    artifactHandoffRef.current = null;
    handleSurface("projects");
    return true;
  }, [tabsState, handleSurface, setTabsState]);
  const handleWorkbenchVersion = useCallback((paneId: PaneId, version: number) => {
    setTabsStateRaw(current => {
      const active = activeTerminalTab(current), pane = getWorkspacePane(active.workspace, paneId);
      if (!pane?.artifact || pane.artifact.version === version) return current;
      return updateActiveTerminalWorkspace(current, { ...active.workspace, [paneId]: { ...pane, artifact: { ...pane.artifact, version } } });
    });
  }, []);
  const handleWorkbenchDirty = useCallback((dirty: boolean) => { workbenchDirtyRef.current = dirty; setWorkbenchDirty(dirty); }, []);
  const returnFromGeneralWorkbench = () => {
    const origin = returnToChatWorkbenchOrigin(chatWorkbenchOriginRef.current, workbenchDirtyRef.current);
    if (!origin) return;
    chatWorkbenchOriginRef.current = null;
    setChatWorkbenchReturn(current => ({ origin, request: (current?.request ?? 0) + 1 }));
    handleSurface("projects");
  };

  useEffect(() => subscribeProjectSessionRestore(() => {
    const restoredTabs = loadTerminalTabs(audience);
    setTabsState(restoredTabs);
    setTimeContext(loadTerminalTimeContext());
    setMaximizedPane(null);
    setExperienceSurface("workbench");
  }), [audience]);

  const handleNav = useCallback((view: ViewMode) => {
    if (!canOpenView(view)) return;
    if (view === "environment") {
      onOpenEnvironment();
      return;
    }
    if (view !== "agent") {
      setAskLiosContext(null);
      setAskLiosPrompt(null);
    }
    handleSurface("workbench");
    setWorkspace((current) => navigateFocusedPane(current, view), `Open ${getTerminalCapability(view).label}`);
    prefetchPanelData(view);
    recordCapabilityLaunch(view, "other");
  }, [canOpenView, handleSurface, onOpenEnvironment, setWorkspace]);

  const handleAskLios = useCallback((initialQuestion?: string) => {
    if (activePane.view === "agent") {
      if (initialQuestion?.trim()) setAskLiosPrompt(initialQuestion.trim());
      return;
    }

    const capability = getTerminalCapability(activePane.view);
    const contextSymbol = capability.symbolAware ? activePane.symbol?.trim().toUpperCase() || undefined : undefined;
    setAskLiosContext({
      symbol: contextSymbol,
      view: activePane.view,
      asOfDate: timeContext.enabled ? timeContext.asOfDate ?? undefined : undefined,
    });
    setAskLiosPrompt(initialQuestion?.trim() || null);

    if (isClient) {
      handleSurface("workbench");
      setWorkspace(
        (current) => openViewInNewPane(current, "agent", contextSymbol || current.primary.symbol),
        "Open Ask LiOS beside analysis",
      );
      prefetchPanelData("agent");
      recordCapabilityLaunch("agent", "other");
      return;
    }

    handleNav("agent");
  }, [
    activePane.symbol,
    activePane.view,
    handleNav,
    handleSurface,
    setWorkspace,
    timeContext.asOfDate,
    timeContext.enabled,
  ]);

  const handleExploreField = useCallback((fieldId: string) => {
    requestExperienceField(fieldId);
    handleSurface("explore");
  }, [handleSurface]);

  const handleResearchStarter = useCallback((question: string, symbol: string) => {
    setResearchStarter({ question, symbol });
    handleNav("research");
  }, [handleNav]);

  const handlePaneFocus = useCallback((paneId: PaneId) => {
    setWorkspace((current) => focusPane(current, paneId), `Focus ${paneId} pane`);
  }, [setWorkspace]);

  const updatePaneSymbolAndView = useCallback((paneId: PaneId, symbol: string, view?: ViewMode) => {
    if (view && !canOpenView(view)) return;
    setTabsState((current) => {
      const active = activeTerminalTab(current);
      const focused = focusPane(active.workspace, paneId);
      const nextWorkspace = view ? openSecurityView(focused, symbol, view) : openSymbolInWorkspace(focused, symbol);
      if (workspaceEqual(active.workspace, nextWorkspace)) return current;
      historyRef.current[active.id] = pushTerminalNavigation(
        historyRef.current[active.id] ?? createTerminalNavigationHistory(),
        active.workspace,
        nextWorkspace,
      );
      undoRef.current[active.id] = pushTerminalUndo(
        undoRef.current[active.id] ?? createTerminalUndoState<WorkspaceState>(),
        view ? `Open ${getTerminalCapability(view).label}` : `Open ${symbol.toUpperCase()}`,
        active.workspace,
        nextWorkspace,
        workspaceEqual,
      );
      let next = updateActiveTerminalWorkspace(current, nextWorkspace);
      if (active.linkGroupId) next = syncLinkedTerminalTabsSymbol(next, active.id, symbol);
      return next;
    });
  }, [canOpenView]);

  const handlePaneSymbol = useCallback((paneId: PaneId, symbol: string) => {
    updatePaneSymbolAndView(paneId, symbol);
  }, [updatePaneSymbolAndView]);

  const handlePaneNav = useCallback((paneId: PaneId, view: ViewMode) => {
    if (!canOpenView(view)) return;
    setWorkspace((current) => navigateFocusedPane(focusPane(current, paneId), view), `Open ${getTerminalCapability(view).label}`);
    prefetchPanelData(view);
  }, [canOpenView, setWorkspace]);

  const openAnalyticalSurface = useCallback((view: ViewMode, symbol?: string) => {
    if (!canOpenView(view)) return;
    if (view === "environment") {
      onOpenEnvironment();
      return;
    }
    const capability = getTerminalCapability(view);
    const normalized = capability.symbolAware ? symbol?.trim().toUpperCase() : undefined;
    const fallbackSymbol = normalized || activePane.symbol || "AAPL";
    setTabsState((current) => openTerminalTab(current, {
      kind: normalized ? "entity" : "workspace",
      entity: normalized ?? null,
      workspace: { primary: { view, symbol: fallbackSymbol }, secondary: null, focusedPane: "primary" },
    }));
    prefetchPanelData(view);
    recordCapabilityLaunch(view, "other");
  }, [activePane.symbol, canOpenView, onOpenEnvironment]);

  const handleOpenAction = useCallback((view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => {
    if (!canOpenView(view)) return;
    if (view === "environment") {
      onOpenEnvironment();
      return;
    }
    const capability = getTerminalCapability(view);
    const safeSymbol = capability.symbolAware ? (symbol?.trim().toUpperCase() || activePane.symbol) : undefined;
    handleSurface("workbench");
    if (mode === "tab") {
      openAnalyticalSurface(view, safeSymbol);
      return;
    }
    if (mode === "current") {
      if (safeSymbol) updatePaneSymbolAndView(workspace.focusedPane, safeSymbol, view);
      else handleNav(view);
      return;
    }
    const preferredPane = mode === "split-below" ? "tertiary" : undefined;
    setWorkspace(
      (current) => openViewInNewPane(current, view, safeSymbol || current.primary.symbol, preferredPane),
      `Open ${getTerminalCapability(view).label} in split`,
    );
    prefetchPanelData(view);
    recordCapabilityLaunch(view, "context-menu");
  }, [activePane.symbol, canOpenView, handleNav, handleSurface, onOpenEnvironment, openAnalyticalSurface, setWorkspace, updatePaneSymbolAndView, workspace.focusedPane]);

  useEffect(() => subscribeSafeWorkspaceActions((request) => {
    const action = request.action;
    if (action.type === "open-panel") {
      if (!isRegisteredView(action.view) || !canOpenView(action.view)) return;
      const mode: AnalyticalOpenMode = action.placement === "tab"
        ? "tab"
        : action.placement === "primary"
          ? "current"
          : "split-right";
      handleOpenAction(action.view, mode, action.symbol);
      return;
    }
    if (action.type === "focus-panel") {
      handlePaneFocus(action.paneId);
      return;
    }
    if (action.type === "close-panel") {
      if (action.paneId === "primary") return;
      setWorkspace((current) => closeWorkspacePane(current, action.paneId), `Close ${action.paneId} pane`);
      setMaximizedPane((current) => current === action.paneId ? null : current);
      return;
    }
    if (action.type === "propose-layout") {
      setPendingWorkspaceProposal(request);
    }
  }), [canOpenView, handleOpenAction, handlePaneFocus]);

  const applyPendingWorkspaceProposal = useCallback(() => {
    const action = pendingWorkspaceProposal?.action;
    if (!action || action.type !== "propose-layout") return;
    const proposed = sanitizeWorkspaceForAudience(workspaceForProposal(action.preset, activePane.symbol, audience), audience);
    setWorkspace(() => proposed, `Apply LiOS ${action.preset} workspace proposal`);
    setMaximizedPane(null);
    handleSurface("workbench");
    setPendingWorkspaceProposal(null);
  }, [activePane.symbol, audience, handleSurface, pendingWorkspaceProposal, setWorkspace]);

  const handleCommand = useCallback((command: ParsedTerminalCommand) => {
    if (command.navigation) {
      dispatchCanonicalNavigation(command.navigation, {
        openConnections: onOpenEnvironment,
        openProjectSection: (section) => {
          setProjectNavigation((current) => ({ id: (current?.id ?? 0) + 1, section }));
          handleSurface("projects");
        },
      });
    } else if (command.symbol) handleOpenAction(command.view, "tab", command.symbol);
    else handleOpenAction(command.view, "current");
    setCmdOpen(false);
  }, [handleOpenAction, handleSurface, onOpenEnvironment]);

  useEffect(() => subscribeDecisionReview(setReviewDecisionId), []);

  const handleNewTab = useCallback(() => setTabsState((current) => openTerminalTab(current)), []);

  const handleCloseTab = useCallback((tabId: string) => {
    setTabsState((current) => closeTerminalTab(current, tabId));
    delete historyRef.current[tabId];
    delete undoRef.current[tabId];
    setMaximizedPane(null);
  }, []);

  const handleDuplicateTab = useCallback((tab: TerminalTab) => {
    setTabsState((current) => openTerminalTab(current, {
      title: `${tab.title} copy`, kind: tab.kind, entity: tab.entity, groupId: tab.groupId,
      linkGroupId: tab.linkGroupId ?? null, linkScopes: tab.linkScopes, workspace: tab.workspace, pinned: false, preview: false, dirty: tab.dirty,
    }));
  }, []);

  const handleRenameTab = useCallback((tabId: string, title: string) => {
    setTabsState((current) => renameTerminalTab(current, tabId, title));
  }, []);

  const handleOpenRecent = useCallback((recent: RecentAnalyticalContext) => {
    if (recent.symbol) openAnalyticalSurface(recent.view, recent.symbol);
    else handleNav(recent.view);
  }, [handleNav, openAnalyticalSurface]);

  const renderPaneContent = useCallback((paneId: PaneId, pane: PaneState, chatControls?: ChatTerminalControls) => {
    const onSymbol = chatControls?.onSymbol ?? ((symbol: string) => handlePaneSymbol(paneId, symbol));
    const onNav = chatControls?.onNav ?? ((view: ViewMode) => handlePaneNav(paneId, view));
    let content: React.ReactNode;

    switch (pane.view) {
      case "missioncontrol": content = <MissionControlPanel tabs={tabsState.tabs} activeTabId={activeTab.id} activeSymbol={activePane.symbol} onResearchStarter={handleResearchStarter} onNav={handleNav} onSymbol={handleSymbol} onNewEntity={() => handleSymbol(activePane.symbol)} />; break;
      case "entity": content = <EntityWorkspacePanel symbol={pane.symbol} onNav={onNav} onSymbol={onSymbol} role={session.role} />; break;
      case "market": content = <MarketOverview activeSymbol={pane.symbol} onSymbol={onSymbol} onNav={onNav} />; break;
      case "quote": content = <QuotePanel symbol={pane.symbol} onNav={onNav} />; break;
      case "chart": content = <ChartPanel symbol={pane.symbol} onSymbol={chatControls ? onSymbol : (nextSymbol) => updatePaneSymbolAndView(paneId, nextSymbol, "chart")} />; break;
      case "news": content = <NewsPanel symbol={pane.symbol} />; break;
      case "agent": content = <AgentPanel magnetization={magnetization} onSymbol={onSymbol} onNav={onNav} context={askLiosContext ?? undefined} initialPrompt={askLiosPrompt ?? undefined} />; break;
      case "artifact": content = pane.artifact ? <WorkbenchArtifactPane key={pane.artifact.artifactId} context={pane.artifact} onVersionChange={(version) => handleWorkbenchVersion(paneId, version)} onDirtyChange={handleWorkbenchDirty} onReturn={handleReturnToChat} /> : <p role="alert">Choose an Artifact from Chat to open it in Workbench.</p>; break;
      case "screener": content = <ScreenerPanel onSymbol={onSymbol} />; break;
      case "watchlist": content = <WatchlistPanel activeSymbol={pane.symbol} onSymbol={onSymbol} role={session.role} />; break;
      case "alerts": content = <AlertsPanel onSymbol={onSymbol} role={session.role} />; break;
      case "economics": content = <EconomicsPanel />; break;
      case "portfolio": content = <PortfolioPanel symbol={pane.symbol} onSymbol={onSymbol} onNav={onNav} />; break;
      case "personalfinance": content = <PersonalFinancePanel />; break;
      case "montecarlo": content = <MonteCarloPanel symbol={pane.symbol} onSymbol={onSymbol} />; break;
      case "correlation": content = <CorrelationPanel onSymbol={onSymbol} />; break;
      case "options": content = <OptionsPanel symbol={pane.symbol} />; break;
      case "forex": content = <ForexPanel />; break;
      case "heatmap": content = <HeatMapPanel onSymbol={onSymbol} />; break;
      case "earnings": content = <EarningsPanel onSymbol={onSymbol} />; break;
      case "ising":
      case "optimizer":
      case "valuation":
      case "fixedincome":
      case "fractal":
      case "risknetwork":
      case "filingintel":
      case "quantum":
      case "hawkes":
      case "entropy":
      case "flow":
        content = <QuantDeskPanel view={pane.view} symbol={pane.symbol} magnetization={magnetization} setMagnetization={setMagnetization} orderIntensity={orderIntensity} setOrderIntensity={setOrderIntensity} linkIsingToQuantum={linkIsingToQuantum} setLinkIsingToQuantum={setLinkIsingToQuantum} linkHawkesToOptimizer={linkHawkesToOptimizer} setLinkHawkesToOptimizer={setLinkHawkesToOptimizer} onSymbol={onSymbol} onNav={onNav} />;
        break;
      case "macrostress": content = <MacroStressPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "sentiment": content = <SentimentPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "yieldcurve": content = <YieldCurvePanel onNav={onNav} onSymbol={onSymbol} />; break;
      case "peercomp": content = <PeerCompPanel symbol={pane.symbol || "AAPL"} onSymbol={onSymbol} onNav={onNav} />; break;
      case "ecalendar": content = <EconCalendarPanel onNav={onNav} onSymbol={onSymbol} />; break;
      case "crossasset": content = <CrossAssetPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "scanner": content = <ScannerPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "morningbrief": content = <MorningBriefPanel magnetization={magnetization} onSymbol={onSymbol} onNav={onNav} />; break;
      case "developer": content = isInternal ? <DeveloperConsolePanel onSymbol={onSymbol} onNav={onNav} /> : null; break;
      case "uide": content = isInternal ? <UideEnginePanel /> : null; break;
      case "workspaces": content = <WorkspacePanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "spreadsheet": content = <SpreadsheetStudioPanel symbol={pane.symbol} />; break;
      case "adminconsole": content = isInternal ? <AdminConsolePanel role={session.role} /> : null; break;
      case "consultinginbox": content = isInternal ? <ConsultingAdminInboxPanel role={session.role} /> : null; break;
      case "publishdesk": content = isInternal ? <PublishDeskPanel role={session.role} defaultDomain={domain} /> : null; break;
      case "qualitygate": content = isInternal ? <QualityGatePanel role={session.role} /> : null; break;
      case "research": content = isInternal ? <ResearchIntelligencePanel symbol={pane.symbol} role={session.role} starterQuestion={researchStarter?.question} starterSymbol={researchStarter?.symbol} /> : null; break;
      case "consensus": content = isInternal ? <ConsensusIntelligencePanel symbol={pane.symbol} role={session.role} /> : null; break;
      case "brain": content = isInternal ? <LimuriaBrainPanel symbol={pane.symbol} role={session.role} /> : null; break;
      case "decisionengine": content = isInternal ? <DecisionEnginePanel symbol={pane.symbol} role={session.role} /> : null; break;
      case "coveragemap": content = <CoverageMapPanel />; break;
      case "indicatorexplorer": content = <IndicatorExplorerPanel />; break;
      case "macrodashboard": content = <MacroDashboardPanel onNav={onNav} />; break;
      case "indicatorworkbench": content = <IndicatorWorkbenchPanel />; break;
      case "econsignals": content = <EconomicSignalsPanel />; break;
      case "econpolicyquant": content = <EconomicsPolicyQuantPanel />; break;
      case "supplychainindicators": content = <SupplyChainIndicatorPanel />; break;
      case "supplychaindashboard": content = <SupplyChainDashboardPanel onNav={onNav} />; break;
      case "supplychainquant": content = <SupplyChainQuantPanel />; break;
      case "environmentindicators": content = <EnvironmentIndicatorPanel />; break;
      case "environmentdashboard": content = <EnvironmentDashboardPanel onNav={onNav} />; break;
      case "environmentquant": content = <EnvironmentQuantPanel />; break;
      case "mediaindicators": content = <MediaTopicPanel />; break;
      case "mediadashboard": content = <MediaDashboardPanel onNav={onNav} />; break;
      case "tourismindicators": content = <TourismIndicatorPanel />; break;
      case "tourismdashboard": content = <TourismDashboardPanel onNav={onNav} />; break;
      case "insiders": content = <InsiderTradingPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "optionsflow": content = <OptionsFlowScannerPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "cotpositioning": content = <CotPositioningPanel />; break;
      case "globalindicators": content = <GlobalIndicatorExplorerPanel />; break;
      case "companyfundamentals": content = <CompanyFundamentalsPanel symbol={pane.symbol} />; break;
      case "financialstatements": content = <FinancialStatementsPanel symbol={pane.symbol} />; break;
      case "globaldevelopment": content = <GlobalDevelopmentPanel />; break;
      case "globalclimate": content = <GlobalClimatePanel />; break;
      case "carbonintensity": content = <CarbonIntensityPanel />; break;
      case "datastats": content = <DataStatsExplorerPanel symbol={pane.symbol} />; break;
      case "assetpricing": content = <AssetPricingPanel symbol={pane.symbol} />; break;
      case "advancedrisk": content = <AdvancedRiskPanel symbol={pane.symbol} />; break;
      case "quantworkbench": content = <QuantWorkbenchPanel />; break;
      case "quantregistry": content = QuantModelRegistryPanel ? <QuantModelRegistryPanel /> : null; break;
      case "quantlab": content = QuantLabPanel ? <QuantLabPanel /> : null; break;
      case "integratedmodel": content = IntegratedModelStudioPanel ? <IntegratedModelStudioPanel symbol={pane.symbol} /> : null; break;
      case "marketdatafabric": content = MarketDataFabricPanel ? <MarketDataFabricPanel symbol={pane.symbol} /> : null; break;
      case "economicdatafabric": content = EconomicDataFabricPanel ? <EconomicDataFabricPanel /> : null; break;
      case "universefabric": content = UniverseDataFabricPanel ? <UniverseDataFabricPanel /> : null; break;
      case "crossassetfabric": content = CrossAssetDataFabricPanel ? <CrossAssetDataFabricPanel symbol={pane.symbol} /> : null; break;
      case "enginereadiness": content = EngineReadinessPanel ? <EngineReadinessPanel /> : null; break;
      case "connectors": content = ConnectorRegistryPanel ? <ConnectorRegistryPanel /> : null; break;
      case "conflictdetector": content = <ConflictDetectorPanel symbol={pane.symbol} />; break;
      case "portfolioattribution": content = <PortfolioAttributionPanel />; break;
      case "shillercape": content = <ShillerCapePanel />; break;
      case "riskreturn": content = <RiskReturnScatterPanel />; break;
      case "marketbreadth": content = <MarketBreadthPanel />; break;
      case "sectorrotation": content = <SectorRotationPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "riskcalc": content = <RiskCalcPanel onNav={onNav} />; break;
      case "portfoliostress": content = <PortfolioStressPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "dividends": content = <DividendPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "shortinterest": content = <ShortInterestPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "regime": content = <RegimeClassifierPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "cryptochain": content = <CryptoChainPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "tradeideas": content = <TradeIdeaPanel onSymbol={onSymbol} onNav={onNav} />; break;
      case "backtesting": content = <BacktestPanel symbol={pane.symbol || "AAPL"} onNav={onNav} />; break;
      case "mnadesk": content = <MnaDealDeskPanel />; break;
      case "integration": content = <IntegrationTrackerPanel />; break;
      case "fpa": content = <FpaDashboardPanel />; break;
      case "advisory": content = isClient ? <AdvisoryPanel /> : null; break;
      case "activity": content = isClient ? <ActivityPanel role={session.role} /> : null; break;
      case "crossdomainfusion": content = isClient ? <CrossDomainFusionPanel /> : null; break;
      case "decisionmemory": content = isClient ? <DecisionMemoryPanel /> : null; break;
      case "clientdata": content = isClient ? <ClientDataPanel /> : null; break;
      default: content = <MarketOverview activeSymbol={activePane.symbol} onSymbol={onSymbol} onNav={onNav} />; break;
    }

    return (
      <PanelErrorBoundary key={`${paneId}:${pane.view}:${pane.symbol}`} paneLabel={pane.view}>
        <Suspense fallback={<PanelLoadingFallback />}>{content}</Suspense>
      </PanelErrorBoundary>
    );
  }, [
    activePane.symbol, activeTab.id, askLiosContext, askLiosPrompt, domain, handleNav, handlePaneNav, handlePaneSymbol, handleResearchStarter, linkHawkesToOptimizer, linkIsingToQuantum, magnetization, orderIntensity, researchStarter, session.role, tabsState.tabs,
    updatePaneSymbolAndView, handleWorkbenchVersion, handleWorkbenchDirty, handleReturnToChat,
  ]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!canHandleWorkspaceShortcut(event)) return;
      const ignore = shouldIgnoreCommandShortcut(event.target);
      const modifier = event.metaKey || event.ctrlKey;

      if (modifier && !event.shiftKey && !ignore && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setSwitcherOpen(true);
        return;
      }
      if (modifier && !ignore && event.key.toLowerCase() === "t") {
        event.preventDefault();
        if (event.shiftKey) setTabsState((current) => reopenTerminalTab(current));
        else handleNewTab();
        return;
      }
      if (modifier && !ignore && event.key.toLowerCase() === "w") {
        event.preventDefault();
        handleCloseTab(tabsState.activeTabId);
        return;
      }
      if (modifier && !ignore && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (modifier && !ignore && /^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const tab = tabsState.tabs[Number(event.key) - 1];
        if (tab) setTabsState((current) => activateTerminalTab(current, tab.id));
        return;
      }
      if (!ignore && event.altKey && event.key === "ArrowLeft") {
        event.preventDefault();
        handleHistoryBack();
        return;
      }
      if (!ignore && event.altKey && event.key === "ArrowRight") {
        event.preventDefault();
        handleHistoryForward();
        return;
      }
      if (event.key.toLowerCase() === "k" && modifier && event.shiftKey && isProjectsSurface) {
        event.preventDefault();
        window.dispatchEvent(new Event("lios:open-work-search"));
        return;
      }
      if ((event.key.toLowerCase() === "k" && modifier) || (event.key === "/" && !ignore)) {
        event.preventDefault();
        setCmdOpen(true);
        return;
      }
      if (event.key === "Escape") {
        setCmdOpen(false);
        setSwitcherOpen(false);
      }

      const workspaceAction = getWorkspaceShortcutAction(event);
      if (!workspaceAction) return;
      event.preventDefault();
      if (workspaceAction === "focus-primary") setWorkspace((current) => focusPane(current, "primary"), "Focus primary pane");
      if (workspaceAction === "focus-secondary") setWorkspace((current) => focusPane(current, "secondary"), "Focus secondary pane");
      if (workspaceAction === "close-secondary") {
        setWorkspace((current) => closeWorkspacePane(current, "secondary"), "Close secondary pane");
        setMaximizedPane(null);
      }
      if (workspaceAction === "toggle-maximize") setMaximizedPane((current) => current ? null : workspace.focusedPane);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleCloseTab, handleHistoryBack, handleHistoryForward, handleNewTab, handleRedo, handleUndo, isProjectsSurface, setWorkspace, tabsState.activeTabId, tabsState.tabs, workspace.focusedPane]);

  const updatePreferences = useCallback((next: TerminalUxPreferences) => {
    saveTerminalUxPreferences(next);
    setUxPreferences(next);
  }, []);

  const updateDensity = useCallback((density: TerminalUxPreferences["density"]) => {
    updatePreferences(patchTerminalUxPreferences(uxPreferences, { density }));
  }, [updatePreferences, uxPreferences]);

  const exitCanvasMode = useCallback(() => {
    updatePreferences(patchTerminalUxPreferences(uxPreferences, { focusMode: false, presentationMode: false }));
  }, [updatePreferences, uxPreferences]);

  return (
    <TerminalArtifactRendererProvider value={{ audience, render: (context, controls) => renderPaneContent("primary", { view: context.view, symbol: context.symbol ?? "" }, controls) }}>
    <NativeArtifactDraftOwnerContext.Provider value={session.email ?? null}>
    <div
      className="terminal-root flex h-screen flex-col overflow-hidden bg-background"
      data-density={uxPreferences.density}
      data-experience-mode={uxPreferences.experienceMode}
      data-intelligent-calm={intelligentCalm ? "true" : "false"}
      data-comfort-mode={uxPreferences.comfortMode ? "true" : "false"}
      data-focus-mode={focusMode ? "true" : "false"}
      data-presentation-mode={presentationMode ? "true" : "false"}
      data-reduced-motion={uxPreferences.reducedMotion ? "true" : "false"}
      data-low-resource-mode={uxPreferences.lowResourceMode ? "true" : "false"}
      data-visual-environments={uxPreferences.visualEnvironmentsEnabled ? "true" : "false"}
      data-text-scale={uxPreferences.textScale}
    >
      {!focusMode && !presentationMode && <PWAInstallBanner />}
      {!focusMode && !presentationMode
        && (session.offline || session.licenseReason === "license_in_grace" || session.licenseReason === "license_billing_hold")
        && (
          <LicenseStatusBanner
            reason={(session.offline ? "offline_lease_authorized" : session.licenseReason) as LicenseBannerReason}
            graceEndsAt={session.licenseGraceEndsAt ?? null}
          />
        )}

      {!presentationMode && showDenseChrome && (
        <TopBar activeSymbol={activePane.symbol} view={activePane.view} onNav={handleNav} onSymbol={handleSymbol} onOpenCmd={() => setCmdOpen(true)} onAskLios={handleAskLios} session={session} onLogout={onLogout} domain={domain} onSwitchDomain={onSwitchDomain} />
      )}

      {!presentationMode && showDenseChrome && pendingWorkspaceProposal?.action.type === "propose-layout" && (
        <div className="flex shrink-0 items-center gap-3 border-b border-amber-300/20 bg-amber-300/[0.04] px-3 py-2">
          <span className="font-terminal text-[7px] uppercase tracking-wider text-amber-200">LiOS workspace proposal</span>
          <span className="min-w-0 flex-1 truncate font-ui text-[8px] text-muted-foreground">
            {pendingWorkspaceProposal.action.reason} · {pendingWorkspaceProposal.action.preset.replace("-", " ")}
          </span>
          <button
            type="button"
            onClick={applyPendingWorkspaceProposal}
            className="rounded border border-amber-300/30 px-2.5 py-1 font-ui text-[7px] font-medium text-amber-100 hover:bg-amber-300/[0.08]"
          >
            Apply
          </button>
          <button
            type="button"
            onClick={() => setPendingWorkspaceProposal(null)}
            className="px-2 py-1 font-ui text-[7px] text-muted-foreground hover:text-foreground"
          >
            Dismiss
          </button>
        </div>
      )}

      {!presentationMode && showDenseChrome && (
        <div className="flex min-w-0 shrink-0 items-stretch border-b border-border bg-[#080808]">
          <div className="flex shrink-0 items-stretch border-r border-border" aria-label="Analytical history">
            <button onClick={handleHistoryBack} disabled={!canGoBack} className="flex w-8 items-center justify-center font-terminal text-[12px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground disabled:opacity-25" title="Back (Alt+Left)" aria-label="Back in analytical history">←</button>
            <button onClick={handleHistoryForward} disabled={!canGoForward} className="flex w-8 items-center justify-center border-l border-border font-terminal text-[12px] text-muted-foreground hover:bg-white/[0.04] hover:text-foreground disabled:opacity-25" title="Forward (Alt+Right)" aria-label="Forward in analytical history">→</button>
          </div>
          <div className="min-w-0 flex-1"><ContextRibbon view={activePane.view} isInternal={isInternal} onNav={handleNav} /></div>
          <div className="hidden shrink-0 items-center border-l border-border px-1 lg:flex"><TerminalTimeContextControl view={activePane.view} context={timeContext} onChange={setTimeContext} /></div>
          <TerminalTabBar className="w-[42%] border-b-0 border-l border-border" tabs={tabsState.tabs} activeTabId={tabsState.activeTabId} hasClosedTabs={tabsState.closedTabs.length > 0} onActivate={(tabId) => setTabsState((current) => activateTerminalTab(current, tabId))} onNew={handleNewTab} onClose={handleCloseTab} onReopen={() => setTabsState((current) => reopenTerminalTab(current))} onTogglePin={(tabId) => setTabsState((current) => toggleTerminalTabPin(current, tabId))} onDuplicate={handleDuplicateTab} onGroup={(tabId, groupId) => setTabsState((current) => setTerminalTabGroup(current, tabId, groupId))} onLinkGroup={(tabId, groupId: TerminalLinkGroup | null) => setTabsState((current) => setTerminalTabLinkGroup(current, tabId, groupId))} onLinkScopes={(tabId, scopes) => setTabsState((current) => setTerminalTabLinkScopes(current, tabId, scopes))} onMove={(sourceTabId, targetTabId) => setTabsState((current) => moveTerminalTab(current, sourceTabId, targetTabId))} onRename={handleRenameTab} />
        </div>
      )}

      {uxPreferences.showTickerTape && !focusMode && !presentationMode && showDenseChrome && <TickerTape onSymbol={handleSymbol} />}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!focusMode && !presentationMode && showSidebarNav && <div className="hidden md:flex"><Sidebar view={activePane.view} surface={experienceSurface} onNav={handleNav} onSurface={handleSurface} domain={domain} lifecycleStage={session.lifecycleStage} /></div>}
        <main
          className={`relative min-w-0 flex-1 overflow-hidden ${isProjectsSurface ? "bg-transparent" : "bg-background"}`}
          data-visual-host="true"
        >
          <VisualCanvas
            surface={experienceSurface}
            activeView={activePane.view}
            focusMode={focusMode}
            presentationMode={presentationMode}
            preferences={uxPreferences}
          />
          <div className="relative z-[1] h-full min-h-0 min-w-0">
          <div className={isProjectsSurface ? "h-full min-h-0" : "hidden"} aria-hidden={!isProjectsSurface}>
            <ProjectExperienceShell
              navigationRequest={projectNavigation}
              onNavigationContext={setNavigationContext}
              onOpenCommand={() => setCmdOpen(true)}
              account={{ name: session.name, email: session.email }}
              onLogout={onLogout}
              onOpenSettings={() => openTerminalUxSurface("settings")}
              audience={audience}
              activeView={activePane.view}
              activeSymbol={getTerminalCapability(activePane.view).symbolAware ? activePane.symbol : undefined}
              workspaceAdapter={livingWorkspaceAdapter}
              onOpenWorkbench={handleOpenWorkbench}
              workbenchReturn={workbenchReturn}
              renderTerminalPanel={(context, controls) => renderPaneContent("primary", { view: context.view, symbol: context.symbol ?? "" }, controls)}
              chatWorkbenchReturn={chatWorkbenchReturn}
              onOpenEnvironment={onOpenEnvironment}
            />
          </div>
          {isProjectsSurface ? null : isExperienceHomeSurface(experienceSurface) ? (
            <WaveCExperienceShell
              embedded
              surface={experienceSurface}
              onSurfaceChange={handleSurface}
              activeView={activePane.view}
              activeSymbol={getTerminalCapability(activePane.view).symbolAware ? activePane.symbol : undefined}
              onOpen={handleOpenAction}
              onAskLios={handleAskLios}
            />
          ) : (
          <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden" data-testid="workbench-canvas">
            {chatWorkbenchOriginRef.current && !artifactHandoffRef.current && <button type="button" data-testid="workbench-return-chat-general" disabled={workbenchDirty} onClick={returnFromGeneralWorkbench} className="shrink-0 border-b border-border p-2 text-left text-sm">Return to Chat</button>}
            {workbenchDirty && <p role="status" className="shrink-0 border-b border-amber-300/30 p-2 text-sm text-amber-200">Unsaved Artifact edits · save or reset in the Artifact pane before leaving this workspace.</p>}
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <DockviewWorkspaceGrid
                workspace={workspace}
                isMobile={isMobile}
                preserveArtifactDraft={workbenchDirty}
                maximizedPane={maximizedPane}
                onFocus={handlePaneFocus}
                onClose={(paneId) => { setWorkspace((current) => closeWorkspacePane(current, paneId), `Close ${paneId} pane`); if (maximizedPane === paneId) setMaximizedPane(null); }}
                onToggleMaximize={(paneId) => setMaximizedPane((current) => current === paneId ? null : paneId)}
                onOpenActions={(paneId, pane, x, y) => requestTerminalContextMenu({ paneId, view: pane.view, symbol: getTerminalCapability(pane.view).symbolAware ? pane.symbol : undefined, x, y })}
                renderPane={renderPaneContent}
                density={uxPreferences.density}
              />
            </div>
          </div>
          )}
          </div>
        </main>
        {!focusMode && !presentationMode && showDenseChrome && (
          <ContextRail view={activePane.view} symbol={activePane.symbol} open={contextRailOpen} onToggle={() => setContextRailOpen((current) => !current)} onNav={handleNav} onNewTab={handleNewTab} onSymbol={handleSymbol} onOpenCmd={() => setCmdOpen(true)} density={uxPreferences.density} onDensityChange={updateDensity} isInternal={isInternal} onOpenLayout={() => setLayoutOpen(true)} />
        )}
      </div>

      {cmdOpen && <CommandBar audience={audience} navigationContext={isProjectsSurface ? navigationContext : `Workspace · ${activePane.symbol ?? "no security selected"}; saved Project/Chat retained`} onClose={() => setCmdOpen(false)} onExecute={handleCommand} onAskLios={handleAskLios} onExploreField={handleExploreField} />}

      {switcherOpen && <QuickSwitcher tabs={tabsState.tabs} activeTabId={tabsState.activeTabId} favorites={loadTerminalFavorites()} recents={recentContexts} onActivateTab={(tabId) => setTabsState((current) => activateTerminalTab(current, tabId))} onOpenView={handleNav} onOpenRecent={handleOpenRecent} onClose={() => setSwitcherOpen(false)} />}

      {layoutOpen && <LayoutManager onClose={() => setLayoutOpen(false)} currentWorkspace={workspace} onApplyLayout={(layout) => setWorkspace(() => sanitizeWorkspaceForAudience(layout, audience), "Apply workspace layout")} />}
      <Dialog open={reviewDecisionId !== null} onOpenChange={open => { if (!open) setReviewDecisionId(null); }}>
        <DialogContent className="flex h-[90dvh] w-[96vw] max-w-[96vw] flex-col overflow-hidden p-3">
          <DialogTitle>Canonical Decision review · case {reviewDecisionId}</DialogTitle>
          <DialogDescription>Review the exact case without leaving your Project, Chat or saved Artifact. Closing returns to the same work. Reading is not approval or execution; current server grants apply.</DialogDescription>
          <div className="min-h-0 flex-1 overflow-hidden">
            {reviewDecisionId !== null && <PanelErrorBoundary paneLabel="Canonical Decision review"><Suspense fallback={<p role="status">Loading exact canonical case…</p>}><DecisionEnginePanel key={reviewDecisionId} initialDecisionId={reviewDecisionId} symbol="" role={session.role} /></Suspense></PanelErrorBoundary>}
          </div>
        </DialogContent>
      </Dialog>

      {uxPreferences.showMacroTickerTape && !focusMode && !presentationMode && showDenseChrome && <MacroTickerTape onSymbol={handleSymbol} />}
      {showDenseChrome && !isClient && uxPreferences.density === "terminal" && !intelligentCalm && !focusMode && !presentationMode && <FunctionBar onNav={handleNav} onOpenCmd={() => setCmdOpen(true)} onOpenLayouts={() => setLayoutOpen(true)} onOpenWorkbench={() => handleSurface("workbench")} />}

      {(focusMode || presentationMode) && (
        <div className="fixed right-2 top-2 z-[60] flex items-center gap-1 border border-border bg-[#080808]/95 p-1 shadow-xl">
          <button onClick={() => setCmdOpen(true)} className="border border-border px-2 py-1.5 font-terminal text-[7px] text-amber-300 hover:bg-white/[0.04]">⌘K SEARCH</button>
          <button onClick={() => handleSurface("workbench")} className="border border-border px-2 py-1.5 font-terminal text-[7px] text-cyan-300 hover:bg-white/[0.04]">WORKBENCH</button>
          <button onClick={exitCanvasMode} className="border border-border px-2 py-1.5 font-terminal text-[7px] text-muted-foreground hover:text-foreground">EXIT {presentationMode ? "PRESENTATION" : "FOCUS"}</button>
        </div>
      )}

      <TerminalUxOverlays experienceSurface={experienceSurface} activeView={activePane.view} activeSymbol={getTerminalCapability(activePane.view).symbolAware ? activePane.symbol : undefined} workspace={workspace} isInternal={isInternal} preferences={uxPreferences} onPreferencesChange={updatePreferences} onOpen={handleOpenAction} onApplyWorkspace={applyWorkspace} />
    </div>
    </NativeArtifactDraftOwnerContext.Provider>
    </TerminalArtifactRendererProvider>
  );
}


