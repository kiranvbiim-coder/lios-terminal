import { z } from "zod";
/** Locale-unambiguous decimal text only. No binary floating-point conversion, scaling, rounding or unit guessing. */
export function normalizeEvidenceDecimal(raw: string, explicitUnit?: string | null): string | null {
  let value = raw.trim();
  if (value.length > 2_000) return null;
  const parenthesized = value.startsWith("(") && value.endsWith(")");
  if (parenthesized) value = value.slice(1, -1).trim();
  if (explicitUnit === "%" && value.endsWith("%")) value = value.slice(0, -1).trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(value)) return null;
  if (parenthesized && /^[+-]/.test(value)) return null;
  value = value.replaceAll(",", "");
  const negative = parenthesized || value.startsWith("-");
  value = value.replace(/^[+-]/, "");
  const [whole, fraction] = value.split(".");
  const canonicalWhole = whole.replace(/^0+(?=\d)/, "");
  const canonicalFraction = fraction?.replace(/0+$/, "");
  const zero = canonicalWhole === "0" && !canonicalFraction;
  return `${negative && !zero ? "-" : ""}${canonicalWhole}${canonicalFraction ? `.${canonicalFraction}` : ""}`;
}

const hash = z.string().regex(/^[a-f0-9]{64}$/);
/** Material values bind their exact source and normalization chain to a canonical output cell. No separate store. */
export const numericalEvidenceSchema = z.object({
  id: z.string().trim().min(1).max(200),
  target: z.object({ row: z.number().int().nonnegative(), column: z.string().trim().min(1).max(200) }).strict(),
  source: z.object({
    kind: z.enum(["document", "provider"]), sourceRef: z.string().trim().min(1).max(1_000),
    contentHash: hash, provider: z.string().trim().min(1).max(200).nullable(),
    receiptRef: z.string().trim().min(1).max(500).nullable(),
    field: z.string().trim().min(1).max(500), period: z.string().trim().min(1).max(200).nullable(),
    unit: z.string().trim().min(1).max(200).nullable(), currency: z.string().trim().min(1).max(20).nullable(),
    tableRef: z.string().trim().min(1).max(200).nullable(), row: z.number().int().nonnegative().nullable(),
    column: z.string().trim().min(1).max(200).nullable(),
    pageNumber: z.number().int().positive().nullable(),
    lineRange: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative() }).strict().nullable(),
  }).strict(),
  rawValue: z.string().max(2_000), normalizedValue: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/).max(2_000),
  transformations: z.array(z.object({
    operation: z.enum(["decimal_text_normalization"]), version: z.literal("1"), inputHash: hash, outputHash: hash,
  }).strict()).min(1).max(20),
  unknowns: z.array(z.enum(["period", "unit", "currency", "provider", "receipt", "precise_anchor"])).max(6),
}).strict().superRefine((value, ctx) => {
  if (normalizeEvidenceDecimal(value.rawValue, value.source.unit) !== value.normalizedValue) {
    ctx.addIssue({ code: "custom", path: ["normalizedValue"], message: "Declared decimal normalization must reproduce the exact bound value." });
  }
  if (value.source.kind === "provider" && (!value.source.provider || !value.source.receiptRef)) {
    ctx.addIssue({ code: "custom", path: ["source"], message: "Provider numerical evidence requires provider identity and canonical lineage receipt." });
  }
  for (let index = 1; index < value.transformations.length; index++) {
    if (value.transformations[index].inputHash !== value.transformations[index - 1].outputHash) {
      ctx.addIssue({ code: "custom", path: ["transformations", index], message: "Numerical evidence transformation hashes must form one chain." });
    }
  }
});
export type NumericalEvidence = z.infer<typeof numericalEvidenceSchema>;
