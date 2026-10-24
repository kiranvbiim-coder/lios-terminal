import { randomBytes } from "node:crypto";

/**
 * Public, one-shot AI provider readiness challenge.
 *
 * A static OK string can be replayed by a stale local gateway or cached
 * upstream response. Each call must prove that this specific public prompt
 * reached the selected model and a fresh acknowledgement came back.
 *
 * This is not provider identity attestation, native tool-calling verification,
 * a paid inference entitlement, or evidence of installed product acceptance.
 */
export function issueAIConnectionChallenge(): string {
  return `LIOS_AI_OK_${randomBytes(12).toString("hex")}`;
}

export function acceptsAIConnectionAcknowledgement(reply: unknown, challenge: string): boolean {
  if (typeof reply !== "string" || !/^LIOS_AI_OK_[a-f0-9]{24}$/.test(challenge)) return false;
  // Match the previous UX tolerance for common plain-text provider formatting;
  // never allow explanatory prose, extra lines or echoed instructions.
  const acknowledgement = reply.trim().replace(/^["'`]+|["'`.!]+$/g, "").trim();
  return acknowledgement === challenge;
}
