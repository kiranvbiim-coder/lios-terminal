import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { importLicensedNewsPhoto } from "./import_licensed_editorial_image";

const photo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL+tAAAAABJRU5ErkJggg==", "base64");
const source = "https://news.example.org/real-published-article";
const grant = {
  kind: "image",
  alt: "Licensed original photograph from the publication's source archive",
  caption: "Source-provided archive photograph, not a claim of a current scene",
  owner: "Rights-cleared publisher",
  attribution: "Publication photographer, used with explicit permission",
  licenseName: "Documented commercial and offline reproduction",
  licenseEvidenceRef: "permission:explicit-reviewed-letter:editor",
  sourceEvidenceId: source,
  verifiedBy: "authorized-media-editor",
  verifiedAt: "2026-10-26T08:00:00.000Z",
  permission: "commercial_redistribution_and_display",
  offlineBundlingPermitted: true,
  state: "approved",
};

test("local image with reviewed grant becomes a hash-named article-specific asset", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-license-intake-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const src = path.join(root, "source.png");
  fs.writeFileSync(src, photo);
  const publicRoot = path.join(root, "public");
  const result = importLicensedNewsPhoto(src, grant, publicRoot);
  assert.match(result.assetPath, /^\/editorial-media\/[a-f0-9]{64}\.png$/);
  assert.ok(fs.existsSync(path.join(publicRoot, result.assetPath.slice(1))));
  assert.equal(JSON.parse(fs.readFileSync(path.join(publicRoot, "editorial-media", "manifest.json"), "utf8"))[0].sourceEvidenceId, source);
  assert.throws(() => importLicensedNewsPhoto(src, grant, publicRoot), /already has a reviewed image/);
});

test("no rights assertion, unsafe format and unrelated source cannot be accepted", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-license-refusal-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const src = path.join(root, "source.png");
  fs.writeFileSync(src, photo);
  const out = path.join(root, "public");
  assert.throws(() => importLicensedNewsPhoto(src, { ...grant, permission: "publisher_thumbnail_only" }, out), /Grant is invalid/);
  assert.throws(() => importLicensedNewsPhoto(src, { ...grant, sourceEvidenceId: "file:\/\/\/secret" }, out), /ordinary public/);
  assert.throws(() => importLicensedNewsPhoto(src, { ...grant, state: "pending" }, out), /must be approved/);
  for (const field of ["api_key", "access_token", "signature", "session_id"])
    assert.throws(() => importLicensedNewsPhoto(src, { ...grant, sourceEvidenceId: source + "?" + field + "=private" }, out), /ordinary public/);
  fs.writeFileSync(path.join(root, "wrong.png"), "not an image");
  assert.throws(() => importLicensedNewsPhoto(path.join(root, "wrong.png"), grant, out), /non-empty file|Image content/);
  assert.equal(fs.existsSync(path.join(out, "editorial-media", "manifest.json")), false);
});
