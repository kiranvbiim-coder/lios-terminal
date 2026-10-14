import test from "node:test";
import assert from "node:assert/strict";
import { buildEventOwnershipTimeline, classifyOwnershipTransaction } from "./eventOwnershipImpact";

test("classifies open-market Form 4 purchase and sale without causal inference", () => {
  assert.deepEqual(classifyOwnershipTransaction({ code: "P", codeLabel: "Open market purchase", isOpenMarket: true, acquiredDisposed: "A", isDerivative: false }), ["open_market_buy", "ownership_change"]);
  assert.deepEqual(classifyOwnershipTransaction({ code: "S", codeLabel: "Open market sale", isOpenMarket: true, acquiredDisposed: "D", isDerivative: false }), ["open_market_sell", "ownership_change"]);
});

test("distinguishes derivative and non-market ownership changes", () => {
  const flags = classifyOwnershipTransaction({ code: "M", codeLabel: "Option exercise", isOpenMarket: false, acquiredDisposed: "A", isDerivative: true });
  assert.deepEqual(flags, ["ownership_change", "derivative_transaction"]);
  assert.deepEqual(classifyOwnershipTransaction({ code: "A", codeLabel: "Grant", isOpenMarket: false, acquiredDisposed: null, isDerivative: false }), []);
});

test("builds deterministic chronology, category mapping, and honest paging", () => {
  const timeline = buildEventOwnershipTimeline({
    ticker: "ACME",
    secInsiders: [{ symbol: "ACME", issuerName: "Acme", filerName: "Director", filerTitle: "Director", isDirector: true, isOfficer: false, isTenPercentOwner: false, transactionDate: "2025-03-05", transactionCode: "P", transactionCodeLabel: "Open market purchase", isOpenMarket: true, securityTitle: "Common stock", isDerivative: false, shares: 10, pricePerShare: 4, value: 40, acquiredDisposed: "A", sharesOwnedAfter: 10, accessionNumber: "0001", filingUrl: "https://sec.example/0001" }],
    secFilings: [{ formType: "8-K", filedDate: "2025-03-04", accessionNumber: "0002", filingUrl: "https://sec.example/0002" }],
    dividends: [{ symbol: "ACME", effective_date: "2025-03-01", declaration_date: null, record_date: null, payment_date: null, dividend_amount: 0.2, currency: "USD", frequency: "quarterly" }],
    from: "2025-03-01",
    to: "2025-03-31",
    page: 1,
    limit: 2,
  });
  assert.equal(timeline.total, 3);
  assert.equal(timeline.rows.length, 2);
  assert.equal(timeline.rows[0].flags.includes("open_market_buy"), true);
  assert.deepEqual(timeline.rows[0].categories, ["ownership", "governance"]);
  assert.equal(timeline.hasMore, true);
});

test("rejects reversed ranges and omits invalid-dated rows", () => {
  assert.throws(() => buildEventOwnershipTimeline({ ticker: "ACME", from: "2025-04-01", to: "2025-03-01" }), /on or before/);
  const timeline = buildEventOwnershipTimeline({ ticker: "ACME", secFilings: [{ formType: "8-K", filedDate: "not-a-date", accessionNumber: "bad", filingUrl: "https://sec.example/bad" }] });
  assert.equal(timeline.total, 0);
});
