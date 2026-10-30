import test from "node:test";
import assert from "node:assert/strict";
import { extractRssMediaPreview } from "./newsFeedMediaEnclosures";
import { safeNewsMediaPreview } from "../shared/newsMediaPreview";
import { parseNewsFeed } from "./marketData";

const preview = { url: "https://publisher.example.com/audio.mp3", type: "audio/mpeg" };

test("RSS video/audio are metadata only and cannot become image license grants", () => {
  const audio = extractRssMediaPreview({ enclosure: preview });
  assert.deepEqual(audio, { kind: "audio", url: preview.url, mime: preview.type, source: "rss", rights: "publisher_stream_only" });
  const video = extractRssMediaPreview({ "media:content": { url: "https://publisher.example.com/story.mp4", type: "video/mp4" } });
  assert.equal(video?.kind, "video");
  assert.equal("permission" in (audio ?? {}), false);
  assert.equal("assetPath" in (audio ?? {}), false);
  const rss = '<rss><channel><item><title>Public report</title><link>https://publisher.example.com/story</link><pubDate>Tue, 27 Oct 2026 08:00:00 GMT</pubDate><enclosure url="https://publisher.example.com/audio.mp3" type="audio/mpeg"/></item></channel></rss>';
  assert.deepEqual(parseNewsFeed(rss, "Publisher")[0]?.mediaPreview, audio);
});

test("only strict supported public HTTPS sources qualify for user-initiated playback", () => {
  const allowed = extractRssMediaPreview({ enclosure: { url: "https://publisher.example.com/clip.webm", type: "video/webm" } });
  assert.ok(allowed);
  for (const url of [
    "http://publisher.example.com/audio.mp3", "https://127.0.0.1/audio.mp3",
    "https://localhost/audio.mp3", "https://media.internal/audio.mp3",
    "https://publisher.example.com:4321/a.mp3", "https://name:pass@publisher.example.com/a.mp3",
    "https://publisher.example.com/a.mp3?token=secret",
    "file:///Users/me/.ssh/id_rsa",
  ]) {
    assert.equal(extractRssMediaPreview({ enclosure: { url, type: "audio/mpeg" } }), undefined, url);
  }
  assert.equal(extractRssMediaPreview({ enclosure: { url: preview.url, type: "text/html" } }), undefined);
  assert.equal(extractRssMediaPreview({ enclosure: { url: preview.url, type: "image/jpeg" } }), undefined);
  assert.equal(safeNewsMediaPreview({ ...allowed, rights: "unverified" }), null);
});

