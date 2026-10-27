/**
 * Bind an explicitly reviewed, locally bundled image to the exact news source.
 * Never fetch a publisher-provided candidate or infer a grant from RSS.
 *
 * The manifest is public release metadata; the asset is packed into the
 * existing client/public directory and served as a same-origin static image.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { eligibleEditorialMedia, type EditorialMedia } from "@shared/editorialMedia";

const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_MEDIA_ITEMS = 128;

function containsRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

function imageSignatureValid(bytes: Buffer, extension: string): boolean {
  if (extension === "png") return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === "jpg" || extension === "jpeg") return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (extension === "webp") return bytes.length > 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
  if (extension === "avif") return bytes.length > 12 && bytes.toString("ascii", 4, 8) === "ftyp" && ["avif", "avis"].includes(bytes.toString("ascii", 8, 12));
  return false;
}

/** Offline asset verification, bounded to one configured static asset root. */
export function approvedNewsMediaByUrl(root: string, asOf: string): Map<string, EditorialMedia> {
  const approved = new Map<string, EditorialMedia>();
  const manifest = path.join(root, "editorial-media", "manifest.json");
  try {
    const rootReal = fs.realpathSync(root);
    const meta = fs.statSync(manifest);
    if (!meta.isFile() || meta.size > MAX_MANIFEST_BYTES) return approved;
    const payload: unknown = JSON.parse(fs.readFileSync(manifest, "utf8"));
    if (!Array.isArray(payload) || payload.length > MAX_MEDIA_ITEMS) return approved;
    for (const entry of payload) {
      try {
      const candidate = eligibleEditorialMedia(entry, [entry?.sourceEvidenceId].filter((x): x is string => typeof x === "string"), asOf);
      if (!candidate || approved.has(candidate.sourceEvidenceId)) continue;
      const relative = candidate.assetPath.slice(1);
      const file = path.join(rootReal, relative);
      const real = fs.realpathSync(file);
      if (!containsRoot(rootReal, real)) continue;
      const info = fs.statSync(real);
      if (!info.isFile() || info.size < 16 || info.size > MAX_IMAGE_BYTES) continue;
      const image = fs.readFileSync(real);
      if (!imageSignatureValid(image, path.extname(real).slice(1).toLowerCase())) continue;
      if (createHash("sha256").update(image).digest("hex") !== candidate.sha256) continue;
      approved.set(candidate.sourceEvidenceId, candidate);
      } catch {
        // A single missing or invalid file must not suppress other approved stories.
        continue;
      }
    }
  } catch {
    // No licensed asset is an ordinary state: news remains available without pictures.
  }
  return approved;
}

/** Bundled public files differ between development and packaged/static builds. */
export function resolveEditorialPublicRoot(
  cwd = process.cwd(),
  bundledDirectory: string | null = typeof __dirname === "string" ? __dirname : null,
): string | null {
  // Packaged Electron starts from an arbitrary cwd (often "/"). The same
  // __dirname/public directory is used by serveStatic's production entry.
  // Vite development instead serves the src/client/public directory.
  const candidates = [
    bundledDirectory ? path.resolve(bundledDirectory, "public") : null,
    path.resolve(cwd, "dist/public"),
    path.resolve(cwd, "src/dist/public"),
    path.resolve(cwd, "client/public"),
    path.resolve(cwd, "src/client/public"),
  ];
  for (const root of candidates) {
    if (root && fs.existsSync(path.join(root, "editorial-media", "manifest.json"))) return root;
  }
  return null;
}

/** One read per feed refresh, not one file-system walk for every RSS article. */
export function approvedNewsMediaForFeed(asOf = new Date().toISOString()): Map<string, EditorialMedia> {
  const root = resolveEditorialPublicRoot();
  return root ? approvedNewsMediaByUrl(root, asOf) : new Map();
}
