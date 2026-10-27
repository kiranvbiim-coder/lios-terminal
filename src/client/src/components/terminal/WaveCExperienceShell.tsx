import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Activity, Compass, FolderKanban, Globe2, Keyboard, Library, LayoutDashboard, Radio, ShieldCheck, Sparkles, X } from "lucide-react";
import {
  EXPERIENCE_SHELL_SURFACES,
  MARKET_PACKS,
  MASTER_AI_MODES,
  buildAdaptiveCompanySections,
  buildDynamicAnalyticsCatalog,
  buildQuantSeries,
  findMarketPack,
  formatMarketValue,
  type ExperienceShellSurface,
  type MasterAiMode,
  type MasterAiState,
} from "@shared/waveCContracts";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import { useAudience } from "@/lib/audience";
import type { ActionInboxItem, IntelligenceCard } from "@shared/waveDContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import {
  EXPERIENCE_SELECTED_FIELDS_STORAGE_KEY,
  setExperienceSurface as setGlobalExperienceSurface,
  subscribeExperienceField,
} from "@/lib/experienceShell";
import {
  loadRecentAnalyticalContexts,
  loadTerminalFavorites,
  type RecentAnalyticalContext,
} from "@/lib/terminalPersonalization";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import FusionPulseBoard from "./FusionPulseBoard";
import { FusionActionButton } from "./FusionPrimitives";
import ExploreSurface from "./ExploreSurface";

interface Props {
  activeView: ViewMode;
  activeSymbol?: string;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onClose?: () => void;
  embedded?: boolean;
  surface?: ExperienceShellSurface;
  onSurfaceChange?: (surface: ExperienceShellSurface) => void;
  onAskLios?: (initialQuestion?: string) => void;
}

const masterAiResponseSchema = z.object({
  state: z.custom<MasterAiState>(value => value === "on" || value === "off"),
  mode: z.custom<MasterAiMode>(value => MASTER_AI_MODES.some(mode => mode.id === value)),
  updatedAt: z.string().nullable().optional(),
});
const MARKET_PACK_KEY = "lios.waveC.marketPack";
const SURFACE_ICONS = { projects: FolderKanban, pulse: Activity, explore: Compass, workbench: LayoutDashboard, signals: Radio, library: Library } as const;


type PulseChannel = "for_you" | "following" | "markets" | "research";

export default function WaveCExperienceShell({ activeView, activeSymbol, onOpen, onClose, embedded = false, surface: controlledSurface, onSurfaceChange, onAskLios }: Props) {
  const isClient = useAudience() === "client";
  const [uncontrolledSurface, setUncontrolledSurface] = useState<ExperienceShellSurface>("pulse");
  const surface = controlledSurface ?? uncontrolledSurface;
  const setSurface = (next: ExperienceShellSurface) => {
    if (next === "workbench") {
      if (onSurfaceChange) onSurfaceChange(next);
      else setGlobalExperienceSurface(next);
      return;
    }
    if (!controlledSurface) setUncontrolledSurface(next);
    onSurfaceChange?.(next);
  };
  const queryClient = useQueryClient();
  const aiQuery = useQuery({
    queryKey: ["/api/wave-c/ai/state"],
    enabled: !isClient,
    queryFn: async () => masterAiResponseSchema.parse(await (await apiRequest("GET", "/api/wave-c/ai/state")).json()),
    staleTime: 5_000,
  });
  const aiState = aiQuery.data?.state ?? "off";
  const aiMode = aiQuery.data?.mode ?? "manual";
  const aiWrite = useMutation({
    mutationFn: async (choice: { state: MasterAiState; mode: MasterAiMode }) => masterAiResponseSchema.parse(await (await apiRequest("PUT", "/api/wave-c/ai/state", choice)).json()),
    onSuccess: async saved => {
      queryClient.setQueryData(["/api/wave-c/ai/state"], saved);
      await queryClient.invalidateQueries({ queryKey: ["/api/setup/status"] });
    },
  });
  const [packId, setPackId] = useState(() => window.localStorage.getItem(MARKET_PACK_KEY) ?? "india");
  const [selectedFieldIds, setSelectedFieldIds] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(EXPERIENCE_SELECTED_FIELDS_STORAGE_KEY) ?? "null");
      return Array.isArray(saved) ? saved.filter((value): value is string => typeof value === "string").slice(0, 6) : ["metric.pe", "metric.roic"];
    } catch { return ["metric.pe", "metric.roic"]; }
  });
  const [waveDPulseCards, setWaveDPulseCards] = useState<IntelligenceCard[]>([]);
  const [waveDInboxCount, setWaveDInboxCount] = useState(0);
  const [waveDInboxItems, setWaveDInboxItems] = useState<ActionInboxItem[]>([]);
  const [waveDMonitoringCount, setWaveDMonitoringCount] = useState(0);
  const [waveDStatus, setWaveDStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [pulseChannel, setPulseChannel] = useState<PulseChannel>("for_you");
  const [briefHeadline, setBriefHeadline] = useState<string | null>(null);
  const [libraryRecents, setLibraryRecents] = useState<RecentAnalyticalContext[]>(() => loadRecentAnalyticalContexts().slice(0, 6));
  const [libraryFavorites, setLibraryFavorites] = useState<ViewMode[]>(() => loadTerminalFavorites().slice(0, 6));
  const catalog = useMemo(() => buildDynamicAnalyticsCatalog(), []);
  const sections = useMemo(() => buildAdaptiveCompanySections(catalog.map((field) => field.id)), [catalog]);
  const pack = findMarketPack(packId) ?? MARKET_PACKS[0];
  useEffect(() => { window.localStorage.setItem(MARKET_PACK_KEY, pack.id); }, [pack.id]);
  useEffect(() => { window.localStorage.setItem(EXPERIENCE_SELECTED_FIELDS_STORAGE_KEY, JSON.stringify(selectedFieldIds)); }, [selectedFieldIds]);
  useEffect(() => {
    if (surface !== "pulse" && surface !== "library") return;
    setLibraryRecents(loadRecentAnalyticalContexts().slice(0, 6));
    setLibraryFavorites(loadTerminalFavorites().slice(0, 6));
  }, [surface, activeView, activeSymbol]);
  useEffect(() => subscribeExperienceField((fieldId) => {
    setSelectedFieldIds((current) => current.includes(fieldId) ? current : [...current, fieldId].slice(-6));
  }), []);
  useEffect(() => {
    let cancelled = false;
    setWaveDStatus("loading");
    void Promise.all([
      fetch(`/api/wave-d/pulse?channel=${pulseChannel}`),
      fetch("/api/wave-d/action-inbox"),
      isClient ? Promise.resolve<Response | null>(null) : fetch(`/api/wave-d/briefs/${pulseChannel === "for_you" ? "morning" : "evening"}`),
    ]).then(async ([pulseResponse, inboxResponse, briefResponse]) => {
      if (cancelled) return;
      if (!pulseResponse.ok) { setWaveDStatus("unavailable"); return; }
      const pulse = await pulseResponse.json() as { cards?: IntelligenceCard[]; monitoring?: { activeRules?: number } };
      const inbox = inboxResponse.ok ? await inboxResponse.json() as { items?: ActionInboxItem[] } : { items: [] };
      const brief = briefResponse?.ok ? await briefResponse.json() as { headline?: string } : {};
      if (cancelled) return;
      setWaveDPulseCards(Array.isArray(pulse.cards) ? pulse.cards.slice(0, 6) : []);
      const inboxItems = Array.isArray(inbox.items) ? inbox.items : [];
      setWaveDInboxItems(inboxItems.slice(0, 8));
      setWaveDInboxCount(inboxItems.length);
      setWaveDMonitoringCount(Number(pulse.monitoring?.activeRules ?? 0));
      setBriefHeadline(typeof brief.headline === "string" ? brief.headline : null);
      setWaveDStatus("ready");
    }).catch(() => { if (!cancelled) setWaveDStatus("unavailable"); });
    return () => { cancelled = true; };
  }, [pulseChannel]);

  const toggleMetric = (id: string) => setSelectedFieldIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(-6));
  const selectedLabels = selectedFieldIds.map((id) => catalog.find((field) => field.id === id)?.label ?? id);
  const openChartWithSelectedSeries = () => {
    const seriesIds = selectedFieldIds.flatMap((id) => {
      const series = buildQuantSeries(id);
      return series ? [series.fieldId] : [];
    });
    if (activeSymbol && seriesIds.length) {
      const key = `lios.chart.fields.${activeSymbol.trim().toUpperCase()}`;
      try {
        const saved = JSON.parse(window.localStorage.getItem(key) ?? "[]");
        const existing = Array.isArray(saved) ? saved.filter((value): value is string => typeof value === "string") : [];
        window.localStorage.setItem(key, JSON.stringify([...new Set([...existing, ...seriesIds])].slice(-24)));
      } catch {
        window.localStorage.setItem(key, JSON.stringify(seriesIds.slice(-24)));
      }
    }
    onOpen("chart", "current", activeSymbol);
  };

  const shell = (
      <section data-testid="experience-shell" data-visual-system="phase-one" className={`overflow-hidden bg-[#080909] ${embedded ? "flex h-full min-h-0 w-full flex-col" : "w-full max-w-6xl rounded-2xl border border-cyan-400/20 shadow-2xl"}`} onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS experience shell">
        <header className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/[0.06] text-cyan-200"><Sparkles className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1"><div className="font-ui text-[11px] font-semibold tracking-tight text-foreground">LiOS Intelligence Terminal</div>{!isClient && <div className="mt-1 font-ui text-[8px] text-muted-foreground">Pulse, Explore, Workbench, Signals and Library — Ask LiOS stays available.</div>}</div>
          <FusionActionButton onClick={() => onAskLios ? onAskLios() : onOpen("agent", "current", activeSymbol)} variant="accent" data-testid="ask-lios"><Sparkles className="mr-1 inline h-3 w-3" />ASK LIOS</FusionActionButton>
          {!isClient && <div className="flex items-center gap-2 rounded-lg border border-border/60 px-2 py-1.5"><span className="font-terminal text-[7px] text-muted-foreground">MASTER AI</span><button disabled={!aiQuery.data || aiQuery.isError || aiWrite.isPending} onClick={() => aiWrite.mutate({ state: aiState === "on" ? "off" : "on", mode: aiMode })} className={`rounded-md border px-2 py-1 font-terminal text-[7px] ${aiState === "on" ? "border-emerald-400/40 text-emerald-300" : "border-border text-muted-foreground"}`} aria-pressed={aiState === "on"}>{aiQuery.isPending ? "CHECKING" : aiQuery.isError ? "UNAVAILABLE" : aiWrite.isPending ? "SAVING" : aiState.toUpperCase()}</button></div>}
          {!isClient && <select value={aiMode} disabled={!aiQuery.data || aiQuery.isError || aiWrite.isPending} onChange={(event) => aiWrite.mutate({ state: aiState, mode: event.target.value as MasterAiMode })} className="rounded-lg border border-border/60 bg-transparent px-2 py-1.5 font-terminal text-[7px] text-muted-foreground" aria-label="Master AI mode">{MASTER_AI_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}</select>}
          {!embedded && onClose && <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground" aria-label="Close experience shell"><X className="h-4 w-4" /></button>}
        </header>
        {!isClient && (aiQuery.isError || aiWrite.isError) && <p role="alert" className="border-b border-border px-4 py-2 text-xs text-red-300">{aiWrite.error?.message ?? aiQuery.error?.message ?? "Master AI settings are unavailable."} Open Connection Center to verify the selected provider and model. No failed change is shown as enabled.</p>}

        {!embedded && <nav className="flex gap-1 overflow-x-auto border-b border-border/60 px-3 py-2" aria-label="Experience surfaces">
          {EXPERIENCE_SHELL_SURFACES.map((item) => { const Icon = SURFACE_ICONS[item.id]; return <button key={item.id} onClick={() => setSurface(item.id)} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 font-terminal text-[8px] tracking-wider ${surface === item.id ? "bg-cyan-400/[0.09] text-cyan-200" : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"}`} aria-current={surface === item.id ? "page" : undefined}><Icon className="h-3 w-3" />{item.label.toUpperCase()}</button>; })}
        </nav>}

        {surface === "pulse" && (
          <div className={embedded ? "min-h-0 flex-1 overflow-y-auto" : ""}>
            <FusionPulseBoard
              activeSymbol={activeSymbol}
              onOpen={onOpen}
              onAskLios={onAskLios}
              pulseCards={waveDPulseCards}
              monitoringCount={waveDMonitoringCount}
              inboxCount={waveDInboxCount}
              recents={libraryRecents}
              favorites={libraryFavorites}
              pulseChannel={pulseChannel}
              pulseStatus={waveDStatus}
              briefHeadline={!isClient && briefHeadline ? briefHeadline : null}
              onPulseChannelChange={setPulseChannel}
            />
          </div>
        )}

        <div className={`${surface === "pulse" ? "hidden" : "grid"} gap-4 p-4 ${isClient ? "" : "lg:grid-cols-[1.35fr_1fr]"} ${embedded ? "min-h-0 flex-1 overflow-y-auto" : ""}`}>
          <div className="space-y-4">
            {surface === "projects" && <section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><FolderKanban className="h-4 w-4 text-amber-300" /><div><div className="font-ui text-[10px] font-semibold">Projects</div><div className="font-ui mt-1 text-[8px] text-muted-foreground">Projects are the primary LiOS workspace. Open the main Terminal Projects surface to manage persistent chats, resources and Sessions.</div></div></div></section>}
            {surface === "explore" && <ExploreSurface
              activeSymbol={activeSymbol}
              catalog={catalog}
              selectedFieldIds={selectedFieldIds}
              selectedLabels={selectedLabels}
              onOpen={onOpen}
              onOpenChart={openChartWithSelectedSeries}
              onToggleMetric={toggleMetric}
            />}

            {surface === "signals" && !isClient && <section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><Radio className="h-4 w-4 text-amber-300" /><div><div className="font-ui text-[10px] font-semibold">Signals</div><div className="font-ui mt-1 text-[8px] text-muted-foreground">Bring alerts, scenario branches and decision checkpoints into one review loop.</div></div></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><button onClick={() => onOpen("alerts", "current")} className="rounded-lg border border-border/60 p-3 text-left hover:border-amber-300/35"><span className="font-terminal text-[7px] text-muted-foreground">MONITOR</span><span className="mt-1 block font-ui text-[8px] text-foreground">Alerts & triggers</span></button><button onClick={() => onOpen("regime", "current")} className="rounded-lg border border-border/60 p-3 text-left hover:border-amber-300/35"><span className="font-terminal text-[7px] text-muted-foreground">REGIME</span><span className="mt-1 block font-ui text-[8px] text-foreground">Market state</span></button><button onClick={() => onOpen("decisionengine", "current")} className="rounded-lg border border-border/60 p-3 text-left hover:border-amber-300/35"><span className="font-terminal text-[7px] text-muted-foreground">DECIDE</span><span className="mt-1 block font-ui text-[8px] text-foreground">Decision engine</span></button></div></section>}
            {surface === "signals" && <section className="rounded-xl border border-border/60 p-4" aria-label="Wave D action inbox"><div className="flex items-center justify-between gap-3"><div className="font-terminal text-[8px] font-bold tracking-widest text-cyan-300">ACTION INBOX</div><div className="flex items-center gap-3"><span className="font-terminal text-[7px] text-muted-foreground">{waveDMonitoringCount} RULES</span><span className="font-terminal text-[8px] text-amber-300">{waveDInboxCount} NEED ATTENTION</span></div></div>{isClient ? <div className="mt-3 space-y-2">{waveDInboxItems.length === 0 ? <div className="rounded-lg border border-dashed border-border/60 p-4 text-center font-ui text-[9px] text-foreground">You’re caught up.</div> : waveDInboxItems.map((item) => { const sourceCard = waveDPulseCards.find((card) => card.id === item.sourceCardId); return <button key={item.id} onClick={() => sourceCard?.symbol ? onOpen("quote", "current", sourceCard.symbol) : onOpen("alerts", "current")} className="flex w-full items-center gap-3 rounded-lg border border-border/55 px-3 py-3 text-left hover:border-cyan-300/35"><span className={`h-2 w-2 shrink-0 rounded-full ${item.priority === "critical" ? "bg-red-300" : "bg-amber-300"}`} /><span className="min-w-0 flex-1 truncate font-ui text-[8px] font-semibold text-foreground">{item.title}</span><span className="font-terminal text-[6px] text-cyan-300">{item.suggestedActions[0]?.toUpperCase() ?? "REVIEW"}</span></button>; })}</div> : <><div className="mt-1 font-ui text-[8px] text-muted-foreground">Attention is grouped by decision relevance, not unread volume.</div><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-lg border border-border/50 p-3"><span className="font-terminal text-[6px] text-muted-foreground">ACTIVE RULES</span><span className="mt-1 block font-ui text-[13px] text-foreground">{waveDMonitoringCount}</span><span className="mt-1 block font-ui text-[7px] text-muted-foreground">Persisted monitors evaluated against current quote evidence.</span></div><button onClick={() => onOpen("alerts", "current")} className="rounded-lg border border-cyan-300/20 p-3 text-left hover:border-cyan-300/40"><span className="font-terminal text-[6px] text-cyan-300">REVIEW</span><span className="mt-1 block font-ui text-[9px] text-foreground">Open monitor center</span><span className="mt-1 block font-ui text-[7px] text-muted-foreground">Investigate · update · snooze · dismiss</span></button></div></>}</section>}

            {surface === "library" && <section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><Library className="h-4 w-4 text-fuchsia-300" /><div><div className="font-ui text-[10px] font-semibold">{isClient ? "My LiOS" : "Library"}</div>{!isClient && <div className="font-ui mt-1 text-[8px] text-muted-foreground">Return to saved work, favorites, evidence and outputs without losing context.</div>}</div></div>{isClient ? <div className="mt-4 space-y-4"><div className="grid gap-2 sm:grid-cols-2"><button onClick={() => onOpen("watchlist", "current")} className="rounded-lg border border-border/60 p-3 text-left hover:border-fuchsia-300/35"><span className="font-terminal text-[7px] text-muted-foreground">SAVED</span><span className="mt-1 block font-ui text-[9px] text-foreground">Watchlists</span></button><button onClick={() => onOpen("portfolio", "current")} className="rounded-lg border border-border/60 p-3 text-left hover:border-fuchsia-300/35"><span className="font-terminal text-[7px] text-muted-foreground">OWNED</span><span className="mt-1 block font-ui text-[9px] text-foreground">Portfolio</span></button></div><div><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">RECENT ANALYSIS</div><div className="mt-2 space-y-1.5">{libraryRecents.length ? libraryRecents.map((recent) => <button key={recent.key} onClick={() => onOpen(recent.view, "current", recent.symbol || undefined)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2 text-left hover:border-fuchsia-300/30"><span className="min-w-0 truncate font-ui text-[8px] text-foreground">{recent.label}</span><span className="font-terminal text-[6px] text-muted-foreground">{new Date(recent.lastOpenedAt).toLocaleDateString()}</span></button>) : <div className="rounded-lg border border-dashed border-border/50 px-3 py-3 font-ui text-[8px] text-muted-foreground">No recent analysis yet.</div>}</div></div><div><div className="font-terminal text-[7px] tracking-widest text-muted-foreground">FAVORITES</div><div className="mt-2 flex flex-wrap gap-2">{libraryFavorites.length ? libraryFavorites.map((view) => { const capability = getTerminalCapability(view); return <button key={view} onClick={() => onOpen(view, "current", capability.symbolAware ? activeSymbol : undefined)} className="rounded-full border border-border/60 px-2.5 py-1.5 font-ui text-[7px] text-foreground hover:border-fuchsia-300/35">{capability.label}</button>; }) : <span className="font-ui text-[8px] text-muted-foreground">No favorites yet.</span>}</div></div></div> : <div className="mt-4 grid gap-2 sm:grid-cols-3"><button onClick={() => onOpen("workspaces", "current")} className="rounded-lg border border-border/60 p-3 text-left hover:border-fuchsia-300/35"><span className="font-terminal text-[7px] text-muted-foreground">SAVED</span><span className="mt-1 block font-ui text-[8px] text-foreground">Workspaces</span></button><button onClick={() => onOpen("research", "current")} className="rounded-lg border border-border/60 p-3 text-left hover:border-fuchsia-300/35"><span className="font-terminal text-[7px] text-muted-foreground">RESEARCH</span><span className="mt-1 block font-ui text-[8px] text-foreground">Evidence & notes</span></button><button onClick={() => onOpen("spreadsheet", "current")} className="rounded-lg border border-border/60 p-3 text-left hover:border-fuchsia-300/35"><span className="font-terminal text-[7px] text-muted-foreground">OUTPUTS</span><span className="mt-1 block font-ui text-[8px] text-foreground">Models & exports</span></button></div>}</section>}
          </div>

          <aside className={isClient ? "hidden" : "space-y-4"}>
            <section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><Globe2 className="h-3.5 w-3.5 text-cyan-300" /><div className="font-ui text-[9px] font-semibold">Home Market</div></div><div className="mt-1 font-ui text-[7px] text-muted-foreground">Choose a market pack to seed locale formatting, aliases, exchanges and Pulse clocks.</div><select value={pack.id} onChange={(event) => setPackId(event.target.value)} className="mt-3 w-full rounded-lg border border-border/60 bg-transparent px-2.5 py-2 font-terminal text-[8px] text-foreground" aria-label="Home market pack">{MARKET_PACKS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.currency}</option>)}</select><div className="mt-3 grid grid-cols-2 gap-2"><div className="rounded-lg border border-border/50 p-2"><span className="font-terminal text-[6px] text-muted-foreground">REGION</span><span className="mt-1 block font-ui text-[8px] text-foreground">{pack.region}</span></div><div className="rounded-lg border border-border/50 p-2"><span className="font-terminal text-[6px] text-muted-foreground">EXCHANGES</span><span className="mt-1 block font-ui text-[8px] text-foreground">{pack.exchanges.length}</span></div></div><div className="mt-3 font-terminal text-[7px] tracking-widest text-muted-foreground">MARKET EXPLORER · COUNTRY / EXCHANGE</div><div className="mt-1.5 space-y-1">{pack.exchanges.map((exchange) => <button key={exchange.mic} onClick={() => onOpen("screener", "current")} className="flex w-full items-center justify-between rounded-lg border border-border/45 px-2.5 py-2 text-left hover:border-cyan-300/30"><span className="font-ui text-[7px] text-foreground">{exchange.label}</span><span className="font-terminal text-[6px] text-muted-foreground">{exchange.countryCode} · {exchange.mic}</span></button>)}</div><div className="mt-3 flex flex-wrap gap-1.5">{pack.countries.map((country) => <span key={country} className="rounded-full border border-border/55 px-2 py-1 font-terminal text-[6px] text-muted-foreground">{country}</span>)}</div><div className="mt-3 flex items-center justify-between"><span className="font-terminal text-[7px] text-muted-foreground">EXAMPLE FORMAT</span><span className="font-terminal text-[8px] text-cyan-200">{formatMarketValue(1234567.89, pack)}</span></div></section>
            <section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-emerald-300" /><div className="font-ui text-[9px] font-semibold">Trust & orientation</div></div><div className="mt-3 space-y-2">{["Identify the active surface", "Open search and find a metric", "Inspect evidence before sharing"].map((item, index) => <div key={item} className="flex items-center gap-2 rounded-lg border border-border/45 px-2.5 py-2"><span className="flex h-4 w-4 items-center justify-center rounded-full border border-emerald-300/30 font-terminal text-[6px] text-emerald-300">{index + 1}</span><span className="font-ui text-[7px] text-muted-foreground">{item}</span></div>)}</div><div className="mt-3 flex items-center gap-2 font-terminal text-[6px] text-muted-foreground"><Keyboard className="h-3 w-3" /> ⌘⇧F focus · ⌘K search · ? shortcuts</div></section>
            <section className="rounded-xl border border-border/60 p-4"><div className="font-terminal text-[7px] tracking-wider text-muted-foreground">ADAPTIVE COMPANY SECTIONS</div><div className="mt-2 space-y-1.5">{sections.map((section) => <div key={section.id} className="flex items-center justify-between rounded-lg bg-white/[0.02] px-2.5 py-2"><span className="font-ui text-[7px] text-foreground">{section.label}</span><span className={`font-terminal text-[6px] ${section.state === "ready" ? "text-emerald-300" : "text-amber-300"}`}>{section.fields.length} FIELDS · {section.state.toUpperCase()}</span></div>)}</div></section>
          </aside>
        </div>
      </section>
  );

  if (embedded) return <div className="h-full min-h-0 overflow-y-auto">{shell}</div>;
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/75 px-3 py-6 sm:py-12" onMouseDown={onClose}>
      {shell}
    </div>
  );
}
