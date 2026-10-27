/** Preview-only Wikimedia Commons metadata. Not an approved/packaged LiOS image. */
export interface CommonsCandidate {
  fileTitle: string;
  filePage: string;
  previewUrl: string;
  creator: string;
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/";
  license: "CC0 1.0";
  mime: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
}

/** Do not allow upstream or untrusted response URLs to become arbitrary image requests. */
export function safeCommonsPreview(candidate: CommonsCandidate | null | undefined): string | null {
  if (!candidate || candidate.license !== "CC0 1.0") return null;
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
