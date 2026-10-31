import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import type { ExperienceShellSurface } from "@shared/waveCContracts";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import { INTELLIGENCE_VIEWS } from "@/lib/intelligenceViews";
import { openTerminalUxSurface } from "@/lib/terminalUxEvents";
import WaveCExperienceShell from "./WaveCExperienceShell";

/** Tabs offered inside Discover. Projects/Workbench stay in the main navigation, not here. */
export const DISCOVER_SURFACES = ["pulse", "explore", "signals", "library"] as const satisfies readonly ExperienceShellSurface[];
export type DiscoverSurfaceId = typeof DISCOVER_SURFACES[number];

export function discoverSurfaceFor(surface: ExperienceShellSurface | undefined): DiscoverSurfaceId {
  return (DISCOVER_SURFACES as readonly string[]).includes(surface ?? "") ? surface as DiscoverSurfaceId : "pulse";
}

interface Props {
  initialSurface?: ExperienceShellSurface;
  activeView: ViewMode;
  activeSymbol?: string;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onAsk: (question?: string) => void;
  onWorkbench: () => void;
  onBack: () => void;
}

/**
 * The discovery stack (Pulse, Explore, Signals, Library) rendered inside the
 * Chat shell. Navigation, account, Project and Chat state stay in one place;
 * there is no second sidebar or header to switch to.
 */
export function DiscoverSurface({ initialSurface, activeView, activeSymbol, onOpen, onAsk, onWorkbench, onBack }: Props) {
  const [surface, setSurface] = useState<DiscoverSurfaceId>(() => discoverSurfaceFor(initialSurface));
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Discover" data-testid="discover-surface">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[var(--lios-border-default)] px-5 py-3">
        <button type="button" onClick={onBack} className="lios-section-action inline-flex items-center gap-1.5" aria-label="Back to chat"><ArrowLeft size={14} aria-hidden="true" />Chat</button>
        <h1 className="text-[17px] font-semibold tracking-tight">Discover</h1>
        <nav className="ml-auto flex flex-wrap items-center gap-1.5" aria-label="Intelligence views">
          {INTELLIGENCE_VIEWS.map((view) => (
            <button key={view.surface} type="button" title={view.hint} onClick={() => openTerminalUxSurface(view.surface)}
              className="rounded-md border border-[var(--lios-border-default)] px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:border-amber-300/40 hover:text-foreground">
              {view.label}
            </button>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1">
        <WaveCExperienceShell
          embedded
          hosted
          hostedSurfaces={DISCOVER_SURFACES}
          surface={surface}
          onSurfaceChange={(next) => { if (next === "workbench") onWorkbench(); else setSurface(discoverSurfaceFor(next)); }}
          activeView={activeView}
          activeSymbol={activeSymbol}
          onOpen={onOpen}
          onAskLios={onAsk}
        />
      </div>
    </section>
  );
}
