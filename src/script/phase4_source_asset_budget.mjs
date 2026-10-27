/**
 * Source-output regression ceiling; not packaged startup/memory/interaction
 * qualification. Existing P14 probes remain authoritative for native timing.
 */
import { readdirSync, statSync } from "node:fs";
import { resolve, join, extname } from "node:path";

export const SOURCE_ASSET_CEILINGS = Object.freeze({
  maxSingleJsBytes: 32 * 1024 * 1024,
  maxTotalJsBytes: 100 * 1024 * 1024,
  maxTotalCssBytes: 20 * 1024 * 1024,
});
export function evaluateSourceAssetBudget(assetDir, caps = SOURCE_ASSET_CEILINGS) {
  const failures = [];
  const counts = { js: 0, css: 0 };
  const bytes = { js: 0, css: 0, largestJs: 0 };
  let entries;
  try {
    entries = readdirSync(resolve(assetDir), { withFileTypes: true });
  } catch {
    return { status: "failed", failures: ["Built client assets directory is absent or unreadable."], counts, bytes };
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    const kind = extension === ".js" ? "js" : extension === ".css" ? "css" : null;
    if (!kind) continue;
    const size = statSync(join(resolve(assetDir), entry.name)).size;
    counts[kind]++;
    bytes[kind] += size;
    if (kind === "js") {
      bytes.largestJs = Math.max(bytes.largestJs, size);
      if (size > caps.maxSingleJsBytes) failures.push("One JavaScript asset exceeds the source-size ceiling: " + entry.name);
    }
  }
  if (!counts.js) failures.push("No built JavaScript assets were found; refusing empty passing build.");
  if (bytes.js > caps.maxTotalJsBytes) failures.push("Total JavaScript exceeds the source-size ceiling.");
  if (bytes.css > caps.maxTotalCssBytes) failures.push("Total CSS exceeds the source-size ceiling.");
  return { status: failures.length ? "failed" : "passed", failures, counts, bytes, ceilings: caps, scope: "SOURCE_BUNDLE_ONLY_NOT_NATIVE_P14" };
}
