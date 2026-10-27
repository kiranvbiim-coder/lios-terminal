import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { NewsStoryEvolution } from "./NewsStoryEvolution";
import { observeNewsFeed } from "@/lib/newsStoryEvolution";

const url = "https://publisher.example/story/published";
const item = { url, title: "Recorded energy report", summary: "First feed summary",
  source: "Publisher", publishedAt: "2026-10-27T08:00:00Z" };
const at = Date.parse("2026-10-27T09:00:00Z");
const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");

test("never create a timeline for a single feed baseline or another article URL", () => {
  const history = observeNewsFeed([], [item], at);
  const html = renderToStaticMarkup(React.createElement(NewsStoryEvolution, { exactUrl: url, history }));
  assert.match(html, /No revisions observed/);
  assert.doesNotMatch(html, /Explore visual timeline|data-testid="news-beui-recorded-timeline"/);
  const unrelated = renderToStaticMarkup(React.createElement(NewsStoryEvolution, {
    exactUrl: "https://other.example/first", history,
  }));
  assert.doesNotMatch(unrelated, /Explore visual timeline/);
});

test("source recorded revisions retain list, optional visual control and exact URL identity", () => {
  const first = observeNewsFeed([], [item], at);
  const history = observeNewsFeed(first, [{ ...item, title: "Recorded energy report clarified",
    summary: "Publisher feed summary revised" }], at + 60_000);
  const html = renderToStaticMarkup(React.createElement(NewsStoryEvolution, { exactUrl: url, history }));
  assert.match(html, /Explore visual timeline/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Recorded energy report clarified/);
  assert.doesNotMatch(html, /data-testid="news-beui-recorded-timeline"/);
  const timeline = source("./NewsObservedRevisionTimeline.tsx");
  assert.match(timeline, /\[\.\.\.versions\]\.reverse\(\)/);
  assert.match(timeline, /changedNewsFields\(ordered\[i - 1\], version\)/);
  assert.match(timeline, /date: version\.observedAt/);
  assert.match(timeline, /defaultValue=\{events\[events\.length - 1\]\.id\}/);
  assert.doesNotMatch(timeline, /fetch\(|Math\.random\(|new Date\(\)|onSelectRelated/);
});

test("real free MIT beUI source is wired to existing Framer Motion without a second library or global touch owner", () => {
  const beui = source("../vendor/beui/BeuiTimeline.tsx");
  const timeline = source("./NewsObservedRevisionTimeline.tsx");
  const news = source("./NewsStoryEvolution.tsx");
  assert.match(beui, /starc007\/ui-components/);
  assert.match(beui, /components\/motion\/timeline\.tsx/);
  assert.match(beui, /from "framer-motion"/);
  assert.match(beui, /onKeyDown=\{\(e\) => onKeyDown\(e, index\)\}/);
  assert.match(beui, /useReducedMotion/);
  assert.match(beui, /onPointerMove=\{onPointerMove\}/);
  assert.doesNotMatch(beui, /from "motion\/react"|from "@\/lib\/touch"/);
  assert.match(timeline, /Timeline as BeuiTimeline/);
  assert.match(news, /React\.lazy\(\(\) => import\("\.\/NewsObservedRevisionTimeline"\)\)/);
});
