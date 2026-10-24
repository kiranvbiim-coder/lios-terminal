import assert from 'node:assert/strict';
import test from 'node:test';
import { REVERSE_BODY, REVERSE_ROUTE, verifyReverseDcfResult } from './sp01_strict_python_valuation_contract.mjs';

test('approved deterministic reverse DCF fixture has fixed canonical route and inputs', () => {
  assert.equal(REVERSE_ROUTE, '/advanced/valuation/reverse-dcf');
  assert.equal(REVERSE_BODY.marketEquityValue, 100);
  assert.equal(REVERSE_BODY.waccPct, 10);
  assert.equal(REVERSE_BODY.solveFor, 'revenue_growth');
  assert.equal(Object.isFrozen(REVERSE_BODY), true);
});

test('actual result must reproduce independently known equity value and zero implied growth', () => {
  assert.doesNotThrow(() => verifyReverseDcfResult({ impliedRevenueGrowthPct: 0, repricedEquityValue: 100 }));
  assert.doesNotThrow(() => verifyReverseDcfResult({ impliedRevenueGrowthPct: 1e-9, repricedEquityValue: 100.000000001 }));
});

test('numeric smoke fails closed on wrong, missing, nonfinite or string-valued results', () => {
  for (const invalid of [null, undefined, [], 'good', {},
    { impliedRevenueGrowthPct: '0', repricedEquityValue: 100 },
    { impliedRevenueGrowthPct: 0, repricedEquityValue: '100' },
    { impliedRevenueGrowthPct: 0, repricedEquityValue: 99 },
    { impliedRevenueGrowthPct: 0.01, repricedEquityValue: 100 },
    { impliedRevenueGrowthPct: NaN, repricedEquityValue: 100 },
    { impliedRevenueGrowthPct: 0, repricedEquityValue: Infinity },
  ]) assert.throws(() => verifyReverseDcfResult(invalid));
});
