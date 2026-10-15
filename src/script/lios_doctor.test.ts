import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildLiosDoctorSnapshot } from "./lios_doctor";

test("P10 doctor reports all diagnostic domains without credential values or tenant records", () => {
  const snapshot = buildLiosDoctorSnapshot({
    ...process.env,
    LSE_API_KEY: "should-never-appear-123456",
    FRED_API_KEY: "should-never-appear-abcdef",
  });
  const serialized = JSON.stringify(snapshot);
  for (const key of ["system","runtimePacks","repairPlan","sp01Dependencies","connectors","observability","jobsAgents","dataDiagnostics","releaseGovernance"]) {
    assert.ok(key in snapshot);
  }
  assert.doesNotMatch(serialized, /should-never-appear/i);
  assert.equal(snapshot.connectors.credentialValuesRead, false);
  assert.equal(snapshot.jobsAgents.tenantRecordsEnumerated, false);
  assert.deepEqual(snapshot.runtimePacks.catalog.map((item: any) => item.id), ["core","research","quant","modeling","data-lab","local-ai"]);
  assert.equal(snapshot.runtimePacks.engineFabricCatalog.length, 11);
  assert.deepEqual(snapshot.runtimePacks.engineFabricValidationErrors, []);
  assert.equal(typeof snapshot.runtimePacks.managedRuntimeReadiness?.state, "string");
  assert.equal(typeof snapshot.runtimePacks.managedRuntimeReadiness?.repairAction, "string");
  assert.equal(typeof snapshot.repairPlan.action, "string");
  assert.equal("command" in snapshot.repairPlan, false);
  assert.equal(snapshot.sp01Dependencies.components.length, 8);
});


test("P10 doctor does not expose absolute local paths in shareable diagnostics", () => {
  const previous = process.env.LIMURIA_DATA_DIR;
  process.env.LIMURIA_DATA_DIR = "/tmp/private-user-name/lios-data";
  try {
    const snapshot = buildLiosDoctorSnapshot({});
    const serialized = JSON.stringify(snapshot);
    assert.doesNotMatch(serialized, /private-user-name/);
    assert.equal(snapshot.observability.localFileName, "otel-events.ndjson");
    assert.equal(typeof snapshot.observability.localFilePresent, "boolean");
  } finally {
    if (previous === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previous;
  }
});

test("SI-01.16 doctor reports a missing default Core runtime as installable rather than healthy", () => {
  const previous = process.env.LIMURIA_DATA_DIR;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lios-doctor-provisioning-"));
  process.env.LIMURIA_DATA_DIR = directory;
  try {
    const snapshot = buildLiosDoctorSnapshot({ ...process.env });
    assert.deepEqual(snapshot.runtimePacks.managedRuntimeReadiness, {
      state: "missing",
      ready: false,
      repairAction: "install",
      requiredPackIds: ["core"],
      missingPackIds: ["core"],
      reasons: ["Managed runtime is not installed."],
    });
    assert.deepEqual(snapshot.repairPlan, {
      schemaVersion: "1",
      component: "managed_runtime",
      state: "missing",
      severity: "warning",
      action: "install_managed_runtime",
      automaticCandidate: true,
      requiresConfirmation: true,
      summary: "Managed runtime installation is required.",
      reasons: ["Managed runtime is not installed."],
      affectedPackIds: ["core"],
    });
    assert.ok(snapshot.warnings.some((warning: string) => /managed-runtime readiness: missing/.test(warning)));
  } finally {
    if (previous === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
