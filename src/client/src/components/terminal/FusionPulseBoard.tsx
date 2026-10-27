import { useId, useMemo, useState } from "react";
import type { PulseStoryView } from "@/lib/pulseStoryPresentation";
import { clusterRecordedPulseStories } from "@/lib/pulseStoryClusters";
import type { PulseReviewPresentation } from "@/lib/pulseReviewPresentation";
import { normalizePulseSubjectKey, type PulseSubjectAction, type PulseSubjectPreferences } from "@shared/pulseSubjectPreferences";
import LiosPulseStoryCard from "./LiosPulseStoryCard";
import { PulseDiscoveryTabs } from "./PulseDiscoveryTabs";
import { Activity, ArrowDownRight, ArrowUpRight, BriefcaseBusiness, Gauge, Landmark, Radar, Sparkles, Star } from "lucide-react";
import type { AnalyticalOpenMode } from "@/lib/terminalActionContracts";
import type { ViewMode } from "@/lib/terminalTypes";
import type { RecentAnalyticalContext } from "@/lib/terminalPersonalization";
import { getTerminalCapability } from "@/lib/terminalCatalog";
import { useIndicators } from "@/lib/useEconomics";
import { useMarketBreadth, useMarketGainers, useMarketLosers, useMarketSentiment, type MarketBreadthResult } from "@/lib/useFinance";
import { formatPrice, getCurrencySymbol, pctClass, type Quote } from "@/lib/finance";
import { FusionActionButton, FusionDataBar, FusionEmptyState, FusionFreshnessBadge, FusionMetric, FusionMetricGrid, FusionSection, FusionSourceBadge, FusionSparkline } from "./FusionPrimitives";
import FusionMarketCanvas from "./FusionMarketCanvas";
import { toneForChange } from "@/lib/fusionExperience";


interface Props {
  activeSymbol?: string;
  onOpen: (view: ViewMode, mode: AnalyticalOpenMode, symbol?: string) => void;
  onAskLios?: (initialQuestion?: string) => void;
  pulseCards: PulseStoryView[];
  monitoringCount: number;
  inboxCount: number;
  recents: RecentAnalyticalContext[];
  favorites: ViewMode[];
  pulseChannel: "for_you" | "following" | "markets" | "research";
  pulseStatus: "loading" | "ready" | "unavailable";
  briefHeadline?: string | null;
  pulsePreferences: PulseSubjectPreferences;
  pulseReview: PulseReviewPresentation | null;
  reviewPending: boolean;
  reviewError: string | null;
  onMarkPulseReviewed: () => void;
  preferencePending: boolean;
  preferenceError: string | null;
  onPulsePreferenceChange: (cardId: string, action: PulseSubjectAction) => void;
  onPulsePreferenceClear: (subjectKey: string) => void;
  onPulseRetry: () => void;
  onPulseChannelChange: (channel: "for_you" | "following" | "markets" | "research") => void;
}

function QuoteRow({ quote, onOpen }: { quote: Quote; onOpen: Props["onOpen"] }) {
  const change = quote.changePercent;
  const up = change >= 0;
  return (
    <button onClick={() => onOpen("quote", "current", quote.symbol)} className="fusion-table-row grid grid-cols-[minmax(0,1.2fr)_0.8fr_0.65fr] items-center gap-2">
      <span className="min-w-0">
        <span className="block truncate font-semibold text-foreground">{quote.symbol}</span>
        <span className="block truncate text-xs leading-5 text-muted-foreground">{quote.name}</span>
      </span>
      <span className="text-right tabular-nums text-foreground">{getCurrencySymbol(quote.symbol)}{formatPrice(quote.price)}</span>
      <span className={`flex items-center justify-end gap-1 tabular-nums ${pctClass(change)}`}>
        {up ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
        {Math.abs(change).toFixed(2)}%
      </span>
    </button>
  );
}

function MarketStateHero({
  breadth,
  sentiment,
  gainers,
  losers,
  onOpen,
}: {
  breadth?: MarketBreadthResult;
  sentiment?: { sentiment?: string; score?: number };
  gainers: Quote[];
  losers: Quote[];
  onOpen: Props["onOpen"];
}) {
  const latest = breadth?.latest ?? null;
  const latestNet = latest ? latest.advances - latest.declines : null;
  const total = latest ? latest.advances + latest.declines + latest.unchanged : 0;
  const advancePct = latest && total > 0 ? (latest.advances / total) * 100 : null;
  const tone = sentiment?.sentiment ?? (advancePct == null ? "Awaiting" : advancePct >= 55 ? "Constructive" : advancePct <= 45 ? "Defensive" : "Balanced");
  const score = sentiment?.score ?? (advancePct == null ? null : Math.round(advancePct));
  const breadthSeries = (breadth?.series ?? []).slice(-30).map((item) => item.netAdvances);
  const leader = gainers.find((quote) => Number.isFinite(quote.changePercent));
  const laggard = losers.find((quote) => Number.isFinite(quote.changePercent));
  const marketRead = advancePct == null
    ? "Connect a breadth source to build the market read."
    : advancePct >= 55
      ? "Participation is broad enough to support a constructive tape."
      : advancePct <= 45
        ? "Participation is narrow. Keep risk and catalyst checks close."
        : "Leadership is mixed. Use the tape and breadth together before acting.";

  return (
    <section className="fusion-market-hero" aria-label="Market state overview">
      <div className="fusion-hero-main">
        <div className="fusion-hero-kicker"><span>GLOBAL MARKET STATE</span><FusionSourceBadge /></div>
        <div className="fusion-hero-title-row">
          <div className="min-w-0">
            <h1>Market <em>now</em></h1>
            <p>{marketRead}</p>
          </div>
          <div className="fusion-hero-score" aria-label={`Risk tone ${tone}, score ${score ?? "unavailable"}`}>
            <span>RISK TONE</span>
            <strong>{score == null ? "—" : score}</strong>
            <b>{tone.toUpperCase()}</b>
          </div>
        </div>
        <div className="fusion-hero-signal-row">
          <div className="fusion-hero-signal">
            <div><span>PARTICIPATION</span><strong>{advancePct == null ? "—" : `${advancePct.toFixed(0)}%`} <small>ADVANCING</small></strong></div>
            <div className="fusion-hero-signal-bar"><i style={{ width: `${advancePct ?? 0}%` }} /></div>
            <small>{latest ? `${latest.advances} advancing · ${latest.declines} declining · ${latest.unchanged} unchanged` : "Breadth unavailable"}</small>
          </div>
          <div className="fusion-hero-signal fusion-hero-chart">
            <div><span>NET FLOW · 30 SESSIONS</span><strong>{latestNet == null ? "—" : `${latestNet >= 0 ? "+" : ""}${latestNet}`}</strong></div>
            <FusionSparkline values={breadthSeries} height={32} label="Net market breadth flow" />
          </div>
        </div>
      </div>
      <div className="fusion-hero-side">
        <div className="fusion-hero-side-head"><span>LEADERSHIP SNAPSHOT</span><button type="button" onClick={() => onOpen("market", "current")}>OPEN TAPE ↗</button></div>
        <button type="button" className="fusion-hero-leader" onClick={() => leader && onOpen("quote", "current", leader.symbol)} disabled={!leader}>
          <span className="fusion-hero-leader-label">LEADING</span>
          <span className="fusion-hero-leader-symbol">{leader?.symbol ?? "—"}</span>
          <span className="fusion-hero-leader-move text-up">{leader ? `+${leader.changePercent.toFixed(2)}%` : "—"}</span>
        </button>
        <button type="button" className="fusion-hero-leader" onClick={() => laggard && onOpen("quote", "current", laggard.symbol)} disabled={!laggard}>
          <span className="fusion-hero-leader-label">UNDER PRESSURE</span>
          <span className="fusion-hero-leader-symbol">{laggard?.symbol ?? "—"}</span>
          <span className="fusion-hero-leader-move text-down">{laggard ? `${laggard.changePercent.toFixed(2)}%` : "—"}</span>
        </button>
        <div className="fusion-hero-footnote">The read updates from the visible provider universe and remains tied to the evidence panels below.</div>
      </div>
    </section>
  );
}

export default function FusionPulseBoard({
  activeSymbol,
  onOpen,
  onAskLios,
  pulseCards,
  monitoringCount,
  inboxCount,
  recents,
  favorites,
  pulseChannel,
  pulseStatus,
  briefHeadline,
  pulsePreferences,
  pulseReview,
  reviewPending,
  reviewError,
  onMarkPulseReviewed,
  preferencePending,
  preferenceError,
  onPulsePreferenceChange,
  onPulsePreferenceClear,
  onPulseRetry,
  onPulseChannelChange,
}: Props) {
  const { data: gainers = [], isLoading: gainersLoading } = useMarketGainers();
  const { data: losers = [], isLoading: losersLoading } = useMarketLosers();
  const { data: sentiment } = useMarketSentiment();
  const { data: breadth } = useMarketBreadth();
  const { data: indicators = [], isLoading: macroLoading } = useIndicators();
  const latestBreadth = breadth?.latest ?? null;
  const breadthTotal = latestBreadth ? latestBreadth.advances + latestBreadth.declines + latestBreadth.unchanged : 0;
  const advancePct = latestBreadth && breadthTotal > 0 ? (latestBreadth.advances / breadthTotal) * 100 : null;
  const maxMacroMove = Math.max(1, ...indicators.map((item) => Math.abs(item.changePercent ?? 0)));
  // Source-filtered cards are canonical. Never repopulate a muted/empty Pulse
  // from quote-derived synthetic cards; Market State remains independently live.
  const groupedPulseCards = useMemo(() => clusterRecordedPulseStories(pulseCards, 24), [pulseCards]);
  const visiblePulseCards = groupedPulseCards;
  const changedSourceCardIds = new Set(pulseReview?.newCardIds ?? []);
  const visiblePulseStatus = pulseStatus;
  // Market detail stays available, but does not push source-backed stories
  // below the fold for a user browsing For You, Following or Research.
  const marketDeskId = useId();
  const [marketDeskOverride, setMarketDeskOverride] = useState<{ channel: Props["pulseChannel"]; show: boolean } | null>(null);
  const showMarketDesk = marketDeskOverride?.channel === pulseChannel
    ? marketDeskOverride.show : pulseChannel === "markets";
  const toggleMarketDesk = () => setMarketDeskOverride({ channel: pulseChannel, show: !showMarketDesk });

  return (
    <section className="fusion-pulse-board" aria-label="LiOS intelligence discovery board">
      <div className="flex flex-wrap items-start gap-3 border-b border-border/70 px-3 py-2.5">
        <div className="flex h-8 w-8 items-center justify-center border border-amber-400/25 bg-amber-400/[0.045] text-amber-300"><Radar className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="font-ui text-sm font-semibold tracking-wide text-amber-200">LIOS PULSE · INTELLIGENCE DISCOVERY</div>
          <div className="mt-1 font-ui text-sm leading-5 text-muted-foreground">Source-backed stories across your interests, research, markets and monitoring.</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <FusionFreshnessBadge state={pulseStatus === "loading" ? "loading" : pulseStatus === "unavailable" ? "stale" : "live"} />
          <span className="font-ui text-xs font-medium tabular-nums text-muted-foreground">{pulseStatus === "loading" ? "HYDRATING" : pulseStatus === "unavailable" ? "PULSE UNAVAILABLE" : `${visiblePulseCards.length} STORIES`}</span>
          <FusionActionButton onClick={() => onAskLios ? onAskLios() : onOpen("agent", "current", activeSymbol)} variant="accent"><Sparkles className="mr-1 inline h-3 w-3" />ASK LIOS</FusionActionButton>
        </div>
      </div>

      <div className="border-b border-border/60 px-3 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <PulseDiscoveryTabs channel={pulseChannel} onChange={onPulseChannelChange} />
          {briefHeadline && <div className="min-w-0 flex-1 truncate font-ui text-xs leading-5 text-amber-100/90" title={briefHeadline}>{briefHeadline}</div>}
        </div>
      </div>

      <div className="p-3">
        <div data-testid="lios-pulse-discovery-stories">
        <FusionSection title="Your recorded intelligence" eyebrow="DISCOVER · WHY IT MATTERS · SOURCES · ASK · FOLLOW" className="mb-4" action={<FusionActionButton onClick={() => onOpen("alerts", "current")} variant="primary">OPEN MONITORS</FusionActionButton>}>
          {pulseStatus === "ready" && pulseReview && <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-border/60 px-3 py-3 font-ui text-xs text-foreground" data-testid="pulse-reviewed-continuity">
            <div className="min-w-0 flex-1" role="status">
              {pulseReview.status === "not_reviewed" ? "No source review recorded yet." :
                `${pulseReview.newCount} source-backed card${pulseReview.newCount === 1 ? "" : "s"} added or revised since your saved review.`}
              {pulseReview.reviewedAt && <span className="ml-2 text-muted-foreground">Last reviewed <time dateTime={pulseReview.reviewedAt}>{new Date(pulseReview.reviewedAt).toLocaleString()}</time></span>}
            </div>
            <button type="button" disabled={reviewPending || pulseStatus !== "ready"} onClick={onMarkPulseReviewed}
              className="min-h-10 rounded-lg border border-amber-300/35 px-3 py-2 font-ui text-xs font-medium text-foreground disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300">
              {reviewPending ? "Saving review…" : "Mark accessible sources reviewed"}
            </button>
            <p className="w-full font-ui text-xs text-muted-foreground">Review records source-card identity changes, not proof that real-world events changed. This action marks the currently accessible unmuted Pulse as reviewed.</p>
          </div>}
          {reviewError && <p role="alert" className="mb-3 font-ui text-xs text-rose-200">{reviewError}</p>
          {preferenceError && <p role="alert" className="mb-3 rounded-lg border border-rose-300/35 px-3 py-2 font-ui text-sm text-rose-200">{preferenceError}</p>}
          {pulseStatus === "ready" && pulsePreferences.followed.length > 0 && <details className="mb-3 rounded-lg border border-border/50 p-3 font-ui text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">Followed subjects ({pulsePreferences.followed.length})</summary>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Manage followed subjects">
              {pulsePreferences.followed.map(subject => <button key={subject} type="button"
                disabled={preferencePending} onClick={() => onPulsePreferenceClear(subject)}
                aria-label={`Unfollow ${subject}`}
                className="min-h-10 rounded-lg border border-border/65 px-3 py-2 font-ui text-sm text-foreground disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-amber-300/70">
                {subject} · Unfollow
              </button>)}
            </div>
          </details>}
          {pulseStatus === "ready" && pulsePreferences.muted.length > 0 && <details className="mb-3 rounded-lg border border-border/50 p-3 font-ui text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">Muted subjects ({pulsePreferences.muted.length})</summary>
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Restore muted subjects">
              {pulsePreferences.muted.map(subject => <button key={subject} type="button"
                disabled={preferencePending} onClick={() => onPulsePreferenceClear(subject)}
                aria-label={`Unmute ${subject}`}
                className="min-h-10 rounded-lg border border-border/65 px-3 py-2 font-ui text-sm text-foreground disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-amber-300/70">
                {subject} · Unmute
              </button>)}
            </div>
          </details>}
              {visiblePulseStatus === "loading" ? <FusionEmptyState>Refreshing decision-relevant changes…</FusionEmptyState> : visiblePulseStatus === "unavailable" ? <div role="alert" className="flex flex-wrap items-center gap-3 px-3 py-4 font-ui text-sm text-muted-foreground">Pulse unavailable. Market and macro panels remain independent. <button type="button" onClick={onPulseRetry} className="min-h-10 rounded-lg border border-border/60 px-3 py-2 text-foreground focus-visible:ring-2 focus-visible:ring-amber-300/70">Retry</button></div> : visiblePulseCards.length ? (
            <div className="fusion-pulse-card-grid">
              {visiblePulseCards.slice(0, 6).map((card, index) => (
                <LiosPulseStoryCard
                  key={card.id}
                  card={card}
                  channel={pulseChannel}
                  featured={index === 0}
                  onAsk={(question) => onAskLios ? onAskLios(question) : onOpen("agent", "current", card.symbol ?? activeSymbol)}
                  onOpenSymbol={(symbol) => onOpen("quote", "current", symbol)}
                  changedSinceReview={card.clusteredCardIds.some(id => changedSourceCardIds.has(id))}
                  followed={Boolean(normalizePulseSubjectKey(card.subjectKey ?? card.symbol) && pulsePreferences.followed.includes(normalizePulseSubjectKey(card.subjectKey ?? card.symbol)!))}
                  preferencePending={preferencePending}
                  onPreferenceChange={onPulsePreferenceChange}
                />
              ))}
            </div>
          ) : <FusionEmptyState>{pulseChannel === "following" ? "No followed-source updates are available. Follow a subject from For You or your existing watchlist." : "No unmuted source-backed stories are currently available."}</FusionEmptyState>}
        </FusionSection>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/35 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-ui text-sm font-semibold text-foreground">Market analytics</h2>
            <p className="mt-1 font-ui text-xs leading-5 text-muted-foreground">Live provider-dependent market breadth, quotes and macro data. Separate from your recorded discovery feed.</p>
          </div>
          <button type="button" onClick={toggleMarketDesk}
            aria-expanded={showMarketDesk} aria-controls={marketDeskId}
            className="min-h-11 rounded-lg border border-border/70 px-3 py-2 font-ui text-sm font-medium text-foreground hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300">
            {showMarketDesk ? "Hide market analytics" : "Explore market analytics"}
          </button>
        </div>
        {showMarketDesk && <div id={marketDeskId} aria-label="Market analytics detail" className="mt-3 space-y-3">
        <MarketStateHero breadth={breadth} sentiment={sentiment} gainers={gainers} losers={losers} onOpen={onOpen} />

        <FusionMarketCanvas breadth={breadth} gainers={gainers} losers={losers} onOpen={onOpen} />

        <FusionMetricGrid>
          <FusionMetric label="MARKET SENTIMENT" value={sentiment?.sentiment?.toUpperCase() ?? "—"} secondary={sentiment ? `SCORE ${sentiment.score}` : "No live sentiment"} tone={sentiment?.sentiment === "Bullish" ? "positive" : sentiment?.sentiment === "Bearish" ? "negative" : "neutral"} />
          <FusionMetric label="ADVANCING" value={advancePct == null ? "—" : `${advancePct.toFixed(1)}%`} secondary={latestBreadth ? `${latestBreadth.advances} of ${breadthTotal}` : "Breadth unavailable"} tone={toneForChange((advancePct ?? 50) - 50)} />
          <FusionMetric label="NEW HIGHS / LOWS" value={latestBreadth ? `${latestBreadth.newHighs} / ${latestBreadth.newLows}` : "—"} secondary={latestBreadth?.date ?? "No breadth date"} tone={latestBreadth ? toneForChange(latestBreadth.newHighs - latestBreadth.newLows) : "neutral"} />
          <FusionMetric label="ACTIVE MONITORS" value={monitoringCount} secondary="Rules watching for change" tone={monitoringCount > 0 ? "accent" : "neutral"} onClick={() => onOpen("alerts", "current")} />
          <FusionMetric label="ACTION INBOX" value={inboxCount} secondary="Items requiring attention" tone={inboxCount > 0 ? "warning" : "neutral"} onClick={() => onOpen("alerts", "current")} />
          <FusionMetric label="ACTIVE OBJECT" value={activeSymbol ?? "GLOBAL"} secondary={activeSymbol ? "Continue current research" : "Select a security"} tone="accent" onClick={() => activeSymbol && onOpen("entity", "current", activeSymbol)} />
        </FusionMetricGrid>

        <div className="fusion-dashboard-grid mt-3">
          <FusionSection title="Market Movers" eyebrow="PRICE ACTION" action={<FusionActionButton onClick={() => onOpen("market", "current")}>OPEN MARKET</FusionActionButton>}>
            <div className="grid min-h-0 gap-px bg-border/60 lg:grid-cols-2">
              <div className="bg-[#080909]">
                <div className="fusion-subheader text-up">GAINERS</div>
                {gainersLoading ? <FusionEmptyState>Loading gainers…</FusionEmptyState> : gainers.length ? gainers.slice(0, 6).map((quote) => <QuoteRow key={quote.symbol} quote={quote} onOpen={onOpen} />) : <FusionEmptyState>No live gainers available.</FusionEmptyState>}
              </div>
              <div className="bg-[#080909]">
                <div className="fusion-subheader text-down">LOSERS</div>
                {losersLoading ? <FusionEmptyState>Loading losers…</FusionEmptyState> : losers.length ? losers.slice(0, 6).map((quote) => <QuoteRow key={quote.symbol} quote={quote} onOpen={onOpen} />) : <FusionEmptyState>No live losers available.</FusionEmptyState>}
              </div>
            </div>
          </FusionSection>

          <FusionSection title="Macro Pulse" eyebrow="GROWTH · INFLATION · RATES" action={<FusionActionButton onClick={() => onOpen("macrodashboard", "current")}>OPEN MACRO</FusionActionButton>}>
            {macroLoading ? <FusionEmptyState>Loading macro indicators…</FusionEmptyState> : indicators.length ? (
              <div className="space-y-1 p-2">
                {indicators.slice(0, 8).map((indicator) => (
                  <FusionDataBar
                    key={indicator.seriesId}
                    label={indicator.name}
                    value={indicator.changePercent}
                    max={maxMacroMove}
                    valueLabel={<>{indicator.value == null ? "—" : `${indicator.value.toFixed(2)}${indicator.unit === "%" ? "%" : ""}`} <span className={pctClass(indicator.changePercent ?? 0)}>{indicator.changePercent == null ? "" : `${indicator.changePercent >= 0 ? "+" : ""}${indicator.changePercent.toFixed(2)}%`}</span></>}
                    tone={toneForChange(indicator.changePercent)}
                  />
                ))}
              </div>
            ) : <FusionEmptyState>Connect a macro source to populate the pulse.</FusionEmptyState>}
          </FusionSection>

          <FusionSection title="Research Continuity" eyebrow="YOUR DESK">
            <div className="grid gap-px bg-border/60 sm:grid-cols-2 lg:grid-cols-1">
              <button onClick={() => activeSymbol ? onOpen("entity", "current", activeSymbol) : onOpen("screener", "current")} className="fusion-continuity-card">
                <Activity className="h-3.5 w-3.5 text-amber-300" />
                <span><strong>{activeSymbol ? `Continue ${activeSymbol}` : "Start company research"}</strong><small>{activeSymbol ? "Return to the active object workspace" : "Discover a company from the universe"}</small></span>
              </button>
              <button onClick={() => onOpen("portfolio", "current")} className="fusion-continuity-card">
                <BriefcaseBusiness className="h-3.5 w-3.5 text-cyan-300" />
                <span><strong>Portfolio</strong><small>Holdings, performance and client-safe analytics</small></span>
              </button>
              <button onClick={() => onOpen("screener", "current")} className="fusion-continuity-card">
                <Gauge className="h-3.5 w-3.5 text-cyan-300" />
                <span><strong>Screen the universe</strong><small>Move from market context to candidates</small></span>
              </button>
              <button onClick={() => onOpen("macrodashboard", "current")} className="fusion-continuity-card">
                <Landmark className="h-3.5 w-3.5 text-cyan-300" />
                <span><strong>Macro</strong><small>Rates, inflation, growth and policy context</small></span>
              </button>
            </div>
            {(recents.length > 0 || favorites.length > 0) && (
              <div className="border-t border-border/60 p-2">
                <div className="fusion-subheader px-0">RECENT / FAVORITE</div>
                <div className="flex flex-wrap gap-1.5">
                  {recents.slice(0, 3).map((recent) => <button key={recent.key} onClick={() => onOpen(recent.view, "current", recent.symbol)} className="fusion-chip">{recent.symbol ? `${recent.symbol} · ` : ""}{getTerminalCapability(recent.view).shortLabel}</button>)}
                  {favorites.slice(0, 3).map((view) => <button key={view} onClick={() => onOpen(view, "current", activeSymbol)} className="fusion-chip"><Star className="mr-1 inline h-2.5 w-2.5" />{getTerminalCapability(view).shortLabel}</button>)}
                </div>
              </div>
            )}
          </FusionSection>
        </div>


        </div>}
      </div>
    </section>
  );
}
