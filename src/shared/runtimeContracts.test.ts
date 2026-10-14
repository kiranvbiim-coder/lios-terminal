import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactEnvelopeSchema,
  backtestRequestSchema,
  financeEngineResultSchema,
  pluginManifestSchema,
  runtimeActionRequestSchema,
  runtimeComponentDescriptorSchema,
  runtimeExecutionReceiptSchema,
  runtimePermissionDecisionSchema,
  workspaceSessionEnvelopeSchema,
} from "./runtimeContracts";

test("runtime component descriptor requires explicit source and stable replaceable metadata", () => {
  const descriptor = runtimeComponentDescriptorSchema.parse({
    contractVersion: "1",
    id: "agent:research",
    kind: "agent",
    name: "Research Agent",
    version: "1.0.0",
    lifecycle: "optional",
    executionScopes: ["python_sidecar"],
    capabilities: ["research:plan", "research:evidence"],
    permissions: ["data:project-read"],
    runtimePackId: "research",
    replaceable: true,
    source: {
      origin: "oss",
      repository: "TauricResearch/TradingAgents",
      commitSha: "2d17df8da1536c121e4d7395ac5a5dcec9e96d6f",
      license: "Apache-2.0",
      importedPaths: [],
      modified: false,
    },
  });

  assert.equal(descriptor.kind, "agent");
  assert.equal(descriptor.replaceable, true);
  assert.equal(descriptor.source.commitSha?.length, 40);
});

test("OSS descriptors fail closed without repository/license metadata", () => {
  assert.throws(
    () => runtimeComponentDescriptorSchema.parse({
      contractVersion: "1",
      id: "agent:bad",
      kind: "agent",
      name: "Bad Agent",
      version: "1",
      lifecycle: "donor_candidate",
      executionScopes: ["external_process"],
      source: { origin: "oss", importedPaths: [], modified: false },
    }),
    /repository and license/i,
  );
});

test("external side effects cannot be silently SAFE_AUTO", () => {
  assert.throws(
    () => runtimeActionRequestSchema.parse({
      id: "action:test",
      componentId: "tool:test",
      action: "write",
      permissionClass: "safe_auto",
      reversible: false,
      externalSideEffect: true,
      summary: "Write to an external system.",
      arguments: {},
    }),
    /external side effects/i,
  );
});

test("permission decisions enforce the frozen SAFE_AUTO / confirm / deny semantics", () => {
  assert.throws(
    () => runtimePermissionDecisionSchema.parse({
      actionId: "action:delete",
      decision: "allow",
      policyClass: "denied",
      reason: "Policy blocks this action.",
      scope: "request",
      expiresAt: null,
    }),
    /must resolve to deny/i,
  );

  assert.throws(
    () => runtimePermissionDecisionSchema.parse({
      actionId: "action:read",
      decision: "confirm",
      policyClass: "safe_auto",
      reason: "Safe read.",
      scope: "request",
      expiresAt: null,
    }),
    /must not require confirmation/i,
  );
});

test("execution receipts distinguish deterministic from AI-derived results", () => {
  const base = {
    id: "00000000-0000-4000-8000-000000000001",
    requestId: "00000000-0000-4000-8000-000000000002",
    componentId: "finance:dcf",
    operation: "valuation:dcf",
    status: "completed",
    startedAt: "2026-09-21T10:00:00+00:00",
    completedAt: "2026-09-21T10:00:01+00:00",
    inputHash: null,
    outputHash: null,
    sourceRefs: [],
    warnings: [],
  };
  assert.doesNotThrow(() => runtimeExecutionReceiptSchema.parse({ ...base, deterministic: true, aiDerived: false }));
  assert.throws(
    () => runtimeExecutionReceiptSchema.parse({ ...base, deterministic: true, aiDerived: true }),
    /both deterministic and AI-derived/i,
  );
});

test("session envelope rejects self-parenting while artifact envelope remains implementation-neutral", () => {
  assert.throws(
    () => workspaceSessionEnvelopeSchema.parse({
      schemaVersion: "1",
      projectId: 1,
      sessionId: "base",
      parentSessionId: "base",
      activeArtifactIds: [],
    }),
    /cannot be its own parent/i,
  );

  const artifact = artifactEnvelopeSchema.parse({
    schemaVersion: "1",
    artifactId: "valuation-1",
    artifactType: "valuation",
    projectId: 1,
    sessionId: "base",
    version: 1,
    sourceRefs: ["sec:filing:123"],
    executionReceiptIds: [],
    assumptionRefs: ["wacc"],
    supportedActions: ["rerun"],
  });
  assert.equal(artifact.artifactType, "valuation");
});

test("backtest and finance engine contracts encode reproducibility guardrails", () => {
  assert.throws(
    () => backtestRequestSchema.parse({
      schemaVersion: "1",
      strategyRef: "strategy:mean-reversion",
      instrumentRefs: ["security:AAPL"],
      startDate: "2026-01-02",
      endDate: "2025-12-31",
      frequency: "1d",
      startingCapital: 100000,
      assumptions: { feesBps: 1, slippageBps: 2, seed: 42 },
      pointInTimeRequired: true,
    }),
    /endDate/i,
  );

  const result = financeEngineResultSchema.parse({
    schemaVersion: "1",
    engineId: "finance:dcf",
    outputRef: "artifact:valuation:1",
    deterministic: true,
    warnings: [],
  });
  assert.equal(result.deterministic, true);
});

test("plugin manifest separates renderer declaration from privileged execution requirements", () => {
  const manifest = pluginManifestSchema.parse({
    apiVersion: "1",
    id: "plugin:sec-research",
    name: "SEC Research",
    version: "1.0.0",
    runtime: "python_sidecar",
    permissions: ["data:project-read"],
    capabilities: ["research:filings"],
    tools: ["tool:sec-search"],
    connectors: ["connector:sec_edgar"],
    artifacts: ["research"],
    agents: [],
    dependencies: [],
    networkAccess: true,
    filesystemAccess: "project_scoped",
  });
  assert.equal(manifest.runtime, "python_sidecar");
  assert.equal(manifest.networkAccess, true);
});
