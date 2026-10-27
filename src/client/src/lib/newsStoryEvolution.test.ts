import test from "node:test";
import assert from "node:assert/strict";
import {
  changedNewsFields, observeNewsFeed, newsStoryRevisions, compareRecordedNewsObservations,
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

test("older cached feeds never fabricate a newer story revision on query-key switches", () => {
  const first = observeNewsFeed([], [article], at);
  const newer = observeNewsFeed(first, [{ ...article, title: "Verified later headline" }], at + 60_000);
  const stale = observeNewsFeed(newer, [article], at + 10_000);
  assert.deepEqual(stale, newer);
  assert.equal(newsStoryRevisions(stale, article.url).length, 2);
  // A changed payload at the same query observation timestamp is not a new fetch.
  assert.deepEqual(observeNewsFeed(stale, [{ ...article, title: "Another headline" }], at + 60_000), stale);
  // Real successive observations remain visible.
  const fresh = observeNewsFeed(stale, [{ ...article, title: "Another headline" }], at + 120_000);
  assert.equal(newsStoryRevisions(fresh, article.url).length, 3);
  assert.equal(newsStoryRevisions(fresh, article.url)[0].title, "Another headline");
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

test("unchanged newer observations advance the watermark without inventing revisions", () => {
  const first = observeNewsFeed([], [article], at);
  const unchanged = observeNewsFeed(first, [article], at + 3000);
  const cached = observeNewsFeed(unchanged, [{ ...article, title: "Older cached content" }], at + 2000);
  assert.equal(cached.length, 1);
  assert.equal(cached[0].title, article.title);
  assert.equal(cached[0].observedAt, first[0].observedAt);
  assert.equal(cached[0].lastObservedAt, new Date(at + 3000).toISOString());
});

test("B03 as-observed-then comparison never merges different publisher URLs or inferred history",()=>{
  const first=observeNewsFeed([], [article], at);
  const second=observeNewsFeed(first,[{...article,title:"Correction recorded",summary:"Updated source excerpt"}],at+60_000);
  const third=observeNewsFeed(second,[{...article,title:"Further clarification",summary:"Different source excerpt"}],at+120_000);
  const early=compareRecordedNewsObservations(third,article.url,first[0].observedAt)!;
  assert.equal(early.earlier.title,"Recorded launch");
  assert.equal(early.later.title,"Further clarification");
  assert.deepEqual(early.changedFields,["headline","summary"]);
  assert.equal(compareRecordedNewsObservations(third,"https://another.example/article",first[0].observedAt),null);
  assert.equal(compareRecordedNewsObservations(third,article.url,"2026-10-20T00:00:00Z"),null);
  assert.equal(compareRecordedNewsObservations([first[0]],article.url,first[0].observedAt),null);
  assert.equal(compareRecordedNewsObservations(third,article.url,third[0].observedAt),null);
});
