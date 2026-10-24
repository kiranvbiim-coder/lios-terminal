import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createGunzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { z } from "zod";
import { runCommand } from "./exec/run-command";
import { resolveSandboxRuntimeProfile } from "./exec/sandbox-runtime-profile";

export interface SandboxImageRelease {
  schemaVersion: 1;
  platform: "linux/arm64" | "linux/amd64";
  image: string;
  archive: "sandbox-image.tar.gz";
  archiveSha256: string;
  provenance: {
    sourceLock: "source-lock.json";
    sourceLockSha256: string;
    baseImage: { reference: string; platform: "linux/arm64" | "linux/amd64" };
    node: { version: string };
    xlsx: { version: string };
    docling: { version: string };
    browser: {
      playwrightVersion: string;
      chromiumRevision: string;
      browserVersion: string;
      modulePath: string;
      executablePath: string;
      qualification: "qualified";
    };
  };
}
export interface SandboxImageReadiness {
  state: "ready" | "missing_release" | "integrity_failed" | "engine_unavailable" | "image_missing" | "incompatible" | "repair_failed";
  ready: boolean;
  image: string | null;
  repairAction: "none" | "load" | "reinstall_app" | "install_engine" | "retry";
  reason: string;
}
const releaseSchema = z.object({
  schemaVersion: z.literal(1),
  platform: z.enum(["linux/arm64", "linux/amd64"]),
  image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  archive: z.literal("sandbox-image.tar.gz"),
  archiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
  provenance: z.object({
    sourceLock: z.literal("source-lock.json"),
    sourceLockSha256: z.string().regex(/^[a-f0-9]{64}$/),
    baseImage: z.object({ reference: z.string(), platform: z.enum(["linux/arm64", "linux/amd64"]) }),
    node: z.object({ version: z.string() }),
    xlsx: z.object({ version: z.string() }),
    docling: z.object({ version: z.string() }),
    browser: z.object({
      playwrightVersion: z.literal("1.63.0"),
      chromiumRevision: z.literal("1243"),
      browserVersion: z.string(),
      modulePath: z.literal("/opt/lios/node_modules/playwright-core"),
      executablePath: z.literal("/opt/lios/browser/chromium"),
      qualification: z.literal("qualified"),
    }),
  }),
}).strict();
/** Same host-to-OCI architecture contract used by the packaged desktop bootstrap.
 * This maps a candidate platform only; it never qualifies a release image.
 * Support is limited to signed desktop target families with a Linux OCI sandbox.
 */
export function requiredSandboxReleasePlatform(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): "linux/arm64" | "linux/amd64" {
  if (platform !== "darwin" && platform !== "win32" && platform !== "linux") {
    throw new Error("Sandbox repair is unsupported for this host operating system.");
  }
  if (arch === "arm64") return "linux/arm64";
  if (arch === "x64") return "linux/amd64";
  throw new Error("Sandbox repair is unsupported for this host architecture.");
}

export function requireSandboxReleasePlatform(
  releasePlatform: SandboxImageRelease["platform"],
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): void {
  const expected = requiredSandboxReleasePlatform(platform, arch);
  if (releasePlatform !== expected) {
    throw new Error(`Packaged sandbox is incompatible with host ${platform}/${arch}: expected ${expected}, found ${releasePlatform}.`);
  }
}

const ARCHIVE = "sandbox-image.tar.gz";
const MANIFEST = "sandbox-image.json";
function releaseDirectory(): string | null {
  const base = "resourcesPath" in process && typeof process.resourcesPath === "string"
    ? process.resourcesPath
    : process.env.ELECTRON_RESOURCES_PATH;
  return base ? path.join(base, "sandbox-image-dist") : null;
}
function readRelease(): { release: SandboxImageRelease; archive: string; lock: string } | null {
  const directory = releaseDirectory();
  if (!directory) return null;
  const releasePath = path.join(directory, MANIFEST);
  if (!fs.existsSync(releasePath)) return null;
  const manifestStat = fs.lstatSync(releasePath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) throw new Error("The packaged sandbox manifest is not a regular file.");
  const release = releaseSchema.parse(JSON.parse(fs.readFileSync(releasePath, "utf8")));
  requireSandboxReleasePlatform(release.platform);
  const archive = path.join(directory, ARCHIVE);
  const archiveStat = fs.lstatSync(archive);
  if (!archiveStat.isFile() || archiveStat.isSymbolicLink()) throw new Error("The packaged sandbox archive is not a regular file.");
  const lock = path.join(directory, "source-lock.json");
  const lockStat = fs.lstatSync(lock);
  if (!lockStat.isFile() || lockStat.isSymbolicLink()) throw new Error("The packaged sandbox source lock is missing or not a regular file.");
  return { release, archive, lock };
}
async function verifiedRelease(): Promise<{ release: SandboxImageRelease; archive: string } | null> {
  const bundle = readRelease();
  if (!bundle) return null;
  const lockHash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(bundle.lock)) lockHash.update(chunk);
  if (lockHash.digest("hex") !== bundle.release.provenance.sourceLockSha256) throw new Error("Packaged source lock checksum differs from release provenance.");
  const lock = JSON.parse(fs.readFileSync(bundle.lock, "utf8"));
  if (lock.schemaVersion !== 1 || lock.releaseStatus !== "ready" || lock.provenance?.verified !== true || !lock.acceptedPlatforms?.includes(bundle.release.platform)) throw new Error("Packaged source lock is not release-qualified for the manifest platform.");
  if (lock.baseImage?.platform !== bundle.release.platform || lock.baseImage?.reference !== bundle.release.provenance.baseImage.reference || lock.node?.version !== bundle.release.provenance.node.version || lock.xlsx?.version !== bundle.release.provenance.xlsx.version || lock.docling?.version !== bundle.release.provenance.docling.version) throw new Error("Sandbox release provenance differs from its trusted source lock.");
  const browser = lock.browser;
  if (lock.verifiedImageId !== bundle.release.image || browser?.qualification !== "qualified") throw new Error("Packaged image lacks exact browser runtime qualification.");
  for (const key of ["playwrightVersion", "chromiumRevision", "browserVersion", "modulePath", "executablePath", "qualification"] as const) {
    if (browser[key] !== bundle.release.provenance.browser[key]) throw new Error("Browser release provenance differs from its trusted source lock.");
  }
  for (const pin of [browser.artifactInventory, browser.dependencyInventory]) {
    if (!pin || typeof pin.file !== "string" || path.basename(pin.file) !== pin.file || !/^[a-f0-9]{64}$/.test(pin.sha256 ?? "")) throw new Error("Packaged browser inventory pin is malformed.");
    const file = path.join(path.dirname(bundle.lock), pin.file);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== pin.sha256) throw new Error("Packaged browser inventory differs from its trusted source lock.");
  }
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(bundle.archive)) hash.update(chunk);
  if (hash.digest("hex") !== bundle.release.archiveSha256) throw new Error("The packaged sandbox archive checksum differs from its release manifest.");
  return bundle;
}
async function engineCommand(engine: "docker" | "podman", target: string, args: string[], timeoutMs = 15_000): Promise<string> {
  const result = await runCommand({
    argv: [engine, engine === "docker" ? `--host=${target}` : `--url=${target}`, ...args],
    timeoutMs,
    maxOutputChars: 64 * 1024,
  });
  return result.stdout.trim();
}
function status(state: SandboxImageReadiness["state"], image: string | null, reason: string, repairAction: SandboxImageReadiness["repairAction"]): SandboxImageReadiness {
  return { state, ready: state === "ready", image, reason, repairAction };
}
/** Packaged release is read-only. Repair imports only its hash-verified image into the explicit local engine. */
export async function inspectSandboxImageReadiness(): Promise<SandboxImageReadiness> {
  let bundle;
  try { bundle = await verifiedRelease(); }
  catch (error) { return status("integrity_failed", null, error instanceof Error ? error.message : "Sandbox release integrity failed.", "reinstall_app"); }
  if (!bundle) return status("missing_release", null, "No signed sandbox image is bundled with this desktop; host fallback is not permitted.", "reinstall_app");
  const { release } = bundle;
  if (process.env.LIOS_EXECUTION_SANDBOX_IMAGE !== release.image) {
    return status("incompatible", release.image, "Configured sandbox digest differs from the packaged release.", "reinstall_app");
  }
  let profile;
  try { profile = resolveSandboxRuntimeProfile(); }
  catch (error) { return status("engine_unavailable", release.image, error instanceof Error ? error.message : "Sandbox engine is not configured.", "install_engine"); }
  if (profile.mode !== "strict" || !profile.engine || !profile.engineTarget) {
    return status("incompatible", release.image, "Strict sandbox isolation is not enabled.", "reinstall_app");
  }
  try {
    const inspected = await engineCommand(profile.engine, profile.engineTarget, ["image", "inspect", "--format", "{{.Id}} {{.Os}}/{{.Architecture}}", release.image]);
    if (inspected !== `${release.image} ${release.platform}`) return status("integrity_failed", release.image, `Engine image ID/platform differs from release (${inspected}).`, "reinstall_app");
    return status("ready", release.image, "Verified packaged image ID and platform are available on the explicit local engine.", "none");
  } catch {
    try { await engineCommand(profile.engine, profile.engineTarget, ["info", "--format", "{{.OSType}}"]); }
    catch { return status("engine_unavailable", release.image, "Local container engine is unavailable; start Docker Desktop or Podman.", "install_engine"); }
    return status("image_missing", release.image, "The packaged sandbox image has not been imported into the local engine.", "load");
  }
}
let loading: Promise<SandboxImageReadiness> | null = null;
export function repairSandboxImage(): Promise<SandboxImageReadiness> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const before = await inspectSandboxImageReadiness();
      if (before.state !== "image_missing") return before;
      const bundle = await verifiedRelease();
      if (!bundle) return status("missing_release", null, "Sandbox release is missing.", "reinstall_app");
      const profile = resolveSandboxRuntimeProfile();
      if (!profile.engine || !profile.engineTarget) return status("engine_unavailable", bundle.release.image, "Explicit local engine is unavailable.", "install_engine");
      const child = spawn(profile.engine, [
        profile.engine === "docker" ? `--host=${profile.engineTarget}` : `--url=${profile.engineTarget}`,
        "load",
      ], { stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      let timedOut = false;
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4096); });
      const completed = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => code === 0
          ? resolve()
          : reject(new Error(timedOut
            ? "Image import exceeded the 15-minute limit."
            : `Local sandbox image load failed: ${stderr.trim() || code}`)));
      });
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, 15 * 60_000);
      timeout.unref();
      try {
        await Promise.all([
          pipeline(fs.createReadStream(bundle.archive), createGunzip(), child.stdin),
          completed,
        ]);
      } catch (error) {
        child.kill("SIGKILL");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      const after = await inspectSandboxImageReadiness();
      return after.state === "ready" ? after : status("repair_failed", bundle.release.image, `Image load completed but verification returned ${after.state}: ${after.reason}`, "retry");
    } catch (error) {
      return status("repair_failed", null, error instanceof Error ? error.message : "Sandbox image repair failed.", "retry");
    }
  })().finally(() => { loading = null; });
  return loading;
}
