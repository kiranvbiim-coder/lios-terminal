import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shell = fs.readFileSync(path.join(clientRoot, "components", "terminal", "ProjectExperienceShell.tsx"), "utf8");

test("Temporary Chat rolls back the optimistic user row when voice transcript review is required", () => {
  assert.ok(shell.includes("if (result.status === 428)"), "conversation paths must handle server-derived voice review.");
  assert.ok(
    shell.includes("current.filter((item) => item.id !== userMessage.id)"),
    "Temporary Chat must remove the optimistic unsent message before the reviewed retry.",
  );
  assert.ok(shell.includes("setVoiceTranscriptReviewed(false)"), "rejected high-impact voice requests must remain explicitly unreviewed.");
  assert.ok(shell.includes("raw audio is not retained"), "the composer must disclose that raw voice audio is not persisted.");
  assert.ok(shell.includes("voiceReview"), "voice transcript evidence must travel through the ordinary conversation send path.");
});
