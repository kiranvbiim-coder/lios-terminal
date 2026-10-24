import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { eq } from "drizzle-orm";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-local-retrieval-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, projectResources } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createProjectResource, setProjectResourceContextMode } = await import("./projectResourceStore");
const { searchProjectIntelligenceLocally } = await import("./p7LocalSearch");
const { searchProjectIntelligence } = await import("./p7ProjectIntelligenceStore");
const { invokeLocalEmbeddings } = await import("./byoaiTransport");

test("local retrieval applies current permissions before generation and never mixes malformed or stale vector spaces", { timeout: 120_000 }, async t => {
  await initDb();
  const previous = process.env.OLLAMA_BASE_URL;
  const requests: Array<{ model: string; input: string[] }> = [];
  let malformed = false;
  let largeFinite = false;
  const server = http.createServer(async (req, res) => {
    if (req.url === "/api/tags") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ models: [
        { name: "explicit-fixture-space-v1", size: 2_000_000, digest: "a".repeat(64), details: { format: "gguf" } },
        { name: "explicit-fixture-space-v2", size: 2_000_000, digest: "b".repeat(64), details: { format: "gguf" } },
      ] }));
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    const parsed = JSON.parse(body) as { model: string; input: string[] };
    requests.push(parsed);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ model: parsed.model, embeddings: parsed.input.map((_, index) => malformed && index === 1 ? [0, 0, 0] : [largeFinite ? 1e308 : 1, 0]) }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.OLLAMA_BASE_URL; else process.env.OLLAMA_BASE_URL = previous;
    await closeDb(); fs.rmSync(root, { recursive: true, force: true });
  });
  const [owner, stranger] = await getDb().insert(users).values(["Owner", "Stranger"].map(name => ({ name, email: `${crypto.randomUUID()}@example.test`, passwordHash: "verification-only", role: "internal_admin" as const, organizationId: null }))).returning();
  assert.ok(owner && stranger);
  const ctx = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(ctx, { name: "Local retrieval" });
  const permitted = await createProjectResource(ctx, { projectId: project.id, kind: "document", label: "Owned source", metadata: { text: "Current research passage alpha" } });
  const excluded = await createProjectResource(ctx, { projectId: project.id, kind: "document", label: "Excluded source", contextMode: "excluded", metadata: { text: "forbidden-private-fixture" } });
  const licensed = await createProjectResource(ctx, { projectId: project.id, kind: "document", label: "Provider-bound source", metadata: { provider: "unverified-provider", text: "licensed-model-input-fixture" } });
  const request = { query: "research passage", localEmbedding: { provider: "ollama" as const, model: "explicit-fixture-space-v1" }, allowedSourceRefs: [permitted.id, excluded.id, licensed.id] };
  const result = await searchProjectIntelligenceLocally(ctx, project.id, request);
  assert.deepEqual(result.hits.map(hit => hit.sourceRef), [permitted.id]);
  assert.equal(result.retrieval.dimensions, 2);
  assert.equal(result.retrieval.servedModel, request.localEmbedding.model);
  assert.equal(requests.some(call => call.input.some(text => text.includes("forbidden-private-fixture"))), false, "excluded text must not reach even a local model");
  assert.equal(result.retrieval.rightsBlockedSourceCount, 1);
  assert.equal(requests.some(call => call.input.some(text => text.includes("licensed-model-input-fixture"))), false, "a retained provider record is not a current model-input grant");
  const oldHash = result.retrieval.sourceRevisions[0]!.contentHash;
  await getDb().update(projectResources).set({ metadata: { text: "Revised source passage beta" }, updatedAt: new Date() }).where(eq(projectResources.id, permitted.id));
  // Change visibility through the canonical owner API to invalidate source projection freshness.
  await setProjectResourceContextMode(ctx, permitted.id, "on_demand");
  const changed = await searchProjectIntelligenceLocally(ctx, project.id, { ...request, localEmbedding: { ...request.localEmbedding, model: "explicit-fixture-space-v2" } });
  assert.notEqual(changed.retrieval.sourceRevisions[0]!.contentHash, oldHash);
  assert.equal(requests.at(-1)?.input.some(text => text.includes("Revised source passage beta")), true, "current revision must be regenerated rather than paired with old cached vectors");
  assert.equal(changed.retrieval.servedModel, "explicit-fixture-space-v2");
  largeFinite = true;
  const normalized = await searchProjectIntelligenceLocally(ctx, project.id, request);
  assert.equal(normalized.hits[0]?.semanticScore, 1, "large finite model vectors must not overflow cosine ranking");
  largeFinite = false;
  const beforeDenied = requests.length;
  await assert.rejects(searchProjectIntelligenceLocally({ userId: stranger.id, organizationId: null, role: stranger.role }, project.id, request));
  assert.equal(requests.length, beforeDenied, "cross-owner access must fail before generation");
  malformed = true;
  await assert.rejects(searchProjectIntelligenceLocally(ctx, project.id, request), /dimensions|norms/);
  malformed = false;
  await setProjectResourceContextMode(ctx, permitted.id, "excluded");
  const beforeExcluded = requests.length;
  const empty = await searchProjectIntelligenceLocally(ctx, project.id, request);
  assert.equal(empty.retrieval.status, "no_permitted_sources");
  assert.deepEqual(empty.hits, []);
  assert.equal(requests.length, beforeExcluded, "no model invocation is authorized by an empty corpus");
  await setProjectResourceContextMode(ctx, permitted.id, "on_demand");
  process.env.OLLAMA_BASE_URL = "https://remote.example.invalid";
  await assert.rejects(invokeLocalEmbeddings({ provider: "ollama", model: "fixture", inputs: ["private input"] }), /loopback/);
  assert.equal(requests.length, beforeExcluded);
  assert.deepEqual((await searchProjectIntelligence(ctx, project.id, { query: "beta" })).map(hit => hit.sourceRef), [permitted.id], "ordinary lexical retrieval remains available without an embedding endpoint");
});
