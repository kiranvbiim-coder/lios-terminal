import { z } from "zod";

/** Declared financial events attach to canonical Timeline Artifacts; this contract is not another event store. */
export const financialEventClassSchema = z.enum([
  "earnings", "filing", "guidance", "recommendation", "corporate_action",
  "financing", "deal", "rating", "macro_policy", "regulatory",
]);
export type FinancialEventClass = z.infer<typeof financialEventClassSchema>;

const ref = z.string().trim().min(1).max(500);
const sourceRef = z.string().trim().min(1).max(1_000);
export const financialEventRelationshipSchema = z.object({
  fromRef: ref,
  toRef: ref,
  relation: z.enum(["issuer", "counterparty", "owns", "supplier", "customer", "exposed_to", "affected_by", "regulates"]),
  /** Explicit source declaration, not a prediction, causal estimate or sentiment classification. */
  impact: z.enum(["positive", "negative", "neutral", "unknown"]).default("unknown"),
  sourceRefs: z.array(sourceRef).min(1).max(20),
}).strict().superRefine((value, ctx) => {
  if (value.fromRef === value.toRef) ctx.addIssue({ code: "custom", path: ["toRef"], message: "Financial relationships require distinct endpoints." });
});

export const financialEventSchema = z.object({
  id: z.string().trim().min(1).max(200),
  eventClass: financialEventClassSchema,
  provider: z.string().trim().min(1).max(200).nullable().default(null),
  providerEventRef: ref.nullable().default(null),
  announcedAt: z.string().datetime({ offset: true }).nullable().default(null),
  effectiveAt: z.string().datetime({ offset: true }).nullable().default(null),
  period: z.string().trim().min(1).max(200).nullable().default(null),
  entityRefs: z.array(ref).max(50).default([]),
  instrumentRefs: z.array(ref).max(50).default([]),
  sourceRefs: z.array(sourceRef).min(1).max(50),
  relationships: z.array(financialEventRelationshipSchema).max(100).default([]),
}).strict().superRefine((value, ctx) => {
  const allowed = new Set(value.sourceRefs);
  for (const [index, relationship] of value.relationships.entries()) {
    if (relationship.sourceRefs.some(reference => !allowed.has(reference))) {
      ctx.addIssue({ code: "custom", path: ["relationships", index, "sourceRefs"], message: "Relationship evidence must be part of the event's cited source set." });
    }
  }
});
export type FinancialEvent = z.infer<typeof financialEventSchema>;
