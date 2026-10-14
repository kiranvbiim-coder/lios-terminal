import { useEffect, useMemo, useState } from "react";
import {
  Activity, AlertTriangle, ArrowRight, BookOpen, ChevronRight, Command, Database, GitBranch, LayoutDashboard,
  Link2, PanelRight, Plus, Search, Settings2, Sparkles, Star, X,
} from "lucide-react";
import type { ViewMode } from "@/lib/terminalTypes";
import type { TerminalDensity } from "@/lib/terminalUxPreferences";
import { formatPrice, getCurrencySymbol, pctClass, type Quote } from "@/lib/finance";
import { useMarketGainers, useMarketLosers, useMarketSentiment } from "@/lib/useFinance";
import { getWorkspaceDefinition, getWorkspaceForView } from "@/lib/featureRegistry";
import { useAlerts } from "@/lib/useAlerts";
import { getContextHeroActions } from "@/lib/terminalExperience";
import { getIncomingToolActions, getJourneyForView, getRelatedToolActions } from "@/lib/terminalToolGraph";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { loadTerminalFavorites, saveTerminalFavorites, toggleTerminalFavorite } from "@/lib/terminalPersonalization";
import { useGuidedMode } from "@/hooks/use-guided-mode";

const RAIL_TABS = ["context", "connections", "evidence", "market", "monitor", "tools"] as const;
type RailTab = typeof RAIL_TABS[number];

interface Props {
  view: ViewMode;
  symbol: string;
  open: boolean;
  onToggle: () => void;
  onNav: (view: ViewMode) => void;
  onSymbol: (symbol: string) => void;
  onNewTab: () => void;
  onOpenCmd: () => void;
  onOpenLayout: () => void;
  density: TerminalDensity;
  onDensityChange: (density: TerminalDensity) => void;
  isInternal: boolean;
}

function MarketQuoteRow({ quote, onSymbol }: { quote: Quote; onSymbol: (symbol: string) => void }) {
  const up = quote.changePercent >= 0;
  return (
    <button onClick={() => onSymbol(quote.symbol)} className="flex w-full items-center justify-between border-b border-border/60 px-2.5 py-2 text-left transition-colors hover:bg-white/[0.04]">
      <span className="min-w-0">
        <span className="block truncate font-terminal text-[9px] text-amber-300">{quote.symbol}</span>
        <span className="block truncate font-terminal text-[7.5px] text-muted-foreground">{quote.name}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block font-terminal text-[9px] tabular-nums text-foreground">{getCurrencySymbol(quote.symbol)}{formatPrice(quote.price)}</span>
        <span className={`block font-terminal text-[7.5px] tabular-nums ${pctClass(quote.changePercent)}`}>{up ? "▲" : "▼"}{Math.abs(quote.changePercent).toFixed(2)}%</span>
      </span>
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 font-terminal text-[7px] tracking-[0.16em] text-muted-foreground">{children}</div>;
}

export default function ContextRail({
  view, symbol, open, onToggle, onNav, onSymbol, onNewTab, onOpenCmd, onOpenLayout,
  density, onDensityChange, isInternal,
}: Props) {
  const [activeTab, setActiveTab] = useState<RailTab>("context");
  const [marketMode, setMarketMode] = useState<"gainers" | "losers">("gainers");
  const [favorites, setFavorites] = useState<ViewMode[]>(() => loadTerminalFavorites());
  const { data: alerts = [] } = useAlerts();
  const { data: gainers = [], isLoading: gainersLoading } = useMarketGainers();
  const { data: losers = [], isLoading: losersLoading } = useMarketLosers();
  const { data: sentiment } = useMarketSentiment();

  useEffect(() => saveTerminalFavorites(favorites), [favorites]);

  const workspace = getWorkspaceDefinition(getWorkspaceForView(view));
  const capability = getTerminalCapability(view);
  const guided = useGuidedMode();
  const journey = getJourneyForView(view);
  const heroActions = getContextHeroActions(view);
  const outgoing = useMemo(() => getRelatedToolActions(view, isInternal), [view, isInternal]);
  const incoming = useMemo(() => getIncomingToolActions(view, isInternal), [view, isInternal]);
  const marketQuotes = marketMode === "gainers" ? gainers : losers;
  const marketLoading = marketMode === "gainers" ? gainersLoading : losersLoading;
  const isFavorite = favorites.includes(view);

  if (!open) {
    return (
      <button
        onClick={onToggle}
        className="fixed right-3 top-[82px] z-40 flex items-center gap-1.5 border border-border bg-[#090909]/95 px-2.5 py-2 font-terminal text-[8px] tracking-widest text-muted-foreground shadow-xl backdrop-blur hover:border-cyan-400/40 hover:text-foreground xl:relative xl:right-auto xl:top-auto xl:z-auto xl:h-full xl:w-8 xl:shrink-0 xl:justify-center xl:border-y-0 xl:border-r-0 xl:border-l xl:px-0 xl:py-0 xl:shadow-none xl:backdrop-blur-none"
        aria-label="Open context intelligence rail"
        title="Open context intelligence rail"
      >
        <PanelRight className="h-3.5 w-3.5" />
        <span className="hidden lg:inline xl:hidden">CONTEXT</span>
      </button>
    );
  }

  return (
    <aside className="fixed inset-x-3 bottom-14 z-40 flex max-h-[72vh] flex-col border border-border bg-[#090909]/98 shadow-2xl backdrop-blur xl:relative xl:inset-auto xl:z-auto xl:h-full xl:max-h-none xl:w-[340px] xl:shrink-0 xl:border-y-0 xl:border-r-0 xl:border-l xl:shadow-none xl:backdrop-blur-none" aria-label="Context intelligence rail">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-[#070707] px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PanelRight className="h-3.5 w-3.5 text-cyan-300" />
            <span className="font-terminal text-[9px] tracking-widest text-foreground">INTELLIGENCE RAIL</span>
          </div>
          <div className="mt-1 truncate font-terminal text-[7px] text-muted-foreground">{symbol || "GLOBAL"} · {capability.label.toUpperCase()}</div>
        </div>
        <button onClick={onToggle} className="border border-border p-1 text-muted-foreground hover:bg-white/5 hover:text-foreground" aria-label="Close context rail"><X className="h-3 w-3" /></button>
      </header>

      <nav className="flex shrink-0 overflow-x-auto border-b border-border bg-[#070707]" aria-label="Context rail sections">
        {RAIL_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            aria-pressed={activeTab === tab}
            className={`min-w-fit flex-1 border-r border-border px-2 py-2 font-terminal text-[6.5px] uppercase tracking-widest ${activeTab === tab ? "bg-amber-500/10 text-amber-300" : "text-muted-foreground hover:bg-white/[0.03] hover:text-foreground"}`}
          >
            {tab}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
        {activeTab === "context" && (
          <div className="space-y-3">
            <div className="border border-border bg-[#0d0d0d] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-terminal text-[7px] tracking-widest text-muted-foreground">ACTIVE ANALYTICAL OBJECT</div>
                  <div className="mt-1 truncate font-terminal text-[14px] text-amber-300">{symbol ? `${symbol} · ${capability.label}` : capability.label}</div>
                  <p className="mt-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">{capability.description}</p>
                  {guided && capability.guidance && (
                    <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                      {capability.guidance.userQuestion && <p className="font-terminal text-[7.5px] italic leading-relaxed text-foreground/80">"{capability.guidance.userQuestion}"</p>}
                      <p className="font-terminal text-[7.5px] leading-relaxed text-muted-foreground"><span className="text-[hsl(38,95%,55%)]">WHY IT MATTERS — </span>{capability.guidance.why}</p>
                      <p className="font-terminal text-[7.5px] leading-relaxed text-muted-foreground"><span className="text-cyan-400/90">WHAT YOU GET — </span>{capability.guidance.outcome}</p>
                      {capability.guidance.risks && <p className="font-terminal text-[7.5px] leading-relaxed text-muted-foreground"><span className="text-red-400/80">WORTH KNOWING — </span>{capability.guidance.risks}</p>}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setFavorites((current) => toggleTerminalFavorite(current, view))}
                  className={`shrink-0 border border-border p-2 ${isFavorite ? "bg-amber-500/10 text-amber-300" : "text-muted-foreground hover:text-foreground"}`}
                  aria-pressed={isFavorite}
                  title={isFavorite ? "Remove from favorites" : "Add to favorites"}
                >
                  <Star className={`h-3.5 w-3.5 ${isFavorite ? "fill-current" : ""}`} />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2 border-t border-border/60 pt-2 font-terminal text-[7px] tracking-widest text-muted-foreground">
                <span className="border border-border px-1.5 py-0.5">{workspace.shortLabel}</span>
                <span>{capability.domain.toUpperCase()}</span>
                <span className="ml-auto text-cyan-300">{capability.shortLabel}</span>
              </div>
            </div>

            {journey && (
              <div className="border border-cyan-500/25 bg-cyan-500/[0.025] p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-terminal text-[8px] text-cyan-300"><GitBranch className="h-3.5 w-3.5" /> {journey.journey.label.toUpperCase()}</div>
                  <span className="font-terminal text-[7px] text-muted-foreground">{journey.stageIndex + 1}/{journey.journey.stages.length}</span>
                </div>
                <div className="mt-3 flex gap-1">
                  {journey.journey.stages.map((stage, index) => (
                    <div key={stage.label} className="min-w-0 flex-1">
                      <div className={`h-1 ${index <= journey.stageIndex ? "bg-cyan-300" : "bg-border"}`} />
                      <div className={`mt-1 truncate font-terminal text-[6px] ${index === journey.stageIndex ? "text-cyan-200" : "text-muted-foreground"}`}>{stage.label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {heroActions.length > 0 && (
              <section>
                <SectionTitle>HIGH-VALUE ACTIONS</SectionTitle>
                <div className="grid grid-cols-2 gap-1.5">
                  {heroActions.map((action) => (
                    <button key={action.id} onClick={() => onNav(action.view)} title={action.description} className={`border px-2.5 py-2 text-left transition-colors ${action.view === view ? "border-amber-500/40 bg-amber-500/10" : "border-border hover:border-cyan-500/35 hover:bg-white/[0.03]"}`}>
                      <div className="font-terminal text-[8px] text-foreground">{action.label}</div>
                      <div className="mt-1 font-terminal text-[6px] tracking-widest text-muted-foreground">{action.shortLabel}</div>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === "connections" && (
          <div className="space-y-4">
            <div className="border border-cyan-500/25 bg-cyan-500/[0.025] p-3">
              <div className="flex items-center gap-2 font-terminal text-[8px] text-cyan-300"><Link2 className="h-3.5 w-3.5" /> CONNECTED ANALYSIS</div>
              <p className="mt-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">These links come from the LiOS Tool Graph. They describe how analytical outputs feed, challenge, support, or deliver into other capabilities.</p>
            </div>

            <section>
              <SectionTitle>SEND / CONTINUE TO</SectionTitle>
              <div className="space-y-1.5">
                {outgoing.length ? outgoing.map((action) => (
                  <button key={`${action.relationship}-${action.view}`} onClick={() => onNav(action.view)} className="group w-full border border-border bg-[#0d0d0d] p-2.5 text-left hover:border-cyan-500/40 hover:bg-cyan-500/[0.025]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-terminal text-[9px] text-foreground">{action.label}</span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-300" />
                    </div>
                    <div className="mt-1 font-terminal text-[6.5px] uppercase tracking-widest text-cyan-300/70">{action.relationship}</div>
                    <p className="mt-1.5 font-terminal text-[7.5px] leading-relaxed text-muted-foreground">{action.reason}</p>
                  </button>
                )) : <div className="border border-dashed border-border p-4 font-terminal text-[8px] text-muted-foreground">No explicit outgoing tool-graph edge yet.</div>}
              </div>
            </section>

            {incoming.length > 0 && (
              <section>
                <SectionTitle>CAN BE FED BY</SectionTitle>
                <div className="flex flex-wrap gap-1">
                  {incoming.map((action) => (
                    <button key={`${action.view}-${action.relationship}`} onClick={() => onNav(action.view)} title={action.reason} className="border border-border px-2 py-1.5 font-terminal text-[7px] text-muted-foreground hover:border-amber-500/40 hover:text-foreground">
                      {action.label.toUpperCase()}
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === "evidence" && (
          <div className="space-y-3">
            <div className="border border-cyan-500/30 bg-cyan-500/[0.04] p-3">
              <div className="flex items-center gap-2 font-terminal text-[9px] text-cyan-300"><BookOpen className="h-3.5 w-3.5" /> EVIDENCE SPINE</div>
              <p className="mt-2 font-terminal text-[8px] leading-relaxed text-muted-foreground">Every important number should be traceable to source, timestamp, transformation, assumptions, and model output. Evidence should be inspectable without abandoning the current analysis.</p>
            </div>
            <button onClick={() => onNav("coveragemap")} className="flex w-full items-center justify-between border border-border px-3 py-2 text-left font-terminal text-[8px] text-muted-foreground hover:border-cyan-500/50 hover:text-foreground"><span className="flex items-center gap-2"><Database className="h-3.5 w-3.5 text-cyan-300" /> DATA COVERAGE & PROVENANCE</span><ChevronRight className="h-3 w-3" /></button>
            {isInternal && <button onClick={() => onNav("qualitygate")} className="flex w-full items-center justify-between border border-border px-3 py-2 text-left font-terminal text-[8px] text-muted-foreground hover:border-cyan-500/50 hover:text-foreground"><span className="flex items-center gap-2"><Activity className="h-3.5 w-3.5 text-cyan-300" /> QUALITY GATE</span><ChevronRight className="h-3 w-3" /></button>}
            {isInternal && <button onClick={() => onNav("research")} className="flex w-full items-center justify-between border border-border px-3 py-2 text-left font-terminal text-[8px] text-muted-foreground hover:border-cyan-500/50 hover:text-foreground"><span className="flex items-center gap-2"><Search className="h-3.5 w-3.5 text-cyan-300" /> RESEARCH INTELLIGENCE</span><ChevronRight className="h-3 w-3" /></button>}
          </div>
        )}

        {activeTab === "market" && (
          <div className="space-y-3">
            <div className="border border-border bg-[#0d0d0d] p-3">
              <div className="flex items-center gap-2 font-terminal text-[8px] tracking-widest text-muted-foreground"><LayoutDashboard className="h-3.5 w-3.5" /> MARKET SNAPSHOT</div>
              <div className="mt-1 font-terminal text-[13px] text-amber-300">{symbol || "GLOBAL"}</div>
              <div className="mt-2 flex items-center gap-1 border-b border-border">
                {(["gainers", "losers"] as const).map((option) => (
                  <button key={option} onClick={() => setMarketMode(option)} className={`flex-1 px-2 py-1.5 font-terminal text-[7px] uppercase tracking-widest ${marketMode === option ? "border-b border-amber-300 text-amber-300" : "text-muted-foreground hover:text-foreground"}`}>{option}</button>
                ))}
              </div>
            </div>
            <div className="overflow-hidden border border-border bg-[#0d0d0d]">
              {marketLoading ? <div className="p-4 font-terminal text-[8px] text-muted-foreground">LOADING MARKET DATA...</div> : marketQuotes.length ? marketQuotes.slice(0, 7).map((quote) => <MarketQuoteRow key={quote.symbol} quote={quote} onSymbol={onSymbol} />) : <div className="p-4 font-terminal text-[8px] text-muted-foreground">NO MARKET DATA AVAILABLE.</div>}
            </div>
            {sentiment && (
              <div className="border border-border bg-[#0d0d0d] p-3">
                <SectionTitle>MARKET SENTIMENT</SectionTitle>
                <div className={`font-terminal text-[12px] font-bold ${sentiment.sentiment === "Bullish" ? "text-up" : sentiment.sentiment === "Bearish" ? "text-down" : "text-amber-300"}`}>{sentiment.sentiment.toUpperCase()}</div>
                <div className="mt-2 font-terminal text-[8px] text-muted-foreground">BULL {sentiment.bullish}% · BEAR {sentiment.bearish}% · SCORE {sentiment.score}</div>
              </div>
            )}
          </div>
        )}

        {activeTab === "monitor" && (
          <div className="space-y-3">
            <div className="border border-border bg-[#0d0d0d] p-3">
              <div className="flex items-center gap-2 font-terminal text-[9px] text-foreground"><AlertTriangle className="h-3.5 w-3.5 text-amber-300" /> MONITORING</div>
              <div className="mt-2 font-terminal text-[22px] text-amber-300">{alerts.length}</div>
              <div className="font-terminal text-[7px] uppercase tracking-widest text-muted-foreground">configured alerts</div>
            </div>
            <button onClick={() => onNav("alerts")} className="flex w-full items-center justify-between border border-border px-3 py-2 font-terminal text-[8px] text-muted-foreground hover:border-amber-500/50 hover:text-foreground"><span className="flex items-center gap-2"><AlertTriangle className="h-3.5 w-3.5" /> OPEN ALERTS</span><ChevronRight className="h-3 w-3" /></button>
            <button onClick={() => onNav("watchlist")} className="flex w-full items-center justify-between border border-border px-3 py-2 font-terminal text-[8px] text-muted-foreground hover:border-amber-500/50 hover:text-foreground"><span className="flex items-center gap-2"><Star className="h-3.5 w-3.5" /> OPEN WATCHLIST</span><ChevronRight className="h-3 w-3" /></button>
            {isInternal && <button onClick={() => onNav("decisionengine")} className="flex w-full items-center justify-between border border-border px-3 py-2 font-terminal text-[8px] text-muted-foreground hover:border-amber-500/50 hover:text-foreground"><span className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> DECISION TRIGGERS</span><ChevronRight className="h-3 w-3" /></button>}
          </div>
        )}

        {activeTab === "tools" && (
          <div className="space-y-4">
            <section>
              <SectionTitle>WORKSPACE ACTIONS</SectionTitle>
              <div className="space-y-1.5">
                <button onClick={onOpenCmd} className="flex w-full items-center justify-between border border-border px-3 py-2 text-left font-terminal text-[8px] text-muted-foreground hover:border-amber-500/50 hover:text-foreground"><span className="flex items-center gap-2"><Command className="h-3.5 w-3.5 text-amber-300" /> OPEN OMNIBOX</span><span>⌘K</span></button>
                <button onClick={onNewTab} className="flex w-full items-center justify-between border border-border px-3 py-2 text-left font-terminal text-[8px] text-muted-foreground hover:border-amber-500/50 hover:text-foreground"><span className="flex items-center gap-2"><Plus className="h-3.5 w-3.5 text-amber-300" /> NEW ANALYTICAL TAB</span><span>⌘T</span></button>
                <button onClick={onOpenLayout} className="flex w-full items-center justify-between border border-border px-3 py-2 text-left font-terminal text-[8px] text-muted-foreground hover:border-amber-500/50 hover:text-foreground"><span className="flex items-center gap-2"><Settings2 className="h-3.5 w-3.5 text-amber-300" /> LAYOUT MANAGER</span><ChevronRight className="h-3 w-3" /></button>
              </div>
            </section>
            <section>
              <SectionTitle>INFORMATION DENSITY</SectionTitle>
              <div className="grid grid-cols-2 gap-1">
                {(["terminal", "compact", "standard", "comfortable"] as const).map((option) => (
                  <button key={option} onClick={() => onDensityChange(option)} className={`border px-2 py-2 font-terminal text-[7px] uppercase tracking-widest ${density === option ? "border-cyan-500/50 bg-cyan-500/[0.06] text-cyan-200" : "border-border text-muted-foreground hover:text-foreground"}`}>{option}</button>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </aside>
  );
}
