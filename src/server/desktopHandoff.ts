import fs from "node:fs";
import { VAULT_SECRET_HANDOFF } from "./credentialVault";
import { LOCAL_TRUST_HANDOFF } from "./localDesktopTrust";

/**
 * The desktop hands this process its secrets on stdin instead of environment variables, so they are not
 * visible in the process environment or inherited by child processes (GM-01 D-12). Imported first by index.ts
 * so everything is in place before any module opens the vault or accepts a request.
 *
 * Wire format, only when the launcher set LIOS_DESKTOP_HANDOFF_ON_STDIN=1:
 *   LIOS-LOCAL-TOKEN <token>      required: per-launch token the window presents on every request
 *   LIOS-VAULT-SECRET <secret>    optional: the OS-protected credential-vault secret
 *   LIOS-HANDOFF-END              terminator
 * Plain `npm run dev` and server Homes never set the flag and use LIMURIA_VAULT_SECRET / the generated key file.
 */
export interface DesktopHandoff {
  localToken: string | null;
  vaultSecret: string | null;
}

const END = "LIOS-HANDOFF-END";

export function readDesktopHandoff(env: NodeJS.ProcessEnv = process.env, fd = 0, timeoutMs = 5_000): DesktopHandoff | null {
  if (env.LIOS_DESKTOP_HANDOFF_ON_STDIN !== "1") return null;
  const deadline = Date.now() + timeoutMs;
  const chunk = Buffer.alloc(4096);
  let text = "";
  while (!text.split("\n").some((line) => line.replace(/\r$/, "") === END) && Date.now() < deadline) {
    try {
      const read = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (read === 0) break;
      text += chunk.subarray(0, read).toString("utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EAGAIN") { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); continue; }
      if (code === "EOF") break;
      throw error;
    }
  }
  const handoff: DesktopHandoff = { localToken: null, vaultSecret: null };
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line === END) break;
    if (line.startsWith("LIOS-LOCAL-TOKEN ") && line.length > 17) handoff.localToken = line.slice(17);
    else if (line.startsWith("LIOS-VAULT-SECRET ") && line.length > 18) handoff.vaultSecret = line.slice(18);
  }
  return handoff;
}

const handoff = readDesktopHandoff();
if (handoff) {
  // The desktop always sends a token; starting without one would leave the API open to other local processes.
  if (!handoff.localToken || handoff.localToken.length < 32) throw new Error("The desktop did not provide a valid local trust token on stdin.");
  (globalThis as Record<symbol, unknown>)[LOCAL_TRUST_HANDOFF] = handoff.localToken;
  if (handoff.vaultSecret) (globalThis as Record<symbol, unknown>)[VAULT_SECRET_HANDOFF] = handoff.vaultSecret;
}
