import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, ArrowRight, BookMarked, BookOpenCheck, Brain, Clock3, Database, FileText, Gauge, Layers3,
  Plus, Radar, ShieldCheck, Sparkles, Target,
} from "lucide-react";
import type { TerminalTab } from "@/lib/terminalTabs";
import type { ViewMode } from "@/lib/terminalTypes";
import { getTerminalCapability, isCapabilityVisible } from "@/lib/terminalCatalog";
import { apiRequest } from "@/lib/queryClient";
import { deriveResearchStarterQuestion, getTerminalPersona, resolveTerminalPersonaId, TERMINAL_PERSONAS, type TerminalPersonaId } from "@/lib/terminalPersona";
import { useAudience } from "@/lib/audience";
import { loadResearchTray, subscribeResearchTray, type ResearchTrayItem } from "@/lib/terminalResearchTray";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";
import { loadSessionMemory, subscribeSessionMemory, type SessionMemoryEntry } from "@/lib/terminalSessionMemory";
import { requestWorkspaceRestore } from "@/lib/terminalWorkspaceRestore";
import { GuidedCapabilityExplainer } from "@/components/terminal/GuidedExplainer";

const PERSONA_PREFERENCES_KEY = ["/api/me/persona-preferences"] as const;
const LEGACY_PERSONA_KEYS = ["limuria-terminal-persona-v1", "lios-terminal-persona", "terminal-persona"] as const;

interface PersonaPreferences {
  primaryPersona?: unknown;
  secondaryPersonas?: unknown;
  activeDomainSlug?: string | null;
  activeContext?: string | null;
  preferences?: Record<string, unknown>;
  [key: string]: unknown;
}

interface PersonaPreferencesResponse {
  preferences?: PersonaPreferences | null;
  selectedProfile?: unknown;
  availableProfiles?: unknown;
  securityRole?: string;
  onboardingCompleted?: boolean;
  hasPersistedPreferences?: boolean;
}

function readLegacyPersona(): string | null {
  if (typeof window === "undefined") return null;
  for (const key of LEGACY_PERSONA_KEYS) {
    try {
      const value = window.localStorage.getItem(key);
      if (value) return value;
    } catch {
      return null;
    }
  }
  return null;
}
function clearLegacyPersona(): void {
  if (typeof window === "undefined") return;
  try {
    LEGACY_PERSONA_KEYS.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Storage can be unavailable in privacy-restricted contexts.
  }
}
function profileId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    if ("id" in value && typeof value.id === "string") return value.id;
    if ("canonicalId" in value && typeof value.canonicalId === "string") return value.canonicalId;
  }
  return null;
}
export function shouldMigrateLegacyPersona(
  data: PersonaPreferencesResponse | undefined,
  legacyPersona: string | null,
): boolean {
  return Boolean(data && data.hasPersistedPreferences === false && legacyPersona);
}

function preferencePrimary(data: PersonaPreferencesResponse | undefined): TerminalPersonaId {
  return resolveTerminalPersonaId(profileId(data?.preferences?.primaryPersona) ?? profileId(data?.selectedProfile) ?? readLegacyPersona());
}

function preferenceSecondary(data: PersonaPreferencesResponse | undefined): TerminalPersonaId[] {
  const values = Array.isArray(data?.preferences?.secondaryPersonas) ? data.preferences.secondaryPersonas : [];
  return values.map(profileId).filter((id): id is string => Boolean(id)).map(resolveTerminalPersonaId);
}

function canonicalOptions(data: PersonaPreferencesResponse | undefined): TerminalPersonaId[] {
  const available = Array.isArray(data?.availableProfiles)
    ? data.availableProfiles.map(profileId).filter((id): id is string => Boolean(id)).map(resolveTerminalPersonaId)
    : ["general" as TerminalPersonaId];
  const selected = preferencePrimary(data);
  return Array.from(new Set([selected, ...available]));
}


interface Props {
  tabs: TerminalTab[];
  activeTabId: string;
  onNav: (view: ViewMode) => void;
  onSymbol: (symbol: string) => void;
  onNewEntity: () => void;
  activeSymbol?: string;
  onResearchStarter?: (question: string, symbol: string) => void;
}


interface StarterCard {
  icon: typeof Gauge;
  title: string;
  description: string;
  action: string;
  view?: ViewMode;
  tone?: "amber" | "cyan" | "violet";
}

const STARTERS: readonly StarterCard[] = [
  { icon: Layers3, title: "UNDERSTAND", description: "Build a durable company context before opening deeper models.", action: "Open company workspace", tone: "cyan" },
  { icon: FileText, title: "VALUE", description: "Move from statements into DCF, reverse DCF, peers and sensitivity.", action: "Open valuation", view: "valuation", tone: "amber" },
  { icon: Database, title: "CONNECT DATA", description: "Inspect data connections, coverage and lineage before modeling.", action: "Open data environment", view: "environment", tone: "cyan" },
  { icon: BookOpenCheck, title: "RESEARCH", description: "Start an evidence-led investigation with a persona-guided question.", action: "Open Research Intelligence", view: "research", tone: "violet" },
  { icon: Brain, title: "INVESTIGATE", description: "Connect evidence, deterministic models, challenge and decision reasoning.", action: "Open Brain", view: "brain", tone: "violet" },
  { icon: ShieldCheck, title: "CHALLENGE", description: "Stress assumptions, contradictions and conditions that would break a thesis.", action: "Open decision engine", view: "decisionengine", tone: "violet" },
  { icon: Radar, title: "MONITOR", description: "Keep track of alerts, evidence changes and reversal triggers.", action: "Open monitoring", view: "alerts", tone: "cyan" },
];

const TONE: Record<NonNullable<StarterCard["tone"]>, string> = {
  amber: "border-amber-400/20 hover:border-amber-400/35",
  cyan: "border-cyan-400/18 hover:border-cyan-400/32",
  violet: "border-violet-400/18 hover:border-violet-400/32",
};

function Starter({ item, onClick }: { item: StarterCard; onClick: () => void }) {
  const Icon = item.icon;
  return (
    <button onClick={onClick} className={`group rounded-2xl border bg-white/[0.012] p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:bg-white/[0.025] hover:shadow-lg ${TONE[item.tone ?? "amber"]}`}>
      <div className="flex items-start justify-between gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-xl border border-border/55 bg-black/10"><Icon className="h-3.5 w-3.5 text-amber-300/85" /></div><ArrowRight className="h-3.5 w-3.5 text-muted-foreground/45 transition-all group-hover:translate-x-0.5 group-hover:text-amber-300" /></div>
      <div className="font-ui mt-4 text-[10px] font-semibold text-foreground">{item.title}</div>
      <p className="font-ui mt-1.5 min-h-[34px] text-[8px] leading-relaxed text-muted-foreground">{item.description}</p>
      <div className="font-ui mt-4 text-[7px] font-semibold text-amber-300/80">{item.action} →</div>
    </button>
  );
}

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function ResumeCard({ item }: { item: SessionMemoryEntry }) {
  const capability = getTerminalCapability(item.view);
  const paneCount = [item.workspace.primary, item.workspace.secondary, item.workspace.tertiary ?? null, item.workspace.quaternary ?? null].filter(Boolean).length;
  return (
    <button onClick={() => requestWorkspaceRestore(item.workspace, `Resume ${item.title}`)} className="group rounded-2xl border border-border/50 bg-white/[0.012] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-amber-400/22 hover:bg-white/[0.025]">
      <div className="flex items-start justify-between gap-3"><div className="flex h-8 w-8 items-center justify-center rounded-xl border border-amber-400/15 bg-amber-400/[0.035]"><Clock3 className="h-3.5 w-3.5 text-amber-300/80" /></div><span className="font-ui text-[7px] text-muted-foreground/55">{relativeTime(item.lastActiveAt)}</span></div>
      <div className="mt-3 flex items-center gap-2">{item.symbol && <span className="lios-symbol text-[8px] font-semibold text-amber-300">{item.symbol}</span>}<span className="font-ui truncate text-[10px] font-semibold text-foreground">{capability.label}</span></div>
      <p className="font-ui mt-1.5 line-clamp-2 text-[8px] leading-relaxed text-muted-foreground">{item.title}</p>
      <div className="mt-3 flex items-center justify-between"><span className="font-ui text-[7px] text-muted-foreground/70">{paneCount} pane{paneCount === 1 ? "" : "s"} · {item.visitCount} visits</span><span className="font-ui flex items-center gap-1 text-[7px] font-semibold text-cyan-300/75">Resume <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span></div>
    </button>
  );
}

export default function MissionControlPanel({ tabs, activeTabId, onNav, onSymbol, onNewEntity, activeSymbol, onResearchStarter }: Props) {
  const isInternal = useAudience() === "internal";
  const entityTabs = useMemo(() => tabs.filter((tab) => tab.kind === "entity" && tab.entity), [tabs]);
  const active = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const queryClient = useQueryClient();
  const personaQuery = useQuery<PersonaPreferencesResponse>({
    queryKey: PERSONA_PREFERENCES_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/me/persona-preferences")).json(),
    retry: false,
  });
  const [personaId, setPersonaId] = useState<TerminalPersonaId>(() => preferencePrimary(undefined));
  const [researchItems, setResearchItems] = useState<ResearchTrayItem[]>(() => loadResearchTray());
  const [sessionMemory, setSessionMemory] = useState<SessionMemoryEntry[]>(() => loadSessionMemory());
  const migrationAttempted = useRef(false);
  const serverPersonaId = preferencePrimary(personaQuery.data);
  const options = useMemo(() => canonicalOptions(personaQuery.data), [personaQuery.data]);
  const persona = getTerminalPersona(personaId);

  useEffect(() => {
    if (!personaQuery.data || shouldMigrateLegacyPersona(personaQuery.data, readLegacyPersona())) return;
    setPersonaId(serverPersonaId);
  }, [personaQuery.data, serverPersonaId]);

  const preferenceMutation = useMutation<PersonaPreferencesResponse, Error, { primaryPersona: TerminalPersonaId; secondaryPersonas: TerminalPersonaId[] }, { previousPersonaId: TerminalPersonaId }>({
    mutationFn: async ({ primaryPersona, secondaryPersonas }: { primaryPersona: TerminalPersonaId; secondaryPersonas: TerminalPersonaId[] }) => {
      const current = personaQuery.data?.preferences;
      const canonicalPrimary = getTerminalPersona(primaryPersona).canonicalId;
      const canonicalSecondary = secondaryPersonas.map((id) => getTerminalPersona(id).canonicalId);
      const response = await apiRequest("PATCH", "/api/me/persona-preferences", {
        primaryPersona: canonicalPrimary,
        secondaryPersonas: canonicalSecondary,
        activeDomainSlug: current?.activeDomainSlug ?? undefined,
        activeContext: current?.activeContext ?? undefined,
        preferences: current?.preferences ?? {},
      });
      return response.json() as Promise<PersonaPreferencesResponse>;
    },
    onSuccess: async (data) => {
      clearLegacyPersona();
      queryClient.setQueryData(PERSONA_PREFERENCES_KEY, data);
      await queryClient.invalidateQueries({ queryKey: PERSONA_PREFERENCES_KEY });
    },
    onError: (_error, _variables, context) => {
      setPersonaId(context?.previousPersonaId ?? serverPersonaId);
    },
    onMutate: () => ({ previousPersonaId: personaId }),
  });

  useEffect(() => {
    const legacy = readLegacyPersona();
    if (!shouldMigrateLegacyPersona(personaQuery.data, legacy) || migrationAttempted.current) return;
    migrationAttempted.current = true;
    preferenceMutation.mutate({ primaryPersona: resolveTerminalPersonaId(legacy), secondaryPersonas: preferenceSecondary(personaQuery.data) });
  }, [personaQuery.data, preferenceMutation]);
  const launchResearchStarter = () => {
    const symbol = activeSymbol?.trim().toUpperCase() || active?.workspace?.primary.symbol?.trim().toUpperCase() || "";
    const question = deriveResearchStarterQuestion(persona.canonicalId, symbol);
    if (onResearchStarter) onResearchStarter(question, symbol);
    else onNav("research");
  };

  useEffect(() => subscribeResearchTray(setResearchItems), []);
  useEffect(() => subscribeSessionMemory(setSessionMemory), []);

  const visibleStarters = useMemo(() => STARTERS.filter((starter) => {
    if (!starter.view) return true;
    return isCapabilityVisible(getTerminalCapability(starter.view), isInternal);
  }), []);

  const starters = useMemo(() => [...visibleStarters].sort((left, right) => {
    const leftIndex = left.view ? persona.preferredViews.indexOf(left.view) : -1;
    const rightIndex = right.view ? persona.preferredViews.indexOf(right.view) : -1;
    if (leftIndex === -1 && rightIndex === -1) return 0;
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  }), [persona, visibleStarters]);

  const priorityCapabilities = useMemo(() => persona.preferredViews
    .map((view) => getTerminalCapability(view as ViewMode))
    .filter((capability) => isCapabilityVisible(capability, isInternal))
    .slice(0, 5), [persona]);

  const pinnedResearch = researchItems.slice(0, 4);
  const resumableSessions = sessionMemory.filter((item) => item.view !== "missioncontrol").slice(0, 4);
  const choosePersona = (id: TerminalPersonaId) => {
    setPersonaId(id);
    preferenceMutation.mutate({ primaryPersona: id, secondaryPersonas: preferenceSecondary(personaQuery.data) });
  };
  return (
    <div className="h-full min-h-0 overflow-y-auto bg-transparent scrollbar-thin" data-testid="mission-control">
      <header className="relative overflow-hidden border-b border-border/45 px-4 pb-5 pt-6 sm:px-6 lg:px-8">
        <div className="pointer-events-none absolute -left-24 -top-32 h-72 w-72 rounded-full bg-amber-400/[0.035] blur-3xl" />
        <div className="pointer-events-none absolute -right-24 top-0 h-64 w-64 rounded-full bg-cyan-400/[0.025] blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-3xl">
            <div className="font-ui flex items-center gap-2 text-[8px] font-semibold uppercase tracking-[0.16em] text-amber-300/75"><Gauge className="h-3.5 w-3.5" /> Session Home</div>
            <h1 className="font-ui mt-3 text-[22px] font-semibold tracking-[-0.035em] text-foreground sm:text-[26px]">Continue the analysis, not the navigation.</h1>
            <p className="font-ui mt-2 max-w-2xl text-[10px] leading-relaxed text-muted-foreground">Resume the exact multi-pane desk you were using, reopen pinned research, or start a role-relevant workflow. LiOS remembers analytical context locally instead of making every session start from zero.</p>
          </div>
          <button onClick={onNewEntity} className="font-ui flex items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-400/[0.055] px-3.5 py-2.5 text-[9px] font-semibold text-amber-200 transition-all hover:-translate-y-0.5 hover:bg-amber-400/[0.09]"><Plus className="h-3.5 w-3.5" /> Open entity</button>
        </div>
        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          <span className="font-ui text-[7px] font-semibold uppercase tracking-[0.13em] text-muted-foreground/70">Work mode</span>
          <select data-testid="mission-persona-switcher" value={personaId} disabled={preferenceMutation.isPending} onChange={(event) => choosePersona(event.target.value as TerminalPersonaId)} className="font-ui h-8 rounded-lg border border-border/60 bg-black/15 px-2.5 text-[8px] font-medium text-foreground outline-none focus:border-amber-400/30 disabled:opacity-60">
            {options.map((id) => { const profile = getTerminalPersona(id); return <option key={profile.canonicalId} value={profile.canonicalId}>{profile.label}</option>; })}
          </select>
          <span className="font-ui text-[8px] text-muted-foreground">{persona.description}</span>
          {personaQuery.isError && <span className="font-ui text-[8px] text-amber-300/80" role="status">Preferences unavailable; using this device's last selection.</span>}
          {preferenceMutation.isError && <span className="font-ui text-[8px] text-red-300/85" role="alert">Could not save persona. Try again.</span>}
        </div>
      </header>

      <main className="space-y-7 p-4 sm:p-6 lg:p-8">
        {resumableSessions.length > 0 && (
          <section>
            <div className="mb-3 flex items-end justify-between gap-3"><div><div className="font-ui flex items-center gap-2 text-[10px] font-semibold text-foreground"><Clock3 className="h-3.5 w-3.5 text-amber-300/80" /> Continue where you left off</div><div className="font-ui mt-1 text-[8px] text-muted-foreground">Exact local workspace memory: view, symbol and multi-pane analytical layout.</div></div><span className="lios-pane-code text-[7px] text-muted-foreground/55">LOCAL MEMORY</span></div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{resumableSessions.map((item) => <ResumeCard key={item.id} item={item} />)}</div>
          </section>
        )}

        <section>
          <div className="mb-3 flex items-end justify-between gap-3"><div><div className="font-ui flex items-center gap-2 text-[10px] font-semibold text-foreground"><Target className="h-3.5 w-3.5 text-amber-300/80" /> Priority launches</div><div className="font-ui mt-1 text-[8px] text-muted-foreground">Ordered for {persona.label.toLowerCase()} work. This changes priority, never permissions.</div><div className="font-ui mt-1 text-[7px] text-muted-foreground/65">Starter focus: {persona.starterLabels.join(" · ")}</div></div></div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">{priorityCapabilities.map((capability, index) => <button key={capability.view} onClick={() => onNav(capability.view)} className="group rounded-xl border border-border/50 bg-white/[0.01] p-3 text-left transition-all hover:border-amber-400/22 hover:bg-white/[0.025]"><div className="flex items-center justify-between"><span className="lios-pane-code text-[7px] text-amber-300/75">{capability.shortLabel}</span><span className="font-ui text-[7px] text-muted-foreground/45">0{index + 1}</span></div><GuidedCapabilityExplainer capability={capability} className="block"><div className="font-ui mt-2 text-[9px] font-semibold text-foreground">{capability.label}</div></GuidedCapabilityExplainer><p className="font-ui mt-1.5 line-clamp-2 text-[7px] leading-relaxed text-muted-foreground">{capability.description}</p></button>)}</div>
        </section>

        <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]">
          <section>
            <div className="mb-3 flex items-center justify-between"><div className="font-ui flex items-center gap-2 text-[10px] font-semibold text-foreground"><Activity className="h-3.5 w-3.5 text-cyan-300/80" /> Active contexts <span className="lios-pane-code text-[7px] text-muted-foreground/60">{entityTabs.length}</span></div><span className="font-ui text-[7px] text-muted-foreground/55">{tabs.length} tabs open</span></div>
            {entityTabs.length ? <div className="grid gap-2 sm:grid-cols-2">{entityTabs.slice(0, 6).map((tab) => <button key={tab.id} onClick={() => onSymbol(tab.entity!)} className="group flex items-center gap-3 rounded-xl border border-border/50 bg-white/[0.012] p-3 text-left transition-colors hover:border-cyan-400/22 hover:bg-white/[0.025]"><div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-400/15 bg-cyan-400/[0.035]"><span className="lios-symbol text-[8px] font-semibold text-cyan-300">{tab.entity?.slice(0, 4)}</span></div><div className="min-w-0 flex-1"><div className="lios-symbol text-[9px] font-semibold text-foreground">{tab.entity}</div><div className="font-ui mt-1 truncate text-[7px] text-muted-foreground">{tab.title}</div></div><ArrowRight className="h-3 w-3 text-muted-foreground/35 transition-all group-hover:translate-x-0.5 group-hover:text-cyan-300" /></button>)}</div> : <button onClick={onNewEntity} className="font-ui flex min-h-28 w-full items-center justify-center rounded-2xl border border-dashed border-border/60 bg-white/[0.008] p-5 text-[9px] text-muted-foreground transition-colors hover:border-cyan-400/22 hover:bg-white/[0.018]">Open a company to create a durable analytical context →</button>}
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between"><div className="font-ui flex items-center gap-2 text-[10px] font-semibold text-foreground"><BookMarked className="h-3.5 w-3.5 text-amber-300/80" /> Research continuity</div><button onClick={() => openTerminalUxSurface("research-tray")} className="font-ui text-[7px] font-medium text-amber-300/75 hover:text-amber-200">Open tray →</button></div>
            <div className="rounded-2xl border border-border/50 bg-white/[0.01] p-2">
              {pinnedResearch.length ? pinnedResearch.map((item) => <button key={item.id} onClick={() => item.symbol ? onSymbol(item.symbol) : onNav(item.view)} className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-white/[0.025]"><div className="h-6 w-1 rounded-full bg-amber-300/35" /><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5">{item.symbol && <span className="lios-symbol text-[7px] font-semibold text-amber-300">{item.symbol}</span>}<span className="font-ui truncate text-[8px] font-medium text-foreground">{item.title}</span></div><div className="font-ui mt-1 truncate text-[7px] text-muted-foreground">{item.note || item.description}</div></div><ArrowRight className="h-3 w-3 text-muted-foreground/30 group-hover:text-amber-300/80" /></button>) : <button onClick={() => openTerminalUxSurface("research-tray")} className="font-ui min-h-28 w-full rounded-xl p-4 text-center text-[8px] leading-relaxed text-muted-foreground hover:bg-white/[0.02]">Pin DCFs, financials, charts, evidence or notes while you work. They will remain here for the next session.</button>}
            </div>
          </section>
        </div>

        <section>
          <div className="mb-3 flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-amber-300/80" /><span className="font-ui text-[10px] font-semibold text-foreground">Start an analytical journey</span></div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{starters.map((starter) => <Starter key={starter.title} item={starter} onClick={starter.title === "UNDERSTAND" ? onNewEntity : starter.title === "RESEARCH" ? launchResearchStarter : () => starter.view && onNav(starter.view)} />)}</div>
        </section>

        <section className="grid gap-3 lg:grid-cols-3">
          <button onClick={() => openTerminalUxSurface("innovation-studio")} className="group rounded-2xl border border-border/50 bg-white/[0.01] p-4 text-left transition-colors hover:bg-white/[0.025]"><div className="font-ui text-[9px] font-semibold text-foreground">What changed?</div><p className="font-ui mt-2 text-[8px] leading-relaxed text-muted-foreground">Inspect deterministic snapshot differences, model receipt diffs and data timing without losing the underlying context.</p><span className="font-ui mt-3 flex items-center gap-1 text-[7px] font-medium text-amber-300/75">Analytical Studio <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span></button>
          {isInternal && isCapabilityVisible(getTerminalCapability("quantlab"), true) ? <button onClick={() => onNav("quantlab")} className="group rounded-2xl border border-border/50 bg-white/[0.01] p-4 text-left transition-colors hover:bg-white/[0.025]"><div className="font-ui text-[9px] font-semibold text-foreground">Compute queue</div><p className="font-ui mt-2 text-[8px] leading-relaxed text-muted-foreground">Long-running quant work remains durable with diagnostics, comparisons and calculation receipts.</p><span className="font-ui mt-3 flex items-center gap-1 text-[7px] font-medium text-cyan-300/75">Quant Lab <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span></button> : <button onClick={() => openTerminalUxSurface("evidence")} className="group rounded-2xl border border-border/50 bg-white/[0.01] p-4 text-left transition-colors hover:bg-white/[0.025]"><div className="font-ui text-[9px] font-semibold text-foreground">Evidence & receipts</div><p className="font-ui mt-2 text-[8px] leading-relaxed text-muted-foreground">Inspect provenance, freshness and calculation lineage without leaving your current workflow.</p><span className="font-ui mt-3 flex items-center gap-1 text-[7px] font-medium text-cyan-300/75">Inspect evidence <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span></button>}
          <button onClick={() => openTerminalUxSurface("workbench")} className="group rounded-2xl border border-border/50 bg-white/[0.01] p-4 text-left transition-colors hover:bg-white/[0.025]"><div className="font-ui text-[9px] font-semibold text-foreground">Current analytical state</div><p className="font-ui mt-2 text-[8px] leading-relaxed text-muted-foreground">{active?.title ?? "No active context"}. Keep advanced controls available without filling the shell with permanent buttons.</p><span className="font-ui mt-3 flex items-center gap-1 text-[7px] font-medium text-amber-300/75">Open Workbench <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" /></span></button>
        </section>
      </main>
    </div>
  );
}
