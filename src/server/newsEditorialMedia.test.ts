import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { approvedNewsMediaByUrl, resolveEditorialPublicRoot } from "./newsEditorialMedia";

const AS_OF = "2026-10-27T08:00:00.000Z";
const SRC = "https://news.google.com/rss/articles/exact-story";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL+tAAAAABJRU5ErkJggg==", "base64");
const HASH = createHash("sha256").update(PNG).digest("hex");

function media(state = "approved", sourceEvidenceId = SRC) {
  return {
    kind: "image",
    assetPath: "/editorial-media/" + HASH + ".png",
    sha256: HASH,
    alt: "Original, rights-reviewed photograph accompanying this story",
    attribution: "Rights-cleared original publisher photograph",
    owner: "Publisher with explicit permission",
    licenseName: "Verified commercial display and redistribution",
    licenseEvidenceRef: "internal:reviewed-license:editor-1",
    sourceEvidenceId,
    verifiedBy: "authorized-editor",
    verifiedAt: "2026-10-26T08:00:00.000Z",
    permission: "commercial_redistribution_and_display",
    offlineBundlingPermitted: true,
    state,
  };
}

test("only exact, signed-off source image with matching packaged file hash is attached", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-editorial-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "editorial-media"));
  const image = path.join(root, "editorial-media", HASH + ".png");
  const manifest = path.join(root, "editorial-media", "manifest.json");
  fs.writeFileSync(image, PNG);
  fs.writeFileSync(manifest, JSON.stringify([media()]));

  assert.equal(approvedNewsMediaByUrl(root, AS_OF).get(SRC)?.sha256, HASH);
  assert.equal(approvedNewsMediaByUrl(root, AS_OF).get("https://other.example/story"), undefined);

  fs.writeFileSync(manifest, JSON.stringify([media("revoked")]));
  assert.equal(approvedNewsMediaByUrl(root, AS_OF).size, 0);
  fs.writeFileSync(manifest, JSON.stringify([media()]));
  fs.writeFileSync(image, Buffer.from("tampered bytes"));
  assert.equal(approvedNewsMediaByUrl(root, AS_OF).size, 0);
});

test("missing/invalid grants and assets fail closed with no unrelated article image", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-editorial-empty-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(approvedNewsMediaByUrl(root, AS_OF).size, 0);
  fs.mkdirSync(path.join(root, "editorial-media"));
  fs.writeFileSync(path.join(root, "editorial-media", "manifest.json"), JSON.stringify([media()]));
  assert.equal(approvedNewsMediaByUrl(root, AS_OF).size, 0);
  fs.writeFileSync(path.join(root, "editorial-media", "manifest.json"), JSON.stringify([{ ...media(), assetPath: "https://evil.example/track.png" }]));
  assert.equal(approvedNewsMediaByUrl(root, AS_OF).size, 0);
});

test("bundled dist/public has precedence and works independently of launch cwd", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lios-media-paths-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const bundle = path.join(cwd, "pack", "dist");
  const bundledRoot = path.join(bundle, "public");
  const developmentRoot = path.join(cwd, "client", "public");
  for (const directory of [bundledRoot, developmentRoot]) {
    fs.mkdirSync(path.join(directory, "editorial-media"), { recursive: true });
    fs.writeFileSync(path.join(directory, "editorial-media", "manifest.json"), "[]");
  }
  assert.equal(resolveEditorialPublicRoot("/", bundle), bundledRoot);
  assert.equal(resolveEditorialPublicRoot(cwd, null), developmentRoot);
  const output = path.join(cwd, "dist", "public");
  fs.mkdirSync(path.join(output, "editorial-media"), { recursive: true });
  fs.writeFileSync(path.join(output, "editorial-media", "manifest.json"), "[]");
  assert.equal(resolveEditorialPublicRoot(cwd, null), output);
});
