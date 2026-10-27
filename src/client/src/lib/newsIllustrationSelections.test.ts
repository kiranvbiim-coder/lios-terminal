import test from "node:test";
import assert from "node:assert/strict";
import type { CommonsCandidate } from "@shared/commonsMedia";
import { encodeTerminalPanelValue, decodeTerminalPanelValue } from "@shared/terminalArtifact";
import {
  rememberNewsIllustration, readSavedNewsIllustrations, forgetNewsIllustration,
  restoredNewsIllustration, MAX_SAVED_NEWS_ILLUSTRATIONS, NEWS_ILLUSTRATION_MAX_AGE_MS,
} from "./newsIllustrationSelections";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const story = "https://example.org/news/solar";
const source: CommonsCandidate = {
  fileTitle: "File:Solar project illustrative image.jpg",
  filePage: "https://commons.wikimedia.org/wiki/File:Solar_project_illustrative_image.jpg",
  previewUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/solar.jpg/640px-solar.jpg",
  creator: "Commons contributor",
  license: "CC0 1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  mime: "image/jpeg",
};

test("explicit saved Commons references round-trip through existing P4 panel codec, without pixels or licenses", () => {
  const selected = rememberNewsIllustration([], story, source, NOW);
  const reopened = readSavedNewsIllustrations(decodeTerminalPanelValue(encodeTerminalPanelValue(selected)), NOW + 1000);
  assert.equal(reopened.length, 1);
  assert.equal(reopened[0].storyUrl, story);
  assert.equal(reopened[0].candidate.filePage, source.filePage);
  assert.equal(JSON.stringify(reopened).includes("assetPath"), false);
  assert.equal(JSON.stringify(reopened).includes("permission"), false);
  assert.equal(readSavedNewsIllustrations(reopened, NOW + NEWS_ILLUSTRATION_MAX_AGE_MS + 1).length, 0);
});

test("saved illustrations are bounded and never reused across unrelated articles", () => {
  let saved = [] as ReturnType<typeof readSavedNewsIllustrations>;
  for (let i = 0; i < MAX_SAVED_NEWS_ILLUSTRATIONS + 3; i++) {
    saved = rememberNewsIllustration(saved, story + "/" + i, source, NOW);
  }
  assert.equal(saved.length, MAX_SAVED_NEWS_ILLUSTRATIONS);
  assert.equal(saved.some(x => x.storyUrl === story + "/0"), false);
  saved = rememberNewsIllustration(saved, story + "/14", source, NOW + 1);
  assert.equal(saved.filter(x => x.storyUrl === story + "/14").length, 1);
  assert.equal(saved.find(x => x.storyUrl === story + "/14")?.savedAt, new Date(NOW + 1).toISOString());
  assert.equal(forgetNewsIllustration(saved, story + "/14", NOW + 2).some(x => x.storyUrl === story + "/14"), false);
});

test("unsafe URLs, invalid metadata and credential-bearing references fail closed", () => {
  assert.deepEqual(rememberNewsIllustration([], "https://example.org/story?api_key=private", source, NOW), []);
  assert.deepEqual(rememberNewsIllustration([], story, { ...source, previewUrl: "https://evil.example.net/photo.jpg" }, NOW), []);
  assert.deepEqual(rememberNewsIllustration([], story, { ...source, license: "CC BY-NC 4.0" as "CC0 1.0" }, NOW), []);
  assert.deepEqual(rememberNewsIllustration([], story, { ...source, licenseUrl: "https://example.org/license" as CommonsCandidate["licenseUrl"] }, NOW), []);
  assert.deepEqual(readSavedNewsIllustrations([{ storyUrl: story, candidate: source, savedAt: "not a date" }], NOW), []);
  assert.equal(restoredNewsIllustration({ storyUrl: story, candidate: source, savedAt: new Date(NOW).toISOString() }, { ...source, filePage: "https://commons.wikimedia.org/wiki/File:Another_image.jpg" }), null);
  assert.ok(restoredNewsIllustration({ storyUrl: story, candidate: source, savedAt: new Date(NOW).toISOString() }, source));
});
