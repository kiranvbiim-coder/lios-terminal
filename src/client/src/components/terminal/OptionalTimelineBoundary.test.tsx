import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OptionalTimelineBoundary } from "./OptionalTimelineBoundary";

test("optional timeline boundary preserves its normal child output", () => {
  const html = renderToStaticMarkup(createElement(OptionalTimelineBoundary, null,
    createElement("p", null, "Original timeline preview")));
  assert.match(html, /Original timeline preview/);
});

test("optional timeline failure is isolated and never exposes exception details", () => {
  const boundary = new OptionalTimelineBoundary({ children: createElement("div", null, "hidden visual") });
  boundary.state = OptionalTimelineBoundary.getDerivedStateFromError();
  const html = renderToStaticMarkup(boundary.render());
  assert.match(html, /role="alert"/);
  assert.match(html, /Original recorded items and source history remain available/);
  assert.doesNotMatch(html, /hidden visual|Error:|stack trace/);
});

test("News and Watchroom only guard the optional visual, not their source/readthrough records", () => {
  const news = readFileSync(new URL("../panels/NewsStoryEvolution.tsx", import.meta.url), "utf8");
  const watch = readFileSync(new URL("./ProjectWatchroomDesk.tsx", import.meta.url), "utf8");
  const owner = readFileSync(new URL("./OptionalTimelineBoundary.tsx", import.meta.url), "utf8");
  assert.equal((news.match(/<OptionalTimelineBoundary/g) ?? []).length, 2);
  assert.equal((watch.match(/<OptionalTimelineBoundary/g) ?? []).length, 1);
  assert.match(news, /<ol className="mt-3 space-y-3/);
  assert.match(news, /Open publisher/);
  assert.match(watch, /data-testid="watchroom-recorded-run-strip"/);
  assert.match(watch, /Review workflow and history/);
  assert.doesNotMatch(owner, /componentDidCatch|console\.error|window\.location|new Date\(|fetch\(/);
});
