import test from "node:test";
import assert from "node:assert/strict";
import { approvedPhotoCount, newsWithApprovedPhotos } from "./newsVisualCoverage";
import type { EditorialMedia } from "@shared/editorialMedia";

const now = "2026-10-27T15:00:00.000Z";
const story = "https://publisher.example/news/approved";
const sha = "a".repeat(64);
const licensed: EditorialMedia = {
  kind: "image", assetPath: "/editorial-media/" + sha + ".webp", sha256: sha,
  alt: "Original rights-cleared illustration accompanying this news report",
  attribution: "Owner-authorised reuse", owner: "News photographer",
  licenseName: "Contracted display and distribution",
  licenseEvidenceRef: "internal:license:2026-10-27",
  sourceEvidenceId: story, verifiedBy: "Rights reviewer",
  verifiedAt: "2026-10-27T14:00:00.000Z",
  permission: "commercial_redistribution_and_display",
  offlineBundlingPermitted: true, state: "approved",
};

test("only exact-URL approved media count as visually discoverable, preserving feed order", () => {
  const feed = [
    { url: story, media: licensed },
    { url: "https://publisher.example/news/unrelated", media: licensed },
    { url: "https://publisher.example/news/no-photo", imageCandidate: { url: "https://publisher.example/photo.jpg", rights: "unverified" } },
  ];
  assert.deepEqual(newsWithApprovedPhotos(feed, now), [feed[0]]);
  assert.equal(approvedPhotoCount(feed, now), 1);
});

test("revoked, expired and future grants never appear in photo discovery", () => {
  for (const media of [
    { ...licensed, state: "revoked" },
    { ...licensed, state: "pending" },
    { ...licensed, verifiedAt: "2026-10-28T00:00:00.000Z" },
    { ...licensed, expiresAt: "2026-10-27T14:30:00.000Z" },
    { ...licensed, assetPath: "https://publisher.example/remote.webp" },
  ]) {
    assert.equal(approvedPhotoCount([{ url: story, media }], now), 0);
  }
});

test("unreviewed RSS thumbnails alone never trigger automatic remote-image rendering", () => {
  const candidate = { url: "https://publisher.example/news/photo.webp", rights: "unverified" };
  assert.equal(approvedPhotoCount([{ url: story, imageCandidate: candidate }], now), 0);
});
