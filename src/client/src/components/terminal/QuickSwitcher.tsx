import { useEffect, useMemo, useState } from "react";
import { Clock3, Layers3, Search, Star, X } from "lucide-react";
import type { TerminalTab } from "@/lib/terminalTabs";
import type { ViewMode } from "@/lib/terminalTypes";
import type { RecentAnalyticalContext } from "@/lib/terminalPersonalization";
import { getTerminalCapability, type TerminalCapability } from "@/lib/terminalCatalog";
import { GuidedCapabilityExplainer } from "./GuidedExplainer";
import { useAccessibleDialog } from "./useAccessibleDialog";

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
  const { dialogRef, initialRef, onDialogKeyDown } = useAccessibleDialog(onClose);

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
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/65 px-3 pt-[min(12vh,80px)] backdrop-blur-[1px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} onKeyDown={onDialogKeyDown} className="flex max-h-[80dvh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-border bg-[#090909] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="lios-quick-switcher-title" tabIndex={-1}>
        <h2 id="lios-quick-switcher-title" className="sr-only">Quick switcher</h2>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="h-3.5 w-3.5 text-primary" />
          <input ref={initialRef} role="combobox" aria-label="Search open tabs, favorites, and recent analysis" aria-autocomplete="list" aria-expanded="true" aria-controls="lios-quick-switcher-options" aria-activedescendant={items[selected] ? `lios-switch-option-${selected}` : undefined} value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} onKeyDown={onKeyDown} placeholder="Switch tabs, favorites, or recent work…" className="min-w-0 flex-1 bg-transparent py-2 font-ui text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-primary" />
          <span className="hidden border border-border px-1.5 py-0.5 font-terminal text-[6px] text-muted-foreground sm:inline">⌘P</span>
          <button type="button" onClick={onClose} className="rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="Close quick switcher"><X className="h-3.5 w-3.5" /></button>
        </div>
        <p className="sr-only" role="status" aria-live="polite">{items.length} matching destinations</p>
        <div id="lios-quick-switcher-options" role="listbox" aria-label="Matching tabs, favorites and recent analysis" className="min-h-0 overflow-y-auto overscroll-contain scrollbar-thin">
          {items.length ? items.map((item, index) => {
            const active = selected === index;
            const Icon = item.kind === "tab" ? Layers3 : item.kind === "favorite" ? Star : Clock3;
            return (
              <button key={item.key} id={`lios-switch-option-${index}`} type="button" role="option" aria-selected={active} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => { item.run(); onClose(); }} className={`flex min-h-11 w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${active ? "bg-primary/[0.10]" : "hover:bg-white/[0.035]"}`}>
                <Icon className={`h-3.5 w-3.5 shrink-0 ${item.kind === "favorite" ? "text-amber-300" : item.kind === "tab" ? "text-primary" : "text-muted-foreground"}`} />
                <span className="min-w-[130px] flex-1 truncate font-ui text-sm text-foreground">
                  {item.capability ? <GuidedCapabilityExplainer capability={item.capability}>{item.label}</GuidedCapabilityExplainer> : item.label}
                </span>
                <span className="shrink-0 font-terminal text-[10px] tracking-wide text-muted-foreground">{item.meta}</span>
              </button>
            );
          }) : <div className="p-8 text-center font-ui text-sm text-muted-foreground">No matching tabs or recent work. Try another search.</div>}
        </div>
      </section>
    </div>
  );
}
