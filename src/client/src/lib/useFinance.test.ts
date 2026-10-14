import test from "node:test";
import assert from "node:assert/strict";

import { buildNewsArticleParams } from "./useFinance";

test("buildNewsArticleParams omits undefined optional fields", () => {
  const params = buildNewsArticleParams({
    url: "https://example.com/story",
    title: "Headline",
    source: "Yahoo Finance",
    feedProvider: undefined,
    publishedAt: "2026-03-17T15:00:00.000Z",
    summary: undefined,
  });

  assert.equal(params.get("url"), "https://example.com/story");
  assert.equal(params.get("title"), "Headline");
  assert.equal(params.get("source"), "Yahoo Finance");
  assert.equal(params.get("publishedAt"), "2026-03-17T15:00:00.000Z");
  assert.equal(params.has("feedProvider"), false);
  assert.equal(params.has("summary"), false);
  assert.equal(params.toString().includes("undefined"), false);
});

test("buildNewsArticleParams includes feed provider and summary when present", () => {
  const params = buildNewsArticleParams({
    url: "https://example.com/story",
    title: "Headline",
    source: "Yahoo Finance",
    feedProvider: "Google News",
    publishedAt: "2026-03-17T15:00:00.000Z",
    summary: "Summary text",
  });

  assert.equal(params.get("feedProvider"), "Google News");
  assert.equal(params.get("summary"), "Summary text");
});
