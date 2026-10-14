import assert from "node:assert/strict";
import test from "node:test";
import {
  findCountry,
  findExchange,
  matchesCountry,
  matchesExchange,
  resolveMarketMetadata,
  type MarketGeography,
  type MarketVenue,
} from "@shared/globalMarketMaster";

const US: MarketGeography = { code: "US", name: "United States", region: "Americas", currencyCode: "USD", aliases: ["USA", "United States of America"] };
const IN: MarketGeography = { code: "IN", name: "India", region: "Asia-Pacific", currencyCode: "INR", aliases: ["Bharat"] };
const COUNTRIES = [US, IN];

const NASDAQ: MarketVenue = { mic: "XNAS", operatingMic: null, name: "Nasdaq", countryCode: "US", currencyCode: "USD", timezone: "America/New_York", aliases: ["NASDAQ", "Nasdaq Stock Market"], active: true };
const NSE: MarketVenue = { mic: "XNSE", operatingMic: null, name: "National Stock Exchange of India", countryCode: "IN", currencyCode: "INR", timezone: "Asia/Kolkata", aliases: ["NSE"], active: true };
const EXCHANGES = [NASDAQ, NSE];

test("matchesCountry accepts code, canonical name, and alias, case/whitespace-insensitively", () => {
  assert.equal(matchesCountry(US, "US"), true);
  assert.equal(matchesCountry(US, "us"), true);
  assert.equal(matchesCountry(US, " United States "), true);
  assert.equal(matchesCountry(US, "USA"), true);
  assert.equal(matchesCountry(US, "IN"), false);
  assert.equal(matchesCountry(US, "United"), false, "prefix matches are deliberately rejected for geography");
});

test("findCountry returns null instead of guessing on an unknown input", () => {
  assert.equal(findCountry(COUNTRIES, "US"), US);
  assert.equal(findCountry(COUNTRIES, "Bharat"), IN);
  assert.equal(findCountry(COUNTRIES, "Atlantis"), null);
});

test("matchesExchange accepts MIC, name, and alias including common short names", () => {
  assert.equal(matchesExchange(NASDAQ, "XNAS"), true);
  assert.equal(matchesExchange(NASDAQ, "NASDAQ"), true);
  assert.equal(matchesExchange(NSE, "NSE"), true, "existing free-text companyListings.exchange values like NSE must resolve");
  assert.equal(matchesExchange(NASDAQ, "XNYS"), false);
});

test("matchesExchange falls back to operatingMic for a segment MIC lookup", () => {
  const segment: MarketVenue = { ...NASDAQ, mic: "XNGS", operatingMic: "XNAS", name: "Nasdaq Global Select" };
  assert.equal(matchesExchange(segment, "XNAS"), true);
});

test("findExchange returns null instead of guessing on an unknown venue", () => {
  assert.equal(findExchange(EXCHANGES, "BSE"), null, "BSE is not seeded in this fixture, so it must not silently match NSE");
});

test("resolveMarketMetadata resolves both sides of an existing free-text listing pair", () => {
  const result = resolveMarketMetadata(COUNTRIES, EXCHANGES, { country: "IN", exchange: "NSE" });
  assert.equal(result.fullyResolved, true);
  assert.equal(result.country, IN);
  assert.equal(result.exchange, NSE);
  assert.equal(result.countryExchangeMismatch, false);
});

test("resolveMarketMetadata reports partial resolution without claiming the instrument itself is missing", () => {
  const result = resolveMarketMetadata(COUNTRIES, EXCHANGES, { country: "IN", exchange: "BSE" });
  assert.equal(result.fullyResolved, false);
  assert.equal(result.country, IN);
  assert.equal(result.exchange, null);
  assert.equal(result.countryExchangeMismatch, false, "an unresolved exchange is not the same fact as a country/exchange mismatch");
});

test("resolveMarketMetadata flags a resolved exchange whose seeded country contradicts the supplied country", () => {
  const result = resolveMarketMetadata(COUNTRIES, EXCHANGES, { country: "US", exchange: "NSE" });
  assert.equal(result.countryExchangeMismatch, true);
  assert.equal(result.fullyResolved, false);
});

test("resolveMarketMetadata with no inputs is trivially fully resolved", () => {
  const result = resolveMarketMetadata(COUNTRIES, EXCHANGES, {});
  assert.equal(result.fullyResolved, true);
  assert.equal(result.country, null);
  assert.equal(result.exchange, null);
});
