import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const market = readFileSync(new URL("./marketData.ts", import.meta.url), "utf8");
const pane = readFileSync(new URL("../client/src/components/panels/NewsPanel.tsx", import.meta.url), "utf8");
const hook = readFileSync(new URL("../client/src/lib/useFinance.ts", import.meta.url), "utf8");

test("Publisher article text is distinguished from RSS fallback and only success is cached", () => {
  const section = market.slice(market.indexOf("export async function getNewsArticle("),
    market.indexOf("export async function getNewsArticle(") + 2400);
  assert.match(section, /readThrough: content\.length \? "publisher_text" : "feed_summary"/);
  assert.match(section, /content\.length \? setCached\(articleCache, cacheKey, article, ARTICLE_TTL_MS\) : article/);
  assert.match(section, /readThrough: "feed_summary"/);
  assert.doesNotMatch(section, /return setCached\(articleCache, cacheKey, fallback, ARTICLE_TTL_MS\)/);
  assert.match(pane, /Publisher text could not be retrieved/);
  assert.match(hook, /readThrough === "feed_summary"/);
});
