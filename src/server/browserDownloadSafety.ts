/**
 * browser-use download watchdog adaptations, source-pinned to
 * browser-use/browser-use@a6e103e27d28c390ac6421a6ee8ac21f1b1dfc1c.
 * Source: browser_use/browser/watchdogs/downloads_watchdog.py;
 * tests/ci/security/test_download_filename_sanitization.py (MIT).
 *
 * Pure basename sanitization and boundary checks only. GM-14's existing
 * isolated browser network/file authority remains the sole execution owner.
 */
import fs from "node:fs";
import path from "node:path";

export const BROWSER_USE_DOWNLOAD_SOURCE = Object.freeze({
  repository:"browser-use/browser-use",
  commit:"a6e103e27d28c390ac6421a6ee8ac21f1b1dfc1c",
  license:"MIT",
  bundledBrowserUseRuntime:false,
});

export function sanitizeBrowserDownloadFilename(raw: string): string {
  if(typeof raw!=="string" || raw.length>2_000) {
    throw new TypeError("Browser download filename must be bounded text.");
  }
  // Browser-controlled names may use Unix, Windows, or mixed separators.
  const name=raw.replace(/\\/g,"/").split("/").at(-1)!
    .replace(/[\u0000-\u001f\u007f]/g,"")
    .replace(/[<>:"|?*]/g,"-")
    .trim()
    .slice(0,180);
  return !name || /^\.+$/.test(name) ? "download" : name;
}

/**
 * Verify an adapter-reported path is strictly under an approved root. Resolve
 * relative paths lexically, then resolve symlinks when both paths exist locally.
 * Unresolvable remote workers still have to enforce file transport isolation.
 */
export function assertBrowserDownloadInsideRoots(candidate:string, roots:readonly string[]): string {
  if(typeof candidate!=="string"||!path.isAbsolute(candidate)||
     candidate.includes("\0") ||candidate.length>4_096) {
    throw new Error("Browser download target must be an absolute bounded path.");
  }
  if(!Array.isArray(roots)||roots.length===0||roots.length>16) {
    throw new Error("Browser download requires approved filesystem roots.");
  }
  const target=path.resolve(candidate);
  for(const rootInput of roots){
    if(typeof rootInput!=="string"||!path.isAbsolute(rootInput)||rootInput.includes("\0")) continue;
    const root=path.resolve(rootInput);
    const relative=path.relative(root,target);
    if(!relative || relative===".." || relative.startsWith(".."+path.sep) || path.isAbsolute(relative)) continue;
    // When the path is present on the host, links cannot lead outside the
    // approved real root. A remote worker additionally enforces its sandbox.
    if(fs.existsSync(root)&&fs.existsSync(target)){
      const realRoot=fs.realpathSync(root);
      const realTarget=fs.realpathSync(target);
      const realRelative=path.relative(realRoot,realTarget);
      if(!realRelative || realRelative===".." ||
         realRelative.startsWith(".."+path.sep) ||path.isAbsolute(realRelative)) continue;
    }
    return target;
  }
  throw new Error("Browser download target escaped Project-approved filesystem roots.");
}
