import test from "node:test";
import assert from "node:assert/strict";
import {
  changedNewsFields, observeNewsFeed, newsStoryRevisions,
  MAX_NEWS_REVISIONS_PER_STORY, MAX_NEWS_STORIES,
  type NewsStoryObservation,
} from "./newsStoryEvolution";

const article: NewsStoryObservation = {
  url: "https://publisher.example/story/one",
  title: "Recorded launch",
  summary: "First feed summary",
  source: "Publisher A",
  publishedAt: "2026-10-27T08:00:00Z",
};
const at = Date.parse("2026-10-27T09:00:00Z");

test("first read is a single observation, not a fabricated revision", () => {
  const first = observeNewsFeed([], [article], at);
  assert.equal(first.length, 1);
  assert.equal(first[0].observedAt, "2026-10-27T09:00:00.000Z");
  assert.equal(observeNewsFeed(first, [article], at + 60000).length, 1);
  assert.deepEqual(changedNewsFields(first[0], first[0]), []);
});

test("real changes in the SAME recorded article URL produce a feed change history", () => {
  const first = observeNewsFeed([], [article], at);
  const updated = { ...article, title: "Recorded launch updated", summary: "Corrected text" };
  const second = observeNewsFeed(first, [updated], at + 60_000);
  assert.equal(second.length, 2);
  assert.deepEqual(changedNewsFields(second[1], second[0]), ["headline", "summary"]);
  assert.equal(second[1].title, article.title);
  assert.equal(second[0].observedAt, "2026-10-27T09:01:00.000Z");
});

test("similar headlines from independent URLs never become one event", () => {
  const similar = { ...article, url: "https://other.example/story/second" };
  const history = observeNewsFeed([], [article, similar], at);
  assert.equal(newsStoryRevisions(history, article.url).length, 1);
  assert.equal(newsStoryRevisions(history, similar.url).length, 1);
  assert.deepEqual(changedNewsFields(history[0], history[1]), []);
});

test("invalid and credential-bearing URLs or timestamps do not enter history", () => {
  const history = observeNewsFeed([], [
    { ...article, url: "https://publisher.example/one?api_key=private" },
    { ...article, url: "javascript:alert(1)" },
    { ...article, publishedAt: "not a timestamp" },
  ], at);
  assert.equal(history.length, 0);
  assert.deepEqual(observeNewsFeed([], [article], Number.NaN), []);
});

test("bounded memory never grows beyond last 80 stories and 6 revisions per URL", () => {
  let history = observeNewsFeed([], Array.from({ length: MAX_NEWS_STORIES + 20 }, (_, i) => ({
    ...article, url: "https://publisher.example/story/" + i,
  })), at);
  assert.equal(history.length, MAX_NEWS_STORIES);
  const target = "https://publisher.example/story/0";
  for (let i = 0; i < 10; i++) {
    history = observeNewsFeed(history, [{ ...article, url: target, summary: "Revision " + i }], at + (i + 1) * 1000);
  }
  assert.equal(newsStoryRevisions(history, target).length, MAX_NEWS_REVISIONS_PER_STORY);
  assert.ok(history.length <= MAX_NEWS_STORIES + MAX_NEWS_REVISIONS_PER_STORY - 1);
});
