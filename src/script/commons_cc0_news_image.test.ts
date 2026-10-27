import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { cc0Candidate, commonsQuery, searchCommonsCC0, importCommonsCC0Context } from "./commons_cc0_news_image";

const title = "File:Solar demonstration photo.jpg";
const sourcePage = "https://commons.wikimedia.org/wiki/File:Solar_demonstration_photo.jpg";
const asset = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/photo.jpg/640px-photo.jpg";
const article = "https://news.example.org/2026/solar-installations";
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL+tAAAAABJRU5ErkJggg==", "base64");
const thumb = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/photo.png/640px-photo.png";

function sample(license = "CC0 1.0", fileUrl = asset) {
  return {
    title,
    imageinfo: [{
      mime: fileUrl.endsWith(".png") ? "image/png" : "image/jpeg",
      thumburl: fileUrl,
      descriptionurl: sourcePage,
      extmetadata: {
        LicenseShortName: { value: license },
        LicenseUrl: { value: "https://creativecommons.org/publicdomain/zero/1.0/" },
        Artist: { value: "<a>Wikimedia volunteer</a>" },
      },
    }],
  };
}

test("only explicit canonical CC0 photo metadata and Commons-hosted previews are accepted", () => {
  assert.equal(cc0Candidate(sample())?.license, "CC0 1.0");
  assert.equal(cc0Candidate(sample())?.creator, "Wikimedia volunteer");
  assert.equal(cc0Candidate(sample("CC BY 4.0")), null);
  assert.equal(cc0Candidate(sample("CC0 1.0", "https://private.example.org/photo.jpg")), null);
  assert.equal(cc0Candidate(sample("CC0 1.0", "https://upload.wikimedia.org.evil.org/photo.jpg")), null);
  assert.equal(cc0Candidate({ ...sample(), imageinfo: [{ ...sample().imageinfo[0], descriptionurl: "https://evil.example.org/photo" }] }), null);
  assert.equal(cc0Candidate({ ...sample(), imageinfo: [{
    ...sample().imageinfo[0],
    extmetadata: { ...sample().imageinfo[0].extmetadata, LicenseUrl: { value: "https://creativecommons.org/licenses/by-nc/4.0/" } },
  }] }), null);
});

test("search uses Wikimedia-only API, confines to File namespace and bounds matches", async () => {
  const url = commonsQuery({ generator: "search", gsrsearch: "solar", gsrnamespace: "6", gsrlimit: "8" });
  const p = new URL(url);
  assert.equal(p.host, "commons.wikimedia.org");
  assert.equal(p.searchParams.get("gsrnamespace"), "6");
  assert.equal(p.searchParams.get("iiurlwidth"), "640");
  const requester = (async (target: URL | RequestInfo) => {
    assert.equal(new URL(String(target)).hostname, "commons.wikimedia.org");
    return new Response(JSON.stringify({ query: { pages: [sample(), sample("CC BY 4.0")] } }),
      { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  assert.equal((await searchCommonsCC0("solar", requester)).length, 1);
  await assert.rejects(() => searchCommonsCC0("x", requester), /between 3 and 100/);
});

test("one reviewed Commons CC0 context image imports into canonical news manifest with explicit illustration label", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-commons-review-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const requester = (async (target: URL | RequestInfo) => {
    const url = String(target);
    if (url.startsWith("https://commons.wikimedia.org/w/api.php")) {
      return new Response(JSON.stringify({ query: { pages: [sample("CC0 1.0", thumb)] } }), { status: 200 });
    }
    assert.equal(url, thumb);
    return new Response(png, { status: 200, headers: { "content-type": "image/png" } });
  }) as typeof fetch;
  const result = await importCommonsCC0Context(article, title, dir, requester);
  assert.equal(result.sourcePage, sourcePage);
  assert.match(result.assetPath, /^\/editorial-media\/[a-f0-9]{64}\.png$/);
  assert.ok(fs.existsSync(path.join(dir, result.assetPath.slice(1))));
  const saved = JSON.parse(fs.readFileSync(path.join(dir, "editorial-media", "manifest.json"), "utf8"));
  assert.equal(saved[0].usageContext, "illustrative");
  assert.equal(saved[0].sourceEvidenceId, article);
  assert.equal(saved[0].mediaSourcePage, sourcePage);
  assert.match(saved[0].caption, /not a photograph of the reported event/);
  await assert.rejects(() => importCommonsCC0Context(article, title, dir, requester), /already has a reviewed image/);
});

test("a Commons image without confirmed CC0 metadata never causes a download or import", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-commons-denied-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let calls = 0;
  const requester = (async () => {
    calls++;
    return new Response(JSON.stringify({ query: { pages: [sample("CC BY-SA 4.0")] } }), { status: 200 });
  }) as typeof fetch;
  await assert.rejects(() => importCommonsCC0Context(article, title, dir, requester), /no confirmed CC0 metadata/);
  assert.equal(calls, 1);
  assert.equal(fs.existsSync(path.join(dir, "editorial-media", "manifest.json")), false);
});


test("Commons CC0 metadata accepts exact deed URL variants, never mistaken BY licenses", () => {
  const base = sample();
  assert.ok(cc0Candidate({
    ...base,
    imageinfo: [{ ...base.imageinfo[0], extmetadata: {
      ...base.imageinfo[0].extmetadata,
      LicenseShortName: { value: "CC0" },
      LicenseUrl: { value: "http://creativecommons.org/publicdomain/zero/1.0/deed.en" },
    } }],
  }));
  assert.equal(cc0Candidate({
    ...base,
    imageinfo: [{ ...base.imageinfo[0], extmetadata: {
      ...base.imageinfo[0].extmetadata,
      LicenseUrl: { value: "https://creativecommons.org/licenses/by/4.0/" },
    } }],
  }), null);
});
