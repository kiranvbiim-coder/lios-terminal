/**
 * LangAlpha provenance fingerprint mechanism, adapted into existing LiOS P7
 * ResearchArtifact evidence. Apache-2.0 source:
 * ginlix-ai/LangAlpha@db8f8c2dee948c9c6f77805558898c3abb637328
 * src/ptc_agent/agent/provenance/types.py (blob
 * 8b54bc5d0d79c740aa809a40372b6afed1cce577).
 *
 * This is NOT source verification or rights approval: it binds the exact saved
 * quote UTF-8 bytes to its digest for later tamper detection. P7 owns source
 * acquisition and custody; P4 owns immutable Artifact versions. No LangAlpha
 * agent, sandbox, PostgreSQL, provider or separate provenance store is used.
 */
import crypto from "node:crypto";
import { z } from "zod";

export const recordedExcerptFingerprintSchema = z.object({
  excerptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  excerptByteLength: z.number().int().nonnegative().max(64 * 1024),
}).strict();
export type RecordedExcerptFingerprint = z.infer<typeof recordedExcerptFingerprintSchema>;

/** Hash the exact P7-visible saved quote, not an unbounded source body. */
export function fingerprintRecordedExcerpt(excerpt: string): RecordedExcerptFingerprint {
  const bytes = Buffer.from(excerpt, "utf8");
  if (bytes.length > 64 * 1024) throw new Error("Recorded excerpt exceeds the bounded 64 KiB provenance budget.");
  return recordedExcerptFingerprintSchema.parse({
    excerptSha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    excerptByteLength: bytes.length,
  });
}

/** Check only quote-byte identity; never claim its document/market facts are true. */
export function matchesRecordedExcerptFingerprint(
  excerpt: string,
  metadata: unknown,
): boolean {
  const stored = recordedExcerptFingerprintSchema.safeParse(metadata);
  if (!stored.success) return false;
  try {
    const observed = fingerprintRecordedExcerpt(excerpt);
    return stored.data.excerptSha256 === observed.excerptSha256
      && stored.data.excerptByteLength === observed.excerptByteLength;
  } catch {
    return false;
  }
}
