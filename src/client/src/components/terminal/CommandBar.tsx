import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Clock3, Command, Database, Gauge, Layers3, Search, Sparkles, Star, TerminalSquare, TrendingUp, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CapabilityDiscoveryResult } from "@shared/capabilityDiscovery";
import { searchDynamicAnalyticsCatalog, type DynamicAnalyticsField } from "@shared/waveCContracts";
import { CANONICAL_NAVIGATION, searchCanonicalNavigation, type CanonicalNavigationTarget, type ParsedTerminalCommand } from "@/lib/terminalCommands";
import type { WorkspaceAudience } from "@/lib/featureRegistry";
import type { ViewMode } from "@/lib/terminalTypes";
import { parseFlexibleTerminalCommand } from "@/lib/terminalIntentCommands";
import { getTerminalCapability, searchTerminalCapabilities, type TerminalCapability } from "@/lib/terminalCatalog";
import {
  capabilityDiscoveryView,
  fetchUniversalCapabilityDiscovery,
} from "@/lib/universalCapabilityDiscovery";
import {
  loadRecentAnalyticalContexts, loadTerminalFavorites, recordRecentAnalyticalContext,
  saveRecentAnalyticalContexts, type RecentAnalyticalContext,
} from "@/lib/terminalPersonalization";
import { getVisibleWorkspaces, getWorkspaceDefinition, isViewVisibleToAudience, type WorkspaceKey } from "@/lib/featureRegistry";
import { browseRegisteredSpecialists } from "@/lib/contextualSpecialistDiscovery";
import { rankSecuritySearchResults, type SecuritySearchResult } from "@/lib/terminalSecuritySearch";
import { useGuidedMode } from "@/hooks/use-guided-mode";
import { useAudience } from "@/lib/audience";
import { prefetchLikelyDestination } from "@/lib/prefetch";

interface Props {
  onClose: () => void;
  onExecute: (command: ParsedTerminalCommand) => void;
  onAskLios?: (question: string) => void;
  onExploreField?: (fieldId: string) => void;
  audience: WorkspaceAudience;
  navigationContext?: string;
  activeView?: ViewMode;
}

type LauncherMode = "all" | "tools" | "entities" | "mine" | "favorites" | "recent";

type LauncherResult = {
  key: string;
  type: "intent" | "tool" | "entity" | "favorite" | "recent" | "data" | "ask";
  title: string;
  subtitle: string;
  meta: string;
  icon: LucideIcon;
  command: ParsedTerminalCommand;
  capability?: TerminalCapability;
  askQuestion?: string;
  fieldId?: string;
  relatedReason?: string;
};

const MODES: readonly { id: LauncherMode; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "Everything", icon: Search },
  { id: "tools", label: "Tools", icon: Layers3 },
  { id: "entities", label: "Entities", icon: TrendingUp },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "recent", label: "Recent", icon: Clock3 },
];

const RETAIL_MODES: readonly { id: LauncherMode; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "All", icon: Search },
  { id: "entities", label: "Companies", icon: TrendingUp },
  { id: "tools", label: "Tools", icon: Layers3 },
  { id: "mine", label: "My LiOS", icon: Star },
];

const RESULT_TONE: Record<LauncherResult["type"], string> = {
  intent: "border-amber-400/25 bg-amber-400/[0.055] text-amber-300",
  entity: "border-cyan-400/22 bg-cyan-400/[0.045] text-cyan-300",
  favorite: "border-amber-400/18 bg-amber-400/[0.03] text-amber-300/80",
  recent: "border-violet-400/18 bg-violet-400/[0.03] text-violet-300/80",
  tool: "border-border/60 bg-black/10 text-muted-foreground",
  data: "border-emerald-400/22 bg-emerald-400/[0.045] text-emerald-300",
  ask: "border-fuchsia-400/22 bg-fuchsia-400/[0.045] text-fuchsia-300",
};

const NATURAL_QUESTION = /^(why|what|how|explain|summari[sz]e|compare|tell|should|is|are|does|do|can|could|would|which|where|when)\b/i;

function resultSection(result: LauncherResult): string {
  if (result.type === "intent") return "Best action";
  if (result.type === "ask") return "Ask LiOS";
  if (result.type === "entity") return "Companies & securities";
  if (result.type === "data") return "Data & metrics";
  if (result.type === "favorite" || result.type === "recent") return "My LiOS";
  if (result.type === "tool" && result.relatedReason) return "Related to current panel";
  return "Tools";
}

function commandForCapability(capability: TerminalCapability): ParsedTerminalCommand {
  return { raw: capability.shortLabel, view: capability.view };
}

function resultFromCapability(capability: TerminalCapability, type: "tool" | "favorite" = "tool", relatedReason?: string): LauncherResult {
  const workspace = getWorkspaceDefinition(capability.workspace);
  return {
    key: `${type}:${capability.view}`,
    type,
    title: capability.label,
    subtitle: capability.description,
    meta: `${workspace.shortLabel} · ${capability.shortLabel}`,
    icon: capability.hero ? Sparkles : Layers3,
    command: commandForCapability(capability),
    capability,
    ...(relatedReason ? { relatedReason } : {}),
  };
}
const DISCOVERY_NAVIGATION_TARGETS: Readonly<Record<string, CanonicalNavigationTarget | undefined>> = {
  "lios.runtime.doctor": "doctor", "lios.projects": "projects",
  "lios.artifacts": "library", "lios.automations": "automations",
};

function resultFromUniversalCapability(result: CapabilityDiscoveryResult): LauncherResult | null {
  const navigationTarget = DISCOVERY_NAVIGATION_TARGETS[result.capabilityId];
  const navigation = CANONICAL_NAVIGATION.find((entry) => entry.target === navigationTarget);
  if (navigation) return {
    key: `navigation:${navigation.target}`, type: "intent", title: navigation.label,
    subtitle: navigation.description, meta: "OPEN · EXISTING SURFACE · NO AI", icon: Layers3,
    command: { raw: result.name, view: "missioncontrol", navigation: navigation.target },
  };
  const view = capabilityDiscoveryView(result);
  if (!view) return null;
  const capability = getTerminalCapability(view);
  return {
    key: `universal:${result.capabilityId}`,
    type: "tool",
    title: result.name,
    subtitle: result.description,
    meta: `LIOS · ${result.category}${result.invocable ? " · RUNNABLE" : ""}`,
    icon: result.invocable ? Sparkles : Layers3,
    command: { raw: result.name, view },
    capability,
  };
}

function resultFromRecent(recent: RecentAnalyticalContext): LauncherResult {
  const capability = getTerminalCapability(recent.view);
  return {
    key: `recent:${recent.key}`,
    type: "recent",
    title: recent.label,
    subtitle: capability.description,
    meta: "RECENT ANALYSIS",
    icon: Clock3,
    command: {
      raw: recent.symbol ? `${recent.symbol} ${capability.shortLabel}` : capability.shortLabel,
      symbol: recent.symbol || undefined,
      view: recent.view,
    },
    capability,
  };
}

function resultFromDataField(field: DynamicAnalyticsField): LauncherResult {
  return {
    key: `data:${field.id}`,
    type: "data",
    title: field.label,
    subtitle: [field.family, field.unit ?? field.type].filter(Boolean).join(" · "),
    meta: "DATA",
    icon: Database,
    command: { raw: field.id, view: "screener" },
    fieldId: field.id,
  };
}

function resultFromSecurity(security: SecuritySearchResult): LauncherResult {
  const symbol = security.symbol.toUpperCase();
  return {
    key: `entity:${symbol}:${security.exchange ?? ""}`,
    type: "entity",
    title: symbol,
    subtitle: security.name,
    meta: [security.exchange, security.region, security.assetClass].filter(Boolean).join(" · ") || "SECURITY",
    icon: TrendingUp,
    command: { raw: symbol, symbol, view: "quote" },
  };
}

export default function CommandBar({ onClose, onExecute, onAskLios, onExploreField, audience, navigationContext, activeView }: Props) {
  const isClient = useAudience() === "client";
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<LauncherMode>("all");
  const [workspaceFilter, setWorkspaceFilter] = useState<WorkspaceKey | "all">("all");
  const [selected, setSelected] = useState(0);
  const [remoteEntities, setRemoteEntities] = useState<SecuritySearchResult[]>([]);
  const [universalCapabilities, setUniversalCapabilities] = useState<CapabilityDiscoveryResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [discoveringTools, setDiscoveringTools] = useState(false);
  const [favorites] = useState<ViewMode[]>(() => loadTerminalFavorites());
  const [recents, setRecents] = useState<RecentAnalyticalContext[]>(() => loadRecentAnalyticalContexts());
  const inputRef = useRef<HTMLInputElement>(null);
  const guided = useGuidedMode();
  const availableModes = isClient ? RETAIL_MODES : MODES;
  const visibleWorkspaces = useMemo(() => getVisibleWorkspaces(audience), [audience]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const parsedCommand = useMemo(() => parseFlexibleTerminalCommand(query), [query]);
  const normalizedQuery = query.trim();

  useEffect(() => {
    const raw = normalizedQuery;
    if (parsedCommand?.navigation || raw.length < 2 || mode === "tools" || mode === "mine" || mode === "favorites" || mode === "recent") {
      setRemoteEntities([]);
      setSearching(false);
      return;
    }
    const searchTerm = parsedCommand?.symbol && parsedCommand.raw.includes(" ") ? parsedCommand.symbol : raw;
    if (searchTerm.length < 2) return;

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/finance/search?q=${encodeURIComponent(searchTerm)}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Search failed with ${response.status}`);
        const data: unknown = await response.json();
        const valid = Array.isArray(data)
          ? data.filter((item): item is SecuritySearchResult => Boolean(item && typeof item === "object" && typeof (item as SecuritySearchResult).symbol === "string" && typeof (item as SecuritySearchResult).name === "string"))
          : [];
        setRemoteEntities(rankSecuritySearchResults(valid, searchTerm).slice(0, 8));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setRemoteEntities([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 130);

    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [normalizedQuery, mode, parsedCommand]);

  useEffect(() => {
    if (parsedCommand?.navigation || audience !== "internal" || normalizedQuery.length < 2 || mode === "entities" || mode === "mine" || mode === "favorites" || mode === "recent") {
      setUniversalCapabilities([]);
      setDiscoveringTools(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setDiscoveringTools(true);
      try {
        setUniversalCapabilities(await fetchUniversalCapabilityDiscovery(normalizedQuery, {
          signal: controller.signal,
          limit: mode === "tools" ? 14 : 9,
        }));
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setUniversalCapabilities([]);
      } finally {
        if (!controller.signal.aborted) setDiscoveringTools(false);
      }
    }, 90);

    return () => { controller.abort(); window.clearTimeout(timeout); };
  }, [audience, mode, normalizedQuery, parsedCommand?.navigation]);

  const browsedSpecialists = useMemo(() => mode === "tools"
    ? browseRegisteredSpecialists({ query: normalizedQuery, audience, activeView, workspace: workspaceFilter })
    : [], [activeView, audience, mode, normalizedQuery, workspaceFilter]);

  const toolResults = useMemo(() => {
    if (mode === "entities" || mode === "recent") return [];
    const favoritesOnly = mode === "favorites" || mode === "mine";
    const queryForTools = favoritesOnly ? "" : normalizedQuery;
    if (mode === "tools") return browsedSpecialists.map(({ capability, relatedReason }) => resultFromCapability(capability, "tool", normalizedQuery ? undefined : relatedReason));
    const capabilities = favoritesOnly
      ? favorites.map(getTerminalCapability)
      : searchTerminalCapabilities(queryForTools, audience === "internal", 10);
    return capabilities
      .filter((capability) => isViewVisibleToAudience(capability.view, audience))
      .filter((capability) => !favoritesOnly || !normalizedQuery || [capability.label, capability.shortLabel, ...capability.keywords].join(" ").toLowerCase().includes(normalizedQuery.toLowerCase()))
      .map((capability) => resultFromCapability(capability, favoritesOnly ? "favorite" : "tool"));
  }, [audience, browsedSpecialists, favorites, mode, normalizedQuery]);

  const universalToolResults = useMemo(() => {
    if (mode === "entities" || mode === "favorites" || mode === "recent") return [];
    return universalCapabilities
      .map(resultFromUniversalCapability)
      .filter((result): result is LauncherResult => Boolean(result))
      .filter((result) => isViewVisibleToAudience(result.command.view, audience));
  }, [audience, mode, universalCapabilities]);

  const recentResults = useMemo(() => {
    if (mode !== "all" && mode !== "recent" && mode !== "mine") return [];
    const filtered = normalizedQuery ? recents.filter((recent) => recent.label.toLowerCase().includes(normalizedQuery.toLowerCase())) : recents;
    return filtered
      .filter((recent) => isViewVisibleToAudience(recent.view, audience))
      .slice(0, mode === "recent" || mode === "mine" ? 18 : 6)
      .map(resultFromRecent);
  }, [audience, mode, normalizedQuery, recents]);

  const entityResults = useMemo(() => {
    if (mode === "tools" || mode === "mine" || mode === "favorites" || mode === "recent") return [];
    return remoteEntities.map(resultFromSecurity);
  }, [mode, remoteEntities]);

  const dataResults = useMemo(() => {
    if (!onExploreField || mode !== "all" || normalizedQuery.length < 2) return [];
    const seenLabels = new Set<string>();
    return searchDynamicAnalyticsCatalog(normalizedQuery, 12)
      .filter((field) => {
        const key = field.label.trim().toLowerCase();
        if (seenLabels.has(key)) return false;
        seenLabels.add(key);
        return true;
      })
      .slice(0, 6)
      .map(resultFromDataField);
  }, [mode, normalizedQuery, onExploreField]);

  const navigationResults = useMemo<LauncherResult[]>(() => {
    if (mode === "entities" || mode === "favorites" || mode === "recent" || (mode === "tools" && !normalizedQuery)) return [];
    return searchCanonicalNavigation(normalizedQuery).map((entry) => ({
      key: `navigation:${entry.target}`, type: "intent", title: entry.label,
      subtitle: `${entry.description}${navigationContext ? ` Current context: ${navigationContext}.` : " Current selection is retained."}`,
      meta: "OPEN · EXISTING SURFACE · NO AI", icon: Layers3,
      command: { raw: entry.label, view: "missioncontrol", navigation: entry.target },
    }));
  }, [mode, normalizedQuery, navigationContext]);

  const intentResult = useMemo<LauncherResult[]>(() => {
    if (!normalizedQuery || !parsedCommand || parsedCommand.navigation || mode === "mine" || mode === "favorites" || mode === "recent") return [];
    if (!isViewVisibleToAudience(parsedCommand.view, audience)) return [];
    const capability = getTerminalCapability(parsedCommand.view);
    const symbol = parsedCommand.symbol;
    return [{
      key: `intent:${parsedCommand.raw}`,
      type: "intent",
      title: symbol ? `${capability.label} · ${symbol}` : capability.label,
      subtitle: symbol ? `Execute ${capability.label} in the ${symbol} analytical context.` : capability.description,
      meta: `EXECUTE · ${parsedCommand.raw}`,
      icon: TerminalSquare,
      command: parsedCommand,
      capability,
    }];
  }, [audience, mode, normalizedQuery, parsedCommand]);

  const askResult = useMemo<LauncherResult[]>(() => {
    if (!isClient || !onAskLios || mode !== "all" || !normalizedQuery || parsedCommand) return [];
    if (!normalizedQuery.includes(" ") && !normalizedQuery.endsWith("?")) return [];
    return [{
      key: `ask:${normalizedQuery}`,
      type: "ask",
      title: "Ask LiOS",
      subtitle: normalizedQuery,
      meta: "AI · YOUR PROVIDER",
      icon: Sparkles,
      command: { raw: normalizedQuery, view: "agent" },
      askQuestion: normalizedQuery,
    }];
  }, [mode, normalizedQuery, onAskLios, parsedCommand]);

  const results = useMemo(() => {
    const seen = new Set<string>();
    const questionLike = NATURAL_QUESTION.test(normalizedQuery) || normalizedQuery.endsWith("?");
    const ordered = questionLike
      ? [...navigationResults, ...askResult, ...intentResult, ...entityResults, ...dataResults, ...recentResults, ...universalToolResults, ...toolResults]
      : [...navigationResults, ...intentResult, ...entityResults, ...dataResults, ...recentResults, ...universalToolResults, ...toolResults, ...askResult];
    return ordered.filter((result) => {
      if (parsedCommand?.navigation && !result.command.navigation) return false;
      const identity = result.command.navigation ? `navigation:${result.command.navigation}` : result.type === "ask"
        ? `ask:${result.askQuestion}`
        : result.type === "data"
          ? `data:${result.fieldId}`
          : `${result.command.view}:${result.command.symbol ?? ""}:${result.type === "intent" ? "intent" : "result"}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }).slice(0, 24);
  }, [askResult, dataResults, entityResults, intentResult, navigationResults, normalizedQuery, parsedCommand?.navigation, recentResults, toolResults, universalToolResults]);

  useEffect(() => {
    setSelected((current) => Math.max(0, Math.min(current, Math.max(0, results.length - 1))));
  }, [results.length]);

  const selectedResult = results[selected] ?? null;

  useEffect(() => {
    if (!selectedResult || selectedResult.command.navigation || selectedResult.type === "ask" || selectedResult.type === "data") return;
    prefetchLikelyDestination(selectedResult.command.view, selectedResult.command.symbol);
  }, [selectedResult]);

  function execute(result: LauncherResult) {
    if (result.command.navigation) { onExecute(result.command); return; }
    if (result.type === "data" && result.fieldId && onExploreField) {
      onExploreField(result.fieldId);
      onClose();
      return;
    }
    if (result.type === "ask" && result.askQuestion && onAskLios) {
      onAskLios(result.askQuestion);
      onClose();
      return;
    }
    const nextRecents = recordRecentAnalyticalContext(recents, result.command.view, result.command.symbol);
    setRecents(nextRecents);
    saveRecentAnalyticalContexts(nextRecents);
    onExecute(result.command);
  }

  function handleKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setSelected((index) => Math.min(index + 1, Math.max(0, results.length - 1))); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelected((index) => Math.max(index - 1, 0)); return; }
    if (event.key === "Tab" && !event.shiftKey) { event.preventDefault(); const current = availableModes.findIndex((item) => item.id === mode); setMode(availableModes[(current + 1) % availableModes.length].id); setSelected(0); return; }
    if (event.key === "Enter" && selectedResult) { event.preventDefault(); execute(selectedResult); return; }
    if (event.key === "Escape") onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-3 pt-[7vh] backdrop-blur-[5px]" onMouseDown={onClose}>
      <section className={`lios-v4-overlay w-full overflow-hidden rounded-2xl ${isClient ? "max-w-3xl" : "max-w-5xl"}`} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="LiOS Omnibox">
        <header className="border-b border-border/55">
          <div className="flex items-center gap-3 px-4 py-4 sm:px-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/[0.055]"><Command className="h-4 w-4 text-amber-300" /></div>
            <div className="min-w-0 flex-1">
              <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={handleKey} placeholder={isClient ? "Search companies, data, tools or actions…" : "Search or act — DCF NVDA · India inflation · portfolio stress · peer comps…"} className="font-ui w-full bg-transparent text-[15px] font-medium tracking-[-0.01em] text-foreground outline-none placeholder:text-muted-foreground/40" data-testid="cmd-input" autoComplete="off" spellCheck={false} />
              {!isClient && <div className="font-ui mt-1.5 text-[8px] text-muted-foreground/65">Tools, entities, models, providers, workflows and deterministic terminal commands in one place.</div>}
            </div>
            <kbd className="lios-pane-code hidden rounded-lg border border-border/65 bg-black/10 px-2 py-1.5 text-[7px] text-muted-foreground sm:block">ESC</kbd>
            <button onClick={onClose} className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground" aria-label="Close Omnibox"><X className="h-3.5 w-3.5" /></button>
          </div>
          <nav className="flex overflow-x-auto border-t border-border/45 px-2" aria-label="Omnibox result filters">
            {availableModes.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => { setMode(id); setSelected(0); }} className={`font-ui flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[8px] font-medium transition-colors ${mode === id ? "border-amber-300 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`} aria-pressed={mode === id}><Icon className="h-3 w-3" /> {label}</button>)}
            <div className="font-ui ml-auto hidden items-center gap-2 px-3 text-[7px] text-muted-foreground/55 md:flex"><kbd className="lios-pane-code rounded border border-border/60 px-1.5 py-0.5">TAB</kbd> filter <kbd className="lios-pane-code rounded border border-border/60 px-1.5 py-0.5">↑↓</kbd> move <kbd className="lios-pane-code rounded border border-border/60 px-1.5 py-0.5">↵</kbd> open</div>
          </nav>
          {mode === "tools" && <div className="flex flex-wrap items-center gap-2 border-t border-border/45 px-4 py-2.5">
            <label htmlFor="lios-specialist-workspace-filter" className="font-ui text-xs text-muted-foreground">Workspace</label>
            <select id="lios-specialist-workspace-filter" value={workspaceFilter} onChange={(event) => { setWorkspaceFilter(event.target.value as WorkspaceKey | "all"); setSelected(0); }} className="min-h-10 min-w-0 max-w-full rounded-lg border border-border bg-background px-3 py-2 font-ui text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-400">
              <option value="all">All registered tools</option>
              {visibleWorkspaces.map((workspace) => <option key={workspace.key} value={workspace.key}>{workspace.label}</option>)}
            </select>
            <span role="status" className="font-ui text-xs text-muted-foreground">{browsedSpecialists.length} matching tools · navigate to inspect; access and data are checked when used</span>
          </div>}
        </header>

        <div className={isClient ? "min-h-[390px] max-h-[68vh]" : "grid min-h-[390px] max-h-[68vh] grid-cols-1 md:grid-cols-[minmax(0,1fr)_320px]"}>
          <div className={`min-h-0 overflow-y-auto p-2 scrollbar-thin ${isClient ? "" : "border-r border-border/50"}`}>
            {searching && entityResults.length === 0 && (mode === "all" || mode === "entities") && <div className="font-ui m-1 flex items-center gap-2 rounded-lg px-3 py-2 text-[8px] text-muted-foreground"><ActivityPulse /> Searching securities…</div>}
            {discoveringTools && universalToolResults.length === 0 && (mode === "all" || mode === "tools") && <div className="font-ui m-1 flex items-center gap-2 rounded-lg px-3 py-2 text-[8px] text-muted-foreground"><ActivityPulse /> Discovering LiOS capabilities…</div>}
            {mode === "tools" && browsedSpecialists.length > 24 && <p className="font-ui px-3 py-2 text-xs text-muted-foreground">Showing the first results. Search or choose a workspace to find additional tools.</p>}
            {results.length === 0 ? (
              <div className="flex min-h-[340px] flex-col items-center justify-center px-8 text-center"><div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/55 bg-white/[0.012]"><Search className="h-5 w-5 text-muted-foreground/45" /></div><div className="font-ui mt-4 text-[11px] font-semibold text-foreground">{isClient ? "Search LiOS" : "Search the analytical system"}</div>{!isClient && <p className="font-ui mt-2 max-w-md text-[8px] leading-relaxed text-muted-foreground">Try a company, task, model, dataset or provider: <span className="lios-pane-code text-amber-300/85">AAPL GP</span>, <span className="lios-pane-code text-amber-300/85">reverse DCF</span>, <span className="font-medium text-foreground/80">credit merton</span>, <span className="font-medium text-foreground/80">FRED macro</span>.</p>}</div>
            ) : results.map((result, index) => {
              const Icon = result.icon;
              const active = index === selected;
              const section = resultSection(result);
              const previousSection = index > 0 ? resultSection(results[index - 1]) : null;
              return <div key={result.key}>{section !== previousSection && <div className="px-3 pb-1 pt-2 font-ui text-[7px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/55">{section}</div>}<button onMouseEnter={() => { setSelected(index); if (!result.command.navigation && result.type !== "ask" && result.type !== "data") prefetchLikelyDestination(result.command.view, result.command.symbol); }} onClick={() => execute(result)} className={`group mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-all ${active ? "border-amber-400/20 bg-amber-400/[0.045] shadow-[inset_0_1px_0_rgba(255,255,255,.018)]" : "border-transparent hover:border-border/55 hover:bg-white/[0.018]"}`}><div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${RESULT_TONE[result.type]}`}><Icon className="h-3.5 w-3.5" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="font-ui truncate text-[10px] font-semibold text-foreground">{result.title}</span>{result.capability?.hero && <span className="font-ui hidden rounded-full border border-amber-500/18 px-1.5 py-0.5 text-[6px] font-medium text-amber-300/75 sm:inline">Core</span>}</div><div className="font-ui mt-1 truncate text-[8px] text-muted-foreground">{result.subtitle}</div></div><div className="hidden shrink-0 text-right sm:block"><div className="lios-pane-code text-[6px] tracking-wide text-muted-foreground/55">{result.meta}</div><div className={`font-ui mt-1 text-[7px] font-medium ${active ? "text-amber-300/85" : "text-muted-foreground/40"}`}>{result.type === "ask" ? "Ask" : result.type === "data" ? "Explore" : "Open"} <ArrowRight className="ml-1 inline h-2.5 w-2.5" /></div></div></button></div>;
            })}
          </div>

          {!isClient && (
          <aside className="hidden min-h-0 overflow-y-auto bg-black/[0.09] p-5 md:block">
            {selectedResult ? (
              <div className="space-y-5">
                <div>
                  <div className="font-ui text-[7px] font-semibold uppercase tracking-[0.14em] text-cyan-300/70">Selected context</div>
                  <div className="font-ui mt-2 text-[15px] font-semibold tracking-[-0.02em] text-foreground">{selectedResult.title}</div>
                  <p className="font-ui mt-2 text-[9px] leading-relaxed text-muted-foreground">{selectedResult.subtitle}</p>
                  {selectedResult.relatedReason && <p className="font-ui mt-2 text-xs leading-relaxed text-amber-300/80">Related next step: {selectedResult.relatedReason}</p>}
                  {guided && selectedResult.capability?.guidance && (
                    <div className="mt-3 space-y-1.5 rounded-xl border border-[hsl(38,95%,50%)]/20 bg-[hsl(38,95%,50%)]/[0.035] p-2.5">
                      <p className="font-ui text-[8px] leading-relaxed text-muted-foreground"><span className="font-semibold uppercase tracking-wide text-[hsl(38,95%,55%)]">Why it matters — </span>{selectedResult.capability.guidance.why}</p>
                      <p className="font-ui text-[8px] leading-relaxed text-muted-foreground"><span className="font-semibold uppercase tracking-wide text-cyan-400/90">What you get — </span>{selectedResult.capability.guidance.outcome}</p>
                    </div>
                  )}
                </div>
                {selectedResult.capability && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <MetaCard label="Workspace" value={getWorkspaceDefinition(selectedResult.capability.workspace).label} />
                      <MetaCard label="Context" value={selectedResult.capability.symbolAware ? "Entity-aware" : "Global"} />
                      <MetaCard label="Domain" value={selectedResult.capability.domain} />
                      <MetaCard label="Code" value={selectedResult.capability.shortLabel} mono />
                    </div>
                    {selectedResult.capability.keywords.length > 0 && (
                      <div>
                        <div className="font-ui text-[7px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">Related intent</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          {selectedResult.capability.keywords.slice(0, 8).map((keyword) => <span key={keyword} className="font-ui rounded-full border border-border/55 px-2 py-1 text-[6px] text-muted-foreground">{keyword}</span>)}
                        </div>
                      </div>
                    )}
                  </>
                )}
                <div className="rounded-xl border border-border/55 bg-white/[0.012] p-3">
                  <div className="font-ui flex items-center gap-2 text-[8px] font-semibold text-amber-300/80"><TerminalSquare className="h-3 w-3" /> Destination</div>
                  <div className="lios-pane-code mt-2 break-all text-[8px] text-muted-foreground">{selectedResult.command.raw}</div>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center"><Gauge className="h-5 w-5 text-muted-foreground/45" /><p className="font-ui mt-3 text-[8px] leading-relaxed text-muted-foreground">Select a result to inspect its analytical role before opening it.</p></div>
            )}
          </aside>
          )}
        </div>

        <footer className="font-ui flex items-center gap-2 border-t border-border/50 bg-black/[0.08] px-4 py-2.5 text-[7px] text-muted-foreground/60"><Database className="h-3 w-3 text-cyan-300/65" /><span>LiOS Omnibox</span>{!isClient && <><span>·</span><span>universal capability discovery</span></>}<span className="ml-auto hidden sm:inline">/ or ⌘K</span></footer>
      </section>
    </div>
  );
}

function MetaCard({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="rounded-xl border border-border/55 bg-white/[0.012] p-2.5"><div className="font-ui text-[6px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">{label}</div><div className={`${mono ? "lios-pane-code" : "font-ui"} mt-1 truncate text-[8px] font-medium text-foreground`}>{value}</div></div>;
}

function ActivityPulse() {
  return <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />;
}
