import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Building2, Circle, Copy, GripVertical, Home, Link2, Pin, PinOff, Plus, RotateCcw, Workflow, X } from "lucide-react";
import {
  getEffectiveTerminalTabLinkScopes,
  notifyTerminalTabActivated,
  TERMINAL_ANALYTICAL_LINK_SCOPES,
} from "@/lib/terminalLinkedContextStore";
import type { TerminalLinkGroup, TerminalLinkScope, TerminalTab } from "@/lib/terminalTabs";
import { getExperienceViewLabel } from "@/lib/terminalExperience";
import { dismissTerminalPeek, requestTerminalPeek } from "@/lib/terminalPeek";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PromptDialog } from "@/components/ui/prompt-dialog";

interface Props {
  tabs: TerminalTab[];
  activeTabId: string;
  hasClosedTabs: boolean;
  onActivate: (tabId: string) => void;
  onNew: () => void;
  onClose: (tabId: string) => void;
  onReopen: () => void;
  onTogglePin: (tabId: string) => void;
  onDuplicate: (tab: TerminalTab) => void;
  onGroup: (tabId: string, groupId: string | null) => void;
  onRename: (tabId: string, title: string) => void;
  onMove?: (sourceTabId: string, targetTabId: string) => void;
  onLinkGroup?: (tabId: string, groupId: TerminalLinkGroup | null) => void;
  onLinkScopes?: (tabId: string, scopes: TerminalLinkScope[]) => void;
  className?: string;
}

const GROUP_COLORS = ["text-cyan-300", "text-emerald-300", "text-amber-300", "text-fuchsia-300"];
const LINK_GROUP_CLASSES: Record<TerminalLinkGroup, string> = {
  A: "border-cyan-400/40 bg-cyan-400/[0.065] text-cyan-200",
  B: "border-emerald-400/40 bg-emerald-400/[0.065] text-emerald-200",
  C: "border-amber-400/40 bg-amber-400/[0.065] text-amber-200",
  D: "border-fuchsia-400/40 bg-fuchsia-400/[0.065] text-fuchsia-200",
};

const LINK_SCOPE_LABELS: Record<TerminalLinkScope, string> = {
  instrument: "Instrument",
  time: "Time",
  portfolio: "Portfolio",
  scenario: "Scenario",
  benchmark: "Benchmark",
};

function stableGroupColor(groupId: string | null): string {
  if (!groupId) return "text-muted-foreground/45";
  let hash = 0;
  for (let index = 0; index < groupId.length; index += 1) hash = ((hash << 5) - hash + groupId.charCodeAt(index)) | 0;
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

function TabKindIcon({ tab }: { tab: TerminalTab }) {
  if (tab.kind === "entity") return <Building2 className="h-3 w-3 shrink-0 text-cyan-300/70" />;
  if (tab.kind === "workflow") return <Workflow className="h-3 w-3 shrink-0 text-fuchsia-300/70" />;
  if (tab.kind === "home") return <Home className="h-3 w-3 shrink-0 text-muted-foreground/65" />;
  return null;
}

export default function TerminalTabBar({
  tabs, activeTabId, hasClosedTabs, onActivate, onNew, onClose, onReopen, onTogglePin,
  onDuplicate, onGroup, onRename, onMove, onLinkGroup, onLinkScopes, className,
}: Props) {
  const [menuTabId, setMenuTabId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<{ kind: "rename" | "group"; tabId: string; value: string } | null>(null);
  const promptOpener = useRef<string | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const peekTimerRef = useRef<number | null>(null);
  const activeTabForContext = useMemo(() => tabs.find((tab) => tab.id === activeTabId), [activeTabId, tabs]);
  const activeLinkSignature = activeTabForContext
    ? `${activeTabForContext.linkGroupId ?? "-"}:${activeTabForContext.linkScopesExplicit === true ? "explicit" : "legacy"}:${getEffectiveTerminalTabLinkScopes(activeTabForContext).join(",")}`
    : "-";
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tab of tabs) {
      const group = tab.groupId?.trim();
      if (group) counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    return counts;
  }, [tabs]);

  useEffect(() => {
    notifyTerminalTabActivated(activeTabId, { tabs, activeTabId, closedTabs: [] });
  }, [activeLinkSignature, activeTabId, tabs]);

  const clearPendingPeek = () => {
    if (peekTimerRef.current !== null) window.clearTimeout(peekTimerRef.current);
    peekTimerRef.current = null;
  };

  const schedulePeek = (tab: TerminalTab, element: HTMLElement) => {
    clearPendingPeek();
    const rect = element.getBoundingClientRect();
    peekTimerRef.current = window.setTimeout(() => {
      requestTerminalPeek({
        x: rect.left,
        y: rect.bottom + 8,
        view: tab.workspace.primary.view,
        symbol: tab.entity ?? tab.workspace.primary.symbol,
        title: tab.title,
        source: "tab",
      });
      peekTimerRef.current = null;
    }, 420);
  };

  function openPrompt(kind: "rename" | "group", tabId: string, value: string) {
    promptOpener.current = tabId;
    setPrompt({ kind, tabId, value });
  }

  function confirmPrompt(value: string) {
    if (!prompt) return;
    if (prompt.kind === "rename") {
      if (value.trim()) onRename(prompt.tabId, value);
    } else {
      onGroup(prompt.tabId, value.trim() || null);
    }
    setPrompt(null);
  }

  function toggleLinkScope(tab: TerminalTab, scope: TerminalLinkScope) {
    if (!onLinkScopes || !tab.linkGroupId) return;
    const current = getEffectiveTerminalTabLinkScopes(tab);
    const enabled = current.includes(scope);
    if (enabled && current.length === 1) return;
    const selected = new Set(current);
    if (enabled) selected.delete(scope);
    else selected.add(scope);
    const next = TERMINAL_ANALYTICAL_LINK_SCOPES.filter((candidate) => selected.has(candidate));
    onLinkScopes(tab.id, next);
  }

  function duplicateWithEffectiveScopes(tab: TerminalTab) {
    onDuplicate({
      ...tab,
      linkScopes: getEffectiveTerminalTabLinkScopes(tab),
      linkScopesExplicit: true,
    });
  }

  return (
    <div className={`flex h-9 min-w-0 shrink-0 items-stretch justify-end overflow-x-auto border-b scrollbar-thin ${className ?? ""}`} data-testid="terminal-tab-bar">
      {tabs.map((tab, index) => {
        const active = tab.id === activeTabId;
        const groupKey = tab.groupId?.trim() || null;
        const previousGroupKey = index > 0 ? tabs[index - 1].groupId?.trim() || null : null;
        const showGroupMarker = Boolean(groupKey && groupKey !== previousGroupKey);
        const groupCount = groupKey ? groupCounts.get(groupKey) ?? 0 : 0;
        const groupColor = stableGroupColor(tab.groupId);
        const viewLabel = getExperienceViewLabel(tab.workspace.primary.view);
        const linkGroup = tab.linkGroupId ?? null;
        const linkScopes = getEffectiveTerminalTabLinkScopes(tab);
        return (
          <Fragment key={tab.id}>
            {showGroupMarker && (
              <div
                className="lios-tab-group-marker"
                data-testid={`terminal-tab-group-${groupKey}`}
                aria-label={`${groupKey} tab group, ${groupCount} tabs`}
                title={`${groupKey} · ${groupCount} tab${groupCount === 1 ? "" : "s"}`}
              >
                <span className="lios-pane-code lios-tab-group-marker-kicker">GROUP</span>
                <span className="lios-tab-group-marker-name truncate">{groupKey}</span>
                <span className="lios-pane-code lios-tab-group-marker-count">{groupCount}</span>
              </div>
            )}
            <div
              draggable={Boolean(onMove)}
              onMouseEnter={(event) => schedulePeek(tab, event.currentTarget)}
              onMouseLeave={clearPendingPeek}
              onDragStart={(event) => {
                if (!onMove) return;
                dismissTerminalPeek();
                clearPendingPeek();
                setDraggingTabId(tab.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", tab.id);
              }}
              onDragOver={(event) => { if (onMove && draggingTabId && draggingTabId !== tab.id) event.preventDefault(); }}
              onDrop={(event) => {
                if (!onMove) return;
                event.preventDefault();
                const source = event.dataTransfer.getData("text/plain") || draggingTabId;
                if (source && source !== tab.id) onMove(source, tab.id);
                setDraggingTabId(null);
              }}
              onDragEnd={() => setDraggingTabId(null)}
              className={`lios-tab-v4 relative flex min-w-[138px] max-w-[250px] shrink-0 items-center border-r ${draggingTabId === tab.id ? "opacity-45" : ""}`}
              data-active={active ? "true" : "false"}
              data-tab-kind={tab.kind}
              data-group-id={groupKey ?? "ungrouped"}
              data-link-group={linkGroup ?? undefined}
              onContextMenu={(event) => { event.preventDefault(); dismissTerminalPeek(); setMenuTabId(tab.id); }}
            >
            {onMove && <GripVertical className="ml-1 h-3 w-3 shrink-0 cursor-grab text-muted-foreground/20 transition-colors hover:text-muted-foreground/60" aria-hidden="true" />}
            <button
              className={`flex min-w-0 flex-1 items-center gap-1.5 self-stretch px-2 text-left transition-colors ${active ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => { dismissTerminalPeek(); onActivate(tab.id); }}
              onDoubleClick={() => onTogglePin(tab.id)}
              onKeyDown={(event) => {
                const modifier = event.metaKey || event.ctrlKey;
                if (!onMove || !modifier || !event.shiftKey || (event.key !== "ArrowLeft" && event.key !== "ArrowRight")) return;
                const targetIndex = index + (event.key === "ArrowLeft" ? -1 : 1);
                const target = tabs[targetIndex];
                if (!target) return;
                event.preventDefault();
                onMove(tab.id, target.id);
              }}
              aria-current={active ? "page" : undefined}
              aria-keyshortcuts={onMove ? "Control+Shift+ArrowLeft Control+Shift+ArrowRight Meta+Shift+ArrowLeft Meta+Shift+ArrowRight" : undefined}
              title={`${tab.title} · ${viewLabel}${tab.groupId ? ` · group: ${tab.groupId}` : ""}${linkGroup ? ` · linked context ${linkGroup}: ${linkScopes.join(", ")}` : ""}${tab.pinned ? " · pinned" : ""}${tab.dirty ? " · unsaved changes" : ""}`}
              data-testid={`terminal-tab-${tab.id}`}
            >
              <Circle className={`h-1.5 w-1.5 shrink-0 transition-colors ${active ? "fill-amber-300 text-amber-300" : groupColor}`} />
              <TabKindIcon tab={tab} />
              {linkGroup && <span className={`lios-pane-code flex h-4 min-w-4 shrink-0 items-center justify-center rounded border px-1 text-[6px] ${LINK_GROUP_CLASSES[linkGroup]}`} title={`Linked context ${linkGroup} · ${linkScopes.length}/5 scopes`}><Link2 className="mr-0.5 h-2 w-2" />{linkGroup}</span>}
              {tab.pinned && <Pin className="h-2.5 w-2.5 shrink-0 text-amber-300/80" />}
              <span className="lios-tab-title truncate">{tab.title}</span>
              {tab.dirty && <span className="shrink-0 text-amber-300" aria-label="Unsaved changes">●</span>}
            </button>
            {!tab.pinned && <button className="rounded p-1 text-muted-foreground/45 transition-colors hover:bg-white/[0.04] hover:text-foreground" onClick={() => { dismissTerminalPeek(); onClose(tab.id); }} title="Close tab" aria-label={`Close ${tab.title}`}><X className="h-3 w-3" /></button>}
            <DropdownMenu open={menuTabId === tab.id} onOpenChange={(open) => { if (open) dismissTerminalPeek(); setMenuTabId(open ? tab.id : null); }}>
              <DropdownMenuTrigger asChild>
                <button className="mr-1 rounded p-1 text-muted-foreground/45 transition-colors hover:bg-white/[0.04] hover:text-foreground" data-tab-actions={tab.id} aria-label={`Tab actions for ${tab.title}`}><span className="text-[12px] leading-none">⋯</span></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="lios-v4-overlay w-64 rounded-xl p-1.5">
                <DropdownMenuLabel className="border-b border-border/50 px-2 py-2 font-normal"><div className="font-ui truncate text-[10px] font-semibold text-foreground">{tab.title}</div><div className="mt-1 lios-pane-code text-[7px] tracking-wider text-muted-foreground">{tab.entity ? `${tab.entity} · ${viewLabel}` : viewLabel}</div></DropdownMenuLabel>
                <DropdownMenuItem className="font-ui flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[9px] text-muted-foreground transition-colors focus:bg-white/[0.045] focus:text-foreground" onSelect={() => onTogglePin(tab.id)}>{tab.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}{tab.pinned ? "Unpin tab" : "Pin tab"}</DropdownMenuItem>
                <DropdownMenuItem className="font-ui flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[9px] text-muted-foreground transition-colors focus:bg-white/[0.045] focus:text-foreground" onSelect={() => duplicateWithEffectiveScopes(tab)}><Copy className="h-3 w-3" />Duplicate tab</DropdownMenuItem>
                <DropdownMenuItem className="font-ui flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[9px] text-muted-foreground transition-colors focus:bg-white/[0.045] focus:text-foreground" onSelect={() => openPrompt("rename", tab.id, tab.title)}>Rename tab</DropdownMenuItem>
                <DropdownMenuItem className="font-ui flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-[9px] text-muted-foreground transition-colors focus:bg-white/[0.045] focus:text-foreground" onSelect={() => openPrompt("group", tab.id, tab.groupId ?? "")}>Group tab</DropdownMenuItem>
                {onLinkGroup && <div className="mt-1 border-t border-border/50 pt-1.5"><div className="font-ui px-2 py-1 text-[7px] font-medium tracking-[0.12em] text-muted-foreground">LINKED CONTEXT</div><div className="grid grid-cols-5 gap-1 px-1 pb-1">{(["A", "B", "C", "D"] as const).map((group) => <DropdownMenuItem key={group} onSelect={(event) => { event.preventDefault(); onLinkGroup(tab.id, group); }} className={`lios-pane-code rounded border py-1.5 text-[7px] ${linkGroup === group ? LINK_GROUP_CLASSES[group] : "border-border/70 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"}`} aria-pressed={linkGroup === group}>{group}</DropdownMenuItem>)}<DropdownMenuItem onSelect={() => onLinkGroup(tab.id, null)} className={`lios-pane-code rounded border py-1.5 text-[7px] ${!linkGroup ? "border-border bg-white/[0.05] text-foreground" : "border-border/70 text-muted-foreground hover:bg-white/[0.04] hover:text-foreground"}`} aria-label="Unlink tab">—</DropdownMenuItem></div>{linkGroup && onLinkScopes && <div className="mx-1 mt-1 border-t border-border/50 pt-1"><div className="px-1 py-1 font-ui text-[6px] leading-relaxed text-muted-foreground/70">Choose exactly what this tab shares with group {linkGroup}.</div><div className="grid grid-cols-1 gap-0.5">{TERMINAL_ANALYTICAL_LINK_SCOPES.map((scope) => { const enabled = linkScopes.includes(scope); const locked = enabled && linkScopes.length === 1; return <DropdownMenuItem key={scope} onSelect={(event) => { event.preventDefault(); toggleLinkScope(tab, scope); }} disabled={locked} className={`flex items-center justify-between rounded px-2 py-1.5 font-ui text-[8px] transition-colors ${enabled ? "bg-cyan-400/[0.06] text-cyan-200" : "text-muted-foreground hover:bg-white/[0.035] hover:text-foreground"} disabled:cursor-not-allowed disabled:opacity-55`} aria-pressed={enabled}><span>{LINK_SCOPE_LABELS[scope]}</span><span className={`lios-pane-code flex h-3.5 w-3.5 items-center justify-center rounded border text-[7px] ${enabled ? "border-cyan-400/40 text-cyan-300" : "border-border text-transparent"}`}>✓</span></DropdownMenuItem>; })}</div></div>}</div>}
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
          </Fragment>
        );
      })}
      <button className="flex w-10 shrink-0 items-center justify-center border-r border-border/60 text-muted-foreground/65 transition-colors hover:bg-white/[0.04] hover:text-foreground" onClick={() => { dismissTerminalPeek(); onNew(); }} title="New tab (Ctrl/Cmd+T)" aria-label="New terminal tab"><Plus className="h-3.5 w-3.5" /></button>
      <button className="flex w-10 shrink-0 items-center justify-center text-muted-foreground/65 transition-colors hover:bg-white/[0.04] hover:text-foreground disabled:opacity-25" onClick={() => { dismissTerminalPeek(); onReopen(); }} disabled={!hasClosedTabs} title="Reopen closed tab (Ctrl/Cmd+Shift+T)" aria-label="Reopen closed tab"><RotateCcw className="h-3.5 w-3.5" /></button>
      <PromptDialog
        open={prompt !== null}
        title={prompt?.kind === "group" ? "Group tab" : "Rename tab"}
        label={prompt?.kind === "group" ? "Group name (leave blank to remove the group)" : "Tab name"}
        initialValue={prompt?.value ?? ""}
        confirmLabel={prompt?.kind === "group" ? "Set group" : "Rename"}
        validate={(value) => (prompt?.kind === "rename" && !value.trim() ? "Enter a tab name." : null)}
        onConfirm={confirmPrompt}
        onCancel={() => setPrompt(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLElement>(`[data-tab-actions="${CSS.escape(promptOpener.current ?? "")}"]`)?.focus();
        }}
      />
    </div>
  );
}
