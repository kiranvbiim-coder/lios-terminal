import { useEffect, useMemo, useState } from "react";
import { BookmarkPlus, Clock3, FileText, Folder, Pin, Plus, Search, SplitSquareHorizontal, Tags, Trash2, X } from "lucide-react";
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
  if (item.kind === "evidence") return "Evidence";
  if (item.kind === "output") return "Output";
  if (item.kind === "note") return "Note";
  return "Context";
}

function relativeTime(value: number): string {
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return String(minutes) + "m";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return String(hours) + "h";
  return String(Math.floor(hours / 24)) + "d";
}

const smallButton = "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-border/70 px-3 py-2 font-ui text-sm text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
const inputClass = "min-h-11 w-full rounded-md border border-border/70 bg-[#0b0b0b] px-3 py-2 font-ui text-sm text-foreground placeholder:text-muted-foreground/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

export default function ResearchTray({ activeView, activeSymbol, onOpen, onClose }: Props) {
  const [items, setItems] = useState<ResearchTrayItem[]>(() => loadResearchTray());
  const [thread, setThread] = useState<ResearchThreadEvent[]>(() => loadResearchThread());
  const [tab, setTab] = useState<"pinned" | "thread">("pinned");
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("ALL");
  const [addingNote, setAddingNote] = useState(false);
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [groupDraft, setGroupDraft] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => subscribeResearchTray(setItems), []);
  useEffect(() => subscribeResearchThread(setThread), []);

  const groups = useMemo(() => getResearchTrayGroups(items), [items]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      if (group !== "ALL" && item.group !== group) return false;
      if (!normalized) return true;
      return (item.title + " " + item.description + " " + item.note + " " + item.tags.join(" ") + " " + item.symbol).toLowerCase().includes(normalized);
    });
  }, [group, items, query]);

  const filteredThread = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return thread;
    return thread.filter((event) => (event.label + " " + event.detail + " " + event.symbol + " " + event.kind).toLowerCase().includes(normalized));
  }, [query, thread]);
  const threadDays = useMemo(() => groupResearchThreadByDay(filteredThread), [filteredThread]);

  const persist = (next: ResearchTrayItem[]): boolean => {
    try {
      // Report a blocked/private/quota-limited storage failure rather than
      // claiming a research note was durably saved when it was not.
      saveResearchTray(next);
      setItems(next);
      return true;
    } catch {
      setNotice("Could not save research on this device. Check local storage availability and retry.");
      return false;
    }
  };

  const pinCurrent = () => {
    if (!persist(pinResearchContext(items, { view: activeView, symbol: activeSymbol }))) return;
    try {
      appendResearchThreadEvent({ kind: "pin", view: activeView, symbol: activeSymbol, detail: "Pinned to Research Tray for later use." });
      setNotice("Current analysis pinned for later.");
    } catch {
      setNotice("Analysis pinned, but the research history could not be updated.");
    }
  };

  const addNote = () => {
    const note = newNote.trim();
    if (!note) return;
    const item = createResearchContextItem({
      view: activeView,
      symbol: activeSymbol,
      kind: "note",
      title: activeSymbol ? activeSymbol + " · Research Note" : "Research Note",
      note,
    });
    if (!persist([item, ...items])) return;
    try {
      appendResearchThreadEvent({ kind: "pin", view: activeView, symbol: activeSymbol, label: item.title, detail: note });
      setNotice("Research note saved locally.");
    } catch {
      setNotice("Note saved, but the research history could not be updated.");
    }
    setNewNote("");
    setAddingNote(false);
  };

  const edit = (item: ResearchTrayItem) => {
    setEditingId(item.id);
    setNoteDraft(item.note);
    setTagsDraft(item.tags.join(", "));
    setGroupDraft(item.group);
    setRemoveId(null);
  };

  const saveEdit = (item: ResearchTrayItem) => {
    if (!persist(updateResearchTrayItem(items, item.id, {
      note: noteDraft,
      tags: tagsDraft.split(","),
      group: groupDraft,
    }))) return;
    setEditingId(null);
    setNotice("Research annotation saved locally.");
  };

  const remove = (item: ResearchTrayItem) => {
    if (!persist(removeResearchTrayItem(items, item.id))) return;
    setRemoveId(null);
    if (editingId === item.id) setEditingId(null);
    setNotice("Pinned item removed. Your research thread is unchanged.");
  };

  return (
    <aside className="lios-research-tray flex h-[min(620px,calc(100dvh-145px))] min-h-0 flex-col text-foreground" aria-label="Research continuity">
      <header className="flex shrink-0 items-start gap-3 border-b border-border/60 p-3 sm:p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/[0.06] text-primary">
          <Pin className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-ui text-lg font-semibold tracking-tight text-foreground">Research continuity</h2>
          <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">
            Pin important analysis, take notes and retrace your work. Research stays on this device.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close Research Tray"
          className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-muted-foreground hover:bg-white/[0.05] hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <nav className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2" aria-label="Research sections">
        <button type="button" onClick={() => { setTab("pinned"); setConfirmClear(false); }} aria-pressed={tab === "pinned"}
          className={"min-h-11 flex-1 rounded-md border-b-2 px-3 py-2 font-ui text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " + (tab === "pinned" ? "border-primary bg-primary/[0.055] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
          Pinned ({items.length})
        </button>
        <button type="button" onClick={() => { setTab("thread"); setRemoveId(null); }} aria-pressed={tab === "thread"}
          className={"min-h-11 flex-1 rounded-md border-b-2 px-3 py-2 font-ui text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " + (tab === "thread" ? "border-primary bg-primary/[0.055] text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
          History ({thread.length})
        </button>
      </nav>

      <div className="shrink-0 space-y-3 border-b border-border/50 p-3">
        {tab === "pinned" && (
          <>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={pinCurrent} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md border border-primary/45 bg-primary/[0.065] px-3 py-2 font-ui text-sm font-semibold text-primary hover:bg-primary/[0.12] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                <BookmarkPlus className="h-4 w-4" aria-hidden="true" /> Pin current
              </button>
              <button type="button" onClick={() => { setAddingNote((current) => !current); setNewNote(""); }} aria-expanded={addingNote} aria-controls="research-new-note"
                className={smallButton}>
                <Plus className="h-4 w-4" aria-hidden="true" /> New note
              </button>
            </div>
            {addingNote && (
              <form id="research-new-note" className="space-y-2 rounded-lg border border-border/70 bg-black/20 p-3" onSubmit={(event) => { event.preventDefault(); addNote(); }}>
                <label htmlFor="research-note-content" className="block font-ui text-sm font-semibold text-foreground">Research note</label>
                <textarea id="research-note-content" value={newNote} onChange={(event) => setNewNote(event.target.value)}
                  maxLength={1200} rows={3} autoFocus placeholder="Write an observation, thesis, question or follow-up…"
                  className={inputClass + " resize-y"} />
                <div className="flex flex-wrap gap-2">
                  <button type="submit" disabled={!newNote.trim()} className={smallButton + " border-primary/50 text-primary disabled:opacity-40"}>Save note</button>
                  <button type="button" onClick={() => { setAddingNote(false); setNewNote(""); }} className={smallButton}>Cancel</button>
                </div>
              </form>
            )}
          </>
        )}
        <label className="flex min-h-11 items-center gap-2 rounded-md border border-border/70 bg-[#0b0b0b] px-3 focus-within:border-primary/50">
          <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search {tab === "pinned" ? "pinned research" : "research history"}</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder={tab === "pinned" ? "Search pinned research" : "Search research history"}
            className="min-w-0 flex-1 bg-transparent py-2 font-ui text-sm text-foreground outline-none placeholder:text-muted-foreground/70" />
        </label>
        {tab === "pinned" && groups.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin" role="group" aria-label="Filter research by group">
            {["ALL", ...groups].map((itemGroup) => (
              <button type="button" key={itemGroup} aria-pressed={group === itemGroup} onClick={() => setGroup(itemGroup)}
                className={"min-h-10 shrink-0 rounded-full border px-3 py-2 font-ui text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary " + (group === itemGroup ? "border-primary/50 bg-primary/[0.08] text-primary" : "border-border/70 text-muted-foreground hover:text-foreground")}>
                {itemGroup === "ALL" ? "All groups" : itemGroup}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 scrollbar-thin">
        {tab === "pinned" ? (
          filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-5 text-center">
              <Pin className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <h3 className="mt-3 font-ui text-sm font-semibold">No matching pinned research</h3>
              <p className="mt-2 font-ui text-sm leading-6 text-muted-foreground">
                {items.length ? "Try another search or choose All groups." : "Pin a chart, filing, model or analysis, or write a note to revisit later."}
              </p>
            </div>
          ) : filtered.map((item) => {
            const capability = getTerminalCapability(item.view);
            const editing = editingId === item.id;
            return (
              <article key={item.id} className="mb-3 rounded-lg border border-border/70 bg-white/[0.015] p-3">
                <div className="flex items-start gap-3">
                  <div aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/70 text-cyan-300">
                    {item.kind === "note" ? <FileText className="h-4 w-4" /> : item.group ? <Folder className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.symbol && <span className="font-ui text-xs font-semibold text-primary">{item.symbol}</span>}
                      <h3 className="min-w-0 break-words font-ui text-sm font-semibold">{item.title}</h3>
                    </div>
                    <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">
                      {kindLabel(item)} · {capability.label}{item.group ? " · " + item.group : ""}
                    </p>
                    {!editing && item.note && <p className="mt-2 whitespace-pre-wrap break-words font-ui text-sm leading-6 text-muted-foreground">{item.note}</p>}
                    {item.tags.length > 0 && !editing && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.tags.map((tag) => <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-1 font-ui text-xs text-muted-foreground"><Tags className="h-3 w-3" aria-hidden="true" />{tag}</span>)}
                      </div>
                    )}
                  </div>
                </div>

                {editing && (
                  <form className="mt-3 space-y-3 rounded-lg border border-border/70 bg-black/20 p-3"
                    onSubmit={(event) => { event.preventDefault(); saveEdit(item); }}>
                    <label className="block font-ui text-sm font-medium">
                      Note
                      <textarea value={noteDraft} onChange={(event) => setNoteDraft(event.target.value)} maxLength={1200} rows={4}
                        className={inputClass + " mt-1 resize-y"} placeholder="Record findings or next questions…" />
                    </label>
                    <label className="block font-ui text-sm font-medium">
                      Tags (comma-separated)
                      <input value={tagsDraft} onChange={(event) => setTagsDraft(event.target.value)} className={inputClass + " mt-1"} placeholder="valuation, risk, catalysts" />
                    </label>
                    <label className="block font-ui text-sm font-medium">
                      Group
                      <input value={groupDraft} onChange={(event) => setGroupDraft(event.target.value)} className={inputClass + " mt-1"} placeholder="AAPL thesis" />
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" className={smallButton + " border-primary/50 text-primary"}>Save annotation</button>
                      <button type="button" onClick={() => setEditingId(null)} className={smallButton}>Cancel</button>
                    </div>
                  </form>
                )}

                {!editing && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => onOpen(item.view, "current", item.symbol || undefined)} className={smallButton}>Open here</button>
                    <button type="button" onClick={() => onOpen(item.view, "tab", item.symbol || undefined)} className={smallButton}>New tab</button>
                    <button type="button" onClick={() => onOpen(item.view, "split-right", item.symbol || undefined)} className={smallButton}>
                      <SplitSquareHorizontal className="h-4 w-4" aria-hidden="true" /> Split
                    </button>
                    <button type="button" onClick={() => edit(item)} aria-label={"Annotate " + item.title} className={smallButton}>Annotate</button>
                    <button type="button" onClick={() => setRemoveId(item.id)} aria-label={"Remove pinned item " + item.title} className={smallButton + " hover:text-rose-300"}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove
                    </button>
                  </div>
                )}
                {removeId === item.id && !editing && (
                  <div className="mt-3 rounded-lg border border-rose-400/30 bg-rose-400/[0.035] p-3" data-testid="research-remove-confirm">
                    <p className="font-ui text-sm leading-5">Remove “{item.title}” from pinned research? This does not clear your research history.</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setRemoveId(null)} className={smallButton}>Cancel</button>
                      <button type="button" onClick={() => remove(item)} className={smallButton + " border-rose-400/50 text-rose-200"}>Remove pinned item</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })
        ) : (
          threadDays.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 p-5 text-center">
              <Clock3 className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden="true" />
              <h3 className="mt-3 font-ui text-sm font-semibold">No matching research history</h3>
              <p className="mt-2 font-ui text-sm leading-6 text-muted-foreground">
                {thread.length ? "Try another search." : "Your path through companies, filings, calculations and evidence will appear here."}
              </p>
            </div>
          ) : (
            <>
              {threadDays.map((day) => (
                <section key={day.dateKey} className="mb-5">
                  <h3 className="mb-2 font-ui text-xs font-semibold text-muted-foreground">{day.label} · {day.events.length} events</h3>
                  <div className="space-y-1 border-l border-border/70 pl-3">
                    {day.events.map((event) => (
                      <button type="button" key={event.id} onClick={() => onOpen(event.view, "current", event.symbol || undefined)}
                        className="w-full rounded-lg p-3 text-left hover:bg-white/[0.035] focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="min-w-0 break-words font-ui text-sm font-medium text-foreground">{event.symbol ? event.symbol + " · " : ""}{event.label}</span>
                          <span className="shrink-0 font-ui text-xs text-muted-foreground">{relativeTime(event.createdAt)}</span>
                        </div>
                        <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">{event.detail}</p>
                        <span className="mt-2 block font-ui text-xs capitalize text-cyan-300">{event.kind}</span>
                      </button>
                    ))}
                  </div>
                </section>
              ))}
              {thread.length > 0 && (
                <div className="mt-4 border-t border-border/70 pt-3">
                  {!confirmClear ? (
                    <button type="button" className={smallButton + " w-full"} onClick={() => setConfirmClear(true)}>
                      Clear research history
                    </button>
                  ) : (
                    <div data-testid="research-clear-confirm" className="space-y-3 rounded-lg border border-rose-400/30 bg-rose-400/[0.035] p-3">
                      <p className="font-ui text-sm leading-6">Clear research history on this device? Pinned notes and findings will remain.</p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setConfirmClear(false)} className={smallButton}>Cancel</button>
                        <button type="button" onClick={() => {
                          try {
                            clearResearchThread();
                            setConfirmClear(false);
                            setNotice("Research history cleared. Pinned findings are unchanged.");
                          } catch {
                            setNotice("Could not clear research history on this device. Check local storage availability.");
                          }
                        }}
                          className={smallButton + " border-rose-400/50 text-rose-200"}>Clear history</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )
        )}
      </div>

      <footer className="shrink-0 border-t border-border/60 px-3 py-3">
        <p className="font-ui text-xs leading-5 text-muted-foreground">{items.length} pinned · {thread.length} history events · stored on this device</p>
        {notice && <p role="status" className="mt-1 font-ui text-xs leading-5 text-primary">{notice}</p>}
      </footer>
    </aside>
  );
}
