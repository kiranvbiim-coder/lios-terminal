import assert from "node:assert/strict";
import test from "node:test";
import { resolveInstrumentQuerySchema, searchInstrumentsQuerySchema } from "./globalInstrumentMasterRoutes";

test("the resolve query schema requires at least a name, ticker, or identifier pair", () => {
  const empty = resolveInstrumentQuerySchema.safeParse({});
  assert.equal(empty.success, false);

  const micOnly = resolveInstrumentQuerySchema.safeParse({ mic: "XNAS" });
  assert.equal(micOnly.success, false, "a scoping field alone without a name/ticker/identifier must not pass");

  const byTicker = resolveInstrumentQuerySchema.safeParse({ ticker: "AAPL" });
  assert.equal(byTicker.success, true);

  const byIdentifierPair = resolveInstrumentQuerySchema.safeParse({ identifierType: "isin", identifierValue: "US0378331005" });
  assert.equal(byIdentifierPair.success, true);

  const identifierTypeWithoutValue = resolveInstrumentQuerySchema.safeParse({ identifierType: "isin" });
  assert.equal(identifierTypeWithoutValue.success, false, "an identifier type without a value is not a usable lookup");
});

test("the resolve query schema rejects an unknown identifier type", () => {
  const parsed = resolveInstrumentQuerySchema.safeParse({ identifierType: "not_a_real_type", identifierValue: "X" });
  assert.equal(parsed.success, false);
});

test("the search query schema requires a non-empty query string", () => {
  const empty = searchInstrumentsQuerySchema.safeParse({ q: "" });
  assert.equal(empty.success, false);

  const missing = searchInstrumentsQuerySchema.safeParse({});
  assert.equal(missing.success, false);

  const valid = searchInstrumentsQuerySchema.safeParse({ q: "AAPL" });
  assert.equal(valid.success, true);
});

test("the search query schema coerces and bounds the limit parameter", () => {
  const coerced = searchInstrumentsQuerySchema.safeParse({ q: "AAPL", limit: "10" });
  assert.equal(coerced.success, true);
  if (coerced.success) assert.equal(coerced.data.limit, 10);

  const tooLarge = searchInstrumentsQuerySchema.safeParse({ q: "AAPL", limit: "500" });
  assert.equal(tooLarge.success, false, "the limit must stay bounded so a caller cannot force an unbounded response");

  const negative = searchInstrumentsQuerySchema.safeParse({ q: "AAPL", limit: "-1" });
  assert.equal(negative.success, false);
});

test("the search query schema accepts the includeHistorical flag as an explicit string enum", () => {
  const valid = searchInstrumentsQuerySchema.safeParse({ q: "AAPL", includeHistorical: "true" });
  assert.equal(valid.success, true);

  const invalid = searchInstrumentsQuerySchema.safeParse({ q: "AAPL", includeHistorical: "yes" });
  assert.equal(invalid.success, false, "query-string booleans must be the literal 'true'/'false' strings, not free-form values");
});

test("LV4-04-13: the resolve query schema validates asOfDate as a real calendar date", () => {
  const valid = resolveInstrumentQuerySchema.safeParse({ ticker: "AAPL", asOfDate: "2015-06-30" });
  assert.equal(valid.success, true);

  const wrongShape = resolveInstrumentQuerySchema.safeParse({ ticker: "AAPL", asOfDate: "06/30/2015" });
  assert.equal(wrongShape.success, false, "only YYYY-MM-DD is accepted");

  const notARealDate = resolveInstrumentQuerySchema.safeParse({ ticker: "AAPL", asOfDate: "2015-13-40" });
  assert.equal(notARealDate.success, false, "a YYYY-MM-DD-shaped string must still be a real calendar date");
});

test("LV4-04-13: the search query schema validates asOfDate as a real calendar date", () => {
  const valid = searchInstrumentsQuerySchema.safeParse({ q: "AAPL", asOfDate: "2015-06-30" });
  assert.equal(valid.success, true);

  const invalid = searchInstrumentsQuerySchema.safeParse({ q: "AAPL", asOfDate: "not-a-date" });
  assert.equal(invalid.success, false);
});

test("LV4-04-13: the resolve query schema rejects a nonexistent day-of-month instead of silently rolling it forward", () => {
  // JS Date parsing normally turns "2015-02-30" into "2015-03-02" instead
  // of rejecting it -- a backtest caller must never silently get a
  // different date than the one requested.
  const feb30 = resolveInstrumentQuerySchema.safeParse({ ticker: "AAPL", asOfDate: "2015-02-30" });
  assert.equal(feb30.success, false, "February never has 30 days");

  const feb29NonLeap = resolveInstrumentQuerySchema.safeParse({ ticker: "AAPL", asOfDate: "2015-02-29" });
  assert.equal(feb29NonLeap.success, false, "2015 was not a leap year");

  const apr31 = resolveInstrumentQuerySchema.safeParse({ ticker: "AAPL", asOfDate: "2015-04-31" });
  assert.equal(apr31.success, false, "April only has 30 days");

  const feb29Leap = resolveInstrumentQuerySchema.safeParse({ ticker: "AAPL", asOfDate: "2016-02-29" });
  assert.equal(feb29Leap.success, true, "2016 was a real leap year -- a valid date must not be rejected");
});
