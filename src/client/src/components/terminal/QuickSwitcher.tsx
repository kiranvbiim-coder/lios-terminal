import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3, Layers3, Search, Star, X } from "lucide-react";
import type { TerminalTab } from "@/lib/terminalTabs";
import type { ViewMode } from "@/lib/terminalTypes";
import type { RecentAnalyticalContext } from "@/lib/terminalPersonalization";
import { getTerminalCapability, type TerminalCapability } from "@/lib/terminalCatalog";
import { GuidedCapabilityExplainer } from "./GuidedExplainer";

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

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(value + 1, Math.max(0, items.length - 1))); }
    if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(0, value - 1)); }
    if (event.key === "Enter" && items[selected]) { event.preventDefault(); items[selected].run(); onClose(); }
    if (event.key === "Escape") onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/45 px-3 pt-[12vh] backdrop-blur-[1px]" onMouseDown={onClose}>
      <section className="w-full max-w-xl overflow-hidden border border-cyan-500/35 bg-[#090909] shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Quick switcher">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-3.5 w-3.5 text-cyan-300" />
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={onKeyDown} placeholder="Switch tab, favorite, or recent analysis..." className="min-w-0 flex-1 bg-transparent font-terminal text-[10px] text-foreground outline-none placeholder:text-muted-foreground/50" />
          <span className="hidden border border-border px-1.5 py-0.5 font-terminal text-[6px] text-muted-foreground sm:inline">⌘P</span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="Close quick switcher"><X className="h-3.5 w-3.5" /></button>
        </div>
        <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
          {items.length ? items.map((item, index) => {
            const active = selected === index;
            const Icon = item.kind === "tab" ? Layers3 : item.kind === "favorite" ? Star : Clock3;
            return (
              <button key={item.key} onMouseEnter={() => setSelected(index)} onClick={() => { item.run(); onClose(); }} className={`flex w-full items-center gap-3 border-b border-border/60 px-3 py-2.5 text-left ${active ? "bg-cyan-500/[0.07]" : "hover:bg-white/[0.025]"}`}>
                <Icon className={`h-3.5 w-3.5 shrink-0 ${item.kind === "favorite" ? "text-amber-300" : item.kind === "tab" ? "text-cyan-300" : "text-muted-foreground"}`} />
                <span className="min-w-0 flex-1 truncate font-terminal text-[9px] text-foreground">
                  {item.capability ? <GuidedCapabilityExplainer capability={item.capability}>{item.label}</GuidedCapabilityExplainer> : item.label}
                </span>
                <span className="shrink-0 font-terminal text-[6.5px] tracking-widest text-muted-foreground">{item.meta}</span>
              </button>
            );
          }) : <div className="p-8 text-center font-terminal text-[8px] text-muted-foreground">NO MATCHING OPEN OR RECENT ANALYSIS</div>}
        </div>
      </section>
    </div>
  );
}
