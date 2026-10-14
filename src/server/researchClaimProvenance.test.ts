import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { researchArtifactContentSchema } from "@shared/artifactContracts";

test("SI-03.10 research claim provenance is backward-compatible and source-backed claims require citations", () => {
  const legacy = researchArtifactContentSchema.parse({
    kind: "research",
    blocks: [],
    claims: [{ id: "legacy", text: "Legacy claim", sourceRefs: [] }],
  });
  assert.equal(legacy.claims[0].provenance, "unknown");

  assert.throws(() => researchArtifactContentSchema.parse({
    kind: "research",
    blocks: [],
    claims: [{ id: "bad", text: "Unsupported source-backed claim", sourceRefs: [], provenance: "source_backed" }],
  }), /source_backed research claims require at least one sourceRef/);
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-claim-provenance-"));
process.env.LIMURIA_DATA_DIR = root;

const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const {
  createArtifact,
  createArtifactVersion,
  createArtifactProposal,
  decideArtifactProposal,
  forkArtifact,
  assertResearchClaimRefsSafe,
  researchEvidenceLedgerProjection,
} = await import("./artifactStore");
const { listProjectLedgerEvents, verifyLedgerIntegrity } = await import("./ledgerStore");

test("SI-03.10 claim provenance survives create/version/fork/proposal with exact P3 lineage and no raw claim text", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const [owner] = await getDb().insert(users).values({
    email: crypto.randomUUID() + "@example.test",
    passwordHash: "test",
    name: "Owner",
    role: "internal_analyst",
  }).returning();
  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(tenant, { name: "Claim provenance" });
  const sourceRef = "document:site-survey";
  const claimText = "The north entrance has a step-free ramp.";
  const inferenceText = "Accessibility risk is likely lower.";

  const v1Content = researchArtifactContentSchema.parse({
    kind: "research",
    question: "Is the north entrance step-free?",
    blocks: [{
      id: "quote-0",
      type: "quote",
      text: "The north entrance includes a step-free ramp.",
      attrs: { sourceRef, contentHash: "a".repeat(64) },
    }],
    evidence: [{
      id: "evidence-0",
      title: "Site survey",
      snippet: "The north entrance includes a step-free ramp.",
      sourceRef,
      sourceType: "document",
      observedAt: "2026-10-01T12:00:00.000Z",
    }],
    claims: [
      { id: "supported", text: claimText, sourceRefs: [sourceRef], provenance: "source_backed" },
      { id: "inference", text: inferenceText, sourceRefs: [sourceRef], provenance: "explicit_inference" },
      { id: "owner", text: "Accessibility matters to me.", sourceRefs: [], provenance: "user_asserted" },
      { id: "legacy", text: "Unclassified legacy note.", sourceRefs: [] },
    ],
  });

  assert.doesNotThrow(() => assertResearchClaimRefsSafe(v1Content));
  const pure = researchEvidenceLedgerProjection(v1Content, "artifact:test@v1");
  assert.equal(JSON.stringify(pure).includes(claimText), false);
  assert.equal(JSON.stringify(pure).includes(inferenceText), false);
  assert.ok(pure.nodes.some((node) => node.kind === "claim" && node.ref === "artifact:test@v1#claim:supported"));
  assert.ok(pure.edges.some((edge) =>
    edge.from === "artifact:test@v1#evidence:evidence-0"
    && edge.to === "artifact:test@v1#claim:supported"
    && edge.relation === "supports"));
  assert.ok(pure.edges.some((edge) =>
    edge.from === "artifact:test@v1#evidence:evidence-0"
    && edge.to === "artifact:test@v1#claim:inference"
    && edge.relation === "derived_from"));
  assert.equal(pure.edges.some((edge) => edge.to === "artifact:test@v1#claim:owner" && edge.from === sourceRef), false);

  const unsafe = researchArtifactContentSchema.parse({
    kind: "research",
    blocks: [],
    claims: [{
      id: "unsafe",
      text: "Unsafe",
      sourceRefs: ["https://example.test/data?access_token=secret"],
      provenance: "source_backed",
    }],
  });
  assert.throws(() => assertResearchClaimRefsSafe(unsafe), /credential-bearing/);

  const created = await createArtifact(tenant, {
    projectId: project.id,
    title: "Claim provenance proof",
    content: v1Content,
    origin: "conversation",
    sourceRefs: [sourceRef],
    dependencyRefs: [sourceRef],
    actorType: "conversation",
    requestId: crypto.randomUUID(),
  });
  const v1Ref = `${created.artifact.id}@v1`;
  let ledger = await listProjectLedgerEvents(tenant, project.id, { eventType: "artifact.created", limit: 100 });
  const createdEvent = ledger.find((event) => event.payload.artifactId === created.artifact.id);
  assert.ok(createdEvent);
  const createdClaims = (createdEvent.payload as any).claimProvenance;
  assert.equal(createdClaims.length, 4);
  assert.equal(createdClaims.find((item: any) => item.claimId === "supported").declaredProvenance, "source_backed");
  assert.equal(createdClaims.find((item: any) => item.claimId === "legacy").declaredProvenance, "unknown");
  assert.equal(createdClaims.find((item: any) => item.claimId === "supported").downstreamRef, v1Ref);
  assert.equal(JSON.stringify(createdEvent).includes(claimText), false);
  assert.ok((createdEvent.lineage as any).edges.some((edge: any) =>
    edge.from === `${v1Ref}#evidence:evidence-0`
    && edge.to === `${v1Ref}#claim:supported`
    && edge.relation === "supports"));

  const v2Content = researchArtifactContentSchema.parse({
    ...v1Content,
    claims: v1Content.claims.map((claim) => claim.id === "inference"
      ? { ...claim, text: "Accessibility risk may be lower, subject to route verification." }
      : claim),
  });
  const version2 = await createArtifactVersion(tenant, {
    artifactId: created.artifact.id,
    baseVersion: 1,
    content: v2Content,
    sourceRefs: [sourceRef],
    dependencyRefs: [sourceRef],
    actorType: "conversation",
    requestId: crypto.randomUUID(),
  });
  assert.equal(version2.version, 2);
  const v2Ref = `${created.artifact.id}@v2`;
  ledger = await listProjectLedgerEvents(tenant, project.id, { eventType: "artifact.versioned", limit: 100 });
  const v2Event = ledger.find((event) => event.payload.artifactId === created.artifact.id && event.payload.version === 2);
  assert.ok(v2Event);
  assert.equal((v2Event.payload as any).claimProvenance.find((item: any) => item.claimId === "inference").downstreamRef, v2Ref);

  const forked = await forkArtifact(tenant, { artifactId: created.artifact.id, version: 2 });
  const forkRef = `${forked.artifact.id}@v1`;
  const forkEvents = await listProjectLedgerEvents(tenant, project.id, { eventType: "artifact.forked", limit: 100 });
  const forkEvent = forkEvents.find((event) => event.payload.artifactId === forked.artifact.id);
  assert.ok(forkEvent);
  assert.equal((forkEvent.payload as any).claimProvenance.find((item: any) => item.claimId === "supported").downstreamRef, forkRef);

  const proposal = await createArtifactProposal(tenant, {
    artifactId: created.artifact.id,
    baseVersion: 2,
    type: "artifact_patch",
    summary: "Add an explicit user assertion",
    patch: {
      claims: [
        ...v2Content.claims,
        { id: "proposal-owner", text: "The owner wants a follow-up accessibility audit.", sourceRefs: [], provenance: "user_asserted" },
      ],
    },
  });
  const accepted = await decideArtifactProposal(tenant, proposal.id, "accept");
  assert.equal(accepted.version?.version, 3);
  const v3Ref = `${created.artifact.id}@v3`;
  ledger = await listProjectLedgerEvents(tenant, project.id, { eventType: "artifact.versioned", limit: 100 });
  const v3Event = ledger.find((event) => event.payload.artifactId === created.artifact.id && event.payload.version === 3);
  assert.ok(v3Event);
  assert.equal((v3Event.payload as any).claimProvenance.find((item: any) => item.claimId === "proposal-owner").downstreamRef, v3Ref);
  assert.ok((v3Event.lineage as any).edges.some((edge: any) =>
    edge.from === `${v3Ref}#claim:proposal-owner`
    && edge.to === v3Ref
    && edge.relation === "used"));
  assert.equal((v3Event.lineage as any).edges.some((edge: any) =>
    edge.to === `${v3Ref}#claim:proposal-owner`
    && edge.from === sourceRef), false);

  assert.equal((await verifyLedgerIntegrity(tenant, `project:${project.id}`)).valid, true);
});
