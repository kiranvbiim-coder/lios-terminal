import * as React from "react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, PanelsTopLeft, Search } from "lucide-react";
import type { ChatTerminalContext, ChatTerminalControls } from "@/lib/chatTerminalContext";
import { chatTerminalCapabilities } from "@/lib/chatTerminalContext";
import { countDiscoveredChatTools, discoverChatTools } from "@/lib/chatToolDiscovery";
import type { WorkspaceAudience } from "@/lib/featureRegistry";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export type ChatTerminalRenderer = (context: ChatTerminalContext, controls: ChatTerminalControls) => ReactNode;

interface ChatTerminalControlProps {
  audience: WorkspaceAudience;
  selected: ChatTerminalContext | null;
  onSelect: (context: ChatTerminalContext) => void;
}

/**
 * Searchable presentation over LiOS's EXISTING authorized view catalog.
 * Adapted from Watermelon UI command-search / morphing discovery principles;
 * does not import demo commands, routing state, or any second tool executor.
 *
 * Selecting a view still calls the exact caller-supplied navigation handler.
 */
export function ChatTerminalControl({ audience, selected, onSelect }: ChatTerminalControlProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const groups = useMemo(() => discoverChatTools(audience, query), [audience, query]);
  const total = useMemo(() => chatTerminalCapabilities(audience).length, [audience]);
  const count = countDiscoveredChatTools(groups);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  const selectTool = (view: ChatTerminalContext["view"]) => {
    // Preserve existing symbol context, even when switching to a non-symbol
    // view. The destination's established capability logic owns its use.
    onSelect({ view, symbol: selected?.symbol ?? null });
    changeOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="chat-contextual-tools-trigger"
          aria-label="Browse research and analysis tools"
          aria-expanded={open}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-border/60 bg-background/45 px-3 py-2 font-ui text-sm font-medium text-foreground transition-colors hover:border-amber-300/35 hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/70"
        >
          <PanelsTopLeft aria-hidden="true" className="h-4 w-4 text-muted-foreground" />
          <span>Tools</span>
          <ChevronsUpDown aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          searchRef.current?.focus();
        }}
        aria-label="Research and analysis tools"
        data-testid="chat-contextual-tools-popover"
        className="z-[100] w-[min(92vw,27rem)] max-w-[92vw] overflow-hidden rounded-xl border border-border bg-background p-0 shadow-xl"
      >
        <div className="border-b border-border/65 p-3">
          <label htmlFor="lios-chat-tool-filter" className="sr-only">Search registered tools</label>
          <div className="flex min-h-10 items-center gap-2 rounded-lg border border-border/70 bg-white/[0.025] px-3 focus-within:ring-2 focus-within:ring-amber-300/60">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              id="lios-chat-tool-filter"
              ref={searchRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Search tools"
              autoComplete="off"
              maxLength={120}
              className="min-w-0 flex-1 border-0 bg-transparent py-2 font-ui text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <p role="status" aria-live="polite" className="mt-2 font-ui text-xs text-muted-foreground">
            {count} of {total} registered views
          </p>
        </div>
        <div className="max-h-[min(55dvh,23rem)] overflow-y-auto overscroll-contain p-2" data-testid="chat-contextual-tools-results">
          {groups.length > 0 ? (
            <div className="space-y-3">
              {groups.map(group => (
                <section key={group.key} aria-label={group.label} className="space-y-1">
                  <h3 className="px-2 pt-1 font-ui text-xs font-semibold text-muted-foreground">{group.label}</h3>
                  <ul className="space-y-0.5">
                    {group.tools.map(item => (
                      <li key={item.view}>
                        <button
                          type="button"
                          data-testid={`chat-tool-${item.view}`}
                          aria-current={selected?.view === item.view ? "true" : undefined}
                          onClick={() => selectTool(item.view)}
                          className="group flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-white/[0.05] focus-visible:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-amber-300/70"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-ui text-sm font-medium text-foreground">{item.label}</span>
                            <span className="block truncate font-ui text-xs text-muted-foreground">{item.description}</span>
                          </span>
                          {selected?.view === item.view && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-200" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <div role="status" className="px-3 py-6 text-center font-ui text-sm text-muted-foreground">
              No matching tools. Try another search.
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
