import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-quant-version-fence-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
// Intentional module-loading boundary: initialize the DB singleton only after selecting an isolated data root.
const { initDb, getDb, closeDb } = await import("./db");
const { users, quantExperiments, quantRuns } = await import("@shared/schema");
const { QUANT_MODEL_REGISTRY } = await import("./quantModelRegistry");
const { assertCurrentQuantModelVersion, enqueueQuantRun, rerunQuantRun, editQuantExperiment, getQuantExperiment } = await import("./quantLabRuntime");

test("Quant Lab refuses stale experiment and rerun revisions before mutation or Python execution", { timeout: 120_000 }, async t => {
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  await initDb();
  const [owner] = await getDb().insert(users).values({ email: `${crypto.randomUUID()}@example.test`, name: "Version fence", passwordHash: "fixture", role: "internal_analyst" }).returning();
  const model = QUANT_MODEL_REGISTRY.find(item => item.engineEndpoint === "/advanced/valuation/reverse-dcf");
  assert.ok(model, "reverse DCF must remain registered");
  assert.equal(model.version, "1.0.1");
  const staleVersion = "1.0.0";
  const [experiment] = await getDb().insert(quantExperiments).values({ id: crypto.randomUUID(), name: "Historical inputs", workspace: "registry", modelId: model.id, modelVersion: staleVersion, ownerUserId: owner.id }).returning();
  const [run] = await getDb().insert(quantRuns).values({ id: crypto.randomUUID(), experimentId: experiment.id, sequence: 1, status: "succeeded", modelId: model.id, modelVersion: staleVersion, engine: model.engine, engineEndpoint: model.engineEndpoint!, parameters: {}, timeoutMs: 30000, inputHash: "historical-input", cacheKey: "historical-cache", environment: {}, environmentHash: "historical-environment", libraryVersions: {}, ownerUserId: owner.id }).returning();
  const mismatch = /version mismatch: saved .*current version .*Create a current-version experiment and explicitly reconcile its inputs/;
  await assert.rejects(enqueueQuantRun(experiment.id, owner.id, { bypassCache: true }), mismatch);
  await assert.rejects(enqueueQuantRun(experiment.id, owner.id, { bypassCache: false }), mismatch);
  await assert.rejects(rerunQuantRun(run.id, owner.id), mismatch);
  assert.deepEqual(await getQuantExperiment(experiment.id, owner.id), experiment);
  assert.deepEqual(await getDb().select().from(quantRuns), [run]);

  const renamed = await editQuantExperiment(experiment.id, owner.id, { name: "Renamed historical inputs" });
  assert.equal(renamed?.modelVersion, staleVersion, "ordinary edits must not silently upgrade historical inputs");
  await assert.rejects(enqueueQuantRun(experiment.id, owner.id, {}), mismatch);

  // Matching revisions pass the fence and reach normal input validation without a sidecar call.
  const [current] = await getDb().insert(quantExperiments).values({ id: crypto.randomUUID(), name: "Current inputs", workspace: "registry", modelId: model.id, modelVersion: model.version, ownerUserId: owner.id }).returning();
  await assert.rejects(enqueueQuantRun(current.id, owner.id, { parameters: { oversized: "x".repeat(1_000_001) } }));
  assert.deepEqual(await getQuantExperiment(current.id, owner.id), current);
  assert.deepEqual(await getDb().select().from(quantRuns), [run]);
});
