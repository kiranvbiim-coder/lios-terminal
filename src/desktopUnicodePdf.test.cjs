"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeUnicodePdfPayload, buildUnicodeReportHtml } = require("./desktopUnicodePdf.cjs");

const payload = {
  artifactId: "artifact:owner-report", version: 3,
  contentHash: "a".repeat(64), filename: "Tamil-Report-v3.pdf",
  paragraphs: [
    { text: "தமிழ் ஆய்வு அறிக்கை", style: "title" },
    { text: "ஆய்வு முடிவுகள் – ₹450", style: "body" },
    { text: "Hindi: हिंदी परीक्षण", style: "quote" },
    { text: "source:permitted:8", style: "meta" },
  ],
};

test("Unicode printer retains original Tamil/Devanagari and canonical source text", () => {
  const input = normalizeUnicodePdfPayload(payload);
  assert.deepEqual(input.paragraphs, payload.paragraphs);
  const html = buildUnicodeReportHtml(input);
  assert.match(html, /தமிழ் ஆய்வு அறிக்கை/);
  assert.match(html, /ஆய்வு முடிவுகள் – ₹450/);
  assert.match(html, /हिंदी परीक्षण/);
  assert.match(html, /source:permitted:8/);
  assert.match(html, /Noto Sans Tamil/);
  assert.match(html, /Nirmala UI/);
  assert.match(html, /Tamil Sangam MN/);
  assert.match(html, /@page\{size:A4/);
  assert.match(html, /script-src &#39;none&#39;/);
  assert.doesNotMatch(html, /https:\/\/fonts\./);
});

test("Publisher escapes stored user content and never turns it into executable HTML", () => {
  const text = '<script src="https://evil.invalid/x"></script>&<img src=x onerror=alert(1)>';
  const html = buildUnicodeReportHtml({ ...payload, paragraphs: [
    { style: "quote", text },
    { style: "meta", text: "Evidence < private >" },
  ] });
  assert.doesNotMatch(html, /<script|<img\s/i);
  assert.match(html, /&lt;script src=&quot;https:\/\/evil\.invalid\/x&quot;&gt;/);
  assert.match(html, /Evidence &lt; private &gt;/);
});

test("Publishing boundary rejects oversized, forged and traversal payloads", () => {
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, contentHash: "forged" }), /exact saved/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, version: 0 }), /exact saved/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, filename: "../evil.pdf" }), /Unsafe/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, filename: "bad\r\n.pdf" }), /Unsafe/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, paragraphs: [] }), /paragraph count/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, paragraphs: [
    { style: "html", text: "<iframe />" },
  ] }), /Invalid Unicode PDF paragraph/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, paragraphs: [
    { style: "body", text: "x".repeat(100_001) },
  ] }), /text budget/);
  assert.throws(() => normalizeUnicodePdfPayload({ ...payload, paragraphs:
    Array.from({ length: 4_001 }, () => ({ text: "x", style: "body" })),
  }), /paragraph count/);
});
