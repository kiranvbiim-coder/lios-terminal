import assert from "node:assert/strict";
import test from "node:test";
import { formatTenorLabel, parseTenorYears } from "./bondTenor";

test("parseTenorYears reads standard vendor tenor codes", () => {
  assert.equal(parseTenorYears("US10Y"), 10);
  assert.equal(parseTenorYears("DE2Y"), 2);
  assert.equal(parseTenorYears("UK3M"), 0.25);
  assert.equal(parseTenorYears("JP30Y"), 30);
  assert.equal(parseTenorYears("United States 10-Year"), 10);
  assert.equal(parseTenorYears("Germany 6 Month"), 0.5);
  assert.ok(Math.abs((parseTenorYears("IN1W") ?? 0) - 7 / 365) < 1e-9);
});

test("parseTenorYears rejects ambiguous or non-tenor text", () => {
  assert.equal(parseTenorYears(""), null);
  assert.equal(parseTenorYears(null), null);
  assert.equal(parseTenorYears(undefined), null);
  assert.equal(parseTenorYears("United States"), null);
  assert.equal(parseTenorYears("GDP Growth Rate"), null);
  assert.equal(parseTenorYears("Fund XY2024"), null);
});

test("formatTenorLabel round-trips common tenors", () => {
  assert.equal(formatTenorLabel(10), "10Y");
  assert.equal(formatTenorLabel(0.25), "3M");
  assert.equal(formatTenorLabel(1 / 12), "1M");
  assert.equal(formatTenorLabel(7 / 365), "7D");
});
