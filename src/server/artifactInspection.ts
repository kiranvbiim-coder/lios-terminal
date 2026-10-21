import { artifactContentSchema, artifactReferenceTypeSchema } from "@shared/artifactContracts";
import { artifactInspectionTargetSchema, type ArtifactInspection } from "@shared/artifactInspection";
import { trustManifestSchema } from "@shared/trustContracts";
import { getArtifact, getArtifactVersion, listArtifactReferences, artifactTrustSourceRefs } from "./artifactStore";
import { getEntitlementPolicyById } from "./dataEntitlementStore";
import { loadIntegratedModelArtifactSource } from "./integratedModelArtifact";
import type { TenantContext } from "./tenantContext";

/** Read-only projection through canonical P4/source owners. No fuzzy fallback or provider refresh. */
export async function inspectArtifact(ctx: TenantContext, raw: unknown): Promise<ArtifactInspection> {
  const target = artifactInspectionTargetSchema.parse(raw);
  const artifact = await getArtifact(ctx, target.artifactId);
  if (artifact.status !== "active") throw new Error("Artifact inspection requires an active Artifact.");
  const version = await getArtifactVersion(ctx, artifact.id, target.version);
  if (version.contentHash !== target.contentHash) throw new Error("Stale Artifact inspection content hash.");
  const content = artifactContentSchema.parse(version.content);
  const manifest = version.trustManifest ? trustManifestSchema.parse(version.trustManifest) : null;
  let cell: ArtifactInspection["cell"] = null;
  let tableValue: unknown = null;
  let numericalEvidence = content.kind === "table" ? content.numericalEvidence ?? [] : [];
  if (target.cell?.kind === "spreadsheet") {
    if (content.kind !== "spreadsheet") throw new Error("Artifact cell kind does not match.");
    const anchor = target.cell;
    const sheet = content.sheets.find(item => item.id === anchor.sheetId);
    const value = sheet?.cells[anchor.ref];
    if (!sheet || !value) throw new Error("Artifact cell not found.");
    cell = { sheetName: sheet.name, ref: target.cell.ref, value };
  } else if (target.cell?.kind === "table") {
    const anchor = target.cell;
    if (content.kind !== "table" || !content.columns.some(column => column.key === anchor.column)
      || !Object.hasOwn(content.rows[anchor.row] ?? {}, anchor.column)) throw new Error("Artifact table cell not found.");
    tableValue = content.rows[anchor.row][anchor.column];
    numericalEvidence = numericalEvidence.filter(item => item.target.row === anchor.row && item.target.column === anchor.column);
  }
  if (target.numericalEvidenceId) {
    numericalEvidence = numericalEvidence.filter(item => item.id === target.numericalEvidenceId);
    if (numericalEvidence.length !== 1) throw new Error("Artifact numerical evidence not found at the exact target.");
  }
  const sourceRefs = [...new Set([...version.sourceRefs, ...artifactTrustSourceRefs(manifest),
    ...(cell?.value.lineage?.sourceRefs ?? []), ...numericalEvidence.map(item => item.source.sourceRef)])];
  if (target.sourceRef && !sourceRefs.includes(target.sourceRef)) throw new Error("Artifact source not found at the exact version.");
  const receiptIds = [...version.executionReceiptIds, ...numericalEvidence.flatMap(item => item.source.receiptRef ? [item.source.receiptRef] : [])];
  if (target.receiptId && !receiptIds.includes(target.receiptId)) throw new Error("Artifact receipt not found at the exact version.");
  // Recheck linked display rights now, not at the time the Artifact was retained.
  const policyRefs = new Set([...sourceRefs, ...(version.dependencyRefs ?? []), ...(cell?.value.lineage?.entitlementPolicyRef ? [cell.value.lineage.entitlementPolicyRef] : [])]);
  const rights: ArtifactInspection["rights"] = [];
  for (const ref of policyRefs) {
    if (!ref.startsWith("entitlement-policy:")) continue;
    const policy = await getEntitlementPolicyById(ref.slice("entitlement-policy:".length));
    const now = new Date();
    if (!policy || policy.effectiveFrom > now || (policy.effectiveTo !== null && policy.effectiveTo <= now)
      || !policy.permittedUses.includes("display") || (policy.accessScope === "internal_only" && !ctx.role.startsWith("internal_"))) {
      throw new Error("Current source rights do not permit Artifact inspection.");
    }
    rights.push({ id: policy.id, permittedUses: policy.permittedUses, attribution: policy.attribution });
  }
  if (cell?.value.lineage?.custody === "server_projection" && cell.value.lineage.modelRunId) {
    await loadIntegratedModelArtifactSource(ctx, cell.value.lineage.modelRunId, artifact.projectId, true, artifact.owningChatId);
  }
  const references = (await listArtifactReferences(ctx, artifact.id)).filter(item => item.version === null || item.version === target.version)
    .map(({ targetType, targetRef, label, version: refVersion }) => ({ targetType: artifactReferenceTypeSchema.parse(targetType), targetRef, label, version: refVersion }));
  return { target, title: artifact.title, projectId: artifact.projectId, kind: content.kind, sourceRefs,
    executionReceiptIds: version.executionReceiptIds, assumptionRefs: version.assumptionRefs,
    dependencyRefs: version.dependencyRefs ?? [], trustManifest: manifest, cell, tableValue, numericalEvidence, references, rights };
}
