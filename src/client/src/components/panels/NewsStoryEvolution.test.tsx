import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NewsStoryEvolution } from "./NewsStoryEvolution";
import { observeNewsFeed } from "@/lib/newsStoryEvolution";

const url = "https://publisher.example/news/solar";
const input = { url, title: "Solar plan published", summary: "First recorded summary",
  source: "News agency", publishedAt: "2026-10-27T08:00:00Z" };
const firstSeen = Date.parse("2026-10-27T09:00:00Z");

test("single observed feed version is a baseline, never a fabricated editorial update", () => {
  const history = observeNewsFeed([], [input], firstSeen);
  const html = renderToStaticMarkup(React.createElement(NewsStoryEvolution, { exactUrl: url, history }));
  assert.match(html, /Story Evolution/);
  assert.match(html, /0 observed changes/);
  assert.match(html, /No revisions observed/);
  assert.doesNotMatch(html, /Inspect recorded changes/);
});

test("genuine fetched feed text revision has accessible observed-time disclosure", () => {
  const original = observeNewsFeed([], [input], firstSeen);
  const history = observeNewsFeed(original, [{ ...input, title: "Solar plan clarified",
    summary: "Updated published feed summary" }], firstSeen + 60_000);
  const html = renderToStaticMarkup(React.createElement(NewsStoryEvolution, { exactUrl: url, history }));
  assert.match(html, /1 observed change/);
  assert.match(html, /Inspect recorded changes/);
  assert.match(html, /<time dateTime="2026-10-27T09:01:00\.000Z"/);
  assert.match(html, /headline, summary/);
  assert.match(html, /not a complete publication history/);
  assert.match(html, /Solar plan clarified/);
});

test("unrelated articles cannot contribute false evolution entries", () => {
  const history = observeNewsFeed([], [{ ...input, url: "https://other.example/story" }], firstSeen);
  const html = renderToStaticMarkup(React.createElement(NewsStoryEvolution, { exactUrl: url, history }));
  assert.match(html, /0 observed changes/);
  assert.doesNotMatch(html, /other\.example/);
});
