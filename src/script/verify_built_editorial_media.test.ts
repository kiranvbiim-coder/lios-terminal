import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { verifyBuiltEditorialMedia } from "./verify_built_editorial_media";

const NOW = "2026-10-27T12:00:00.000Z";
const ARTICLE = "https://news.example.org/a/source-backed-story";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL+tAAAAABJRU5ErkJggg==","base64");
const SHA = createHash("sha256").update(PNG).digest("hex");
const NAME = SHA + ".png";
const grant = {
  kind: "image", assetPath: "/editorial-media/" + NAME, sha256: SHA,
  alt: "Documented rights-cleared article illustration image",
  attribution: "Original author; explicitly authorised for distribution",
  owner: "Author and original rights owner",
  licenseName: "Owner-approved commercial and offline reuse",
  licenseEvidenceRef: "permission:documented:original-author-1",
  sourceEvidenceId: ARTICLE, verifiedBy: "licensed-media-reviewer",
  verifiedAt: "2026-10-26T00:00:00.000Z",
  state: "approved", permission: "commercial_redistribution_and_display",
  offlineBundlingPermitted: true,
};

function fixture(t: { after: (fn: () => void) => void }, withImage = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),"lios-real-build-photo-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root,"client","public");
  const built = path.join(root,"dist","public");
  for (const folder of [source,built]) fs.mkdirSync(path.join(folder,"editorial-media"),{ recursive: true });
  const grants = withImage ? [grant] : [];
  for (const base of [source,built]) {
    fs.writeFileSync(path.join(base,"editorial-media","manifest.json"),JSON.stringify(grants));
    if (withImage) fs.writeFileSync(path.join(base,"editorial-media",NAME),PNG);
  }
  return { source, built };
}

test("empty reviewed-photo manifest is valid and no image is fabricated", t => {
  const { source, built } = fixture(t,false);
  assert.deepEqual(verifyBuiltEditorialMedia(source,built,NOW),{
    status: "passed", grants: 0, files: 0, imageBytes: 0,
  });
});

test("a genuine approved local photo survives the Vite static-copy contract", t => {
  const { source,built }=fixture(t);
  assert.deepEqual(verifyBuiltEditorialMedia(source,built,NOW),{
    status:"passed",grants:1,files:1,imageBytes:PNG.length,
  });
});

test("stray files, missing images and altered image pixels stop the release", t => {
  const { source,built }=fixture(t);
  const image=path.join(built,"editorial-media",NAME);
  fs.writeFileSync(path.join(built,"editorial-media","unapproved-image.jpg"),PNG);
  assert.throws(()=>verifyBuiltEditorialMedia(source,built,NOW),/unreferenced|non-file/);
  fs.unlinkSync(path.join(built,"editorial-media","unapproved-image.jpg"));
  fs.writeFileSync(image,Buffer.from(PNG.map((byte,i)=>i===20 ? byte^1 : byte)));
  assert.throws(()=>verifyBuiltEditorialMedia(source,built,NOW),/valid hash|signature|source grant/);
  fs.unlinkSync(image);
  assert.throws(()=>verifyBuiltEditorialMedia(source,built,NOW),/missing, unreferenced|unreferenced|non-file/);
});

test("revoked, future, duplicated and divergent manifests cannot ship", t => {
  const { source,built }=fixture(t);
  const manifest=path.join(built,"editorial-media","manifest.json");
  const sourceManifest=path.join(source,"editorial-media","manifest.json");
  const setGrants=(rows: unknown[])=>{
    for(const file of [manifest,sourceManifest]) fs.writeFileSync(file,JSON.stringify(rows));
  };
  setGrants([{...grant,state:"revoked"}]);
  assert.throws(()=>verifyBuiltEditorialMedia(source,built,NOW),/Only active/);
  setGrants([{...grant,verifiedAt:"2026-10-28T00:00:00.000Z"}]);
  assert.throws(()=>verifyBuiltEditorialMedia(source,built,NOW),/Only active/);
  setGrants([grant,{...grant,attribution:"second listing"}]);
  assert.throws(()=>verifyBuiltEditorialMedia(source,built,NOW),/more than one/);
  setGrants([grant]);
  fs.writeFileSync(manifest,"[]");
  assert.throws(()=>verifyBuiltEditorialMedia(source,built,NOW),/Build changed/);
});

test("public manifests cannot publish credential query values in article identities", t => {
  const { source, built } = fixture(t);
  for (const base of [source, built])
    fs.writeFileSync(path.join(base, "editorial-media", "manifest.json"), JSON.stringify([{ ...grant, sourceEvidenceId: ARTICLE + "?access_token=private" }]));
  assert.throws(() => verifyBuiltEditorialMedia(source, built, NOW), /private credentials/);
});
