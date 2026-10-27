import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-chat-connected-source-"));
const priorRoot = process.env.LIMURIA_DATA_DIR;
process.env.LIMURIA_DATA_DIR = root;

const [
  { initDb, closeDb, getDb },
  { users },
  { createProject },
  { upsertSourceConnection, testSourceConnection },
  { recordExternalRightsAssessment },
  { connectedProviderListChatTool, connectedProviderPreviewChatTool },
  { invokeConversationTool },
] = await Promise.all([
  import("./db"),
  import("@shared/schema"),
  import("./projectStore"),
  import("./sourceConnectionService"),
  import("./externalRightsStore"),
  import("./connectedProviderChatTool"),
  import("./conversationRuntime"),
]);

test("Phase 2: connected local file verifies, appears in Chat and supplies an approved bounded source-attributed preview", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
    if (priorRoot === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = priorRoot;
  });

  const [owner] = await getDb().insert(users).values({
    email: `connected-chat-${crypto.randomUUID()}@example.test`,
    passwordHash: "test-hash", role: "internal_admin", name: "Connected Chat Fixture",
  }).returning();
  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(tenant, { name: "Connected Source Chat" });
  const file = path.join(root, "small.json");
  fs.writeFileSync(file, JSON.stringify([
    { region: "west", metric: 27, api_key: "must-not-leak" },
    { region: "east", metric: 19, api_key: "must-not-leak" },
  ]));
  const source = await upsertSourceConnection(owner.id, null, {
    connectorId: "file_upload", sourceType: "file", name: "Region sample",
    credentialRef: null, config: { path: file },
  }, { id: owner.id, email: owner.email });
  const check = await testSourceConnection(owner.id, source.id, { id: owner.id, email: owner.email });
  assert.equal(check?.status, "healthy", "live local-file verification, not catalog availability");

  const call = {
    source: "agent" as const,
    requestId: crypto.randomUUID(), userId: owner.id,
    projectId: project.id, tenant, sourceScope: "my_data" as const,
    resourceTransmissionAllowed: true,
  };
  const noRights = () => connectedProviderPreviewChatTool.invoke({
    connectionId: source.id, entityRef: "region-sample", capability: "provider_extension",
    maxRows: 1,
  }, new AbortController().signal, call);
  await assert.rejects(noRights, /rights review|not approved/i, "unreviewed private records must fail closed");

  await recordExternalRightsAssessment(tenant, {
    subjectId: `source-connection:${source.id}`,
    subjectKind: "data",
    rights: {
      softwareLicense: { spdx: null, reviewed: true },
      apiTerms: { provider: "owner-supplied local file", reviewed: true, termsUrl: null },
      dataRights: { redistribution: "permitted", internalUse: "permitted", attributionRequired: false },
      trademarkReviewed: true,
    },
    notes: "Synthetic test data only: explicit review to exercise Chat integration.",
    reviewedAt: new Date().toISOString(),
  });

  const list = await connectedProviderListChatTool.invoke({}, new AbortController().signal, call);
  const listing = list.output as { sources: Array<{ id: number; previewAvailable: boolean }>; dataFetchPerformed: boolean };
  assert.equal(listing.sources.some(item => item.id === source.id && item.previewAvailable), true);
  assert.equal(listing.dataFetchPerformed, false);

  // The canonical registry cannot run a confirm-class external tool without
  // an exact live L4 grant and L5 external-dispatch receipt. Direct descriptor
  // invocation below is only the already-approved adapter integration fixture.
  await assert.rejects(
    () => invokeConversationTool("lios.provider.connected_preview", {
      connectionId: source.id, entityRef: "region-sample",
    }, new AbortController().signal, call),
    /confirm|approval|authorization/i,
  );

  const result = await noRights();
  const output = result.output as { previewRows: Array<Record<string, unknown>>; connectionId: number; providerId: string; returnedRows: number };
  assert.equal(output.connectionId, source.id);
  assert.equal(output.providerId, `source:${source.id}`);
  assert.equal(output.returnedRows, 1);
  assert.deepEqual(output.previewRows, [{ region: "west", metric: 27, api_key: "[REDACTED]" }]);
  assert.equal(result.sourceRefs.includes(`source-connection:${source.id}`), true);
  assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
  assert.equal(JSON.stringify(result).includes(file), false);
  assert.equal(result.summary.includes("preview row"), true);

  await assert.rejects(
    () => connectedProviderPreviewChatTool.invoke({
      connectionId: source.id, entityRef: "region-sample",
    }, new AbortController().signal, { ...call, resourceTransmissionAllowed: false }),
    /transmission.*disabled/i,
  );
});
