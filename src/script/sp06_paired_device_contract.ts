import fs from "node:fs";
import path from "node:path";

export interface Sp06Target {
  origin: string;
  wssUrl: string;
  fingerprint: string;
  projectId: number;
  appBinary: string;
  appCommit: string;
  cookie: string;
  evidencePath: string;
}

/**
 * This is a manual test on an already-running, operator-identified packaged
 * local Home. Never silently convert a user Home into a destructive fixture.
 * Requiring the executable and commit is evidence metadata, not proof that
 * the live Home process was launched from that executable.
 */
export function parseSp06Target(env: NodeJS.ProcessEnv): Sp06Target {
  if (env.LIOS_SP06_DISPOSABLE_HOME !== "1") {
    throw new Error("SP-06 refuses to mutate a non-disposable Home. Set LIOS_SP06_DISPOSABLE_HOME=1 for an isolated test installation.");
  }
  const rawOrigin = env.LIOS_SP06_HOME_ORIGIN?.trim() ?? "";
  const origin = new URL(rawOrigin);
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)
    || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") {
    throw new Error("SP-06 requires a loopback HTTP Home origin with no embedded credentials or path.");
  }
  const device = new URL(env.LIOS_SP06_DEVICE_WSS_URL?.trim() ?? "");
  if (device.protocol !== "wss:" || device.pathname !== "/gateway/device" || device.search
    || device.hash || device.username || device.password
    || !["127.0.0.1", "localhost", "[::1]"].includes(device.hostname)) {
    throw new Error("SP-06 requires a loopback, pinned wss:// device endpoint with no embedded credentials.");
  }
  const fingerprint = env.LIOS_SP06_TLS_FINGERPRINT?.trim() ?? "";
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("SP-06 requires an exact lowercase 64-character TLS SHA-256 pin.");
  const projectId = Number(env.LIOS_SP06_PROJECT_ID);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) throw new Error("SP-06 requires an existing disposable Project ID.");
  const appCommit = env.LIOS_SP06_TARGET_COMMIT?.trim() ?? "";
  if (!/^[a-f0-9]{40}$/.test(appCommit)) throw new Error("SP-06 requires an exact 40-character source commit.");
  const appBinary = path.resolve(env.LIOS_SP06_APP_BINARY?.trim() ?? "");
  if (!env.LIOS_SP06_APP_BINARY?.trim() || !fs.existsSync(appBinary) || !fs.statSync(appBinary).isFile()) {
    throw new Error("SP-06 requires a real existing packaged application executable.");
  }
  const cookie = env.LIOS_SP06_OWNER_COOKIE ?? "";
  if (!cookie || /[\r\n]/.test(cookie) || cookie.length > 8192) {
    throw new Error("SP-06 requires a current Home-owner session cookie in the process environment.");
  }
  const evidencePath = path.resolve(env.LIOS_SP06_EVIDENCE_PATH?.trim() || "./sp06-local-evidence.json");
  return { origin: origin.origin, wssUrl: device.toString(), fingerprint, projectId, appBinary, appCommit, cookie, evidencePath };
}

export function assertSp06HomeIdentity(target: Pick<Sp06Target,"fingerprint"|"wssUrl">, home: {
  enabled: boolean; fingerprint: string | null; homeId: string | null; port: number | null;
}): string {
  if (!home.enabled || !home.homeId || home.fingerprint !== target.fingerprint) {
    throw new Error("SP-06 refused: live Home is disabled or does not match the pinned certificate.");
  }
  const port = Number(new URL(target.wssUrl).port || "443");
  if (port !== home.port) throw new Error("SP-06 refused: WSS listener port is not the current Home device port.");
  return home.homeId;
}
