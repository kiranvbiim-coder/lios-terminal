import { z } from "zod";
import { artifactContentSchema, artifactExportFormatsForKind } from "@shared/artifactContracts";
import { createArtifactProposal, getArtifact, getArtifactVersion, listArtifactProposals } from "./artifactStore";
import { hashLedgerValue } from "./ledgerStore";
import { reconcileOfficeArtifactProvenance } from "./officeArtifactProvenance";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import type { TenantContext } from "./tenantContext";

export const officeArtifactReturnRequestSchema = z.object({
  sourceArtifactId: z.string().trim().min(1).max(300),
  sourceVersion: z.number().int().positive(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceContent: artifactContentSchema,
  content: artifactContentSchema,
  format: z.enum(["docx", "pptx"]),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  warnings: z.array(z.string().max(2000)).max(100).default([]),
}).strict();

/** File-derived content has no authority until the owned P4 source and its live rights are rechecked. */
export async function proposeOfficeArtifactReturn(ctx: TenantContext, artifactId: string, raw: unknown) {
  const identity = z.object({ sourceArtifactId: z.string().trim().min(1).max(300), sourceVersion: z.number().int().positive() }).passthrough().parse(raw);
  if (identity.sourceArtifactId !== artifactId) throw new Error("Office return belongs to a different Artifact.");
  const artifact = await getArtifact(ctx, artifactId);
  if (artifact.headVersion !== identity.sourceVersion) throw new Error("Artifact head moved; export the current revision before returning Office edits.");
  const source = await getArtifactVersion(ctx, artifactId, identity.sourceVersion);
  const now = new Date();
  const refs = [...new Set([...source.sourceRefs, ...source.dependencyRefs])];
  for (const ref of refs) {
    if (!ref.startsWith("entitlement-policy:")) continue;
    const policy = await getEntitlementPolicyById(ref.slice("entitlement-policy:".length));
    if (!policy || policy.effectiveFrom > now || (policy.effectiveTo !== null && policy.effectiveTo <= now)
      || !["display", "derived_output", "export"].every(use => policy.permittedUses.includes(use))
      || (policy.accessScope === "internal_only" && !ctx.role.startsWith("internal_"))) {
      throw new Error("Current linked source rights do not permit this Office return.");
    }
  }
  const input = officeArtifactReturnRequestSchema.parse(raw);
  if (source.contentHash !== input.sourceHash || hashLedgerValue(input.sourceContent) !== source.contentHash) throw new Error("Office source custody does not match the owned immutable Artifact revision.");
  const original = artifactContentSchema.parse(source.content);
  if (input.content.kind !== original.kind) throw new Error("Office return cannot change Artifact kind.");
  if (!artifactExportFormatsForKind(original.kind).includes(input.format)) throw new Error("This Office format is not enabled for the source Artifact kind.");
  // Fail closed against forged recorded citations, source identities, research
  // entitlements and promoted claims before proposing any external edit.
  const proposed = reconcileOfficeArtifactProvenance(original, input.content);
  const proposedHash = hashLedgerValue(proposed);
  if (proposedHash === source.contentHash) return { proposal: null, changed: false, warnings: input.warnings };
  const changedKeys = Object.keys(proposed).filter(key => hashLedgerValue((proposed as unknown as Record<string, unknown>)[key]) !== hashLedgerValue((original as unknown as Record<string, unknown>)[key]));
  const summary = `Review ${input.format.toUpperCase()} return from ${artifactId}@v${source.version}; changed ${changedKeys.join(", ")}; file SHA-256 ${input.fileHash}. No change is applied until explicit acceptance.`;
  const pending = (await listArtifactProposals(ctx, artifactId)).find(proposal => proposal.status === "pending" && proposal.baseVersion === source.version && proposal.proposedContentHash === proposedHash && proposal.summary === summary);
  const proposal = pending ?? await createArtifactProposal(ctx, { artifactId, baseVersion: source.version, type: "document_edit", summary, patch: proposed as unknown as Record<string, unknown>, actorType: "user" });
  return { proposal, changed: true, changedKeys, warnings: input.warnings };
}
