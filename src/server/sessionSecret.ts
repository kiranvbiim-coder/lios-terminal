import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { stateDir } from "./dataRoot";

let cached: { key: string; value: string } | null = null;

/**
 * The Home's signing secret for sessions and device-binding cookies: SESSION_SECRET when the operator supplies one
 * (multi-node Homes), otherwise a random owner-only file in the state directory. There is no built-in fallback:
 * a default key shared by every install would make every device-binding cookie forgeable.
 */
export function getSessionSecret(): string {
  const supplied = process.env.SESSION_SECRET?.trim();
  if (supplied) return supplied;
  const dir = stateDir();
  const file = path.join(dir, "session-secret");
  if (cached?.key === file) return cached.value;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(file, crypto.randomBytes(32).toString("hex"), { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
    throw new Error("LiOS session secret must be a private regular file (mode 0600 or stricter).");
  }
  const value = fs.readFileSync(file, "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("LiOS session secret is invalid; refusing to issue sessions.");
  cached = { key: file, value };
  return value;
}
