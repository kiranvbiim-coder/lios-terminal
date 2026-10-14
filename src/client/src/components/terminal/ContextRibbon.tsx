import { useEffect, useState } from "react";
import { Activity, ArrowRight, ChevronRight, Network, Sparkles, Star } from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import { getContextHeroActions, getNextBestAction } from "@/lib/terminalExperience";
import { getJourneyForView, getRelatedToolActions } from "@/lib/terminalToolGraph";
import { loadTerminalFavorites, saveTerminalFavorites, toggleTerminalFavorite } from "@/lib/terminalPersonalization";
import { getTerminalCapability } from "@/lib/terminalCatalog";

interface Props {
  view: ViewMode;
  isInternal: boolean;
  onNav: (view: ViewMode) => void;
}

export default function ContextRibbon({ view, isInternal, onNav }: Props) {
  const heroActions = getContextHeroActions(view);
  const nextAction = getNextBestAction(view, isInternal);
  const journeyMatch = getJourneyForView(view);
  const related = getRelatedToolActions(view, isInternal).slice(0, 5);
  const capability = getTerminalCapability(view);
  const [favorites, setFavorites] = useState<ViewMode[]>(() => loadTerminalFavorites());
  const [flowOpen, setFlowOpen] = useState(false);

  useEffect(() => {
    saveTerminalFavorites(favorites);
  }, [favorites]);

  const isFavorite = favorites.includes(view);

  return (
    <nav
      className="relative flex h-full min-h-0 min-w-0 shrink-0 items-center overflow-visible border-b border-border bg-[#080808]"
      aria-label="LIOS workflow and contextual actions"
      data-testid="context-ribbon"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden px-3 py-1">
        <span className="shrink-0 font-terminal text-[7px] tracking-[0.14em] text-muted-foreground">
          CURRENT
        </span>
        <span className="truncate font-terminal text-[8px] tracking-widest text-foreground">
          {capability.label.toUpperCase()}
        </span>
      </div>

      {journeyMatch && (
        <div className="relative hidden h-full shrink-0 border-l border-border/70 xl:block">
          <button
            onClick={() => setFlowOpen((value) => !value)}
            className="flex h-full min-h-0 items-center gap-1.5 px-2.5 font-terminal text-[7px] tracking-widest text-muted-foreground transition-colors hover:bg-white/[0.03] hover:text-foreground"
            title="Open analysis journey"
            aria-expanded={flowOpen}
          >
            <Network className="h-3 w-3 text-cyan-300" />
            <span>{journeyMatch.journey.label.toUpperCase()}</span>
            <ChevronRight className={`h-3 w-3 transition-transform ${flowOpen ? "rotate-90" : ""}`} />
          </button>
          {flowOpen && (
            <div className="absolute right-0 top-full z-50 w-[360px] border border-border bg-[#090909] p-3 shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <div>
                  <div className="font-terminal text-[8px] tracking-widest text-cyan-300">ANALYSIS JOURNEY</div>
                  <div className="mt-1 font-terminal text-[11px] text-foreground">{journeyMatch.journey.label}</div>
                </div>
                <span className="font-terminal text-[8px] text-muted-foreground">STAGE {journeyMatch.stageIndex + 1}/{journeyMatch.journey.stages.length}</span>
              </div>
              <div className="flex gap-1">
                {journeyMatch.journey.stages.map((stage, index) => (
                  <div key={stage.label} className="min-w-0 flex-1">
                    <div className={`h-1 ${index <= journeyMatch.stageIndex ? "bg-amber-400" : "bg-border"}`} />
                    <div className={`mt-1 truncate font-terminal text-[7px] ${index === journeyMatch.stageIndex ? "text-amber-300" : "text-muted-foreground"}`}>{stage.label.toUpperCase()}</div>
                  </div>
                ))}
              </div>
              {related.length > 0 && (
                <div className="mt-3 border-t border-border pt-2">
                  <div className="mb-1.5 font-terminal text-[7px] tracking-widest text-muted-foreground">CONNECTED NEXT MOVES</div>
                  <div className="grid grid-cols-2 gap-1">
                    {related.map((action) => (
                      <button
                        key={`${action.relationship}-${action.view}`}
                        onClick={() => { onNav(action.view); setFlowOpen(false); }}
                        title={action.reason}
                        className="border border-border/70 px-2 py-1.5 text-left font-terminal text-[8px] text-muted-foreground hover:border-cyan-400/40 hover:bg-cyan-400/[0.04] hover:text-foreground"
                      >
                        <span className="block text-foreground">{action.label}</span>
                        <span className="mt-0.5 block text-[6px] uppercase tracking-widest text-cyan-300/70">{action.relationship}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {heroActions.length > 0 && (
        <div
          className="hidden h-full shrink-0 items-center gap-1 border-l border-border/70 px-1.5 2xl:flex"
          aria-label="Contextual quick actions"
          data-testid="context-hero-actions"
        >
          {heroActions.map((action) => {
            const active = action.view === view;
            return (
              <button
                key={action.id}
                onClick={() => onNav(action.view)}
                title={`${action.label} — ${action.description}`}
                aria-current={active ? "page" : undefined}
                className={`border px-2 py-1 font-terminal text-[7px] tracking-widest transition-all ${
                  active
                    ? "border-cyan-400/50 bg-cyan-400/10 text-cyan-100"
                    : action.id === "valuation"
                      ? "border-amber-500/35 text-amber-300 hover:border-amber-400/70 hover:bg-amber-500/10"
                      : "border-border/60 text-muted-foreground hover:border-cyan-400/40 hover:bg-cyan-400/[0.03] hover:text-foreground"
                }`}
              >
                {action.shortLabel}
              </button>
            );
          })}
        </div>
      )}

      <button
        onClick={() => setFavorites((current) => toggleTerminalFavorite(current, view))}
        className={`flex h-full min-h-0 w-9 shrink-0 items-center justify-center border-l border-border/70 transition-colors ${isFavorite ? "text-amber-300" : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"}`}
        title={isFavorite ? `Remove ${capability.label} from favorites` : `Add ${capability.label} to favorites`}
        aria-label={isFavorite ? "Remove current tool from favorites" : "Favorite current tool"}
        aria-pressed={isFavorite}
      >
        <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-current" : ""}`} />
      </button>

      {nextAction ? (
        <button
          onClick={() => onNav(nextAction.view)}
          title={`${nextAction.label} — ${nextAction.description}`}
          className="group flex h-full min-h-0 shrink-0 items-center gap-1.5 border-l border-amber-500/25 bg-amber-500/[0.04] px-2.5 font-terminal text-[7px] tracking-widest text-muted-foreground transition-colors hover:bg-amber-500/10 hover:text-amber-100"
          data-testid="context-next-action"
        >
          <Sparkles className="h-3 w-3 text-amber-300" />
          <span className="hidden lg:inline">NEXT</span>
          <span className="text-amber-300">{nextAction.shortLabel}</span>
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
        </button>
      ) : (
        <div className="hidden h-full min-h-0 shrink-0 items-center gap-1 border-l border-border/70 px-2 font-terminal text-[7px] tracking-widest text-muted-foreground lg:flex">
          <Activity className="h-3 w-3 text-cyan-300" /> CONTEXT
        </div>
      )}
    </nav>
  );
}
