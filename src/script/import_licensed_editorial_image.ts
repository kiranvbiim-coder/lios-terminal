/**
 * Local-only intake of a human-reviewed news photograph. No remote download,
 * publisher scraping, license guessing or image generation occurs here.
 *
 * Usage:
 * node --import tsx script/import_licensed_editorial_image.ts \
 *   /path/to/rights-cleared-photo.webp /path/to/grant.json client/public
 *
 * The grant contains the EditorialMedia fields except assetPath and sha256.
 * sourceEvidenceId must be the EXACT published article URL recorded in RSS.
 * A written grant must be independently reviewed before invoking this tool.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { editorialMediaSchema, eligibleEditorialMedia, type EditorialMedia } from "../shared/editorialMedia";
import { approvedNewsMediaByUrl } from "../server/newsEditorialMedia";

const MAX_IMAGE = 4 * 1024 * 1024;
const MAX_MANIFEST = 128 * 1024;
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

function checkImage(bytes: Buffer, ext: string): boolean {
  if (ext === ".png") return bytes.length >= 16 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (ext === ".jpg" || ext === ".jpeg") return bytes.length >= 16 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (ext === ".webp") return bytes.length >= 16 && bytes.toString("ascii",0,4) === "RIFF" && bytes.toString("ascii",8,12) === "WEBP";
  if (ext === ".avif") return bytes.length >= 16 && bytes.toString("ascii",4,8) === "ftyp" && ["avif","avis"].includes(bytes.toString("ascii",8,12));
  return false;
}

export function importLicensedNewsPhoto(imagePath: string, grant: unknown, publicRoot: string): EditorialMedia {
  const ext = path.extname(imagePath).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) throw new Error("Only JPG, PNG, WEBP, and AVIF files are accepted.");
  const original = fs.statSync(imagePath);
  if (!original.isFile() || original.size < 16 || original.size > MAX_IMAGE) throw new Error("Image must be a non-empty file of 4 MB or less.");
  const bytes = fs.readFileSync(imagePath);
  if (!checkImage(bytes, ext)) throw new Error("Image content does not match the declared extension.");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const assetPath = "/editorial-media/" + sha256 + ext;
  const record = grant && typeof grant === "object" && !Array.isArray(grant) ? grant : {};
  const parsed = editorialMediaSchema.safeParse({ ...record, assetPath, sha256 });
  if (!parsed.success) throw new Error("Grant is invalid or missing the required explicit commercial/offline reuse review.");
  const media = parsed.data;
  let sourceUrl: URL;
  try { sourceUrl = new URL(media.sourceEvidenceId); }
  catch { throw new Error("Exact published article URL is required as sourceEvidenceId."); }
  if (!["https:", "http:"].includes(sourceUrl.protocol) || sourceUrl.username || sourceUrl.password || !sourceUrl.hostname.includes(".")) {
    throw new Error("Article evidence must be an ordinary public HTTP(S) URL.");
  }
  if (!eligibleEditorialMedia(media, [media.sourceEvidenceId], new Date().toISOString())) {
    throw new Error("Grant must be approved, effective, unexpired and linked to the article.");
  }

  const folder = path.join(publicRoot, "editorial-media");
  fs.mkdirSync(folder, { recursive: true });
  const manifest = path.join(folder, "manifest.json");
  let existing: unknown = [];
  if (fs.existsSync(manifest)) {
    if (fs.statSync(manifest).size > MAX_MANIFEST) throw new Error("Image manifest exceeds size limit.");
    existing = JSON.parse(fs.readFileSync(manifest, "utf8"));
  }
  if (!Array.isArray(existing) || existing.length >= 128) throw new Error("Image manifest must be a bounded JSON array.");
  if (existing.some(row => row?.sourceEvidenceId === media.sourceEvidenceId)) {
    throw new Error("Article already has a reviewed image; do not overwrite its grant without separate review.");
  }
  const destination = path.join(folder, path.basename(assetPath));
  if (fs.existsSync(destination)) {
    const saved = fs.readFileSync(destination);
    if (!saved.equals(bytes)) throw new Error("Existing content-addressed image differs from the approved bytes.");
  } else {
    fs.writeFileSync(destination, bytes, { flag: "wx" });
  }
  const next = JSON.stringify([...existing, media], null, 2) + "\n";
  if (Buffer.byteLength(next) > MAX_MANIFEST) throw new Error("New manifest would exceed maximum size.");
  const temporary = manifest + ".pending-" + process.pid;
  try {
    fs.writeFileSync(temporary, next, { flag: "wx" });
    fs.renameSync(temporary, manifest);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary);
  }
  if (approvedNewsMediaByUrl(publicRoot, new Date().toISOString()).get(media.sourceEvidenceId)?.sha256 !== sha256) {
    throw new Error("Imported image failed independent release-asset validation.");
  }
  return media;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [image, grantPath, output = "client/public"] = process.argv.slice(2);
  if (!image || !grantPath) {
    process.stderr.write("Usage: node --import tsx script/import_licensed_editorial_image.ts <approved-local-image> <reviewed-grant.json> [public-root]\n");
    process.exitCode = 2;
  } else {
    try {
      const grant = JSON.parse(fs.readFileSync(grantPath, "utf8"));
      const saved = importLicensedNewsPhoto(image, grant, path.resolve(output));
      process.stdout.write("Licensed article image imported: " + saved.assetPath + "\n");
    } catch (cause) {
      process.stderr.write((cause instanceof Error ? cause.message : String(cause)) + "\n");
      process.exitCode = 1;
    }
  }
}
