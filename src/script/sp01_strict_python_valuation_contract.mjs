/**
 * Independently check one known-value canonical P11 reverse-DCF fixture.
 *
 * This is an acceptance oracle, not a replacement financial engine or a donor.
 * Inputs match python-service/test_engine_worker.py and are NOT customer data.
 */
export const REVERSE_ROUTE = '/advanced/valuation/reverse-dcf';
export const REVERSE_BODY = Object.freeze({
  currentRevenue: 100,
  marketEquityValue: 100,
  years: 1,
  waccPct: 10,
  terminalGrowthPct: 0,
  ebitMarginPct: 20,
  taxRatePct: 0,
  reinvestmentPctOfRevenue: 10,
  solveFor: 'revenue_growth',
});

/** Invalid, missing or surprising numeric results fail the acceptance probe closed. */
export function verifyReverseDcfResult(result) {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Strict valuation worker returned no typed numerical result.');
  }
  for (const [field, expected] of [
    ['impliedRevenueGrowthPct', 0],
    ['repricedEquityValue', 100],
  ]) {
    const value = result[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value - expected) > 1e-7) {
      throw new Error(`Strict valuation worker failed independent ${field} result verification.`);
    }
  }
}
