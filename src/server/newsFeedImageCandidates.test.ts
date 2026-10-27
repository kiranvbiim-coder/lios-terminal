import test from "node:test";
import assert from "node:assert/strict";
import { extractRssImageCandidate } from "./newsFeedImageCandidates";

test("RSS metadata exposes a source-linked candidate without inventing rights", () => {
  assert.deepEqual(
    extractRssImageCandidate({
      "media:thumbnail": { url: "https://publisher.example/story/photo.jpg" },
      "media:credit": "News photographer",
    }),
    { url: "https://publisher.example/story/photo.jpg", source: "rss", rights: "unverified", attribution: "News photographer" },
  );
});

test("only declared image elements may become candidates", () => {
  assert.equal(extractRssImageCandidate({ description: '<img src="https://tracking.example/pixel">' }), undefined);
  assert.equal(extractRssImageCandidate({ enclosure: { url: "https://media.example/video.mp4", type: "video/mp4" } }), undefined);
  assert.equal(extractRssImageCandidate({ "media:content": { url: "https://media.example/video.mp4", type: "video/mp4" } }), undefined);
  assert.equal(extractRssImageCandidate({ "media:thumbnail": { url: "file:///tmp/photo.jpg" } }), undefined);
  assert.equal(extractRssImageCandidate({ "media:thumbnail": { url: "https://127.0.0.1/secrets.jpg" } }), undefined);
  assert.equal(extractRssImageCandidate({ "media:thumbnail": { url: "https://user:pass@media.example/secret" } }), undefined);
});

test("an RSS image URL never becomes an approved bundled editorial image", () => {
  const candidate = extractRssImageCandidate({ enclosure: { url: "https://publisher.example/photo.webp", type: "image/webp" } });
  assert.equal(candidate?.rights, "unverified");
  assert.equal("assetPath" in (candidate ?? {}), false);
  assert.equal("permission" in (candidate ?? {}), false);
});
