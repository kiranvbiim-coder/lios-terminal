import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { z } from "zod";
import { restoreDeviceIdentity } from "../client/src/lib/gateway/deviceIdentity";
import { startRemoteNodeWorker } from "../server/remoteNodeWorker";

// Run with the repository's TS loader: node --import tsx script/remote_node_worker.ts /absolute/path/to/worker.json
// Configuration uses an ALREADY paired device identity and the out-of-band Home
// leaf certificate pin. No private material is generated, logged or transmitted
// before pin verification. Keep this config outside the source checkout.
const configSchema = z.object({
  url: z.string().url().max(2048), fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  keys: z.object({ publicKey: z.string().min(1).max(256), privateKeyPkcs8: z.string().min(1).max(512) }).strict(),
  finance: z.object({ sourceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/), profilePath: z.string().min(1).max(4096), ownerApproved: z.literal(true), dataRights: z.literal("user-owned-profile") }).strict().optional(),
}).strict();
async function main() {
  if (process.argv.length !== 3) throw new Error("Expected one private worker configuration path.");
  const file = await open(process.argv[2], constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let config;
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 8192 || (process.platform !== "win32" && ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()))) throw new Error("Worker configuration must be an owner-only regular file of at most 8192 bytes.");
    config = configSchema.parse(JSON.parse(await file.readFile("utf8")));
  } finally { await file.close(); }
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await startRemoteNodeWorker({ url: config.url, fingerprint: config.fingerprint, identity: await restoreDeviceIdentity(config.keys), finance: config.finance, signal: controller.signal }).done;
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
void main().catch(() => { console.error("Closed-read node worker stopped or refused configuration/transport. No operation was replayed."); process.exitCode = 1; });
