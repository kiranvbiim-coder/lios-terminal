import test from "node:test";
import assert from "node:assert/strict";
import type { lookup } from "node:dns/promises";
import { readFileSync } from "node:fs";
import {
  isPermittedNewsIp, resolvePublicNewsAddress, validatePublicNewsUrl,
} from "./publicNewsArticleFetch";

test("News read-through accepts ordinary public publisher URLs but not credentials or private hostnames", () => {
  assert.equal(validatePublicNewsUrl("https://publisher.example.com/story?q=1").href,
    "https://publisher.example.com/story?q=1");
  for (const url of [
    "file:///etc/passwd", "http://localhost:5000/internal", "https://foo.local/story",
    "https://metadata.google.internal/latest", "http://127.0.0.1/secret",
    "http://192.168.1.1/secret", "http://[::1]/private",
    "http://[::ffff:127.0.0.1]/private", "https://login:secret@publisher.example.com/story",
    "https://publisher.example.com:4321/story", "javascript:alert(1)",
  ]) assert.throws(() => validatePublicNewsUrl(url), undefined, url);
});

test("private, link-local, reserved, embedded and metadata DNS answers are refused", () => {
  for (const ip of [
    "127.0.0.1", "10.1.1.1", "192.168.0.5", "169.254.169.254",
    "100.100.100.200", "0.0.0.0", "255.255.255.255", "::1",
    "fc00::123", "::ffff:10.0.0.1", "198.18.0.1",
  ]) assert.equal(isPermittedNewsIp(ip), false, ip);
  assert.equal(isPermittedNewsIp("8.8.8.8"), true);
  assert.equal(isPermittedNewsIp("2606:4700:4700::1111"), true);
});

test("one unsafe DNS answer disqualifies an otherwise public hostname", async () => {
  const malicious = (async () => [
    { address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 },
  ]) as unknown as typeof lookup;
  await assert.rejects(resolvePublicNewsAddress("publisher.example.com", malicious), /private or unsupported/);
  const publicDns = (async () => [{ address: "8.8.4.4", family: 4 }]) as unknown as typeof lookup;
  assert.deepEqual(await resolvePublicNewsAddress("publisher.example.com", publicDns),
    { address: "8.8.4.4", family: 4 });
});

test("production getNewsArticle uses pinned and bounded transport rather than the generic provider fetchText", () => {
  const market = readFileSync(new URL("./marketData.ts", import.meta.url), "utf8");
  const section = market.slice(market.indexOf("export async function getNewsArticle("),
    market.indexOf("export async function getNewsArticle(") + 1900);
  assert.match(section, /validatePublicNewsUrl|sanitizeArticleUrl/);
  assert.match(section, /fetchPublicNewsArticleHtml\(url\)/);
  assert.doesNotMatch(section, /await fetchText\(url\)/);
  const transport = readFileSync(new URL("./publicNewsArticleFetch.ts", import.meta.url), "utf8");
  assert.match(transport, /agent: false/);
  assert.match(transport, /lookup: \(_host, _options, callback\)/);
  assert.match(transport, /MAX_HTML_BYTES/);
  assert.match(transport, /validatePublicNewsUrl\(new URL\(location, url\)\.href\)/);
});
