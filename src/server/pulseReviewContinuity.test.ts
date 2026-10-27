import assert from "node:assert/strict";
import test from "node:test";
import type { IntelligenceCard } from "@shared/waveDContracts";
import {
  fingerprintPulseRevision, capturePulseReviewedSnapshot,
  comparePulseWithReviewedSnapshot, normalizePulseReviewedSnapshot,
} from "./pulseReviewContinuity";

function card(id: string, change: Partial<IntelligenceCard> = {}): IntelligenceCard {
  return {
    id, kind: "research", title: "Observed source change", whatHappened: "Retained finding",
    whyItMatters: "Review source", whyItMattersToUser: "Research context",
    nextActions: ["ask"], createdAt: "2026-10-27T08:00:00Z", score: 64,
    priority: "important", status: "unread", evidence: [
      { id: "original:source", source: "Original publisher",
        url: "https://example.org/report?api_key=DO_NOT_STORE",
        availableAt: "2026-10-27T07:59:00Z",
      },
    ], ...change,
  };
}
test("Without a recorded review snapshot, no history is fabricated", () => {
  const current=[card("first")];
  assert.deepEqual(comparePulseWithReviewedSnapshot(current, null), {
    status:"not_reviewed",reviewedAt:null,newCardIds:[],newCount:0,sourceBackedCount:1,
  });
  const empty=capturePulseReviewedSnapshot([],new Date("2026-10-27T08:00:00Z"));
  assert.deepEqual(comparePulseWithReviewedSnapshot([],empty),{
    status:"compared",reviewedAt:"2026-10-27T08:00:00.000Z",
    newCardIds:[],newCount:0,sourceBackedCount:0,
  });
});

test("Unchanged source-backed card does not appear again after review", () => {
  const original=card("owned-record");
  const reviewed=capturePulseReviewedSnapshot([original],new Date("2026-10-27T08:01:00Z"));
  assert.equal(reviewed.fingerprints.length,1);
  assert.match(reviewed.fingerprints[0], /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(reviewed), /DO_NOT_STORE|Original publisher|Observed source change|owned-record/);
  const unchanged=comparePulseWithReviewedSnapshot([original],reviewed);
  assert.equal(unchanged.newCount,0);
  assert.deepEqual(unchanged.newCardIds,[]);
});

test("New recorded ID, changed recorded source revision or recorded title are compared, not called world events", () => {
  const original=card("source-1");
  const review=capturePulseReviewedSnapshot([original],new Date("2026-10-27T08:01:00Z"));
  const variants=[
    card("source-2"),
    card("source-1",{title:"Revised recorded title"}),
    card("source-1",{createdAt:"2026-10-27T09:00:00Z"}),
    card("source-1",{evidence:[{id:"original:source",source:"Original publisher",availableAt:"2026-10-27T09:00:00Z"}]}),
    card("source-1",{evidence:[{id:"another:id",source:"Different retained source"}]}),
  ];
  for(const candidate of variants){
    const diff=comparePulseWithReviewedSnapshot([candidate],review);
    assert.equal(diff.newCount,1);
    assert.deepEqual(diff.newCardIds,[candidate.id]);
  }
  assert.notEqual(fingerprintPulseRevision(original),fingerprintPulseRevision(variants[1]));
});

test("Source reference order does not imply a new revision; no unbacked card is counted", () => {
  const two=card("two", {evidence:[
    {id:"evidence:2",source:"Publisher A"},
    {id:"evidence:1",source:"Publisher B",availableAt:"2026-10-27T07:40:00Z"},
  ]});
  const other=card("two", {evidence:[...two.evidence].reverse()});
  assert.equal(fingerprintPulseRevision(two),fingerprintPulseRevision(other));
  assert.equal(fingerprintPulseRevision(card("missing",{evidence:[]})),null);
  const snapshot=capturePulseReviewedSnapshot([two],new Date("2026-10-27T08:00:00Z"));
  assert.deepEqual(comparePulseWithReviewedSnapshot([other,card("missing",{evidence:[]})],snapshot).newCardIds,[]);
});

test("Malformed history is normalized and maximum 120 source IDs stored", () => {
  assert.deepEqual(normalizePulseReviewedSnapshot({reviewedAt:"not-a-date",fingerprints:["a".repeat(64)]}),{reviewedAt:null,fingerprints:[]});
  assert.deepEqual(normalizePulseReviewedSnapshot({reviewedAt:"2026-10-27T08:00:00Z",fingerprints:["notahash", "a".repeat(64),"a".repeat(64)]}),{
    reviewedAt:"2026-10-27T08:00:00.000Z", fingerprints:["a".repeat(64)],
  });
  const values=Array.from({length:160},(_,i)=>card("record-"+i));
  const captured=capturePulseReviewedSnapshot(values,new Date("2026-10-27T08:00:00Z"));
  assert.equal(captured.fingerprints.length,120);
  assert.equal(comparePulseWithReviewedSnapshot(values,captured).newCount,0);
});
