import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifyBundledEditorialAssets } from "./verifyEditorialMedia";

const timestamp = "2026-10-27T08:00:00Z";
function fixture(t: { after: (callback: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "lios-a2-media-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const folder = join(root, "editorial-media");
  mkdirSync(folder);
  const ledgerPath = join(root, "ledger.json");
  const png = Buffer.concat([Buffer.from("89504e470d0a1a0a","hex"),Buffer.alloc(60,1)]);
  const digest = createHash("sha256").update(png).digest("hex");
  const fileName = digest + ".png";
  const media = {
    kind: "image", assetPath: "/editorial-media/" + fileName, sha256: digest,
    alt: "A licensed illustration of a rural energy installation",
    caption: "Original project photograph", attribution: "Project editorial team",
    owner: "Limuria Intelligence LLP", licenseName: "Owned original editorial illustration",
    licenseEvidenceRef: "internal-license-ledger:energy:2026-10-27",
    sourceEvidenceId: "source:owned:1", verifiedBy: "verified-reviewer",
    verifiedAt: "2026-10-26T08:00:00Z", permission: "commercial_redistribution_and_display",
    offlineBundlingPermitted: true, state: "approved",
  };
  const save = (assets: unknown[]) => writeFileSync(ledgerPath, JSON.stringify({ schemaVersion:1, assets }));
  return { folder, ledgerPath, png, fileName, media, save };
}

test("empty signed-off ledger permits no bundled images and no remote fetch", t => {
  const f=fixture(t);
  f.save([]);
  const state=verifyBundledEditorialAssets(f.ledgerPath,f.folder,timestamp);
  assert.deepEqual(state,{inspected:0,eligible:0,status:"bundled_assets_verified"});
});

test("packager accepts real hash-matched local media with explicit rights record", t => {
  const f=fixture(t);
  writeFileSync(join(f.folder,f.fileName),f.png);
  f.save([f.media]);
  const result=verifyBundledEditorialAssets(f.ledgerPath,f.folder,timestamp);
  assert.equal(result.eligible,1);
  assert.equal(result.inspected,1);
});

test("bundler refuses unreviewed extra files, revoked rights and exact-byte tampering", t => {
  const f=fixture(t);
  writeFileSync(join(f.folder,f.fileName),f.png);
  f.save([f.media]);
  writeFileSync(join(f.folder,"not-licensed.png"),f.png);
  assert.throws(() => verifyBundledEditorialAssets(f.ledgerPath,f.folder,timestamp),/Unlicensed asset/);
  rmSync(join(f.folder,"not-licensed.png"));
  f.save([{...f.media,state:"revoked"}]);
  assert.throws(() => verifyBundledEditorialAssets(f.ledgerPath,f.folder,timestamp),/Unapproved/);
  f.save([f.media]);
  writeFileSync(join(f.folder,f.fileName),Buffer.concat([f.png,Buffer.from([2])]));
  assert.throws(() => verifyBundledEditorialAssets(f.ledgerPath,f.folder,timestamp),/integrity|mismatch/);
});

test("right digest but disguised HTML is never permitted as an image", t => {
  const f=fixture(t);
  const html=Buffer.from("<html><script>alert(1)</script></html>");
  const sha=createHash("sha256").update(html).digest("hex");
  const renamed=sha+".png";
  writeFileSync(join(f.folder,renamed),html);
  f.save([{...f.media,assetPath:"/editorial-media/"+renamed,sha256:sha}]);
  assert.throws(() => verifyBundledEditorialAssets(f.ledgerPath,f.folder,timestamp),/signature mismatch/);
});

test("symlinked images are rejected even if they have an approved ledger entry", t => {
  if (process.platform === "win32") return;
  const f=fixture(t);
  const source=join(f.folder,"original.tmp");
  writeFileSync(source,f.png);
  symlinkSync(source,join(f.folder,f.fileName));
  f.save([f.media]);
  assert.throws(() => verifyBundledEditorialAssets(f.ledgerPath,f.folder,timestamp),/Invalid, missing, linked/);
});

test("package rejects media past their rights expiry, even if bytes remain unchanged", t => {
  const f=fixture(t);
  writeFileSync(join(f.folder,f.fileName),f.png);
  f.save([{...f.media,expiresAt:"2026-10-27T07:59:59Z"}]);
  assert.throws(() => verifyBundledEditorialAssets(f.ledgerPath,f.folder,timestamp),/Unapproved/);
  f.save([{...f.media,expiresAt:"2026-11-30T00:00:00Z"}]);
  assert.throws(() => verifyBundledEditorialAssets(f.ledgerPath,f.folder,timestamp),/Time-limited/);
});
