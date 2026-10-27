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

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CANDIDATES = 8;
const AGENT = "LiOS-Terminal/1.0 (https://github.com/kiranvbiim-coder/lios-terminal; manual CC0 media review)";
type FetchLike = typeof fetch;

type Metadata = { value?: unknown };
type ImageInfo = {
  thumburl?: string;
  url?: string;
  descriptionurl?: string;
  mime?: string;
  size?: number;
  extmetadata?: Record<string, Metadata>;
};
type CommonsFile = { title?: string; imageinfo?: ImageInfo[] };
type CommonsPayload = { query?: { pages?: Record<string, CommonsFile> } };

export type CommonsCandidate = {
  fileTitle: string;
  filePage: string;
  previewUrl: string;
  creator: string;
  licenseUrl: typeof CC0_URL;
  license: "CC0 1.0";
  mime: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
};

function strippedText(value: unknown, max = 180): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim().slice(0, max);
}

function metadata(ext: ImageInfo["extmetadata"], key: string): string {
  return strippedText(ext?.[key]?.value, 260);
}

function validCommonsPage(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "commons.wikimedia.org"
      && u.pathname.startsWith("/wiki/File:") && !u.username && !u.password;
  } catch { return false; }
}

function safeUploadUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && u.hostname === "upload.wikimedia.org"
      && u.pathname.startsWith("/wikipedia/commons/") && !u.username && !u.password
      && /\.(?:jpe?g|png|webp|avif)$/i.test(u.pathname);
  } catch { return false; }
}

function safeTitle(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("File:")
    && value.length >= 7 && value.length <= 260 && !/[\r\n<>]/.test(value);
}

/** Strict CC0 AND canonical waiver URL. Other licenses always need manual review. */
export function cc0Candidate(page: CommonsFile): CommonsCandidate | null {
  const info = page.imageinfo?.[0];
  if (!safeTitle(page.title) || !info || !validCommonsPage(info.descriptionurl)) return null;
  if (!["cc0", "cc0 1.0"].includes(metadata(info.extmetadata, "LicenseShortName").toLowerCase())) return null;
  if (metadata(info.extmetadata, "NonFree").toLowerCase() === "true") return null;
  const license = metadata(info.extmetadata, "LicenseUrl");
  // Commons sometimes publishes the canonical CC0 deed URL as HTTP or with
  // /deed.en. Require exact CC0 host/path; never downgrade to BY/BY-SA.
  let licenseUrl: URL;
  try { licenseUrl = new URL(license); } catch { return null; }
  if (!["http:", "https:"].includes(licenseUrl.protocol)
    || licenseUrl.hostname !== "creativecommons.org"
    || !["/publicdomain/zero/1.0", "/publicdomain/zero/1.0/", "/publicdomain/zero/1.0/deed.en"].includes(licenseUrl.pathname)
    || licenseUrl.search || licenseUrl.hash || licenseUrl.username || licenseUrl.password) return null;
  const mime = info.mime;
  if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(mime ?? "")) return null;
  const previewUrl = info.thumburl;
  if (!safeUploadUrl(previewUrl)) return null;
  const creator = metadata(info.extmetadata, "Attribution") ||
    metadata(info.extmetadata, "Artist") || metadata(info.extmetadata, "Credit") || "Commons contributor (see file page)";
  return {
    fileTitle: page.title,
    filePage: info.descriptionurl,
    previewUrl,
    creator,
    license: "CC0 1.0",
    licenseUrl: CC0_URL,
    mime: mime as CommonsCandidate["mime"],
  };
}

export function commonsQuery(params: Record<string, string>): string {
  const url = new URL(COMMONS_API);
  for (const [key, value] of Object.entries({
    action: "query", format: "json", formatversion: "2",
    prop: "imageinfo", iiprop: "url|mime|extmetadata",
    iiurlwidth: "640",
    iiextmetadatafilter: "LicenseShortName|LicenseUrl|Attribution|Artist|Credit|NonFree",
    ...params,
  })) url.searchParams.set(key, value);
  return url.toString();
}

async function fetchCommons(url: string, requester: FetchLike): Promise<CommonsPayload> {
  if (new URL(url).origin !== new URL(COMMONS_API).origin) throw new Error("Unapproved API host.");
  const response = await requester(url, {
    redirect: "error",
    signal: AbortSignal.timeout(12_000),
    headers: { "User-Agent": AGENT, Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Wikimedia Commons API unavailable (" + response.status + ").");
  const size = Number(response.headers.get("content-length") || 0);
  if (size > 150_000) throw new Error("Commons metadata exceeded request budget.");
  const text = await response.text();
  if (text.length > 150_000) throw new Error("Commons metadata too large.");
  return JSON.parse(text) as CommonsPayload;
}

function candidates(payload: CommonsPayload): CommonsCandidate[] {
  return Object.values(payload.query?.pages ?? {})
    .map(cc0Candidate).filter((item): item is CommonsCandidate => item !== null).slice(0, MAX_CANDIDATES);
}

export async function searchCommonsCC0(term: string, requester: FetchLike = fetch): Promise<CommonsCandidate[]> {
  const q = term.trim();
  if (q.length < 3 || q.length > 100) throw new Error("Search must be between 3 and 100 characters.");
  const url = commonsQuery({ generator: "search", gsrsearch: q,
    gsrnamespace: "6", gsrlimit: String(MAX_CANDIDATES) });
  return candidates(await fetchCommons(url, requester));
}

export async function lookupCommonsCC0(title: string, requester: FetchLike = fetch): Promise<CommonsCandidate> {
  if (!safeTitle(title)) throw new Error("Choose a specific Commons File: title.");
  const url = commonsQuery({ titles: title });
  const list = candidates(await fetchCommons(url, requester));
  const match = list.find(item => item.fileTitle === title);
  if (!match) throw new Error("File has no confirmed CC0 metadata or supported image preview.");
  return match;
}

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
