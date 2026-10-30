import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
});

