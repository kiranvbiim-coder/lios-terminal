/**
 * Bounded, read-only Wikimedia Commons discovery. Two modes share one parser:
 * the strict CC0-only mode feeds the build-time bundled-media importer, and the
 * display mode (runtime News/Pulse context illustrations) also accepts public
 * domain, CC BY and CC BY-SA, which are only ever shown with credit.
 */
import { commonsLicenseRank, commonsLicenseUrl, type CommonsCandidate, type CommonsLicense } from "../shared/commonsMedia";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_CANDIDATES = 8;
// Search a broader page because most Commons images are BY/SA rather than CC0.
// One request, at most eight CC0 results returned to LiOS.
const DISCOVERY_PAGE_LIMIT = 30;
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

/** Map Commons' license name onto an accepted license; null when not accepted. */
function acceptedLicense(shortName: string): CommonsLicense | null {
  const name = shortName.trim().replace(/\s+/g, " ");
  const lower = name.toLowerCase();
  if (lower === "cc0" || lower === "cc0 1.0") return "CC0 1.0";
  if (lower === "public domain") return "Public domain";
  const match = /^cc (by|by-sa) (2\.0|2\.5|3\.0|4\.0)$/i.exec(name);
  return match ? (`CC ${match[1].toUpperCase()} ${match[2]}` as CommonsLicense) : null;
}

/** Does the published license URL equal the canonical deed for this license? */
function licenseUrlMatches(license: CommonsLicense, published: string): boolean {
  const expected = commonsLicenseUrl(license);
  if (expected === null) return published === "" ; // public domain has no deed
  if (!expected) return false;
  let url: URL;
  try { url = new URL(published); } catch { return false; }
  if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "creativecommons.org"
    || url.search || url.hash || url.username || url.password) return false;
  // Commons sometimes publishes the HTTP form or a /deed.en suffix of the same deed.
  const canonical = new URL(expected).pathname;
  return [canonical, canonical.replace(/\/$/, ""), canonical + "deed.en"].includes(url.pathname);
}

/**
 * Accepts only explicit, canonical license metadata. `cc0Only` is the strict
 * mode; otherwise public domain, CC BY and CC BY-SA are also accepted. NonFree,
 * NC/ND and unknown licenses are always refused.
 */
export function commonsCandidate(page: CommonsFile, options: { cc0Only?: boolean } = {}): CommonsCandidate | null {
  const info = page.imageinfo?.[0];
  if (!safeTitle(page.title) || !info || !validCommonsPage(info.descriptionurl)) return null;
  const license = acceptedLicense(metadata(info.extmetadata, "LicenseShortName"));
  if (!license || (options.cc0Only && license !== "CC0 1.0")) return null;
  if (metadata(info.extmetadata, "NonFree").toLowerCase() === "true") return null;
  if (!licenseUrlMatches(license, metadata(info.extmetadata, "LicenseUrl"))) return null;
  const mime = info.mime;
  if (!["image/jpeg", "image/png", "image/webp", "image/avif"].includes(mime ?? "")) return null;
  const previewUrl = info.thumburl;
  if (!safeUploadUrl(previewUrl)) return null;
  const credit = metadata(info.extmetadata, "Attribution") ||
    metadata(info.extmetadata, "Artist") || metadata(info.extmetadata, "Credit");
  // CC BY and CC BY-SA require a credit; never invent one for them.
  if (!credit && license !== "CC0 1.0" && license !== "Public domain") return null;
  return {
    fileTitle: page.title,
    filePage: info.descriptionurl,
    previewUrl,
    creator: credit || "Commons contributor (see file page)",
    license,
    licenseUrl: commonsLicenseUrl(license) ?? null,
    mime: mime as CommonsCandidate["mime"],
  };
}

/** Strict CC0 AND canonical waiver URL (bundled-media importer). */
export function cc0Candidate(page: CommonsFile): CommonsCandidate | null {
  return commonsCandidate(page, { cc0Only: true });
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

function candidates(payload: CommonsPayload, options: { cc0Only?: boolean }): CommonsCandidate[] {
  return Object.values(payload.query?.pages ?? {})
    .map(page => commonsCandidate(page, options)).filter((item): item is CommonsCandidate => item !== null)
    // No-credit grants first, then CC BY, then CC BY-SA; stable otherwise.
    .sort((a, b) => commonsLicenseRank(a.license) - commonsLicenseRank(b.license))
    .slice(0, MAX_CANDIDATES);
}

function searchUrl(term: string): string {
  const q = term.trim();
  if (q.length < 3 || q.length > 100) throw new Error("Search must be between 3 and 100 characters.");
  // filetype:bitmap keeps results to raster photos (no PDFs, SVG logos or audio).
  return commonsQuery({ generator: "search", gsrsearch: `${q} filetype:bitmap`,
    gsrnamespace: "6", gsrlimit: String(DISCOVERY_PAGE_LIMIT) });
}

/** Strict CC0-only search for the build-time bundled-media importer. */
export async function searchCommonsCC0(term: string, requester: FetchLike = fetch): Promise<CommonsCandidate[]> {
  return candidates(await fetchCommons(searchUrl(term), requester), { cc0Only: true });
}

/** Runtime display search: CC0, public domain, CC BY and CC BY-SA, shown with credit. */
export async function searchCommonsImages(term: string, requester: FetchLike = fetch): Promise<CommonsCandidate[]> {
  return candidates(await fetchCommons(searchUrl(term), requester), {});
}

async function lookup(title: string, requester: FetchLike, options: { cc0Only?: boolean }): Promise<CommonsCandidate> {
  if (!safeTitle(title)) throw new Error("Choose a specific Commons File: title.");
  const list = candidates(await fetchCommons(commonsQuery({ titles: title }), requester), options);
  const match = list.find(item => item.fileTitle === title);
  if (!match) throw new Error(options.cc0Only
    ? "File has no confirmed CC0 metadata or supported image preview."
    : "File has no confirmed accepted license or supported image preview.");
  return match;
}

export function lookupCommonsCC0(title: string, requester: FetchLike = fetch): Promise<CommonsCandidate> {
  return lookup(title, requester, { cc0Only: true });
}

/** Re-verifies a saved illustration against CURRENT license metadata. */
export function lookupCommonsImage(title: string, requester: FetchLike = fetch): Promise<CommonsCandidate> {
  return lookup(title, requester, {});
}

