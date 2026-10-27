import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { RecordedContextPicture } from "./RecordedContextPicture";

test("private card renders no remote context discovery control or image", () => {
  const html = renderToStaticMarkup(createElement(RecordedContextPicture, {
    title: "Private acquisition target valuations", hasPublicEvidence: false,
  }));
  assert.doesNotMatch(html, /Commons|<img\b|upload\.wikimedia\.org|Find context/);
});

test("publicly sourced card requires a real person click before any metadata or image request", () => {
  const html = renderToStaticMarkup(createElement(RecordedContextPicture, {
    title: "Solar energy report", hasPublicEvidence: true,
  }));
  assert.match(html, /Find context picture/);
  assert.match(html, /after your click/);
  assert.doesNotMatch(html, /<img\b|upload\.wikimedia\.org|<iframe/);
  const source = readFileSync(new URL("./RecordedContextPicture.tsx", import.meta.url), "utf8");
  assert.match(source, /const load = async \(\) =>/);
  assert.match(source, /signal: abort\.signal/);
  assert.match(source, /chooseAutomaticContextImage\(payload, term\)/);
  assert.doesNotMatch(source, /autoPlay|setInterval/);
});

test("original Visual Search and Pulse cards reuse one opt-in context preview", () => {
  const search = readFileSync(new URL("./VisualIntelligenceSearch.tsx", import.meta.url), "utf8");
  const pulse = readFileSync(new URL("./LiosPulseStoryCard.tsx", import.meta.url), "utf8");
  assert.match(search, /<RecordedContextPicture title=\{card\.title\}/);
  assert.match(pulse, /<RecordedContextPicture title=\{card\.title\}/);
});
