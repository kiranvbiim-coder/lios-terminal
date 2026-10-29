import { z } from "zod";

export const PROJECT_MEMORY_RECALL_CONSENT_VERSION = "lios-project-memory-recall/1" as const;
export const projectMemoryRecallChoiceSchema = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }).strict(),
  z.object({ enabled: z.literal(true), consent: z.literal(true), consentVersion: z.literal(PROJECT_MEMORY_RECALL_CONSENT_VERSION) }).strict(),
]);
export interface ProjectMemoryRecallConsent {
  enabled: boolean;
  consentVersion: typeof PROJECT_MEMORY_RECALL_CONSENT_VERSION;
  acceptedAt: string | null;
}
