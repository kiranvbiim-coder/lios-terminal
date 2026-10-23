import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Clock3, Layers3, Search, Star } from "lucide-react";
import type { TerminalTab } from "@/lib/terminalTabs";
import type { ViewMode } from "@/lib/terminalTypes";
import type { RecentAnalyticalContext } from "@/lib/terminalPersonalization";
import { getTerminalCapability, type TerminalCapability } from "@/lib/terminalCatalog";
import { GuidedCapabilityExplainer } from "./GuidedExplainer";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

interface Props {
  tabs: readonly TerminalTab[];
  activeTabId: string;
  favorites: readonly ViewMode[];
  recents: readonly RecentAnalyticalContext[];
  onActivateTab: (tabId: string) => void;
  onOpenView: (view: ViewMode) => void;
  onOpenRecent: (recent: RecentAnalyticalContext) => void;
  onClose: () => void;
}

type SwitchItem = {
  key: string;
  label: string;
  meta: string;
  kind: "tab" | "favorite" | "recent";
  capability?: TerminalCapability;
  run: () => void;
};

export default function QuickSwitcher({ tabs, activeTabId, favorites, recents, onActivateTab, onOpenView, onOpenRecent, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);

  useEffect(() => inputRef.current?.focus(), []);

  const items = useMemo<SwitchItem[]>(() => {
    const q = query.trim().toLowerCase();
    const tabItems = tabs.map((tab) => ({
      key: `tab:${tab.id}`,
      label: tab.title,
      meta: tab.id === activeTabId ? "ACTIVE TAB" : tab.groupId ? `TAB · ${tab.groupId}` : "OPEN TAB",
      kind: "tab" as const,
      run: () => onActivateTab(tab.id),
    }));
    const favoriteItems = favorites.map((view) => {
      const capability = getTerminalCapability(view);
      return {
        key: `favorite:${view}`,
        label: capability.label,
        meta: `FAVORITE · ${capability.shortLabel}`,
        kind: "favorite" as const,
        capability,
        run: () => onOpenView(view),
      };
    });
    const recentItems = recents.slice(0, 12).map((recent) => ({
      key: `recent:${recent.key}`,
      label: recent.label,
      meta: "RECENT ANALYSIS",
      kind: "recent" as const,
      run: () => onOpenRecent(recent),
    }));
    const merged = [...tabItems, ...favoriteItems, ...recentItems];
    const seen = new Set<string>();
    return merged.filter((item) => {
      if (q && !`${item.label} ${item.meta}`.toLowerCase().includes(q)) return false;
      const identity = `${item.kind}:${item.label}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    }).slice(0, 24);
  }, [activeTabId, favorites, onActivateTab, onOpenRecent, onOpenView, query, recents, tabs]);

  useEffect(() => setSelected((value) => Math.max(0, Math.min(value, Math.max(0, items.length - 1)))), [items.length]);
  const selectedKey = items[selected]?.key;
  useEffect(() => {
    if (selectedKey) document.getElementById(`${listId}-${selected}`)?.scrollIntoView({ block: "nearest" });
  }, [listId, selected, selectedKey]);

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(value + 1, Math.max(0, items.length - 1))); }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)); }
    if (event.key === "Enter" && items[selected]) { event.preventDefault(); items[selected].run(); onClose(); }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="flex max-h-[85dvh] w-[calc(100vw-24px)] max-w-xl flex-col gap-0 overflow-hidden border-cyan-500/35 bg-[#090909] p-0"
        onCloseAutoFocus={event => { event.preventDefault(); if (opener?.isConnected) opener.focus(); }}>
        <DialogTitle className="sr-only">Quick switcher</DialogTitle>
        <DialogDescription className="sr-only">Search open tabs, favorites and recent analysis. Use arrow keys and Enter to open a result.</DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-3.5 w-3.5 text-cyan-300" />
          <input ref={inputRef} aria-label="Search tabs, favorites and recent analysis" role="combobox" aria-expanded={true} aria-controls={listId} aria-activedescendant={items[selected] ? `${listId}-${selected}` : undefined} aria-autocomplete="list" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={onKeyDown} placeholder="Switch tab, favorite, or recent analysis..." className="min-h-11 min-w-0 flex-1 bg-transparent pr-8 font-ui text-sm text-foreground outline-none placeholder:text-muted-foreground/70" />
          <span className="sr-only" role="status">{items.length} results</span>
        </div>
        <div id={listId} role="listbox" aria-label="Available destinations" className="min-h-0 flex-1 overflow-y-auto overscroll-contain scrollbar-thin">
          {items.length ? items.map((item, index) => {
            const active = selected === index;
            const Icon = item.kind === "tab" ? Layers3 : item.kind === "favorite" ? Star : Clock3;
            return (
              <button key={item.key} id={`${listId}-${index}`} role="option" aria-selected={active} tabIndex={-1} onMouseEnter={() => setSelected(index)} onClick={() => { item.run(); onClose(); }} className={`flex min-h-11 w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${active ? "bg-cyan-500/[0.07]" : "hover:bg-white/[0.025]"}`}>
                <Icon className={`h-3.5 w-3.5 shrink-0 ${item.kind === "favorite" ? "text-amber-300" : item.kind === "tab" ? "text-cyan-300" : "text-muted-foreground"}`} />
                <span className="min-w-0 flex-1 truncate font-ui text-sm text-foreground">
                  {item.capability ? <GuidedCapabilityExplainer capability={item.capability}>{item.label}</GuidedCapabilityExplainer> : item.label}
                </span>
                <span className="shrink-0 font-terminal text-xs text-muted-foreground">{item.meta}</span>
              </button>
            );
          }) : <div role="status" className="p-8 text-center font-ui text-sm text-muted-foreground">No matching open or recent analysis.</div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
