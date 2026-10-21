import { z } from "zod";
import type { SpreadsheetCell, ArtifactReferenceType } from "./artifactContracts";
import type { NumericalEvidence } from "./numericalEvidenceContracts";
import type { TrustManifest } from "./trustContracts";

/** Exact immutable P4 custody. Display text, symbols and persona are never identities. */
export const artifactInspectionTargetSchema = z.object({
  artifactId: z.string().trim().min(1).max(240),
  version: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  cell: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("spreadsheet"), sheetId: z.string().min(1).max(200), ref: z.string().regex(/^[A-Z]{1,4}[1-9][0-9]{0,6}$/) }).strict(),
    z.object({ kind: z.literal("table"), row: z.number().int().nonnegative(), column: z.string().min(1).max(200) }).strict(),
  ]).optional(),
  sourceRef: z.string().min(1).max(1_000).optional(),
  receiptId: z.string().min(1).max(500).optional(),
  numericalEvidenceId: z.string().min(1).max(200).optional(),
}).strict();
export type ArtifactInspectionTarget = z.infer<typeof artifactInspectionTargetSchema>;
export interface ArtifactInspection {
  target: ArtifactInspectionTarget;
  title: string;
  projectId: number | null;
  kind: string;
  sourceRefs: string[];
  executionReceiptIds: string[];
  assumptionRefs: string[];
  dependencyRefs: string[];
  trustManifest: TrustManifest | null;
  cell: { sheetName: string; ref: string; value: SpreadsheetCell } | null;
  tableValue: unknown;
  numericalEvidence: NumericalEvidence[];
  references: Array<{ targetType: ArtifactReferenceType; targetRef: string; label: string | null; version: number | null }>;
  rights: Array<{ id: string; permittedUses: string[]; attribution: string | null }>;
}
