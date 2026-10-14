import assert from "node:assert/strict";
import test from "node:test";
import {
  loadProjectAITransmissionPolicy,
  loadProjectApprovalGrants,
  revokeProjectApproval,
  saveProjectAITransmissionPolicy,
  recordApprovalOnServer,
  reviewGovernedToolOnServer,
  saveProjectApproval,
  syncProjectApprovalGrants,
} from "./conversationRuntimeClient";
import { DEFAULT_AI_TRANSMISSION_POLICY } from "@shared/conversationRuntime";

class MemoryStorage {
  constructor(private readonly values: Map<string, string>) {}

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, String(value)); }
}

function installWindow(values: Map<string, string>) {
  (globalThis as typeof globalThis & { window: unknown }).window = {
    localStorage: new MemoryStorage(values),
  };
}

function uninstallWindow() {
  delete (globalThis as typeof globalThis & { window?: unknown }).window;
}

test("Project AI transmission policy and approvals survive a renderer restart without crossing Projects", (t) => {
  const persisted = new Map<string, string>();
  t.after(uninstallWindow);
  installWindow(persisted);

  const projectId = 101;
  const otherProjectId = 202;
  const policy = {
    ...DEFAULT_AI_TRANSMISSION_POLICY,
    mode: "configured" as const,
    providerAllow: ["openai"],
    providerDeny: ["anthropic"],
    allowProjectInstructions: true,
    allowResourceReferences: false,
    allowSelection: false,
    allowToolCalling: true,
    dataClassification: "private" as const,
  };

  saveProjectAITransmissionPolicy(projectId, policy);
  saveProjectApproval(projectId, "RunValuation");
  saveProjectApproval(projectId, "AIDirectEstimate");
  saveProjectApproval(projectId, "RunValuation");

  assert.deepEqual(loadProjectAITransmissionPolicy(projectId), policy);
  assert.deepEqual(loadProjectApprovalGrants(projectId), [
    { action: "RunValuation", scope: "project" },
    { action: "AIDirectEstimate", scope: "project" },
  ]);
  assert.deepEqual(loadProjectAITransmissionPolicy(otherProjectId), DEFAULT_AI_TRANSMISSION_POLICY);
  assert.deepEqual(loadProjectApprovalGrants(otherProjectId), []);

  // Simulate a renderer/app restart: module state is discarded, while the
  // desktop browser profile retains localStorage.
  uninstallWindow();
  installWindow(persisted);

  assert.deepEqual(loadProjectAITransmissionPolicy(projectId), policy);
  assert.deepEqual(loadProjectApprovalGrants(projectId), [
    { action: "RunValuation", scope: "project" },
    { action: "AIDirectEstimate", scope: "project" },
  ]);

  assert.deepEqual(revokeProjectApproval(projectId, "RunValuation"), [
    { action: "AIDirectEstimate", scope: "project" },
  ]);
  assert.deepEqual(loadProjectApprovalGrants(projectId), [
    { action: "AIDirectEstimate", scope: "project" },
  ]);
});

test("malformed persisted Project AI state fails closed to safe defaults", (t) => {
  const persisted = new Map<string, string>();
  t.after(uninstallWindow);
  installWindow(persisted);

  persisted.set("lios.project.ai-transmission-policy.303", "{not-json");
  persisted.set("lios.project.runtime-approvals.303", JSON.stringify([
    { action: "RunValuation", scope: "project" },
    { action: "DeleteEverything", scope: "project" },
    { action: "RunBacktest", scope: "session" },
    null,
  ]));

  assert.deepEqual(loadProjectAITransmissionPolicy(303), DEFAULT_AI_TRANSMISSION_POLICY);
  assert.deepEqual(loadProjectApprovalGrants(303), [
    { action: "RunValuation", scope: "project" },
    { action: "RunBacktest", scope: "project" },
  ]);
});

type FetchCall = { url: string; method: string; body: unknown };

function installFetch(handler: (call: FetchCall) => { ok: boolean; status?: number; json?: unknown }) {
  const calls: FetchCall[] = [];
  (globalThis as typeof globalThis & { fetch: unknown }).fetch = async (url: string, init?: { method?: string; body?: string }) => {
    const call = { url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null };
    calls.push(call);
    const result = handler(call);
    return { ok: result.ok, status: result.status ?? (result.ok ? 200 : 400), json: async () => result.json ?? {} };
  };
  return calls;
}

test("GM-11a approvals are recorded on the server: a once approval names its request, a Project approval names its Project", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { (globalThis as typeof globalThis & { fetch: unknown }).fetch = original; });
  const calls = installFetch(() => ({ ok: true }));
  await recordApprovalOnServer({ action: "RunBacktest", scope: "once", requestId: "11111111-1111-4111-8111-111111111111", projectId: 7 });
  await recordApprovalOnServer({ action: "RunBacktest", scope: "project", requestId: "11111111-1111-4111-8111-111111111111", projectId: 7 });
  assert.deepEqual(calls.map((call) => call.body), [
    { action: "RunBacktest", scope: "once", requestId: "11111111-1111-4111-8111-111111111111" },
    { action: "RunBacktest", scope: "project", projectId: 7 },
  ]);
  installFetch(() => ({ ok: false, json: { error: "Project not found." } }));
  await assert.rejects(() => recordApprovalOnServer({ action: "RunBacktest", scope: "project", requestId: "", projectId: 9 }), /Project not found/);
});

test("governed-tool review sends only opaque review identity and the human decision", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { (globalThis as typeof globalThis & { fetch: unknown }).fetch = original; });
  const calls = installFetch(() => ({ ok: true }));
  await reviewGovernedToolOnServer({
    requestId: "11111111-1111-4111-8111-111111111111",
    reviewId: "22222222-2222-4222-8222-222222222222",
    decision: "allow_once",
  });
  assert.deepEqual(calls, [{
    url: "/api/conversation-executions/11111111-1111-4111-8111-111111111111/governed-tool-review",
    method: "POST",
    body: {
      reviewId: "22222222-2222-4222-8222-222222222222",
      decision: "allow_once",
    },
  }]);
  const serialized = JSON.stringify(calls[0]!.body);
  for (const forbidden of ["toolId", "stepId", "toolCallId", "input", "planHash", "policyRevision", "authorization"]) {
    assert.equal(serialized.includes(forbidden), false);
  }

  installFetch(() => ({ ok: false, json: { error: "Review expired." } }));
  await assert.rejects(
    () => reviewGovernedToolOnServer({
      requestId: "11111111-1111-4111-8111-111111111111",
      reviewId: "22222222-2222-4222-8222-222222222222",
      decision: "deny",
    }),
    /Review expired/,
  );
});

test("GM-11a legacy browser grants migrate to the server once, then the browser list mirrors the server", async (t) => {
  const persisted = new Map<string, string>();
  const original = globalThis.fetch;
  t.after(() => { uninstallWindow(); (globalThis as typeof globalThis & { fetch: unknown }).fetch = original; });
  installWindow(persisted);
  saveProjectApproval(5, "RunBacktest");
  let serverGrants = [{ action: "RunBacktest", scope: "project" }];
  const calls = installFetch((call) => (call.method === "GET" ? { ok: true, json: { grants: serverGrants } } : { ok: true }));

  assert.deepEqual(await syncProjectApprovalGrants(5), [{ action: "RunBacktest", scope: "project" }]);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1, "the legacy grant is posted once");

  serverGrants = []; // revoked elsewhere (another device): the browser list follows the server
  assert.deepEqual(await syncProjectApprovalGrants(5), []);
  assert.deepEqual(loadProjectApprovalGrants(5), []);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1, "migration does not repeat");
});
