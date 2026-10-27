/**
 * Build-time release acceptance of the exact static editorial image payload.
 * Reuses the live feed's source-linked SHA-256 + image-signature validator.
 * Rejects unreferenced image binaries and malformed grants rather than
 * accidentally distributing media alongside a compliant empty manifest.
 */
import fs from "node:fs";
import path from "node:path";
import { editorialMediaSchema } from "../shared/editorialMedia";
import { approvedNewsMediaByUrl } from "../server/newsEditorialMedia";

const MAX_MEDIA_ROWS = 128;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_BUNDLED_EDITORIAL_BYTES = 32 * 1024 * 1024;

export function verifyBuiltEditorialMedia(
  sourceRoot = path.resolve("client/public"),
  builtRoot = path.resolve("dist/public"),
  at = new Date().toISOString(),
): { status: "passed"; grants: number; files: number; imageBytes: number } {
  const sourceFolder = path.join(sourceRoot, "editorial-media");
  const builtFolder = path.join(builtRoot, "editorial-media");
  const sourceManifest = path.join(sourceFolder, "manifest.json");
  const builtManifest = path.join(builtFolder, "manifest.json");
  if (!fs.existsSync(sourceManifest) || !fs.existsSync(builtManifest)) {
    throw new Error("Editorial media manifest must exist in source and the built static directory.");
  }
  for (const manifest of [sourceManifest, builtManifest]) {
    const stat = fs.lstatSync(manifest);
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error("Editorial manifest is not a bounded regular file.");
  }
  const sourceBytes = fs.readFileSync(sourceManifest);
  const builtBytes = fs.readFileSync(builtManifest);
  if (!sourceBytes.equals(builtBytes)) throw new Error("Build changed the approved editorial manifest.");
  const manifest: unknown = JSON.parse(builtBytes.toString("utf8"));
  if (!Array.isArray(manifest) || manifest.length > MAX_MEDIA_ROWS) throw new Error("Editorial grant list exceeds the approved limit.");

  const expected = new Set<string>();
  const sourceIds = new Set<string>();
  for (const row of manifest) {
    const parsed = editorialMediaSchema.safeParse(row);
    if (!parsed.success) throw new Error("Build includes a malformed editorial media grant.");
    const media = parsed.data;
    if (media.state !== "approved" ||
        Date.parse(at) < Date.parse(media.verifiedAt) ||
        (media.expiresAt && Date.parse(media.expiresAt) <= Date.parse(at))) {
      throw new Error("Only active, reviewed and unexpired media grants may ship.");
    }
    if (sourceIds.has(media.sourceEvidenceId)) throw new Error("One article has more than one purported approved image.");
    sourceIds.add(media.sourceEvidenceId);
    expected.add(path.basename(media.assetPath));
  }

  const shipped = fs.readdirSync(builtFolder, { withFileTypes: true });
  const files = shipped.filter(entry => entry.name !== "manifest.json");
  if (files.length !== expected.size ||
      files.some(entry => !entry.isFile() || !expected.has(entry.name))) {
    throw new Error("Bundled editorial media contains missing, unreferenced or non-file image assets.");
  }

  let imageBytes = 0;
  for (const filename of expected) {
    const sourceFile = path.join(sourceFolder, filename);
    const builtFile = path.join(builtFolder, filename);
    const original = fs.lstatSync(sourceFile);
    const bundled = fs.lstatSync(builtFile);
    if (!original.isFile() || !bundled.isFile() || original.size !== bundled.size) {
      throw new Error("An approved source image was not copied intact into the bundle.");
    }
    imageBytes += bundled.size;
    if (imageBytes > MAX_BUNDLED_EDITORIAL_BYTES) {
      throw new Error("Editorial images exceed the strict 32 MiB release-size budget.");
    }
  }

  // Fail closed if ANY media fails the existing release and runtime SHA
  // validation; no declared file can be silently omitted from an accepted app.
  const accepted = approvedNewsMediaByUrl(builtRoot, at);
  if (accepted.size !== manifest.length ||
      [...sourceIds].some(sourceId => !accepted.has(sourceId))) {
    throw new Error("An editorial image lacks the required valid hash, signature or exact source grant.");
  }
  return { status: "passed", grants: manifest.length, files: expected.size, imageBytes };
}
