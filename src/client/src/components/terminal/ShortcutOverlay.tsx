import { useMemo, useState } from "react";
import { useAccessibleDialog } from "./useAccessibleDialog";
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
  const { dialogRef, initialRef, onDialogKeyDown } = useAccessibleDialog(onClose);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return SHORTCUTS;
    return SHORTCUTS.filter((item) => `${item.group} ${item.keys} ${item.label} ${item.description}`.toLowerCase().includes(normalized));
  }, [query]);
  const groups = [...new Set(filtered.map((item) => item.group))];

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/75 px-3 pt-4 sm:pt-12" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} onKeyDown={onDialogKeyDown} role="dialog" aria-modal="true" aria-labelledby="lios-keyboard-map-title" tabIndex={-1} className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-[#090909] shadow-2xl">
        <header className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Command className="h-4 w-4 text-amber-300" />
          <div className="min-w-0 flex-1">
            <h2 id="lios-keyboard-map-title" className="font-ui text-base font-semibold text-foreground">Keyboard shortcuts</h2>
            <p className="mt-1 font-ui text-xs text-muted-foreground">Search navigation, workspace and analysis shortcuts.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded border border-border p-2 text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label="Close keyboard map"><X className="h-3.5 w-3.5" /></button>
        </header>
        <div role="search" className="flex items-center gap-2 border-b border-border px-4 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input ref={initialRef} type="search" aria-label="Search keyboard shortcuts" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search shortcuts…" className="min-w-0 flex-1 bg-transparent py-2 font-ui text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-primary" />
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-3 sm:p-4 scrollbar-thin">
          <p className="sr-only" role="status" aria-live="polite">{filtered.length} shortcuts found</p>
          {groups.map((group) => (
            <section key={group} className="mb-5 last:mb-0">
              <h3 className="mb-2 font-ui text-xs font-semibold uppercase tracking-wide text-primary">{group}</h3>
              <ul className="divide-y divide-border/60 rounded border border-border">
                {filtered.filter((item) => item.group === group).map((item) => (
                  <li key={`${item.keys}-${item.label}`} className="grid grid-cols-1 gap-1 px-3 py-3 sm:grid-cols-[minmax(110px,140px)_minmax(110px,150px)_minmax(0,1fr)] sm:gap-3">
                    <kbd className="w-fit self-start rounded border border-border bg-black px-2 py-1 font-terminal text-xs text-amber-300">{item.keys}</kbd>
                    <span className="font-ui text-sm font-medium text-foreground">{item.label}</span>
                    <span className="font-ui text-xs leading-relaxed text-muted-foreground">{item.description}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {filtered.length === 0 && <div className="py-10 text-center font-ui text-sm text-muted-foreground">No matching shortcuts. Try another search.</div>}
        </div>
      </section>
    </div>
  );
}
