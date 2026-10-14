import { useEffect, useMemo, useState } from "react";
import { BookmarkPlus, Clock3, FileText, Folder, MoreHorizontal, Pin, Plus, Search, SplitSquareHorizontal, Tags, Trash2, X } from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import {
  createResearchContextItem,
  getResearchTrayGroups,
  loadResearchTray,
  pinResearchContext,
  removeResearchTrayItem,
  saveResearchTray,
  subscribeResearchTray,
  updateResearchTrayItem,
  type ResearchTrayItem,
} from "@/lib/terminalResearchTray";
import {
  appendResearchThreadEvent,
  clearResearchThread,
  groupResearchThreadByDay,
  loadResearchThread,
  subscribeResearchThread,
  type ResearchThreadEvent,
} from "@/lib/terminalResearchThread";
import { getTerminalCapability } from "@/lib/terminalCatalog";

interface Props {
  activeView: ViewMode;
  activeSymbol?: string;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onClose: () => void;
}

function kindLabel(item: ResearchTrayItem): string {
  if (item.kind === "evidence") return "EVIDENCE";
  if (item.kind === "output") return "OUTPUT";
  if (item.kind === "note") return "NOTE";
  return "CONTEXT";
}

function relativeTime(value: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default function ResearchTray({ activeView, activeSymbol, onOpen, onClose }: Props) {
  const [items, setItems] = useState<ResearchTrayItem[]>(() => loadResearchTray());
  const [thread, setThread] = useState<ResearchThreadEvent[]>(() => loadResearchThread());
  const [tab, setTab] = useState<"pinned" | "thread">("pinned");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("ALL");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  useEffect(() => subscribeResearchTray(setItems), []);
  useEffect(() => subscribeResearchThread(setThread), []);

  const groups = useMemo(() => getResearchTrayGroups(items), [items]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      if (group !== "ALL" && item.group !== group) return false;
      if (!normalized) return true;
      return `${item.title} ${item.description} ${item.note} ${item.tags.join(" ")} ${item.symbol}`.toLowerCase().includes(normalized);
    });
  }, [group, items, query]);

  const filteredThread = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return thread;
    return thread.filter((event) => `${event.label} ${event.detail} ${event.symbol} ${event.kind}`.toLowerCase().includes(normalized));
  }, [query, thread]);
  const threadDays = useMemo(() => groupResearchThreadByDay(filteredThread), [filteredThread]);

  const persist = (next: ResearchTrayItem[]) => {
    setItems(next);
    saveResearchTray(next);
  };

  const pinCurrent = () => {
    persist(pinResearchContext(items, { view: activeView, symbol: activeSymbol }));
    appendResearchThreadEvent({ kind: "pin", view: activeView, symbol: activeSymbol, detail: "Pinned to Research Tray for later use." });
  };

  const addNote = () => {
    const note = window.prompt("Research note");
    if (!note?.trim()) return;
    const item = createResearchContextItem({
      view: activeView,
      symbol: activeSymbol,
      kind: "note",
      title: activeSymbol ? `${activeSymbol} · Research Note` : "Research Note",
      note,
    });
    persist([item, ...items]);
    appendResearchThreadEvent({ kind: "pin", view: activeView, symbol: activeSymbol, label: item.title, detail: note });
  };

  return (
    <aside className="lios-research-tray" aria-label="Research continuity">
      <header className="flex items-start gap-3 border-b border-border/60 p-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/20 bg-amber-500/[0.055] text-amber-300"><Pin className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1"><div className="font-ui text-[12px] font-semibold tracking-tight text-foreground">Research Continuity</div><p className="font-ui mt-1 text-[9px] leading-relaxed text-muted-foreground">Pin what matters and reconstruct the path your investigation actually took. Everything stays local to this device.</p></div>
        <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground" aria-label="Close Research Tray"><X className="h-3.5 w-3.5" /></button>
      </header>

      <div className="flex items-center gap-1 border-b border-border/50 px-3 pt-2">
        <button onClick={() => setTab("pinned")} className={`font-ui rounded-t-lg border-b-2 px-3 py-2 text-[8px] font-semibold transition-colors ${tab === "pinned" ? "border-amber-300 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}><span className="flex items-center gap-1.5"><Pin className="h-3 w-3" /> Pinned <span className="lios-pane-code text-[6px] text-muted-foreground/60">{items.length}</span></span></button>
        <button onClick={() => setTab("thread")} className={`font-ui rounded-t-lg border-b-2 px-3 py-2 text-[8px] font-semibold transition-colors ${tab === "thread" ? "border-cyan-300 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}><span className="flex items-center gap-1.5"><Clock3 className="h-3 w-3" /> Thread <span className="lios-pane-code text-[6px] text-muted-foreground/60">{thread.length}</span></span></button>
      </div>

      <div className="border-b border-border/50 p-3">
        {tab === "pinned" && <div className="flex gap-2"><button onClick={pinCurrent} className="font-ui flex flex-1 items-center justify-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.055] px-3 py-2 text-[9px] font-semibold text-amber-200 transition-colors hover:bg-amber-500/[0.1]"><BookmarkPlus className="h-3.5 w-3.5" /> Pin current analysis</button><button onClick={addNote} className="font-ui flex items-center gap-2 rounded-lg border border-border/70 px-3 py-2 text-[9px] text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"><Plus className="h-3.5 w-3.5" /> Note</button></div>}
        <div className={`${tab === "pinned" ? "mt-2" : ""} flex items-center gap-2 rounded-lg border border-border/60 bg-black/10 px-2.5`}><Search className="h-3 w-3 text-muted-foreground/70" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "pinned" ? "Search pinned research" : "Search research thread"} className="font-ui h-8 min-w-0 flex-1 bg-transparent text-[9px] text-foreground outline-none placeholder:text-muted-foreground/45" /></div>
        {tab === "pinned" && groups.length > 0 && <div className="mt-2 flex gap-1 overflow-x-auto pb-1 scrollbar-thin">{["ALL", ...groups].map((itemGroup) => <button key={itemGroup} onClick={() => setGroup(itemGroup)} className={`font-ui shrink-0 rounded-full border px-2 py-1 text-[7px] font-medium ${group === itemGroup ? "border-cyan-400/30 bg-cyan-400/[0.055] text-cyan-200" : "border-border/60 text-muted-foreground hover:text-foreground"}`}>{itemGroup}</button>)}</div>}
      </div>

      {tab === "pinned" ? (
        <div className="max-h-[430px] overflow-y-auto p-2 scrollbar-thin">
          {filtered.length === 0 ? <div className="m-2 rounded-xl border border-dashed border-border/70 p-6 text-center"><Pin className="mx-auto h-4 w-4 text-muted-foreground/45" /><div className="font-ui mt-3 text-[10px] font-medium text-foreground">Nothing pinned here yet</div><div className="font-ui mt-1 text-[8px] leading-relaxed text-muted-foreground">Pin the active DCF, financials, chart, evidence, or another context you want to revisit during this investigation.</div></div> : filtered.map((item) => {
            const capability = getTerminalCapability(item.view);
            const editing = editingId === item.id;
            return <article key={item.id} className="group relative mb-1.5 rounded-xl border border-border/55 bg-white/[0.012] p-3 transition-all hover:border-border hover:bg-white/[0.025]"><div className="flex items-start gap-2.5"><div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-black/15 text-cyan-300/80">{item.kind === "note" ? <FileText className="h-3.5 w-3.5" /> : item.group ? <Folder className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2">{item.symbol && <span className="lios-symbol text-[8px] font-semibold text-amber-300">{item.symbol}</span>}<span className="font-ui truncate text-[10px] font-semibold text-foreground">{item.title}</span></div><div className="mt-1 flex flex-wrap items-center gap-1.5"><span className="lios-pane-code text-[6px] tracking-wider text-muted-foreground/70">{kindLabel(item)}</span><span className="font-ui text-[7px] text-muted-foreground/70">{capability.label}</span>{item.group && <span className="font-ui rounded-full border border-border/60 px-1.5 py-0.5 text-[6px] text-muted-foreground">{item.group}</span>}</div>{!editing && item.note && <p className="font-ui mt-2 line-clamp-3 text-[8px] leading-relaxed text-muted-foreground">{item.note}</p>}{editing && <div className="mt-2 space-y-2"><textarea defaultValue={item.note} onBlur={(event) => persist(updateResearchTrayItem(items, item.id, { note: event.target.value }))} placeholder="Add your research note…" className="font-ui min-h-20 w-full resize-y rounded-lg border border-border/70 bg-black/15 p-2 text-[9px] leading-relaxed text-foreground outline-none focus:border-amber-400/35" /><input defaultValue={item.tags.join(", ")} onBlur={(event) => persist(updateResearchTrayItem(items, item.id, { tags: event.target.value.split(",") }))} placeholder="Tags: valuation, catalyst, risk" className="font-ui h-8 w-full rounded-lg border border-border/70 bg-black/15 px-2 text-[8px] text-foreground outline-none focus:border-cyan-400/35" /><input defaultValue={item.group} onBlur={(event) => persist(updateResearchTrayItem(items, item.id, { group: event.target.value }))} placeholder="Group: NVDA thesis / Client A" className="font-ui h-8 w-full rounded-lg border border-border/70 bg-black/15 px-2 text-[8px] text-foreground outline-none focus:border-cyan-400/35" /></div>}{item.tags.length > 0 && !editing && <div className="mt-2 flex flex-wrap gap-1">{item.tags.map((tag) => <span key={tag} className="font-ui flex items-center gap-1 rounded-full border border-border/50 px-1.5 py-0.5 text-[6px] text-muted-foreground"><Tags className="h-2 w-2" />{tag}</span>)}</div>}<div className="mt-2 flex flex-wrap gap-1"><button onClick={() => onOpen(item.view, "current", item.symbol || undefined)} className="font-ui rounded-md border border-border/60 px-2 py-1 text-[7px] text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground">Open here</button><button onClick={() => onOpen(item.view, "tab", item.symbol || undefined)} className="font-ui rounded-md border border-border/60 px-2 py-1 text-[7px] text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground">New tab</button><button onClick={() => onOpen(item.view, "split-right", item.symbol || undefined)} className="font-ui flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[7px] text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"><SplitSquareHorizontal className="h-2.5 w-2.5" /> Split</button><button onClick={() => setEditingId(editing ? null : item.id)} className="font-ui rounded-md border border-transparent px-2 py-1 text-[7px] text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground">{editing ? "Done" : "Annotate"}</button></div></div><div className="relative"><button onClick={() => setMenuId(menuId === item.id ? null : item.id)} className="rounded-md p-1 text-muted-foreground/45 opacity-0 transition-all hover:bg-white/[0.04] hover:text-foreground group-hover:opacity-100" aria-label="Research item actions"><MoreHorizontal className="h-3 w-3" /></button>{menuId === item.id && <div className="lios-v4-overlay absolute right-0 top-6 z-20 w-40 rounded-lg p-1"><button onClick={() => { persist(removeResearchTrayItem(items, item.id)); setMenuId(null); }} className="font-ui flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[8px] text-red-300/80 hover:bg-red-500/[0.04] hover:text-red-200"><Trash2 className="h-3 w-3" /> Remove</button></div>}</div></div></article>;
          })}
        </div>
      ) : (
        <div className="max-h-[430px] overflow-y-auto p-3 scrollbar-thin">
          {threadDays.length === 0 ? <div className="rounded-xl border border-dashed border-border/70 p-6 text-center"><Clock3 className="mx-auto h-4 w-4 text-muted-foreground/45" /><div className="font-ui mt-3 text-[10px] font-medium text-foreground">Your research path will appear here</div><div className="font-ui mt-1 text-[8px] leading-relaxed text-muted-foreground">As you move through companies, financials, DCF, risk, evidence and other tools, LiOS records a local navigation chronology.</div></div> : threadDays.map((day) => <section key={day.dateKey} className="mb-4"><div className="font-ui mb-2 flex items-center justify-between text-[7px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65"><span>{day.label}</span><span className="lios-pane-code">{day.events.length} moves</span></div><div className="relative ml-1 border-l border-border/55 pl-3">{day.events.map((event) => <button key={event.id} onClick={() => onOpen(event.view, "current", event.symbol || undefined)} className="group relative mb-1.5 w-full rounded-xl p-2.5 text-left transition-colors hover:bg-white/[0.025]"><span className={`absolute -left-[15.5px] top-4 h-1.5 w-1.5 rounded-full ring-4 ring-[hsl(var(--lios-overlay))] ${event.kind === "pin" ? "bg-amber-300" : event.kind === "evidence" ? "bg-cyan-300" : event.kind === "decision" ? "bg-violet-300" : "bg-muted-foreground/55"}`} /><div className="flex items-center gap-2">{event.symbol && <span className="lios-symbol text-[7px] font-semibold text-amber-300/85">{event.symbol}</span>}<span className="font-ui min-w-0 flex-1 truncate text-[8px] font-medium text-foreground">{event.label}</span><span className="lios-pane-code text-[6px] text-muted-foreground/50">{relativeTime(event.createdAt)}</span></div><div className="font-ui mt-1 line-clamp-2 text-[7px] leading-relaxed text-muted-foreground">{event.detail}</div><div className="font-ui mt-1.5 text-[6px] font-medium uppercase tracking-[0.12em] text-cyan-300/50">{event.kind}</div></button>)}</div></section>)}
          {thread.length > 0 && <button onClick={() => { if (window.confirm("Clear local research thread? Pinned Research Tray items will remain.")) clearResearchThread(); }} className="font-ui mt-2 w-full rounded-lg border border-border/55 px-3 py-2 text-[7px] text-muted-foreground transition-colors hover:border-red-400/20 hover:bg-red-500/[0.025] hover:text-red-300">Clear thread history</button>}
        </div>
      )}

      <footer className="flex items-center justify-between border-t border-border/50 px-3 py-2"><span className="font-ui text-[7px] text-muted-foreground">{items.length} pinned · {thread.length} thread events · local device only</span><span className="lios-pane-code text-[6px] text-muted-foreground/60">RESEARCH CONTINUITY</span></footer>
    </aside>
  );
}
