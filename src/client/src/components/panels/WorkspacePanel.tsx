import { useMemo, useState } from "react";
import { FolderKanban, Plus, X, Star, ArrowUpRight, FileText, Trash2, Pin, Archive, ArchiveRestore, Copy, Search, Tag, Camera } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import {
  useWorkspaces, useWorkspace, useWorkspaceImports, useActiveWorkspaceId, useInvalidateWorkspaces,
  createWorkspace, updateWorkspace, deleteWorkspace, duplicateWorkspace,
} from "@/lib/useWorkspaces";
import {
  useWorkspaceSnapshots, createWorkspaceSnapshot, restoreWorkspaceSnapshot, deleteWorkspaceSnapshot, useInvalidateWorkspaceSnapshots,
} from "@/lib/useWorkspaceSnapshots";

interface Props {
  onSymbol: (sym: string) => void;
  onNav: (v: ViewMode) => void;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function WorkspacePanel({ onSymbol, onNav }: Props) {
  const { data: workspaces, isLoading } = useWorkspaces();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeId, setActiveId] = useActiveWorkspaceId();
  const invalidate = useInvalidateWorkspaces();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newClient, setNewClient] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newTags, setNewTags] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [duplicating, setDuplicating] = useState(false);

  // Selecting a workspace in the list also views it; falls back to the
  // active workspace (if any) on first render so returning to this panel
  // lands somewhere useful instead of an empty state.
  const effectiveSelectedId = selectedId ?? activeId ?? workspaces?.[0]?.id ?? null;

  const { data: selected } = useWorkspace(effectiveSelectedId);
  const { data: imports } = useWorkspaceImports(effectiveSelectedId);

  const [symbolInput, setSymbolInput] = useState("");

  const { data: snapshots } = useWorkspaceSnapshots(effectiveSelectedId);
  const invalidateSnapshots = useInvalidateWorkspaceSnapshots();
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  // Pinned first, then most-recently-updated; archived workspaces are
  // hidden unless SHOW ARCHIVED is on (they're soft-deleted, not gone), and
  // the search box filters client-side across name/client/tags since the
  // list is small enough that a server-side query would be overkill.
  const sortedWorkspaces = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return (workspaces ?? [])
      .filter((w) => showArchived || !w.archived)
      .filter((w) => {
        if (!q) return true;
        return (
          w.name.toLowerCase().includes(q) ||
          (w.clientName?.toLowerCase().includes(q) ?? false) ||
          w.tags.some((t) => t.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      });
  }, [workspaces, searchQuery, showArchived]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const tags = newTags.split(",").map((t) => t.trim()).filter(Boolean);
      const created = await createWorkspace({
        name: newName.trim(),
        clientName: newClient.trim() || undefined,
        description: newDescription.trim() || undefined,
        tags: tags.length ? tags : undefined,
      });
      invalidate();
      setSelectedId(created.id);
      setShowCreate(false);
      setNewName("");
      setNewClient("");
      setNewDescription("");
      setNewTags("");
    } catch (e: any) {
      setError(e?.message || "Failed to create workspace.");
    } finally {
      setCreating(false);
    }
  }

  async function handleAddSymbol() {
    if (!effectiveSelectedId || !symbolInput.trim()) return;
    const symbol = symbolInput.trim().toUpperCase();
    setSymbolInput("");
    await updateWorkspace(effectiveSelectedId, { addSymbol: symbol });
    invalidate();
  }

  async function handleRemoveSymbol(symbol: string) {
    if (!effectiveSelectedId) return;
    await updateWorkspace(effectiveSelectedId, { removeSymbol: symbol });
    invalidate();
  }

  async function handleAddTag() {
    if (!effectiveSelectedId || !tagInput.trim()) return;
    const tag = tagInput.trim();
    setTagInput("");
    await updateWorkspace(effectiveSelectedId, { addTag: tag });
    invalidate();
  }

  async function handleRemoveTag(tag: string) {
    if (!effectiveSelectedId) return;
    await updateWorkspace(effectiveSelectedId, { removeTag: tag });
    invalidate();
  }

  async function handleTogglePin(w: { id: string; pinned: boolean }) {
    await updateWorkspace(w.id, { pinned: !w.pinned });
    invalidate();
  }

  async function handleToggleArchive(w: { id: string; archived: boolean }) {
    await updateWorkspace(w.id, { archived: !w.archived });
    invalidate();
  }

  async function handleDuplicate(id: string) {
    setDuplicating(true);
    try {
      const copy = await duplicateWorkspace(id);
      invalidate();
      setSelectedId(copy.id);
    } finally {
      setDuplicating(false);
    }
  }

  async function handleCreateSnapshot() {
    if (!effectiveSelectedId) return;
    setSnapshotBusy(true);
    setSnapshotError(null);
    try {
      await createWorkspaceSnapshot(effectiveSelectedId, snapshotLabel.trim() || "Snapshot");
      invalidateSnapshots(effectiveSelectedId);
      setSnapshotLabel("");
    } catch (e: any) {
      setSnapshotError(e?.message || "Failed to save snapshot.");
    } finally {
      setSnapshotBusy(false);
    }
  }

  async function handleRestoreSnapshot(snapshotId: string) {
    if (!effectiveSelectedId) return;
    await restoreWorkspaceSnapshot(effectiveSelectedId, snapshotId);
    invalidate();
  }

  async function handleDeleteSnapshot(snapshotId: string) {
    if (!effectiveSelectedId) return;
    await deleteWorkspaceSnapshot(effectiveSelectedId, snapshotId);
    invalidateSnapshots(effectiveSelectedId);
  }

  async function handleDelete(id: string) {
    await deleteWorkspace(id);
    if (activeId === id) setActiveId(null);
    if (selectedId === id) setSelectedId(null);
    invalidate();
  }

  return (
    <div className="h-full min-w-0 flex flex-col bg-[#050505] overflow-hidden" data-workspaces-manager="true">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b border-border bg-[#070707] shrink-0" data-workspaces-toolbar="true">
        <FolderKanban className="w-4 h-4 text-[hsl(38,95%,55%)]" />
        <span className="panel-label">WORKSPACES</span>
        <span className="font-terminal text-[7px] text-muted-foreground/60">
          {sortedWorkspaces.length} engagement{sortedWorkspaces.length === 1 ? "" : "s"}
        </span>
        <div className="ml-2 flex min-w-[180px] max-w-sm flex-1 items-center gap-1.5" data-workspaces-search="true">
          <Search className="w-3 h-3 text-muted-foreground/50 shrink-0" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="SEARCH NAME, CLIENT, TAG..."
            className="w-full bg-transparent border-b border-border/40 px-1 py-0.5 font-terminal text-[8px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40 placeholder:text-muted-foreground/40"
          />
        </div>
        <button
          onClick={() => setShowArchived((v) => !v)}
          className={`flex items-center gap-1 font-terminal text-[7px] tracking-widest px-1.5 py-1 border ${
            showArchived ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10" : "border-border/60 text-muted-foreground hover:text-foreground"
          }`}
        >
          <Archive className="w-2.5 h-2.5" /> {showArchived ? "HIDE ARCHIVED" : "SHOW ARCHIVED"}
        </button>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="ml-auto flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-border/60 text-muted-foreground hover:text-foreground hover:border-[hsl(38,95%,50%)/50%] hover:bg-[hsl(38,95%,50%)/10%] transition-colors"
        >
          <Plus className="w-3 h-3" /> NEW WORKSPACE
        </button>
      </div>

      {showCreate && (
        <div className="px-4 py-3 border-b border-border/50 bg-[#060606] space-y-2 shrink-0" data-workspaces-create="true">
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="WORKSPACE NAME (e.g. Acme Corp — Due Diligence)"
              className="flex-1 bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
            />
            <input
              value={newClient}
              onChange={(e) => setNewClient(e.target.value)}
              placeholder="CLIENT (optional)"
              className="min-w-[180px] flex-1 bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
            />
          </div>
          <input
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="DESCRIPTION (optional)"
            className="w-full bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
          />
          <input
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            placeholder="TAGS, COMMA-SEPARATED (optional)"
            className="w-full bg-transparent border border-border px-2 py-1.5 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="font-terminal text-[8px] tracking-widest px-3 py-1.5 bg-[hsl(38,95%,50%)] text-black font-bold disabled:opacity-50"
            >
              {creating ? "CREATING..." : "CREATE"}
            </button>
            <button onClick={() => setShowCreate(false)} className="font-terminal text-[8px] tracking-widest px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground">
              CANCEL
            </button>
            {error && <span className="font-terminal text-[8px] text-red-400">{error}</span>}
          </div>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden" data-workspaces-body="true">
        <div className="w-[clamp(180px,28%,256px)] min-w-[180px] shrink-0 overflow-y-auto border-r border-border/50 scrollbar-thin" data-workspaces-list="true">
          {isLoading ? (
            <div className="p-3 font-terminal text-[9px] text-muted-foreground">LOADING...</div>
          ) : sortedWorkspaces.length === 0 ? (
            <div className="p-3 font-terminal text-[9px] text-muted-foreground">
              NO WORKSPACES YET. CREATE ONE TO ORGANIZE TICKERS, IMPORTS, AND MODELS BY ENGAGEMENT.
            </div>
          ) : (
            sortedWorkspaces.map((w) => (
              <button
                key={w.id}
                onClick={() => setSelectedId(w.id)}
                className={`w-full text-left px-3 py-2.5 border-b border-border/20 hover:bg-white/[3%] transition-colors ${
                  w.id === effectiveSelectedId ? "bg-[hsl(38,95%,50%)]/10" : ""
                } ${w.archived ? "opacity-50" : ""}`}
              >
                <div className="flex items-center gap-1.5">
                  {w.pinned && <Pin className="w-2.5 h-2.5 text-[hsl(38,95%,55%)] fill-current shrink-0" />}
                  {w.id === activeId && <Star className="w-2.5 h-2.5 text-[hsl(38,95%,55%)] fill-current shrink-0" />}
                  <span className={`font-terminal text-[9px] truncate ${w.id === effectiveSelectedId ? "text-[hsl(38,95%,55%)]" : "text-foreground/90"}`}>
                    {w.name}
                  </span>
                  {w.archived && <span className="font-terminal text-[6.5px] tracking-widest text-muted-foreground/60 border border-border/50 px-1 shrink-0">ARCHIVED</span>}
                </div>
                {w.clientName && <div className="font-terminal text-[7.5px] text-muted-foreground/70 mt-0.5 truncate">{w.clientName}</div>}
                {w.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {w.tags.map((t) => (
                      <span key={t} className="font-terminal text-[6.5px] tracking-wide text-[hsl(38,95%,55%)]/80 border border-[hsl(38,95%,50%)]/25 px-1 py-px">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
                <div className="font-terminal text-[7px] text-muted-foreground/50 mt-1">
                  {w.symbols.length} symbol{w.symbols.length === 1 ? "" : "s"} · {relativeTime(w.updatedAt)}
                </div>
              </button>
            ))
          )}
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-4 scrollbar-thin" data-workspaces-detail="true">
          {!selected ? (
            <div className="font-terminal text-[9px] text-muted-foreground">SELECT OR CREATE A WORKSPACE TO GET STARTED.</div>
          ) : (
            <div className="max-w-4xl space-y-5">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-terminal text-sm text-foreground font-bold">{selected.name}</span>
                  {selected.archived && <span className="font-terminal text-[7px] tracking-widest text-muted-foreground/60 border border-border/50 px-1.5 py-0.5">ARCHIVED</span>}
                  <button
                    onClick={() => setActiveId(activeId === selected.id ? null : selected.id)}
                    title={activeId === selected.id ? "This is your active workspace -- new PDF imports get tagged to it" : "Set as active workspace"}
                    className={`flex items-center gap-1 font-terminal text-[7px] tracking-widest px-1.5 py-0.5 border ${
                      activeId === selected.id
                        ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Star className={`w-2.5 h-2.5 ${activeId === selected.id ? "fill-current" : ""}`} />
                    {activeId === selected.id ? "ACTIVE" : "SET ACTIVE"}
                  </button>
                  <button
                    onClick={() => handleTogglePin(selected)}
                    title={selected.pinned ? "Unpin" : "Pin to top of list"}
                    className={`flex items-center gap-1 font-terminal text-[7px] tracking-widest px-1.5 py-0.5 border ${
                      selected.pinned
                        ? "border-[hsl(38,95%,50%)]/50 text-[hsl(38,95%,55%)] bg-[hsl(38,95%,50%)]/10"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Pin className={`w-2.5 h-2.5 ${selected.pinned ? "fill-current" : ""}`} />
                    {selected.pinned ? "PINNED" : "PIN"}
                  </button>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => handleDuplicate(selected.id)}
                      disabled={duplicating}
                      title="Duplicate workspace"
                      className="flex items-center gap-1 font-terminal text-[7px] tracking-widest px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      <Copy className="w-2.5 h-2.5" /> DUPLICATE
                    </button>
                    <button
                      onClick={() => handleToggleArchive(selected)}
                      title={selected.archived ? "Unarchive workspace" : "Archive workspace"}
                      className="flex items-center gap-1 font-terminal text-[7px] tracking-widest px-1.5 py-0.5 border border-border text-muted-foreground hover:text-foreground"
                    >
                      {selected.archived ? <ArchiveRestore className="w-2.5 h-2.5" /> : <Archive className="w-2.5 h-2.5" />}
                      {selected.archived ? "UNARCHIVE" : "ARCHIVE"}
                    </button>
                    <button
                      onClick={() => handleDelete(selected.id)}
                      title="Delete workspace"
                      className="flex items-center gap-1 font-terminal text-[7px] tracking-widest px-1.5 py-0.5 border border-border text-muted-foreground hover:text-red-400 hover:border-red-900/50"
                    >
                      <Trash2 className="w-2.5 h-2.5" /> DELETE
                    </button>
                  </div>
                </div>
                {selected.clientName && <div className="font-terminal text-[9px] text-muted-foreground mt-1">{selected.clientName}</div>}
                {selected.description && <div className="font-terminal text-[9px] text-muted-foreground/80 mt-1">{selected.description}</div>}
              </div>

              <div>
                <div className="panel-label mb-2">TAGS</div>
                <div className="flex gap-2 mb-2">
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
                    placeholder="ADD TAG..."
                    className="w-40 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
                  />
                  <button onClick={handleAddTag} className="font-terminal text-[8px] tracking-widest px-2 py-1 border border-border text-muted-foreground hover:text-foreground">
                    ADD
                  </button>
                </div>
                {selected.tags.length === 0 ? (
                  <div className="font-terminal text-[8px] text-muted-foreground/60">No tags yet.</div>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.tags.map((tag) => (
                      <div key={tag} className="flex items-center gap-1 px-2 py-1 border border-[hsl(38,95%,50%)]/25 bg-[hsl(38,95%,50%)]/5">
                        <Tag className="w-2.5 h-2.5 text-[hsl(38,95%,55%)]/70" />
                        <span className="font-terminal text-[8px] text-[hsl(38,95%,55%)]">{tag}</span>
                        <button onClick={() => handleRemoveTag(tag)} className="text-muted-foreground hover:text-red-400">
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="panel-label mb-2">SYMBOLS</div>
                <div className="flex gap-2 mb-2">
                  <input
                    value={symbolInput}
                    onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === "Enter" && handleAddSymbol()}
                    placeholder="ADD TICKER..."
                    className="w-40 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
                  />
                  <button onClick={handleAddSymbol} className="font-terminal text-[8px] tracking-widest px-2 py-1 border border-border text-muted-foreground hover:text-foreground">
                    ADD
                  </button>
                </div>
                {selected.symbols.length === 0 ? (
                  <div className="font-terminal text-[8px] text-muted-foreground/60">No symbols yet.</div>
                ) : (
                  <div className="space-y-1">
                    {selected.symbols.map((sym) => (
                      <div key={sym} className="flex items-center gap-2 px-2 py-1.5 border border-border/40 bg-white/[2%]">
                        <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] font-bold w-24">{sym}</span>
                        <button
                          onClick={() => { onSymbol(sym); onNav("quote"); }}
                          className="flex items-center gap-1 font-terminal text-[7px] tracking-widest text-muted-foreground hover:text-foreground"
                        >
                          <ArrowUpRight className="w-2.5 h-2.5" /> QUOTE
                        </button>
                        <button
                          onClick={() => { onSymbol(sym); onNav("financialstatements"); }}
                          className="flex items-center gap-1 font-terminal text-[7px] tracking-widest text-muted-foreground hover:text-foreground"
                        >
                          <FileText className="w-2.5 h-2.5" /> STATEMENTS
                        </button>
                        <button
                          onClick={() => handleRemoveSymbol(sym)}
                          className="ml-auto text-muted-foreground hover:text-red-400"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="panel-label mb-2">RECENT IMPORTS</div>
                {!imports || imports.length === 0 ? (
                  <div className="font-terminal text-[8px] text-muted-foreground/60">
                    No imports tagged to this workspace yet. Set it active, then use IMPORT PDF on the Financial Statements panel.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {imports.map((imp, i) => (
                      <button
                        key={`${imp.symbol}-${i}`}
                        onClick={() => { onSymbol(imp.symbol); onNav("financialstatements"); }}
                        className="w-full flex items-center gap-2 px-2 py-1.5 border border-border/40 hover:bg-white/[3%] text-left"
                      >
                        <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] font-bold w-24">{imp.symbol}</span>
                        <span className="font-terminal text-[8px] text-muted-foreground truncate flex-1">{imp.fileName}</span>
                        <span className="font-terminal text-[7px] text-muted-foreground/60">{imp.reportCount} period-statements</span>
                        <span className="font-terminal text-[7px] text-muted-foreground/50">{relativeTime(imp.importedAt)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="panel-label mb-2">SNAPSHOTS</div>
                <div className="font-terminal text-[7.5px] text-muted-foreground/60 mb-2">
                  A manual checkpoint of this workspace's name, client, description, tags, and symbols -- not the models or imports inside it.
                </div>
                <div className="flex gap-2 mb-2">
                  <input
                    value={snapshotLabel}
                    onChange={(e) => setSnapshotLabel(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateSnapshot()}
                    placeholder="LABEL (e.g. Before Q3 restructure)"
                    className="flex-1 bg-transparent border border-border px-2 py-1 font-terminal text-[9px] text-foreground focus:outline-none focus:border-[hsl(38,95%,50%)]/40"
                  />
                  <button
                    onClick={handleCreateSnapshot}
                    disabled={snapshotBusy}
                    className="flex items-center gap-1 font-terminal text-[8px] tracking-widest px-2 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10 disabled:opacity-40"
                  >
                    <Camera className="w-2.5 h-2.5" /> SNAPSHOT NOW
                  </button>
                </div>
                {snapshotError && <div className="font-terminal text-[8px] text-red-400 mb-2">{snapshotError}</div>}
                {!snapshots || snapshots.length === 0 ? (
                  <div className="font-terminal text-[8px] text-muted-foreground/60">No snapshots yet.</div>
                ) : (
                  <div className="space-y-1">
                    {snapshots.map((s) => (
                      <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 border border-border/40 bg-white/[2%]">
                        <span className="font-terminal text-[9px] text-[hsl(38,95%,55%)] font-bold flex-1 truncate">{s.label}</span>
                        <span className="font-terminal text-[7px] text-muted-foreground/60">{relativeTime(s.savedAt)}</span>
                        <button
                          onClick={() => handleRestoreSnapshot(s.id)}
                          title={`Restore workspace fields to how they were in "${s.label}"`}
                          className="font-terminal text-[7px] tracking-widest px-1.5 py-1 border border-[hsl(38,95%,50%)]/40 text-[hsl(38,95%,55%)] hover:bg-[hsl(38,95%,50%)]/10"
                        >
                          RESTORE
                        </button>
                        <button onClick={() => handleDeleteSnapshot(s.id)} title="Delete this snapshot" className="text-muted-foreground hover:text-red-400">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
