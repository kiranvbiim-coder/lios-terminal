import test from "node:test";
import assert from "node:assert/strict";
import type { PulseStoryView } from "./pulseStoryPresentation";
import { clusterRecordedPulseStories } from "./pulseStoryClusters";
import { pulseStoryQuestion } from "./pulseStoryPresentation";

function story(id: string, changes: Partial<PulseStoryView> = {}): PulseStoryView {
  return {
    id,
    kind: "news",
    title: "Transmission capacity report",
    whatHappened: "Retained reported change; verification pending.",
    whyItMatters: "Review exact source.",
    priority: "important",
    score: 69,
    symbol: "POWER",
    subjectKey: "power:sector",
    createdAt: "2026-10-27T09:00:00Z",
    evidence: [
      { id: "filing:84", source: "Official filing", provider: "public", url: "https://example.org/report/84",
        availableAt: "2026-10-27T08:45:00Z" },
    ],
    ...changes,
  };
}

test("exact source, headline, subject and UTC event date make one bounded expandable story", () => {
  const cards = [
    story("news-1", { score: 91, priority: "critical" }),
    story("news-2", { title: " Transmission   capacity report ", score: 44, priority: "fyi", evidence: [
      { id: "filing:84", source: "Official filing", provider: "public", url: "https://example.org/report/84" },
      { id: "analysis:21", source: "Publisher summary", url: "https://example.org/summary/21" },
    ] }),
  ];
  const grouped = clusterRecordedPulseStories(cards);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].id, "news-1");
  assert.deepEqual(grouped[0].clusteredCardIds, ["news-1", "news-2"]);
  assert.equal(grouped[0].clusteredCount, 2);
  assert.equal(grouped[0].priority, "critical");
  assert.equal(grouped[0].score, 91);
  assert.equal(grouped[0].evidence?.length, 2);
  assert.equal(grouped[0].omittedEvidenceCount, 0);
  const prompt = pulseStoryQuestion(grouped[0]);
  assert.match(prompt, /https:\/\/example.org\/report\/84/);
  assert.match(prompt, /https:\/\/example.org\/summary\/21/);
});

test("never merge distinct evidence, different subject, date, kind, or headline", () => {
  const other: Array<PulseStoryView> = [
    story("other-source", { evidence: [{ id: "different", source: "Same publisher", url: "https://example.org/other" }] }),
    story("other-subject", { subjectKey: "water:sector" }),
    story("other-day", { createdAt: "2026-10-28T02:00:00Z" }),
    story("other-kind", { kind: "research" }),
    story("other-title", { title: "Different development" }),
    story("missing-subject", { subjectKey: "", symbol: undefined }),
    story("missing-date", { createdAt: undefined }),
    story("no-evidence", { evidence: [] }),
  ];
  assert.equal(clusterRecordedPulseStories([story("original"), ...other]).length, 1 + other.length);
  assert.ok(clusterRecordedPulseStories([story("original"), ...other]).every(group => group.clusteredCount === 1));
});

test("never group untrusted or credential-bearing citation URLs on URL appearance", () => {
  const a = story("bad-1", { evidence: [{ id: "", source: "Unverified", url: "https://example.org/report?api_key=secret" }] });
  const b = story("bad-2", { evidence: [{ id: "", source: "Unverified", url: "https://example.org/report?api_key=secret" }] });
  const cards = clusterRecordedPulseStories([a, b]);
  assert.equal(cards.length, 2);
  assert.doesNotMatch(pulseStoryQuestion(cards[0]), /api_key=secret/);
});

test("missing source and market fallback do not acquire fabricated citations or identities", () => {
  const derived = story("market-derived", { kind: "market_move", evidence: undefined, subjectKey: undefined, createdAt: undefined });
  const [group] = clusterRecordedPulseStories([derived]);
  assert.equal(group.clusteredCount, 1);
  assert.deepEqual(group.evidence, []);
  assert.match(pulseStoryQuestion(group), /No external source URLs were attached/);
});

test("bounded projection retains leading priority, carries omissions, does not mutate input", () => {
  const originals = Object.freeze([story("a"), story("b", {
    evidence: [story("a").evidence![0], ...Array.from({ length: 68 }, (_, index) => ({
      id: "edge:" + index, source: "Source " + index, url: "https://example.org/" + index,
    }))],
  })]);
  const grouped = clusterRecordedPulseStories(originals, 48);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].evidence?.length, 60);
  assert.equal(grouped[0].omittedEvidenceCount, 9);
  assert.equal(originals[0].evidence?.length, 1);
  assert.equal(originals[1].evidence?.length, 69);
  assert.equal(clusterRecordedPulseStories(Array.from({ length: 100 }, (_, i) => story("id-" + i, {
    evidence: [], subjectKey: undefined, symbol: undefined,
  })), 200).length, 48);
});

test("no transitive chaining through an intermediate citation", () => {
  const a = story("a", { evidence: [{ id: "A", source: "Primary" }] });
  const b = story("b", { evidence: [{ id: "A", source: "Primary" }, { id: "B", source: "Secondary" }] });
  const c = story("c", { evidence: [{ id: "B", source: "Secondary" }] });
  const grouped = clusterRecordedPulseStories([a,b,c]);
  assert.deepEqual(grouped.map(x => x.clusteredCardIds), [["a","b"], ["c"]]);
});

test("identical URLs inside two different distinct titles never establish same story", () => {
  const result = clusterRecordedPulseStories([story("news"), story("other", { title: "Different reported change" })]);
  assert.equal(result.length, 2);
});

test("existing Wave D → Watermelon-style card handoff uses one shared grouping owner", async () => {
  const { readFileSync } = await import("node:fs");
  const shell = readFileSync(new URL("../components/terminal/WaveCExperienceShell.tsx", import.meta.url), "utf8");
  const board = readFileSync(new URL("../components/terminal/FusionPulseBoard.tsx", import.meta.url), "utf8");
  const storyCard = readFileSync(new URL("../components/terminal/LiosPulseStoryCard.tsx", import.meta.url), "utf8");
  assert.match(shell, /const authorizedCards = Array\.isArray\(pulse\.cards\) \? pulse\.cards\.slice\(0, 24\) : \[\]/);
  assert.match(shell, /setWaveDPulseCards\(authorizedCards\)/);
  assert.match(board, /clusterRecordedPulseStories\(pulseCards, 24\)/);
  assert.match(board, /LiosPulseStoryCard/);
  assert.match(storyCard, /clusteredCount/);
  assert.match(storyCard, /This grouping is not independent corroboration/);
  assert.match(storyCard, /safePulseSourceUrl\(source\.url\)/);
  assert.doesNotMatch(board, /Math\.random|createP9Workflow|fetch\("https?:/);
});

test("A04 same source-local ID from different publishers never merges unrelated articles", () => {
  const lead = story("publisher-a", { evidence: [
    { id: "123", source: "Publisher A", provider: "publisher-a", url: "https://example.org/a" },
  ] });
  const other = story("publisher-b", { evidence: [
    { id: "123", source: "Publisher B", provider: "publisher-b", url: "https://example.org/b" },
  ] });
  assert.equal(clusterRecordedPulseStories([lead, other]).length, 2);
  assert.equal(clusterRecordedPulseStories([lead, { ...other,
    evidence: [{ ...other.evidence![0], url: "https://example.org/a" }],
  }]).length, 1);
});
