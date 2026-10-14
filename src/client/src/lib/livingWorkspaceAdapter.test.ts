import assert from "node:assert/strict";
import test from "node:test";
import type { ProjectWorkspaceSessionState, SafeWorkspaceAction } from "@shared/projectContracts";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import {
  createLivingWorkspaceAdapter,
  createWorkspaceRuntimeContext,
  LIOS_LIVING_WORKSPACE_ADAPTER_ID,
  workspaceSessionEnvelopeForProjectSession,
} from "./livingWorkspaceAdapter";
import type { ProjectSession } from "./useProjects";

function workspaceState(marker: string): ProjectWorkspaceSessionState {
  return {
    version: 1,
    workspaceEngine: "dockview",
    analyticalState: { marker } as any,
    dockviewLayout: { marker },
    linkedContext: { contexts: {}, channels: {} },
    focusedObject: {
      kind: "panel",
      id: "primary",
      label: "Chart",
      view: "chart",
      symbol: "AAPL",
      paneId: "primary",
    },
    savedViewName: null,
    provenance: {
      layoutStateRef: `layout:${marker}`,
      sourcePolicyRef: "policy:project",
      strategyRef: null,
      backtestRef: null,
      assumptionRefs: [],
      artifactVersionRefs: [],
    },
  } as ProjectWorkspaceSessionState;
}

function projectSession(state = workspaceState("saved")): ProjectSession {
  return {
    id: "session:11111111-1111-4111-8111-111111111111",
    projectId: 17,
    chatId: 23,
    parentSessionId: null,
    ownerUserId: 7,
    organizationId: null,
    name: "Research Session",
    status: "active",
    workspaceState: state,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    archivedAt: null,
    trashedAt: null,
    trashedByProjectId: null,
    trashedFromStatus: null,
  };
}

test("Living Workspace routes open, focus and close through LiOS safe actions", async () => {
  const actions: SafeWorkspaceAction[] = [];
  const adapter = createLivingWorkspaceAdapter({
    audience: "internal",
    dispatchWorkspaceAction: (action) => {
      actions.push(action);
      return true;
    },
  });
  const context = createWorkspaceRuntimeContext();

  await adapter.openPanel({ panelId: "chart", symbol: "msft", placement: "secondary", focus: true }, context);
  await adapter.focusPanel("secondary", context);
  await adapter.closePanel("secondary", context);

  assert.deepEqual(actions.map((action) => action.type), ["open-panel", "focus-panel", "close-panel"]);
  assert.deepEqual(actions[0], {
    type: "open-panel",
    view: "chart",
    symbol: "MSFT",
    placement: "secondary",
    reason: "Requested through the LiOS Living Workspace adapter.",
  });
  assert.equal((actions[1] as Extract<SafeWorkspaceAction, { type: "focus-panel" }>).paneId, "secondary");
  assert.equal((actions[2] as Extract<SafeWorkspaceAction, { type: "close-panel" }>).paneId, "secondary");

  assert.throws(() => adapter.closePanel("primary", context), /primary LiOS pane cannot be closed/i);
  assert.throws(() => adapter.focusPanel("not-a-pane", context), /not a canonical LiOS pane/i);
  assert.throws(
    () => adapter.openPanel({ panelId: "chart", artifactId: "artifact:1" }, context),
    /artifact-specific panel opens are not supported/i,
  );
  assert.throws(
    () => adapter.openPanel({ panelId: "definitely-not-a-lios-view" }, context),
    /not available to the active LiOS audience/i,
  );

  const clientAdapter = createLivingWorkspaceAdapter({
    audience: "client",
    dispatchWorkspaceAction: () => true,
  });
  assert.throws(
    () => clientAdapter.openPanel({ panelId: "developer" }, context),
    /not available to the active LiOS audience/i,
  );
});

test("Living Workspace snapshot preserves Project/Session identity and persists only changed canonical state", async () => {
  const saved = projectSession(workspaceState("saved"));
  const current = workspaceState("current");
  const updates: Array<{ sessionId: string; workspaceState?: ProjectWorkspaceSessionState }> = [];
  const adapter = createLivingWorkspaceAdapter({
    audience: "internal",
    dispatchWorkspaceAction: () => true,
    captureWorkspaceState: () => current,
    loadSession: async () => saved,
    updateSession: async (sessionId, patch) => {
      updates.push({ sessionId, workspaceState: patch.workspaceState });
      return { ...saved, workspaceState: patch.workspaceState ?? saved.workspaceState };
    },
  });

  const envelope = await adapter.snapshot(createWorkspaceRuntimeContext({
    projectId: saved.projectId,
    sessionId: saved.id,
    conversationId: saved.chatId,
  }));

  assert.equal(updates.length, 1);
  assert.equal(updates[0].sessionId, saved.id);
  assert.deepEqual(updates[0].workspaceState, current);
  assert.equal(envelope.projectId, saved.projectId);
  assert.equal(envelope.sessionId, saved.id);
  assert.equal(envelope.workspaceAdapterId, LIOS_LIVING_WORKSPACE_ADAPTER_ID);
  assert.equal(envelope.conversationId, saved.chatId);
  assert.equal(envelope.sourcePolicyRef, "policy:project");

  const noWriteUpdates: unknown[] = [];
  const noWriteAdapter = createLivingWorkspaceAdapter({
    audience: "internal",
    dispatchWorkspaceAction: () => true,
    captureWorkspaceState: () => saved.workspaceState,
    loadSession: async () => saved,
    updateSession: async (...args) => {
      noWriteUpdates.push(args);
      return saved;
    },
  });
  await noWriteAdapter.snapshot(createWorkspaceRuntimeContext({ projectId: saved.projectId, sessionId: saved.id }));
  assert.equal(noWriteUpdates.length, 0, "unchanged canonical Session state must not emit a redundant persistence event");
});

test("Living Workspace snapshot and restore fail closed on missing or mismatched identity", async () => {
  const saved = projectSession();
  let restored: unknown = null;
  const adapter = createLivingWorkspaceAdapter({
    audience: "internal",
    dispatchWorkspaceAction: () => true,
    captureWorkspaceState: () => saved.workspaceState,
    restoreWorkspaceState: (state) => {
      restored = state;
      return true;
    },
    loadSession: async () => saved,
    updateSession: async () => saved,
  });

  await assert.rejects(
    () => Promise.resolve(adapter.snapshot(createWorkspaceRuntimeContext({ projectId: saved.projectId }))),
    /requires an existing canonical Project Session id/i,
  );
  await assert.rejects(
    () => Promise.resolve(adapter.snapshot(createWorkspaceRuntimeContext({ projectId: 999, sessionId: saved.id }))),
    /identity does not match/i,
  );

  const envelope = workspaceSessionEnvelopeForProjectSession(saved);
  await adapter.restore(envelope, createWorkspaceRuntimeContext({
    projectId: saved.projectId,
    sessionId: saved.id,
    conversationId: saved.chatId,
  }));
  assert.deepEqual(restored, saved.workspaceState);

  await assert.rejects(
    () => Promise.resolve(adapter.restore(envelope, createWorkspaceRuntimeContext({ projectId: 999, sessionId: saved.id }))),
    /restore context does not match/i,
  );
  await assert.rejects(
    () => Promise.resolve(adapter.restore(
      { ...envelope, workspaceAdapterId: "other.workspace.adapter" },
      createWorkspaceRuntimeContext({ projectId: saved.projectId, sessionId: saved.id }),
    )),
    /requires adapter/i,
  );
});

test("Living Workspace remains replaceable through the existing RuntimeRegistry", () => {
  const first = createLivingWorkspaceAdapter({ audience: "internal", dispatchWorkspaceAction: () => true });
  const second = createLivingWorkspaceAdapter({ audience: "internal", dispatchWorkspaceAction: () => true });
  const registry = new RuntimeRegistry();

  registry.register(first);
  registry.register(second, { replace: true });

  assert.equal(registry.require(LIOS_LIVING_WORKSPACE_ADAPTER_ID).descriptor.kind, "workspace_adapter");
  assert.equal(registry.list("workspace_adapter").length, 1);
});
