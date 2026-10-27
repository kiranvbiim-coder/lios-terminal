import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPerspectiveModel, filterPerspectiveLinks, filterUnlinkedEvidence,
  relationshipGroup, perspectivePublishedDate,
  type PerspectiveEvidence, type PerspectiveRelation,
} from "./researchPerspectives";

const evidence = (id: number, title: string): PerspectiveEvidence => ({
  id, title, evidenceType: "filing", evidenceKind: "fact",
  excerpt: `Exact excerpt for ${title}`, annotation: null,
  sourceName: `Source ${id}`, provider: `Publisher ${id}`,
  sourceUrl: `https://sources.example.org/${id}`,
  publishedAt: "2026-10-20T09:00:00Z", retrievedAt: "2026-10-21T09:00:00Z",
});
const records = [evidence(1, "Original filing"), evidence(2, "Analyst challenge"), evidence(3, "Later filing"), evidence(4, "Unlinked note")];
const relations: PerspectiveRelation[] = [
  { id: 10, fromEvidenceId: 1, toEvidenceId: 2, relationshipType: "supports", note: "Explicit support" },
  { id: 11, fromEvidenceId: 2, toEvidenceId: 1, relationshipType: "contradicts", note: "Recorded contradiction" },
  { id: 12, fromEvidenceId: 3, toEvidenceId: 1, relationshipType: "supersedes", note: "Newer revision" },
];

test("groups only explicitly recorded relationships without assigning a publisher stance", () => {
  const before = JSON.stringify({ records, relations });
  const result = buildPerspectiveModel(records, relations);
  assert.equal(result.evidenceCount, 4);
  assert.equal(result.supportCount, 1);
  assert.equal(result.challengeCount, 1);
  assert.equal(result.contextCount, 1);
  assert.equal(result.links.length, 3);
  assert.deepEqual(result.links.map(e => [e.from.id, e.to.id, e.type, e.group]), [
    [1, 2, "supports", "support"], [2, 1, "contradicts", "challenge"], [3, 1, "supersedes", "context"],
  ]);
  assert.deepEqual(result.unlinked.map(item => item.id), [4]);
  assert.equal(result.providerCount, 4);
  assert.equal(result.sourceCount, 4);
  assert.equal(JSON.stringify({ records, relations }), before);
});

test("a supersedes / cites / affects / derives-from link is context, never an inferred support claim", () => {
  for(const type of ["supersedes", "cites", "derived_from", "affects"] as const) {
    assert.equal(relationshipGroup(type), "context");
  }
  assert.equal(relationshipGroup("supports"), "support");
  assert.equal(relationshipGroup("contradicts"), "challenge");
});

test("missing or unauthorized evidence endpoints never become fabricated cards", () => {
  const one = buildPerspectiveModel(records.slice(0, 1), relations);
  assert.equal(one.links.length, 0);
  assert.equal(one.unresolvedCount, 3);
  assert.equal(one.unlinked.length, 1);
  assert.equal(one.supportCount, 0);
  assert.equal(one.challengeCount, 0);
  assert.ok(!one.links.some(link => link.to.id === 2));
});

test("relationship filters match only retained titles, source names, excerpts and explicit notes", () => {
  const model = buildPerspectiveModel(records, relations);
  assert.deepEqual(filterPerspectiveLinks(model.links, "", "challenge").map(x => x.id), [11]);
  assert.deepEqual(filterPerspectiveLinks(model.links, "EXPLICIT support", "all").map(x => x.id), [10]);
  assert.deepEqual(filterPerspectiveLinks(model.links, "analyst", "support").map(x => x.id), [10]);
  assert.deepEqual(filterPerspectiveLinks(model.links, "unpublished invented phrase", "all"), []);
  assert.deepEqual(filterUnlinkedEvidence(model.unlinked, "Unlinked").map(x => x.id), [4]);
  assert.deepEqual(filterUnlinkedEvidence(model.unlinked, "filing"), []);
});

test("empty investigations and unlinked-only investigations are rendered as factual empty states", () => {
  assert.deepEqual(buildPerspectiveModel([], []).links, []);
  const emptyRelations = buildPerspectiveModel(records, []);
  assert.deepEqual(emptyRelations.unlinked.map(x => x.id), [1, 2, 3, 4]);
  assert.equal(emptyRelations.contextCount, 0);
  assert.equal(emptyRelations.supportCount, 0);
  assert.equal(emptyRelations.challengeCount, 0);
});

test("date fallback is honest about unknown or invalid publisher dates", () => {
  assert.equal(perspectivePublishedDate(null), "Publication date not recorded");
  assert.equal(perspectivePublishedDate("not-a-date"), "Publication date not recorded");
  assert.notEqual(perspectivePublishedDate("2026-10-20T09:00:00Z"), "Publication date not recorded");
});


test("B04 Perspectives do not turn malformed or local publisher dates into publication chronology",()=>{
  for(const value of ["1","2026-02-30T09:00:00Z","2026-10-27","2026-10-27T09:00:00","2026-10-27T24:00:00Z"]){
    assert.equal(perspectivePublishedDate(value),"Publication date not recorded",value);
  }
  assert.notEqual(perspectivePublishedDate("2026-10-27T15:30:00+05:30"),"Publication date not recorded");
});
