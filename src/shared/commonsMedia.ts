/**
 * Preview-only Wikimedia Commons metadata. Not an approved/packaged LiOS image.
 *
 * Only licenses whose terms allow displaying the picture with a credit are
 * accepted: CC0, public domain, CC BY and CC BY-SA. NonCommercial, NoDerivs,
 * fair-use, unknown or mismatched licenses are never accepted. Pictures are
 * shown as attributed, remote context illustrations; LiOS neither bundles,
 * re-hosts nor exports them.
 */
const CC_VERSIONS = ["2.0", "2.5", "3.0", "4.0"] as const;
type CcVersion = (typeof CC_VERSIONS)[number];

export type CommonsLicense =
  | "CC0 1.0"
  | "Public domain"
  | `CC BY ${CcVersion}`
  | `CC BY-SA ${CcVersion}`;

export const CC0_URL = "https://creativecommons.org/publicdomain/zero/1.0/";

export interface CommonsCandidate {
  fileTitle: string;
  filePage: string;
  previewUrl: string;
  /** Credit line to show; required for CC BY and CC BY-SA. */
  creator: string;
  license: CommonsLicense;
  /** Canonical deed URL for the license; null only for "Public domain". */
  licenseUrl: string | null;
  mime: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
}

/** Canonical deed URL for each accepted license, or null when none applies. */
export function commonsLicenseUrl(license: unknown): string | null | undefined {
  if (license === "CC0 1.0") return CC0_URL;
  if (license === "Public domain") return null;
  if (typeof license !== "string") return undefined;
  const match = /^CC (BY|BY-SA) (2\.0|2\.5|3\.0|4\.0)$/.exec(license);
  return match ? `https://creativecommons.org/licenses/${match[1].toLowerCase()}/${match[2]}/` : undefined;
}

/** True only for an accepted license paired with exactly its canonical deed URL. */
export function commonsLicenseValid(candidate: Pick<CommonsCandidate, "license" | "licenseUrl"> | null | undefined): boolean {
  if (!candidate) return false;
  const expected = commonsLicenseUrl(candidate.license);
  return expected !== undefined && (candidate.licenseUrl ?? null) === expected;
}

/** Share-order for choosing between valid candidates: no-credit grants first. */
export function commonsLicenseRank(license: CommonsLicense): number {
  if (license === "CC0 1.0" || license === "Public domain") return 0;
  return license.startsWith("CC BY-SA") ? 2 : 1;
}

/** One-line credit text shown wherever the picture appears. */
export function commonsAttributionLine(candidate: CommonsCandidate): string {
  const creator = candidate.creator.trim() || "Commons contributor";
  return `${creator} · ${candidate.license} · Wikimedia Commons`;
}

/** Do not allow upstream or untrusted response URLs to become arbitrary image requests. */
export function safeCommonsPreview(candidate: CommonsCandidate | null | undefined): string | null {
  if (!candidate || !commonsLicenseValid(candidate)) return null;
  try {
    const url = new URL(candidate.previewUrl);
    if (url.protocol !== "https:" || url.hostname !== "upload.wikimedia.org" ||
        !url.pathname.startsWith("/wikipedia/commons/") ||
        !/\.(?:jpe?g|png|webp|avif)$/i.test(url.pathname) ||
        url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

export function safeCommonsFilePage(candidate: CommonsCandidate): string | null {
  try {
    const url = new URL(candidate.filePage);
    return url.protocol === "https:" && url.hostname === "commons.wikimedia.org" &&
      url.pathname.startsWith("/wiki/File:") && !url.username && !url.password
      ? url.toString() : null;
  } catch { return null; }
}
