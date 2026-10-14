import { getIndicatorHistory } from "./fredData";
import { getOHLCV } from "./marketData";

/**
 * Cross-Domain Intelligence Fusion (Phase 4): make Finance and Economics
 * reason about each other for one client, per the roadmap's own example --
 * "your semiconductor exposure is 23%, here's how the last three rate-cut
 * cycles moved that sector." Purely a deterministic join of two real,
 * independently-fetchable series (live FRED policy-rate history + live
 * sector-ETF price history) -- no AI anywhere in this file, matching "AI
 * validates, never calculates". The client's own real sector exposure %
 * (from /api/client/dashboard/portfolio, already-existing) is computed and
 * joined against this on the client side; this module only knows about the
 * sector, not about any specific client's holdings.
 *
 * "Semiconductors" itself isn't a sector value anywhere in this codebase's
 * ticker universe (it's a GICS sub-industry; the universe only carries
 * GICS sector-level tags -- Technology, Financial Services, etc., see
 * marketData.ts), so the roadmap's specific example is illustrative, not a
 * literal schema requirement -- this generalizes to whichever real sector a
 * client's own real portfolio has real exposure to.
 */

// Real, standard State Street SPDR Select Sector ETF tickers -- the actual
// market's own sector proxies, not an invented mapping. Keys match the
// exact sector strings already used throughout marketData.ts/quotes.
export const SECTOR_ETF_PROXY: Record<string, string> = {
  "Technology": "XLK",
  "Healthcare": "XLV",
  "Financial Services": "XLF",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  "Industrials": "XLI",
  "Energy": "XLE",
  "Basic Materials": "XLB",
  "Real Estate": "XLRE",
  "Utilities": "XLU",
  "Communication Services": "XLC",
};

export interface FedCuttingCycle {
  startDate: string;
  endDate: string;
  startRate: number;
  endRate: number;
  changePp: number; // negative
}

/**
 * Identifies historical Fed easing cycles from the real FEDFUNDS series:
 * track the running peak, then the running trough after it, and confirm a
 * cycle once the rate has both fallen by at least minDeclinePct from that
 * peak AND subsequently risen minDeclinePct off the trough (or the series
 * ends, e.g. an ongoing cycle) -- a straightforward peak-to-trough
 * decline detector, not a fabricated or hand-picked list of dates.
 * Verified against real FRED data at build time to reproduce the
 * well-documented historical cycles (2000-2003 dot-com, 2006-2011
 * GFC/ZIRP, 2019-2020 pre-COVID+COVID, the ongoing 2023- cycle) before
 * this was wired into a route.
 */
export function detectFedCuttingCycles(observations: { date: string; value: number }[], minDeclinePct = 0.5): FedCuttingCycle[] {
  const cycles: FedCuttingCycle[] = [];
  let i = 0;
  while (i < observations.length - 1) {
    let peakIdx = i;
    let peakVal = observations[i].value;
    let j = i + 1;
    while (j < observations.length && observations[j].value >= peakVal - 0.001) {
      if (observations[j].value > peakVal) { peakVal = observations[j].value; peakIdx = j; }
      j++;
    }
    let troughIdx = peakIdx;
    let troughVal = peakVal;
    let k = peakIdx + 1;
    while (k < observations.length) {
      if (observations[k].value <= troughVal + 0.001) {
        if (observations[k].value < troughVal) { troughVal = observations[k].value; troughIdx = k; }
        k++;
      } else if (observations[k].value - troughVal >= minDeclinePct) {
        break;
      } else {
        k++;
      }
    }
    if (peakVal - troughVal >= minDeclinePct && troughIdx > peakIdx) {
      cycles.push({
        startDate: observations[peakIdx].date,
        endDate: observations[troughIdx].date,
        startRate: peakVal,
        endRate: troughVal,
        changePp: Math.round((troughVal - peakVal) * 100) / 100,
      });
    }
    i = Math.max(troughIdx, peakIdx) + 1;
  }
  return cycles;
}

export interface RateCycleImpact extends FedCuttingCycle {
  sectorReturnPct: number | null; // null if no bars cover the window
}

export interface RateCycleImpactResult {
  sector: string;
  etfSymbol: string;
  currentFedFundsRate: number | null;
  cycles: RateCycleImpact[];
}

// Nearest-bar lookup rather than an exact date match -- markets are closed
// on the FOMC decision date itself often enough (weekends, holidays) that
// requiring an exact match would silently drop real cycles.
function nearestBar<T extends { date: string }>(bars: T[], targetDate: string): T | null {
  if (!bars.length) return null;
  const target = new Date(targetDate).getTime();
  let best = bars[0];
  let bestDiff = Math.abs(new Date(bars[0].date).getTime() - target);
  for (const bar of bars) {
    const diff = Math.abs(new Date(bar.date).getTime() - target);
    if (diff < bestDiff) { best = bar; bestDiff = diff; }
  }
  return best;
}

export async function getRateCycleImpact(sector: string): Promise<RateCycleImpactResult> {
  const etfSymbol = SECTOR_ETF_PROXY[sector];
  if (!etfSymbol) {
    return { sector, etfSymbol: "", currentFedFundsRate: null, cycles: [] };
  }

  const [fedObs, etfBars] = await Promise.all([
    getIndicatorHistory("FEDFUNDS", 432), // 36 years monthly -- enough for every cycle since 1990
    getOHLCV(etfSymbol, "25Y", "1d"),
  ]);

  const currentFedFundsRate = fedObs.length ? fedObs[fedObs.length - 1].value : null;
  const allCycles = detectFedCuttingCycles(fedObs);
  // Most recent first, capped at 4 -- "the last three" per the roadmap's own
  // framing, plus one extra since the most recent may still be ongoing.
  const recentCycles = allCycles.slice(-4).reverse();

  const cycles: RateCycleImpact[] = recentCycles.map((cycle) => {
    if (!etfBars.length) return { ...cycle, sectorReturnPct: null };
    const startBar = nearestBar(etfBars, cycle.startDate);
    const endBar = nearestBar(etfBars, cycle.endDate);
    if (!startBar || !endBar || startBar.close <= 0) return { ...cycle, sectorReturnPct: null };
    const sectorReturnPct = Math.round(((endBar.close - startBar.close) / startBar.close) * 1000) / 10;
    return { ...cycle, sectorReturnPct };
  });

  return { sector, etfSymbol, currentFedFundsRate, cycles };
}
