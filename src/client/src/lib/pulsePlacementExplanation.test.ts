import test from "node:test";
import assert from "node:assert/strict";
import type { PulseStoryView } from "./pulseStoryPresentation";
import { explainPulsePlacement } from "./pulsePlacementExplanation";

const card: PulseStoryView = {
  id: "recorded-1", title: "A recorded development", whatHappened: "The provider recorded a change.",
  priority: "important", score: 73.6, kind: "research", subjectKey: "Open Banking",
  createdAt: "2026-10-27T10:00:00Z",
  evidence: [{ id: "reference-1", source: "Publisher 1", url: "https://publisher.example/article" }],
};

test("A discovery shows sourced, literal channel and ranked context, not an AI explanation", () => {
  const why = explainPulsePlacement(card, "research", false);
  assert.ok(why[0].includes("Research channel"));
  assert.ok(why.some(reason => reason.includes("OPEN BANKING") && reason.includes("does not imply you follow")));
  assert.ok(why.some(reason => reason.includes("1 recorded source reference")));
  assert.ok(why.some(reason => reason.includes("74") && reason.includes("not a probability")));
  assert.ok(why.every(reason => !reason.includes("analyzed your private")));
});

test("following is acknowledged ONLY for an explicit authenticated preference", () => {
  const withoutFollow = explainPulsePlacement(card, "for_you", false).join(" ");
  const withFollow = explainPulsePlacement(card, "following", true).join(" ");
  assert.doesNotMatch(withoutFollow, /You follow the recorded subject/);
  assert.match(withFollow, /You follow the recorded subject OPEN BANKING/);
});

test("no source or numeric ranking stays visibly unknown", () => {
  const explanation = explainPulsePlacement({ ...card, evidence: [], score: Number.NaN }, "markets", false).join(" ");
  assert.match(explanation, /No attributed source references/);
  assert.match(explanation, /Relevance is unavailable/);
  assert.doesNotMatch(explanation, /not a probability, accuracy score or recommendation/);
});

test("unsupported or unrecorded subject never becomes a guessed identifier", () => {
  const explanation = explainPulsePlacement({ ...card, subjectKey: "https://user:secret@private.example" }, "for_you", false).join(" ");
  assert.doesNotMatch(explanation, /Recorded subject:|You follow the recorded subject/);
});
