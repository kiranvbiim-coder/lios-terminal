/** Bounded, read-only Wikimedia Commons CC0 discovery for opt-in LiOS image search. */
import type { CommonsCandidate } from "../shared/commonsMedia";
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


export function strippedText(value: unknown, max = 180): string {
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

export function safeUploadUrl(value: unknown): value is string {
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

