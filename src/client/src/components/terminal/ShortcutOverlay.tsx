import { useMemo, useState } from "react";
import { Command, Search, X } from "lucide-react";

interface ShortcutItem {
  group: string;
  keys: string;
  label: string;
  description: string;
}

const SHORTCUTS: readonly ShortcutItem[] = [
  { group: "Navigate", keys: "⌘/Ctrl K", label: "Omnibox", description: "Search tools, securities, favorites, recent analysis, and commands." },
  { group: "Navigate", keys: "⌘/Ctrl P", label: "Quick Switcher", description: "Switch between open tabs, favorites, and recent analytical contexts." },
  { group: "Tabs", keys: "⌘/Ctrl T", label: "New tab", description: "Open a new terminal tab." },
  { group: "Tabs", keys: "⌘/Ctrl ⇧ T", label: "Reopen tab", description: "Restore the most recently closed analytical tab." },
  { group: "Tabs", keys: "⌘/Ctrl W", label: "Close tab", description: "Close the active non-pinned tab." },
  { group: "Tabs", keys: "⌘/Ctrl 1–9", label: "Activate tab", description: "Jump directly to an open tab by position." },
  { group: "History", keys: "Alt ←", label: "Back", description: "Restore the previous full analytical workspace state." },
  { group: "History", keys: "Alt →", label: "Forward", description: "Move forward in analytical history." },
  { group: "Workbench", keys: "⌘/Ctrl ⇧ M", label: "Macros", description: "Open inspectable deterministic workflow macros." },
  { group: "Workbench", keys: "⌘/Ctrl ⇧ E", label: "Evidence", description: "Inspect provenance, freshness, transformations, and calculation receipts." },
  { group: "Workbench", keys: "⌘/Ctrl ⇧ O", label: "Outcome missions", description: "Open outcome-based learning missions." },
  { group: "Workbench", keys: "⌘/Ctrl ⇧ ,", label: "UX settings", description: "Switch Guided/Professional mode, density, motion, and chrome preferences." },
  { group: "Canvas", keys: "⌘/Ctrl ⇧ F", label: "Focus mode", description: "Hide nonessential chrome and maximize analytical canvas." },
  { group: "Canvas", keys: "⌘/Ctrl ⇧ P", label: "Presentation mode", description: "Show a clean meeting/client view while preserving interactive analysis." },
  { group: "Reversible", keys: "⌘/Ctrl Z", label: "Undo", description: "Undo a reversible shell/workspace action." },
  { group: "Reversible", keys: "⌘/Ctrl ⇧ Z", label: "Redo", description: "Redo the last reversible shell/workspace action." },
  { group: "Help", keys: "?", label: "Keyboard map", description: "Open this searchable shortcut overlay when focus is not inside an input." },
];

export default function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return SHORTCUTS;
    return SHORTCUTS.filter((item) => `${item.group} ${item.keys} ${item.label} ${item.description}`.toLowerCase().includes(normalized));
  }, [query]);
  const groups = [...new Set(filtered.map((item) => item.group))];

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/75 px-3 pt-12 sm:pt-20" onMouseDown={onClose}>
      <section className="w-full max-w-3xl border border-border bg-[#090909] shadow-2xl" onMouseDown={(event) => event.stopPropagation()} aria-label="LIOS keyboard map">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Command className="h-4 w-4 text-amber-300" />
          <div className="min-w-0 flex-1">
            <div className="font-terminal text-[10px] font-bold tracking-widest text-foreground">KEYBOARD MAP</div>
            <div className="mt-1 font-terminal text-[8px] text-muted-foreground">Search global and professional terminal shortcuts.</div>
          </div>
          <button onClick={onClose} className="border border-border p-1.5 text-muted-foreground hover:text-foreground" aria-label="Close keyboard map"><X className="h-3.5 w-3.5" /></button>
        </header>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="SEARCH SHORTCUTS..." className="min-w-0 flex-1 bg-transparent font-terminal text-[10px] text-foreground outline-none placeholder:text-muted-foreground/60" />
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-4 scrollbar-thin">
          {groups.map((group) => (
            <section key={group} className="mb-5 last:mb-0">
              <div className="mb-2 font-terminal text-[8px] font-bold tracking-[0.18em] text-cyan-300">{group.toUpperCase()}</div>
              <div className="divide-y divide-border/60 border border-border">
                {filtered.filter((item) => item.group === group).map((item) => (
                  <div key={`${item.keys}-${item.label}`} className="grid grid-cols-[130px_150px_1fr] gap-3 px-3 py-2.5">
                    <kbd className="w-fit border border-border bg-black px-2 py-1 font-terminal text-[8px] text-amber-300">{item.keys}</kbd>
                    <span className="font-terminal text-[9px] text-foreground">{item.label}</span>
                    <span className="font-terminal text-[8px] leading-relaxed text-muted-foreground">{item.description}</span>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {filtered.length === 0 && <div className="py-10 text-center font-terminal text-[9px] text-muted-foreground">NO MATCHING SHORTCUTS</div>}
        </div>
      </section>
    </div>
  );
}
