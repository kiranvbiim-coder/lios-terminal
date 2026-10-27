import test from "node:test";
import assert from "node:assert/strict";
import { safeCommonsPreview, safeCommonsFilePage, type CommonsCandidate } from "./commonsMedia";

const candidate: CommonsCandidate = {
  fileTitle: "File:Illustrative solar field.jpg",
  previewUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/solar.jpg/640px-solar.jpg",
  filePage: "https://commons.wikimedia.org/wiki/File:Illustrative_solar_field.jpg",
  creator: "Commons contributor",
  license: "CC0 1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  mime: "image/jpeg",
};

test("Commons preview only permits exact Wikimedia image URLs with CC0 status", () => {
  assert.equal(safeCommonsPreview(candidate), candidate.previewUrl);
  assert.equal(safeCommonsFilePage(candidate), candidate.filePage);
  assert.equal(safeCommonsPreview({ ...candidate, previewUrl: "https://upload.wikimedia.org.example.com/track.jpg" }), null);
  assert.equal(safeCommonsPreview({ ...candidate, previewUrl: "javascript:alert(1)" }), null);
  assert.equal(safeCommonsPreview({ ...candidate, previewUrl: "https://upload.wikimedia.org/wikipedia/commons/a/secret.svg" }), null);
  assert.equal(safeCommonsPreview({ ...candidate, license: "CC BY 4.0" as "CC0 1.0" }), null);
  assert.equal(safeCommonsFilePage({ ...candidate, filePage: "https://example.org/wiki/File:Unknown.jpg" }), null);
});
