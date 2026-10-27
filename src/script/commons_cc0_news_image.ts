/**
 * $0 editorial photo discovery: Wikimedia Commons CC0 only.
 *
 * search: node --import tsx script/commons_cc0_news_image.ts search "renewable energy"
 * import: node --import tsx script/commons_cc0_news_image.ts import \
 *   "https://publisher.example/exact-news-story" "File:Solar panels.jpg" client/public
 *
 * User chooses the file and target story explicitly. A Commons photo is ALWAYS
 * labelled illustrative, never misrepresented as a photo of the reported event.
 * No scraping, no background fetch, no bulk import, no provider token, no new
 * server service; images only become visible after local import and hash review.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importLicensedNewsPhoto } from "./import_licensed_editorial_image";

import { lookupCommonsCC0, searchCommonsCC0, safeUploadUrl, strippedText } from "../server/commonsCc0Media";
export { cc0Candidate, commonsQuery, searchCommonsCC0 } from "../server/commonsCc0Media";
const AGENT = "LiOS-Terminal/1.0 (https://github.com/kiranvbiim-coder/lios-terminal; manual CC0 media review)";
const MAX_BYTES = 4 * 1024 * 1024;
type FetchLike = typeof fetch;

async function downloadBoundedImage(url: string, requester: FetchLike): Promise<Buffer> {
  if (!safeUploadUrl(url)) throw new Error("Media origin or image format not allowed.");
  const response = await requester(url, {
    redirect: "error", signal: AbortSignal.timeout(20_000),
    headers: { "User-Agent": AGENT, Accept: "image/avif,image/webp,image/png,image/jpeg" },
  });
  if (!response.ok || !response.body) throw new Error("Commons preview download failed.");
  const size = Number(response.headers.get("content-length") || 0);
  if (size > MAX_BYTES) throw new Error("Commons preview exceeds 4 MB limit.");
  const kind = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(kind)) throw new Error("Expected an image, not another media type.");
  let total = 0;
  const chunks: Uint8Array[] = [];
  const stream = response.body.getReader();
  try {
    while (true) {
      const next = await stream.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_BYTES) throw new Error("Commons download exceeded bounded byte budget.");
      chunks.push(next.value);
    }
  } finally { await stream.cancel().catch(() => undefined); stream.releaseLock(); }
  return Buffer.concat(chunks, total);
}

export async function importCommonsCC0Context(
  exactArticleUrl: string, title: string, publicRoot: string,
  requester: FetchLike = fetch,
): Promise<{ sourcePage: string; assetPath: string; license: string }> {
  // A person supplies both these inputs. Never auto-assign news by keyword.
  let article: URL;
  try { article = new URL(exactArticleUrl); } catch { throw new Error("Exact article URL required."); }
  if (!["https:", "http:"].includes(article.protocol) || !article.hostname.includes(".") ||
    article.username || article.password) throw new Error("Invalid article URL.");
  const selected = await lookupCommonsCC0(title, requester);
  const bytes = await downloadBoundedImage(selected.previewUrl, requester);
  const ext = path.extname(new URL(selected.previewUrl).pathname).toLowerCase();
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "lios-commons-cc0-"));
  const file = path.join(temporary, "image" + ext);
  try {
    fs.writeFileSync(file, bytes, { flag: "wx" });
    const saved = importLicensedNewsPhoto(file, {
      kind: "image",
      alt: "Illustrative context photograph: " + strippedText(selected.fileTitle.slice(5), 190),
      caption: "Context illustration, not a photograph of the reported event. Wikimedia Commons.",
      owner: selected.creator,
      attribution: selected.creator + " · Wikimedia Commons",
      licenseName: selected.license,
      licenseEvidenceRef: selected.filePage,
      mediaSourcePage: selected.filePage,
      usageContext: "illustrative",
      sourceEvidenceId: article.toString(),
      verifiedBy: "Commons CC0 metadata; manually selected for this article",
      verifiedAt: new Date().toISOString(),
      permission: "commercial_redistribution_and_display",
      offlineBundlingPermitted: true,
      state: "approved",
    }, publicRoot);
    return { sourcePage: selected.filePage, assetPath: saved.assetPath, license: selected.license };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (import.meta.url && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, arg1, arg2, arg3] = process.argv.slice(2);
  try {
    if (operation === "search" && arg1 && !arg2) {
      searchCommonsCC0(arg1).then(items => process.stdout.write(JSON.stringify(items, null, 2) + "\n"))
        .catch(e => { process.stderr.write(String(e) + "\n"); process.exitCode = 1; });
    } else if (operation === "import" && arg1 && arg2) {
      importCommonsCC0Context(arg1, arg2, path.resolve(arg3 ?? "client/public"))
        .then(out => process.stdout.write("Saved: " + JSON.stringify(out) + "\n"))
        .catch(e => { process.stderr.write(String(e) + "\n"); process.exitCode = 1; });
    } else {
      process.stderr.write("Usage: commons_cc0_news_image.ts search <keywords> OR import <exact-article-url> <Commons File:title> [client/public]\n");
      process.exitCode = 2;
    }
  } catch (error) {
    process.stderr.write(String(error) + "\n");
    process.exitCode = 1;
  }
}
