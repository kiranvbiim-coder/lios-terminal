import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { editorialMediaSchema, eligibleEditorialMedia } from "@shared/editorialMedia";

const ledgerSchema = z.array(editorialMediaSchema).max(128);

export const EDITORIAL_LEDGER_PATH = fileURLToPath(new URL("../client/public/editorial-media/manifest.json", import.meta.url));
export const EDITORIAL_PUBLIC_DIRECTORY = fileURLToPath(new URL("../client/public/editorial-media/", import.meta.url));

function allowedSignature(buffer: Buffer, extension: string): boolean {
  if (extension === ".png") return buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  if (extension === ".jpg" || extension === ".jpeg") return buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (extension === ".webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  if (extension === ".avif") return buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp" && ["avif", "avis"].includes(buffer.toString("ascii", 8, 12));
  return false;
}

/** No network. No auto-licensing. Fails shipping of any unreviewed image bytes. */
export function verifyBundledEditorialAssets(
  ledgerPath = EDITORIAL_LEDGER_PATH,
  publicDirectory = EDITORIAL_PUBLIC_DIRECTORY,
  asOf = new Date().toISOString(),
) {
  const input: unknown = JSON.parse(readFileSync(ledgerPath, "utf8"));
  const ledger = { assets: ledgerSchema.parse(input) };
  const listed = new Set<string>();
  if (!existsSync(publicDirectory)) {
    if (ledger.assets.length) throw new Error("Licensed editorial asset folder missing.");
    return { inspected: 0, eligible: 0, status: "no_licensed_images_bundled" as const };
  }
  const folder = lstatSync(publicDirectory);
  if (!folder.isDirectory() || folder.isSymbolicLink()) throw new Error("Asset directory must be a regular directory.");
  const actual = readdirSync(publicDirectory).filter(name => name !== "manifest.json");
  for (const asset of ledger.assets) {
    if (!eligibleEditorialMedia(asset, [asset.sourceEvidenceId], asOf))
      throw new Error("Unapproved, expired or unlinked editorial rights record: " + asset.assetPath);
    // Installed/offline copies cannot be retroactively retracted at license expiry.
    if (asset.expiresAt) throw new Error("Time-limited editorial rights cannot be bundled in user-owned offline installers.");
    const fileName = basename(asset.assetPath);
    if (listed.has(fileName)) throw new Error("Repeated licensed asset in the rights ledger.");
    listed.add(fileName);
    const file = join(publicDirectory, fileName);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 16 || stat.size > 6_000_000)
      throw new Error("Invalid, missing, linked, empty or excessive editorial asset: " + fileName);
    const bytes = readFileSync(file);
    const sha = createHash("sha256").update(bytes).digest("hex");
    if (sha !== asset.sha256 || !allowedSignature(bytes, extname(fileName)))
      throw new Error("Editorial image integrity or content signature mismatch: " + fileName);
  }
  if (actual.some(name => !listed.has(name))) throw new Error("Unlicensed asset discovered in the editorial public folder.");
  return { inspected: actual.length, eligible: ledger.assets.length, status: "bundled_assets_verified" as const };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.stdout.write(JSON.stringify(verifyBundledEditorialAssets()) + "\n");
  } catch {
    process.stderr.write("Editorial media integrity gate rejected incomplete or unlicensed assets.\n");
    process.exitCode = 1;
  }
}
