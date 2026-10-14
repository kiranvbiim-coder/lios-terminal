import { z } from 'zod';
import { artifactContentSchema, type ArtifactContent } from '@shared/artifactContracts';
import type { TenantContext } from './tenantContext';
import { createArtifactProposal, getArtifact, getArtifactVersion } from './artifactStore';
import { appendLedgerEvent, hashLedgerValue } from './ledgerStore';

export const artifactBranchMergeRequestSchema = z.object({
  branchArtifactId: z.string().trim().min(1).max(300),
  branchVersion: z.number().int().positive(),
  targetVersion: z.number().int().positive(),
  resolutions: z.record(z.enum(['target', 'branch'])).refine(value => Object.keys(value).length <= 100, 'Too many merge resolutions.').default({}),
}).strict();

/** Conservative three-way reconciliation: compound fields remain one review unit. */
export function reconcileArtifactContents(base: ArtifactContent, target: ArtifactContent, branch: ArtifactContent, resolutions: Record<string, 'target' | 'branch'> = {}) {
  if (base.kind !== target.kind || target.kind !== branch.kind) throw new Error('Artifact branches must have the same kind.');
  const original = base as unknown as Record<string, unknown>;
  const current = target as unknown as Record<string, unknown>;
  const incoming = branch as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  const conflicts: string[] = [];
  const conflictKeys = new Set<string>();
  const changedKeys: string[] = [];
  for (const key of [...new Set([...Object.keys(original), ...Object.keys(current), ...Object.keys(incoming)])].sort()) {
    if (key === 'kind') continue;
    const before = hashLedgerValue(original[key] ?? null);
    const targetHash = hashLedgerValue(current[key] ?? null);
    const branchHash = hashLedgerValue(incoming[key] ?? null);
    if (branchHash === before || branchHash === targetHash) continue;
    if (targetHash !== before) {
      conflictKeys.add(key);
      if (!resolutions[key]) { conflicts.push(key); continue; }
      if (resolutions[key] === 'target') continue;
    }
    if (incoming[key] === undefined) throw new Error(`Removing ${key} requires an explicit content revision; branch reconciliation cannot silently discard metadata.`);
    patch[key] = incoming[key];
    changedKeys.push(key);
  }
  for (const key of Object.keys(resolutions)) {
    if (!conflictKeys.has(key)) throw new Error(`Resolution ${key} does not name a current conflict.`);
  }
  if (conflicts.length) return { patch, conflicts, changedKeys };
  artifactContentSchema.parse({ ...target, ...patch });
  return { patch, conflicts, changedKeys };
}

export async function proposeArtifactBranchMerge(ctx: TenantContext, targetArtifactId: string, raw: unknown) {
  const input = artifactBranchMergeRequestSchema.parse(raw);
  const [target, branch] = await Promise.all([getArtifact(ctx, targetArtifactId), getArtifact(ctx, input.branchArtifactId)]);
  if (target.projectId !== branch.projectId) throw new Error('Branch reconciliation requires the same Project.');
  if (branch.forkedFromArtifactId !== target.id || branch.forkedFromVersion === null) throw new Error('Select a direct fork of this Artifact; unrelated work cannot be reconciled.');
  if (target.headVersion !== input.targetVersion) throw new Error('Artifact head moved; refresh before reviewing this merge.');
  const [baseVersion, targetVersion, branchVersion] = await Promise.all([
    getArtifactVersion(ctx, target.id, branch.forkedFromVersion),
    getArtifactVersion(ctx, target.id, input.targetVersion),
    getArtifactVersion(ctx, branch.id, input.branchVersion),
  ]);
  const review = reconcileArtifactContents(artifactContentSchema.parse(baseVersion.content), artifactContentSchema.parse(targetVersion.content), artifactContentSchema.parse(branchVersion.content), input.resolutions);
  const conflictPreviews = Object.fromEntries(review.conflicts.map(key => {
    const targetText = JSON.stringify(targetVersion.content[key] ?? null);
    const branchText = JSON.stringify(branchVersion.content[key] ?? null);
    return [key, {
      target: targetText.slice(0, 4_000), branch: branchText.slice(0, 4_000),
      truncated: targetText.length > 4_000 || branchText.length > 4_000,
    }];
  }));
  if (review.conflicts.length || !review.changedKeys.length) return { ...review, conflictPreviews, proposal: null };
  const proposal = await createArtifactProposal(ctx, {
    artifactId: target.id, baseVersion: input.targetVersion, type: 'artifact_patch',
    summary: `Reconcile ${branch.title} v${branchVersion.version} into ${target.title} v${targetVersion.version}: ${review.changedKeys.join(', ')}`,
    patch: review.patch, actorType: 'user',
  });
  await appendLedgerEvent(ctx, {
    projectId: target.projectId, eventType: 'state.changed', actorType: 'user',
    payload: { action: 'p4.branch_merge_proposed', proposalId: proposal.id, ancestorVersion: baseVersion.version, resolutions: input.resolutions, changedKeys: review.changedKeys },
    lineage: {
      nodes: [
        { kind: 'artifact', ref: branch.id, version: String(branchVersion.version), hash: branchVersion.contentHash, asOf: null, metadata: {} },
        { kind: 'artifact', ref: target.id, version: String(targetVersion.version), hash: targetVersion.contentHash, asOf: null, metadata: {} },
      ],
      edges: [{ from: branch.id, to: target.id, relation: 'changed' }],
    },
  });
  return { ...review, conflictPreviews, proposal };
}
