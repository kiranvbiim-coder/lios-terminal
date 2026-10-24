import { createHash } from "node:crypto";

/**
 * Recheck the returned-file digest at the final consumer boundary. GM-11's
 * output collector calculates sha256 during return, but a caller must not
 * assume that subsequent transport/adapters preserved the same bytes.
 *
 * This is an integrity assertion only. It does not confer execution permission,
 * qualify a sandbox image or replace GM-11 workspace transfer validation.
 */
export function matchesWorkspaceOutputDigest(input: {
  data: Buffer;
  sha256: string;
}): boolean {
  if (!Buffer.isBuffer(input.data) || typeof input.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(input.sha256)) return false;
  return createHash("sha256").update(input.data).digest("hex") === input.sha256;
}
