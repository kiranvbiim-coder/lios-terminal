import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
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
  fs.writeFileSync(path.join(root, "wrong.png"), "not an image");
  assert.throws(() => importLicensedNewsPhoto(path.join(root, "wrong.png"), grant, out), /non-empty file|Image content/);
  assert.equal(fs.existsSync(path.join(out, "editorial-media", "manifest.json")), false);
});


test("preflight rejects a malformed existing grant without copying another image", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-license-prefail-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const src = path.join(root, "image.png");
  fs.writeFileSync(src, photo);
  const out = path.join(root, "public");
  const folder = path.join(out, "editorial-media");
  fs.mkdirSync(folder, { recursive: true });
  const manifest = path.join(folder, "manifest.json");
  const original = JSON.stringify([{ state: "pending", sourceEvidenceId: "https://news.example.org/unreviewed" }]);
  fs.writeFileSync(manifest, original);
  assert.throws(() => importLicensedNewsPhoto(src, grant, out), /Existing editorial release manifest/);
  assert.equal(fs.readFileSync(manifest, "utf8"), original);
  assert.deepEqual(fs.readdirSync(folder), ["manifest.json"]);
});

test("release-size budget is enforced before copying new licensed bytes", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-license-budget-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const out = path.join(root, "public");
  const folder = path.join(out, "editorial-media");
  fs.mkdirSync(folder, { recursive: true });
  const records = [];
  for (let i = 0; i < 8; i++) {
    // Synthetic format-signature fixture, NOT a real licensed photograph.
    // Unique hashes give eight distinct 4-MiB assets: exactly 32 MiB total.
    const bytes = Buffer.alloc(4 * 1024 * 1024, i + 1);
    photo.copy(bytes, 0, 0, 8);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const name = sha256 + ".png";
    fs.writeFileSync(path.join(folder, name), bytes);
    records.push({ ...grant, sourceEvidenceId: source + "/existing/" + i,
      assetPath: "/editorial-media/" + name, sha256 });
  }
  const manifest = path.join(folder, "manifest.json");
  const original = JSON.stringify(records, null, 2) + "\n";
  fs.writeFileSync(manifest, original);
  const src = path.join(root, "candidate.png");
  fs.writeFileSync(src, photo);
  assert.throws(() => importLicensedNewsPhoto(src, grant, out), /32 MiB release-size budget/);
  assert.equal(fs.readFileSync(manifest, "utf8"), original);
  assert.equal(fs.readdirSync(folder).length, 9);
});

test("orphaned image files prevent a new import until the asset set is reconciled", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-license-orphan-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  const src = path.join(root, "photo.png");
  fs.writeFileSync(src, photo);
  const out = path.join(root, "public");
  const folder = path.join(out, "editorial-media");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "orphan.png"), photo);
  fs.writeFileSync(path.join(folder, "manifest.json"), "[]\n");
  assert.throws(() => importLicensedNewsPhoto(src, grant, out), /unreferenced or orphaned/);
  assert.deepEqual(fs.readdirSync(folder).sort(), ["manifest.json", "orphan.png"]);
});
