import assert from "node:assert/strict";
import test from "node:test";
import { adaptLegacySymbolCatalogRow, resolveInstrumentLocal } from "@shared/globalInstrumentMaster";
import { resolveConversationInstrument } from "./conversationInstrumentResolution";

const catalog = [
  adaptLegacySymbolCatalogRow({ symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ" }),
  adaptLegacySymbolCatalogRow({ symbol: "APLE", name: "Apple Hospitality Reit, Inc.", exchange: "NYSE" }),
  adaptLegacySymbolCatalogRow({ symbol: "MSFT", name: "Microsoft Corp", exchange: "NASDAQ" }),
];
const resolve = async (query: Parameters<typeof resolveInstrumentLocal>[0]) => resolveInstrumentLocal(query, catalog);

test("a company name mistaken for a ticker still resolves by name", async () => {
  const result = await resolveConversationInstrument({ symbol: "APPLE", name: "" }, resolve);
  assert.equal(result.match?.symbol, "AAPL");
});

test("a real ticker resolves as a ticker, lowercase or not", async () => {
  assert.equal((await resolveConversationInstrument({ symbol: "msft" }, resolve)).match?.symbol, "MSFT");
});

test("unknown text is not found and never invented", async () => {
  const result = await resolveConversationInstrument({ symbol: "ZZQXV" }, resolve);
  assert.equal(result.match, null);
  assert.equal(result.status, "not_found");
});

test("name-only input resolves by name; empty input is rejected", async () => {
  assert.equal((await resolveConversationInstrument({ name: "Microsoft" }, resolve)).match?.symbol, "MSFT");
  await assert.rejects(() => resolveConversationInstrument({}, resolve));
});
