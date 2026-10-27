import test from "node:test";
import assert from "node:assert/strict";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { P7TimelineEvent } from "@shared/p7ResearchContracts";
import {
  ProjectIntelligenceTimeline,
  groupProjectTimeline,
  projectTimelineEvidenceCount,
} from "./ProjectIntelligenceTimeline";

function event(id: string, at: string, overrides: Partial<P7TimelineEvent> = {}): P7TimelineEvent {
  return {
    id, at, type: "research",
    title: `Research ${id}`,
    summary: `Recorded detail ${id}`,
    sourceRefs: [],
    entityRefs: [],
    artifactRefs: [],
    modelRefs: [],
    decisionRef: null,
    ...overrides,
  };
}

function markup(events: P7TimelineEvent[], options: { loading?: boolean; error?: boolean } = {}) {
  return renderToStaticMarkup(React.createElement(ProjectIntelligenceTimeline, { events, ...options }));
}

test("the visual timeline sorts recorded Project events latest-first without changing the source array", () => {
  const earlier = event("old", "2026-10-21T09:00:00.000Z");
  const later = event("new", "2026-10-22T09:00:00.000Z");
  const original = [earlier, later];
  const groups = groupProjectTimeline(original);
  assert.deepEqual(groups.flatMap(g => g.events.map(e => e.id)), ["new", "old"]);
  assert.deepEqual(original.map(x => x.id), ["old", "new"]);
  assert.equal(groups.length, 2);
});


test("timeline ordering follows the actual instant even with different timezone offsets", () => {
  const later = event("later", "2026-10-24T00:00:00.000+05:30");
  const earlier = event("earlier", "2026-10-23T20:00:00.000Z");
  const ids = groupProjectTimeline([earlier, later]).flatMap(g => g.events.map(e => e.id));
  assert.deepEqual(ids, ["earlier", "later"]);
});
test("timeline preserves source references and evidence counts without guessing importance", () => {
  const e = event("one", "2026-10-22T10:00:00.000Z", {
    sourceRefs: ["source:a", "source:b"],
    entityRefs: ["entity:x"],
    artifactRefs: ["artifact:y"],
    modelRefs: ["model:z"],
    decisionRef: "decision:1",
    type: "decision",
  });
  assert.equal(projectTimelineEvidenceCount(e), 6);
  const html = markup([e]);
  assert.match(html, /data-timeline-kind="decision"/);
  assert.match(html, /6 recorded links/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /Research one/);
  assert.match(html, /dateTime|datetime/);
  // Details are opt-in; references must not appear on the collapsed card.
  assert.doesNotMatch(html, /source:a|entity:x|model:z|decision:1/);
});

test("timeline is bounded but never silently truncates the available history", () => {
  const events = Array.from({ length: 24 }, (_, i) =>
    event(String(i), `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`));
  const html = markup(events);
  assert.match(html, /Showing 8 of 24 events/);
  assert.match(html, /Show more history · 16 remaining/);
  assert.equal((html.match(/data-timeline-kind=/g) ?? []).length, 8);
});

test("time and titles remain recorded; untrusted markup is escaped and never fetched as media", () => {
  const html = markup([event("z", "2026-10-20T10:00:00.000Z", {
    title: "<script>alert('p7')</script>",
    summary: "<img src='https://example.test/spy'>",
  })]);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script\b|<img\b|<iframe\b/);
  assert.doesNotMatch(html, /https:\/\/example\.test\/spy/);
  assert.match(html, /date[Tt]ime="2026-10-20T10:00:00.000Z"/);
});

test("honest empty, loading, and failed reads show no invented timeline", () => {
  assert.match(markup([]), /No recorded Project events match/);
  assert.match(markup([], { loading: true }), /Loading recorded Project history/);
  assert.match(markup([], { error: true }), /Project history could not be loaded/);
  assert.doesNotMatch(markup([]), /data-timeline-kind/);
});
