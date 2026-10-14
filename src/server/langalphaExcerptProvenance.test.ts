import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { fingerprintRecordedExcerpt, matchesRecordedExcerptFingerprint } from "./langalphaExcerptProvenance";

test("LangAlpha SHA-256 fingerprint binds exact quote UTF-8 bytes", () => {
  const quote = "Market insight ₹ café 😃";
  const observed = fingerprintRecordedExcerpt(quote);
  const bytes = Buffer.from(quote, "utf8");
  assert.equal(observed.excerptSha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.equal(observed.excerptByteLength, bytes.length);
  assert.notEqual(observed.excerptByteLength, quote.length);
  assert.equal(matchesRecordedExcerptFingerprint(quote, observed), true);
});

test("changed text, whitespace and same-byte-length substitution are detected", () => {
  const sample = "Evidence source A";
  const signed = fingerprintRecordedExcerpt(sample);
  for (const changed of ["Evidence source B", sample + " ", sample.toLowerCase()]) {
    assert.equal(matchesRecordedExcerptFingerprint(changed, signed), false);
  }
  assert.equal(matchesRecordedExcerptFingerprint(sample, { ...signed, excerptSha256:"0".repeat(64) }),false);
  assert.equal(matchesRecordedExcerptFingerprint(sample, { ...signed, excerptByteLength:signed.excerptByteLength + 1 }),false);
});

test("missing/untrusted metadata fails closed, no source truth or rights assertion", () => {
  const quote = "Quoted untrusted source";
  for(const meta of [null, {}, {excerptSha256:"bad",excerptByteLength:12},
    {...fingerprintRecordedExcerpt(quote),verified:true}, {excerptSha256:"f".repeat(64),excerptByteLength:-1}]) {
    assert.equal(matchesRecordedExcerptFingerprint(quote, meta),false);
  }
});

test("65 KiB excerpt cannot bypass fixed donor provenance budget", () => {
  assert.throws(()=>fingerprintRecordedExcerpt("x".repeat(65*1024)),/64 KiB/);
  assert.equal(matchesRecordedExcerptFingerprint("x".repeat(65*1024),{
    excerptSha256: "0".repeat(64),excerptByteLength:64*1024
  }),false);
});
