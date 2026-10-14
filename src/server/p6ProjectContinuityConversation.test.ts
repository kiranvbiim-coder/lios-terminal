import assert from "node:assert/strict";
import test from "node:test";
import { getConversationTool, planConversationWorkflow } from "./conversationRuntime";

test("active P6 planner resolves explicit Project resume into deterministic Continuity", () => {
  const plan = planConversationWorkflow({
    requestId: "a3f719fc-e08d-4bd2-aeb4-70bf748e1e8b",
    continuationOf: null,
    message: "Resume this project and show decision memory",
    sourceScope: "auto",
    executionMode: "deterministic_first",
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: {
      mode: "configured",
      providerAllow: [],
      providerDeny: [],
      allowProjectInstructions: true,
      allowResourceReferences: true,
      allowSelection: true,
      allowToolCalling: true,
      dataClassification: "private",
    },
    attachments: [],
  });

  assert.equal(plan.intent.parameters.workflow, "p6_project_continuity");
  assert.deepEqual(plan.capabilities.map((item) => item.id), ["project.continuity"]);
  assert.equal(plan.steps[0]?.componentId, "lios.project.continuity");
  assert.equal(plan.steps[0]?.permissionClass, "safe_auto");
});

test("Project Continuity is a registered safe-auto deterministic conversation tool", () => {
  const tool = getConversationTool("lios.project.continuity");
  assert.ok(tool);
  assert.equal(tool?.kind, "calculate");
  assert.equal(tool?.permissionClass, "safe_auto");
});

test("Project Continuity respects source-scope compatibility", () => {
  const plan = planConversationWorkflow({
    requestId: "c179c31a-59db-4810-af02-a928805d17ab",
    continuationOf: null,
    message: "Open decision memory",
    sourceScope: "web",
    executionMode: "deterministic_first",
    aiDirectApproved: false,
    approvals: [],
    transmissionPolicy: {
      mode: "configured",
      providerAllow: [],
      providerDeny: [],
      allowProjectInstructions: true,
      allowResourceReferences: true,
      allowSelection: true,
      allowToolCalling: true,
      dataClassification: "private",
    },
    attachments: [],
  });
  assert.equal(plan.capabilities[0]?.id, "project.continuity");
  assert.equal(plan.capabilities[0]?.sourceScopeCompatible, false);
});
