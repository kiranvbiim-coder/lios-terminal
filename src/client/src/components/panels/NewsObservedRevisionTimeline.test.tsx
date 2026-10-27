import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import * as ts from "typescript";
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
  assert.match(news, /OptionalTimelineBoundary key=\{exactUrl\}/);
});

test("multiple related source headlines can offer a distinct chronology without merging publishers", () => {
  const history = observeNewsFeed([], [item], at);
  const coverage = [
    { ...item, title: "Solar battery innovation expands factories" },
    { ...item, url: "https://other.example/story/solar", title: "Solar battery innovation attracts investment",
      source: "Independent source", publishedAt: "2026-10-27T10:00:00Z" },
    { ...item, url: "https://third.example/story/solar", title: "Solar battery innovation gains new capacity",
      source: "Third publisher", publishedAt: "2026-10-27T11:00:00Z" },
  ];
  const html = renderToStaticMarkup(React.createElement(NewsStoryEvolution, {
    exactUrl: url, history, coverage,
  }));
  assert.match(html, /Explore publication timeline/);
  assert.match(html, /not proof that they report the same event/);
  assert.match(html, /Independent source/);
  assert.match(html, /Third publisher/);
  assert.doesNotMatch(html, /data-testid="news-beui-related-timeline"/);
  const adapter = source("./NewsObservedRevisionTimeline.tsx");
  assert.match(adapter, /export function RelatedPublisherTimeline/);
  assert.match(adapter, /date: item.publishedAt/);
  assert.match(adapter, /Separate publisher feed item/);
  assert.match(adapter, /may describe different events/);
});

test("pinned MIT donor timeline preserves exact registered source and parses as TSX", () => {
  const upstream = source("../vendor/beui/BeuiTimeline.tsx");
  const registry = JSON.parse(source("../../../../../third_party/components.json"));
  const lock = JSON.parse(source("../../../../../third_party/upstream-lock.json"));
  const component = registry.components.find((entry: { id: string }) => entry.id === "beui-news-observation-timeline");
  const pin = lock.locks.find((entry: { id: string }) => entry.id === "beui-news-observation-timeline");
  assert.ok(component);
  assert.ok(pin);
  assert.equal(component.repository, "starc007/ui-components");
  assert.equal(component.commitSha, "601fa21a2b68cfa5f6c1f0b6dcb29528c32472a1");
  assert.equal(component.commitSha, pin.commitSha);
  assert.equal(component.license, "MIT");
  assert.equal(component.bundled, true);
  assert.equal(pin.license, "MIT");
  assert.match(upstream, /49eac72ab9237b48c4eaa7fc106f7e162137657a/);
  assert.doesNotMatch(upstream, /from "motion\/react"|import.+@\/lib\/touch/);
  const result = ts.transpileModule(upstream, {
    fileName: "BeuiTimeline.tsx",
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  });
  const problems = (result.diagnostics ?? []).filter(x => x.category === ts.DiagnosticCategory.Error);
  assert.deepEqual(problems.map(p => ts.flattenDiagnosticMessageText(p.messageText, " ")), []);
});
