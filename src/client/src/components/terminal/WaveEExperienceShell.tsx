import { useEffect, useMemo, useState } from "react";
import { Activity, ArrowUpRight, BookOpen, CheckCircle2, CircleAlert, GitBranch, Network, RefreshCw, Send, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { ViewMode } from "@/lib/terminalTypes";

interface Props {
  activeView: ViewMode;
  activeSymbol?: string;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onClose: () => void;
}

type Surface = "network" | "objects" | "intelligence" | "workspace" | "skills";

interface ReadinessResponse {
  contractVersion: string;
  local: Record<string, number | boolean>;
  workstreams: Record<string, string>;
  externalBlockers: string[];
  updatedAt: string | null;
}

interface Profile {
  id: number;
  handle: string;
  displayName: string;
  bio: string;
  visibility: "private" | "organization" | "public";
  disclosures: string[];
}

interface Skill {
  id: string;
  name: string;
  version: string;
  description: string;
  requiredInputs: string[];
  requiredCapabilities: string[];
  firstParty: boolean;
  approval: "pending" | "approved" | "blocked";
}

interface WorkspacePlan {
  id: string;
  prompt: string;
  operations: Array<{ action: string; block?: { primitive: string; title: string } | null }>;
  reason: string;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed (${response.status}).`);
  return response.json() as Promise<T>;
}

export default function WaveEExperienceShell({ activeView, activeSymbol, onOpen, onClose }: Props) {
  const [surface, setSurface] = useState<Surface>("network");
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [objects, setObjects] = useState<Array<{ id: string; title: string; kind: string; visibility: string }>>([]);
  const [plan, setPlan] = useState<WorkspacePlan | null>(null);
  const [prompt, setPrompt] = useState("Build a research workspace with a chart, valuation metric and cross-domain impact view");
  const [profileDraft, setProfileDraft] = useState({ handle: "", displayName: "", bio: "", visibility: "private" as Profile["visibility"], disclosures: "" });
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextReadiness, nextProfile, nextSkills, nextObjects] = await Promise.all([
        readJson<ReadinessResponse>("/api/readiness/wave-e"),
        readJson<{ profile: Profile | null }>("/api/wave-e/profile"),
        readJson<{ skills: Skill[] }>("/api/wave-e/skills"),
        readJson<{ objects: Array<{ id: string; title: string; kind: string; visibility: string }> }>("/api/wave-e/objects"),
      ]);
      setReadiness(nextReadiness);
      setProfile(nextProfile.profile);
      setSkills(nextSkills.skills ?? []);
      setObjects(nextObjects.objects ?? []);
      if (nextProfile.profile) setProfileDraft({ ...nextProfile.profile, disclosures: nextProfile.profile.disclosures.join("\n") });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Wave E is unavailable for this session.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const counts = useMemo(() => readiness?.local ?? {}, [readiness]);
  const saveProfile = async () => {
    setStatus(null); setError(null);
    try {
      const response = await fetch("/api/wave-e/profile", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...profileDraft, disclosures: profileDraft.disclosures.split("\n").map((value) => value.trim()).filter(Boolean) }) });
      const body = await response.json() as { profile?: Profile; error?: string };
      if (!response.ok || !body.profile) throw new Error(body.error ?? "Profile could not be saved.");
      setProfile(body.profile); setStatus("Profile and disclosure model saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Profile could not be saved."); }
  };

  const buildPlan = async () => {
    setStatus(null); setError(null);
    try {
      const response = await fetch("/api/wave-e/ai/workspaces/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const body = await response.json() as { plan?: WorkspacePlan; error?: string };
      if (!response.ok || !body.plan) throw new Error(body.error ?? "Workspace plan could not be created.");
      setPlan(body.plan); setStatus("Proposal created. Nothing is persisted until you confirm it.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Workspace plan could not be created."); }
  };

  const confirmPlan = async () => {
    if (!plan) return;
    setStatus(null); setError(null);
    try {
      const response = await fetch("/api/wave-e/ai/workspaces/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.id, confirmed: true, permissions: [], title: activeSymbol ? `${activeSymbol} Wave E workspace` : "Wave E workspace" }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Workspace confirmation was blocked.");
      setStatus("Workspace confirmed and persisted under the current user boundary.");
      setPlan(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Workspace confirmation was blocked."); }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/80 px-3 py-6 sm:py-12" onMouseDown={onClose}>
      <section className="w-full max-w-6xl overflow-hidden rounded-2xl border border-cyan-400/25 bg-[#080909] shadow-2xl" onMouseDown={(event) => event.stopPropagation()} aria-label="LiOS Wave E network and moat shell">
        <header className="flex flex-wrap items-center gap-3 border-b border-border/70 px-4 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/25 bg-cyan-400/[0.06] text-cyan-200"><Network className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1"><div className="font-ui text-[11px] font-semibold text-foreground">LiOS V4 · Wave E</div><div className="mt-1 font-ui text-[8px] text-muted-foreground">Network, portable objects, cross-domain intelligence and governed AI-built experiences.</div></div>
          <span className="font-terminal text-[7px] tracking-widest text-emerald-300">{readiness ? `CONTRACT ${readiness.contractVersion}` : "HYDRATING"}</span>
          <button onClick={() => void load()} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground" aria-label="Refresh Wave E"><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground" aria-label="Close Wave E experience shell"><X className="h-4 w-4" /></button>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-border/60 px-3 py-2" aria-label="Wave E surfaces">
          {(["network", "objects", "intelligence", "workspace", "skills"] as Surface[]).map((item) => <button key={item} onClick={() => setSurface(item)} className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 font-terminal text-[8px] tracking-wider ${surface === item ? "bg-cyan-400/[0.09] text-cyan-200" : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"}`}>{item.toUpperCase()}</button>)}
        </nav>

        <div className="grid gap-4 p-4 lg:grid-cols-[1.35fr_1fr]">
          <div className="space-y-4">
            {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-400/30 bg-rose-400/[0.04] p-3 font-terminal text-[8px] text-rose-200"><CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />{error}</div>}
            {status && <div role="status" className="flex items-start gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/[0.04] p-3 font-terminal text-[8px] text-emerald-200"><CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />{status}</div>}

            {surface === "network" && <section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><Users className="h-4 w-4 text-cyan-300" /><div><div className="font-ui text-[10px] font-semibold">Network identity</div><div className="font-ui mt-1 text-[8px] text-muted-foreground">Disclosure-first profile controls. Public visibility is never enabled without an explicit disclosure.</div></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="font-terminal text-[7px] text-muted-foreground">HANDLE<input value={profileDraft.handle} onChange={(event) => setProfileDraft((current) => ({ ...current, handle: event.target.value }))} placeholder="analyst-handle" className="mt-1 w-full rounded border border-border bg-transparent px-2 py-2 font-terminal text-[8px] text-foreground" /></label><label className="font-terminal text-[7px] text-muted-foreground">DISPLAY NAME<input value={profileDraft.displayName} onChange={(event) => setProfileDraft((current) => ({ ...current, displayName: event.target.value }))} placeholder="Your research name" className="mt-1 w-full rounded border border-border bg-transparent px-2 py-2 font-terminal text-[8px] text-foreground" /></label></div><label className="mt-3 block font-terminal text-[7px] text-muted-foreground">BIO<textarea value={profileDraft.bio} onChange={(event) => setProfileDraft((current) => ({ ...current, bio: event.target.value }))} rows={3} className="mt-1 w-full resize-y rounded border border-border bg-transparent px-2 py-2 font-terminal text-[8px] text-foreground" /></label><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="font-terminal text-[7px] text-muted-foreground">VISIBILITY<select value={profileDraft.visibility} onChange={(event) => setProfileDraft((current) => ({ ...current, visibility: event.target.value as Profile["visibility"] }))} className="mt-1 w-full rounded border border-border bg-[#080909] px-2 py-2 font-terminal text-[8px] text-foreground"><option value="private">PRIVATE</option><option value="organization">ORGANIZATION</option><option value="public">PUBLIC</option></select></label><label className="font-terminal text-[7px] text-muted-foreground">DISCLOSURES <span className="normal-case">(one per line)</span><textarea value={profileDraft.disclosures} onChange={(event) => setProfileDraft((current) => ({ ...current, disclosures: event.target.value }))} rows={2} className="mt-1 w-full resize-y rounded border border-border bg-transparent px-2 py-2 font-terminal text-[8px] text-foreground" /></label></div><div className="mt-3 flex flex-wrap items-center gap-2"><button onClick={() => void saveProfile()} className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/30 px-3 py-2 font-terminal text-[7px] text-cyan-200 hover:bg-cyan-300/[0.05]"><Send className="h-3 w-3" /> SAVE PROFILE</button><span className="font-terminal text-[7px] text-muted-foreground">{profile ? `USER ${profile.id} · ${profile.visibility.toUpperCase()}` : "No profile saved yet"}</span></div></section>}

            {surface === "objects" && <section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-cyan-300" /><div><div className="font-ui text-[10px] font-semibold">Portable analytical objects</div><div className="font-ui mt-1 text-[8px] text-muted-foreground">Open, compare and continue work without copying licensed source values.</div></div></div><div className="mt-4 space-y-2">{objects.length ? objects.map((object) => <div key={object.id} className="flex items-center gap-3 rounded-lg border border-border/50 p-3"><div className="min-w-0 flex-1"><div className="font-ui truncate text-[8px] text-foreground">{object.title}</div><div className="mt-1 font-terminal text-[6px] text-muted-foreground">{object.kind.toUpperCase()} · {object.visibility.toUpperCase()}</div></div><button onClick={() => onOpen("workspaces", "current", activeSymbol)} className="inline-flex items-center gap-1 font-terminal text-[7px] text-cyan-200 hover:text-cyan-100">OPEN WORKBENCH <ArrowUpRight className="h-3 w-3" /></button></div>) : <div className="rounded-lg border border-dashed border-border/60 p-5 text-center font-terminal text-[8px] text-muted-foreground">No portable objects are persisted for this user yet.</div>}</div><div className="mt-4 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.03] p-3 font-terminal text-[7px] leading-relaxed text-cyan-100">Sharing policy: licensed references are never copied. Recipient entitlements must be rehydrated before opening or recomputation. External sharing remains blocked without enterprise policy.</div></section>}

            {surface === "intelligence" && <section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><GitBranch className="h-4 w-4 text-amber-300" /><div><div className="font-ui text-[10px] font-semibold">Cross-domain intelligence</div><div className="font-ui mt-1 text-[8px] text-muted-foreground">Macro, policy, supply-chain, company, valuation and portfolio paths stay evidence-bound.</div></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-lg border border-border/50 p-3"><span className="font-terminal text-[7px] text-muted-foreground">ACTIVE CONTEXT</span><span className="mt-1 block font-ui text-[9px] text-foreground">{activeSymbol ?? "No symbol selected"}</span><span className="mt-1 block font-terminal text-[7px] text-muted-foreground">{activeView.toUpperCase()}</span></div><div className="rounded-lg border border-border/50 p-3"><span className="font-terminal text-[7px] text-muted-foreground">GRAPH STATUS</span><span className="mt-1 block font-ui text-[9px] text-foreground">{counts.relationships ?? 0} persisted relationships</span><span className="mt-1 block font-terminal text-[7px] text-amber-200">UNAVAILABLE WITHOUT EXPLICIT EVIDENCE</span></div></div><div className="mt-4 flex flex-wrap gap-2"><button onClick={() => onOpen("crossdomainfusion", "current", activeSymbol)} className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300/30 px-3 py-2 font-terminal text-[7px] text-amber-200">OPEN CROSS-DOMAIN SURFACE <ArrowUpRight className="h-3 w-3" /></button><button onClick={() => onOpen("quantlab", "current", activeSymbol)} className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 font-terminal text-[7px] text-muted-foreground">OPEN DETERMINISTIC RUNTIME</button></div></section>}

            {surface === "workspace" && <section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-fuchsia-300" /><div><div className="font-ui text-[10px] font-semibold">AI-built workspace planner</div><div className="font-ui mt-1 text-[8px] text-muted-foreground">Preview is safe; persistence requires your explicit confirmation and governed primitives.</div></div></div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} className="mt-4 w-full resize-y rounded-lg border border-border bg-transparent px-3 py-2 font-terminal text-[8px] text-foreground" /><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => void buildPlan()} className="inline-flex items-center gap-1.5 rounded-lg border border-fuchsia-300/30 px-3 py-2 font-terminal text-[7px] text-fuchsia-200">PREVIEW PLAN</button>{plan && <button onClick={() => void confirmPlan()} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300/30 px-3 py-2 font-terminal text-[7px] text-emerald-200"><ShieldCheck className="h-3 w-3" /> CONFIRM & SAVE</button>}</div>{plan && <div className="mt-4 rounded-lg border border-fuchsia-300/20 bg-fuchsia-300/[0.03] p-3"><div className="font-terminal text-[7px] text-fuchsia-200">PROPOSAL · {plan.id}</div><div className="mt-2 space-y-1">{plan.operations.map((operation, index) => <div key={`${operation.action}-${index}`} className="font-ui text-[8px] text-foreground">{operation.action.replace("_", " ")} · {operation.block?.primitive ?? "visibility"} {operation.block?.title ?? ""}</div>)}</div><div className="mt-3 font-terminal text-[7px] leading-relaxed text-muted-foreground">{plan.reason}</div></div>}</section>}

            {surface === "skills" && <section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-emerald-300" /><div><div className="font-ui text-[10px] font-semibold">Curated skills & templates</div><div className="font-ui mt-1 text-[8px] text-muted-foreground">First-party packs declare inputs, capabilities and supported analytical object kinds.</div></div></div><div className="mt-4 space-y-2">{skills.map((skill) => <div key={skill.id} className="rounded-lg border border-border/50 p-3"><div className="flex items-center gap-2"><span className="font-ui text-[9px] text-foreground">{skill.name}</span><span className="ml-auto font-terminal text-[6px] text-emerald-300">{skill.approval.toUpperCase()}</span></div><div className="mt-1 font-terminal text-[6px] text-muted-foreground">{skill.id} · v{skill.version}</div><div className="mt-2 font-ui text-[7px] leading-relaxed text-muted-foreground">{skill.description}</div><div className="mt-2 flex flex-wrap gap-1">{skill.requiredCapabilities.map((capability) => <span key={capability} className="rounded-full border border-border/50 px-2 py-1 font-terminal text-[6px] text-muted-foreground">{capability}</span>)}</div></div>)}</div></section>}
          </div>

          <aside className="space-y-4"><section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><Activity className="h-3.5 w-3.5 text-cyan-300" /><div className="font-ui text-[9px] font-semibold">Wave E readiness</div></div><div className="mt-3 grid grid-cols-2 gap-2">{Object.entries(counts).map(([key, value]) => <div key={key} className="rounded-lg border border-border/50 p-2"><span className="font-terminal text-[6px] text-muted-foreground">{key.replace(/([A-Z])/g, " $1").toUpperCase()}</span><span className="mt-1 block font-ui text-[12px] text-foreground">{String(value)}</span></div>)}</div><div className="mt-3 font-terminal text-[7px] text-muted-foreground">Updated {readiness?.updatedAt ? new Date(readiness.updatedAt).toLocaleString() : "not yet"}</div></section><section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><CircleAlert className="h-3.5 w-3.5 text-amber-300" /><div className="font-ui text-[9px] font-semibold">External gates</div></div><div className="mt-3 space-y-2">{(readiness?.externalBlockers ?? ["Load readiness to inspect deployment blockers."]).map((blocker) => <div key={blocker} className="flex gap-2 rounded-lg border border-amber-300/15 bg-amber-300/[0.02] p-2 font-ui text-[7px] leading-relaxed text-muted-foreground"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-300" />{blocker}</div>)}</div></section><section className="rounded-xl border border-border/60 p-4"><div className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-emerald-300" /><div className="font-ui text-[9px] font-semibold">Current session</div></div><div className="mt-2 font-terminal text-[7px] leading-relaxed text-muted-foreground">{profile ? `${profile.displayName} · @${profile.handle}` : "No Wave E profile configured."}<br />Wave E uses the existing protected internal role gates and tenant-scoped preference boundary.</div></section></aside>
        </div>
      </section>
    </div>
  );
}
