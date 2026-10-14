import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { liosPluginManifestV1Schema } from "@shared/pluginSdk";
import type { RuntimeExecutionContext } from "@shared/runtimeContracts";
import {
  createP13PluginWriteReturnHandler,
  type P13StagedFileReturn,
} from "./p13PluginWriteReturn";

const componentId = "plugin.files.echo";
const executionRequestId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const context: RuntimeExecutionContext = {
  requestId: "11111111-1111-4111-8111-111111111111",
  userId: 1, organizationId: 1, projectId: 1,
  sessionId: null, conversationId: null, activeObjectId: null,
  dataClassification: "private", approvedActions: [],
};
const manifest = (permissions: string[]) => liosPluginManifestV1Schema.parse({
  apiVersion: "1", id: "com.example.file", name: "Staged file return",
  version: "1.0.0", publisher: "Example",
  lios: { sdkVersion: "1", minVersion: "1.0.0", maxVersion: null },
  runtime: { kind: "node_process", entrypoint: "plugin.mjs" },
  dependencies: [], permissions, connectors: [],
  tools: [{ id: "echo", componentId, name: "Echo", capabilities: ["plugin.file"] }],
  artifacts: [], agents: [], integrity: null, signer: null,
});
const bytes = Buffer.from("validated-result\n");
const digest = crypto.createHash("sha256").update(bytes).digest("hex");
const base = {
  protocol: "lios-plugin-broker/1",
  kind: "filesystem.write_return",
  requestId, executionRequestId, componentId,
  scope: "project", rootIndex: 0, relativePath: "result.txt",
  bodyBase64: bytes.toString("base64"), sha256: digest,
} as const;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p13-write-return-"));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p13-write-outside-"));
  fs.mkdirSync(path.join(root, "reports"));
  fs.writeFileSync(path.join(root, "existing.txt"), "existing data");
  fs.writeFileSync(path.join(other, "secret.txt"), "secret");
  return { root, other, grant: {
    projectRoot: root, userSelectedReadRoots: [],
    userSelectedWriteRoots: [other], networkHosts: [],
    allowProcessSpawn: false,
  } };
}

test("P13 write return stages exact bounded bytes for one declared Project destination; never writes host files", async t => {
  const f = fixture();
  t.after(() => { fs.rmSync(f.root, { recursive: true, force: true }); fs.rmSync(f.other, { recursive: true, force: true }); });
  const binding = { componentId, context };
  const staged: P13StagedFileReturn[] = [];
  const handler = createP13PluginWriteReturnHandler({
    manifest: manifest(["filesystem.project.write", "filesystem.user_selected.write"]),
    grant: f.grant,
    lookupExecution: id => id === executionRequestId ? binding : null,
    allowedPaths: () => ["result.txt", "reports/report.txt", "outside.txt"].map(relativePath => ({scope:"project" as const,rootIndex:0,relativePath})),
    stageReturn: value => { staged.push(value); },
  });
  const result = await handler(base) as { kind:string;size:number;sha256:string };
  assert.equal(result.kind, "filesystem.staged");
  assert.equal(result.size, bytes.length);
  assert.equal(result.sha256, digest);
  assert.equal(staged.length, 1);
  assert.equal(staged[0]!.relativePath, "result.txt");
  assert.equal(staged[0]!.scope, "project");
  assert.deepEqual(staged[0]!.data, bytes);
  assert.equal(fs.existsSync(path.join(f.root, "result.txt")), false,
    "staging must never create a Project file");
  assert.equal(JSON.stringify(result).includes(f.root), false,
    "staging acknowledgment must never disclose host paths");

  const nested = await handler({...base, relativePath: "reports/report.txt"}) as {kind:string};
  assert.equal(nested.kind, "filesystem.staged");
  assert.equal(fs.existsSync(path.join(f.root, "reports", "report.txt")), false);

  const wrongOutputRoot = await handler({...base, scope:"user_selected",relativePath:"result.txt"}) as {code:string};
  assert.equal(wrongOutputRoot.code, "filesystem_output_not_declared",
    "same declared output name cannot be reused under another granted root");
  const selected = await handler({...base, scope:"user_selected", relativePath:"new.txt"}) as {code:string};
  assert.equal(selected.code, "filesystem_output_not_declared");
});

test("P13 write return fails closed for malformed, unexpected and unsafe destinations", async t => {
  const f = fixture();
  t.after(() => { fs.rmSync(f.root, { recursive: true, force: true }); fs.rmSync(f.other, { recursive: true, force: true }); });
  fs.symlinkSync(path.join(f.other, "secret.txt"), path.join(f.root, "escape.txt"));
  fs.symlinkSync(path.join(f.other, "not-yet-created.txt"), path.join(f.root, "dangling.txt"));
  fs.symlinkSync(f.other, path.join(f.root, "linked-dir"));
  const binding = { componentId, context };
  const staged: P13StagedFileReturn[] = [];
  let active = true;
  const handler = createP13PluginWriteReturnHandler({
    manifest: manifest(["filesystem.project.write"]),
    grant: f.grant,
    lookupExecution: id => id === executionRequestId && active ? binding : null,
    allowedPaths: () => [
      "result.txt", "reports/report.txt", "existing.txt",
      "escape.txt", "dangling.txt", "linked-dir/new.txt",
      "../escape", "/etc/passwd", "reports", "missing/new.txt",
    ].map(relativePath => ({scope:"project" as const,rootIndex:0,relativePath})),
    stageReturn: value => { staged.push(value); },
  });
  for (const relativePath of [
    "existing.txt", "escape.txt", "dangling.txt",
    "linked-dir/new.txt", "reports", "missing/new.txt",
    "../escape", "/etc/passwd", "reports/../result.txt",
  ]) {
    const response = await handler({...base,relativePath}) as {kind:string;code:string};
    assert.equal(response.kind, "filesystem.error", relativePath);
    assert.equal(response.code, "filesystem_return_denied", relativePath);
  }
  const wrongComponent = await handler({...base, componentId:"plugin.foreign"}) as {code:string};
  assert.equal(wrongComponent.code, "filesystem_execution_scope_invalid");
  const wrongRequest = await handler({...base, executionRequestId:"44444444-4444-4444-8444-444444444444"}) as {code:string};
  assert.equal(wrongRequest.code, "filesystem_execution_scope_invalid");
  const wrongRoot = await handler({...base,rootIndex:1}) as {code:string};
  assert.equal(wrongRoot.code, "filesystem_root_not_granted");
  const wrongScope = await handler({...base,scope:"user_selected"}) as {code:string};
  assert.equal(wrongScope.code, "filesystem_permission_denied");
  const undeclared = await handler({...base,relativePath:"not-allowed.txt"}) as {code:string};
  assert.equal(undeclared.code, "filesystem_output_not_declared");
  const mismatch = await handler({...base,sha256:"0".repeat(64)}) as {code:string};
  assert.equal(mismatch.code, "filesystem_return_digest_mismatch");
  const invalidB64 = await handler({...base,bodyBase64:"YQ=="}) as {code:string};
  assert.equal(invalidB64.code, "filesystem_return_digest_mismatch");
  const ambiguousBase64 = await handler({...base,bodyBase64:"AAAA!"}) as {code:string};
  assert.equal(ambiguousBase64.code, "filesystem_return_encoding_invalid");
  const large = await handler({...base,bodyBase64:Buffer.alloc(1024*1024+1).toString("base64")});
  assert.equal((large as {code:string}).code,"filesystem_return_size_invalid",
    "an over-limit decoded file is rejected before staging");
  active = false;
  const cancelled = await handler(base) as {code:string};
  assert.equal(cancelled.code, "filesystem_execution_scope_invalid");
  assert.equal(staged.length,0,"denied data must not reach the host-owned callback");
  assert.equal(fs.readFileSync(path.join(f.other,"secret.txt"),"utf8"),"secret");
  assert.equal(fs.readFileSync(path.join(f.root,"existing.txt"),"utf8"),"existing data");
});

test("P13 write-return staging is unavailable without an explicit host-owned sink, and rejects revocation", async t => {
  const f = fixture();
  t.after(() => { fs.rmSync(f.root, { recursive: true, force: true }); fs.rmSync(f.other, { recursive: true, force: true }); });
  const binding={componentId,context};
  const unavailable=createP13PluginWriteReturnHandler({
    manifest:manifest(["filesystem.project.write"]),grant:f.grant,
    lookupExecution:()=>binding,
  });
  const noSink = await unavailable(base) as {code:string};
  assert.equal(noSink.code,"filesystem_staging_unavailable");
  let active=true;
  let called=0;
  const revoked=createP13PluginWriteReturnHandler({
    manifest:manifest(["filesystem.project.write"]),grant:f.grant,
    lookupExecution:()=>active?binding:null,
    allowedPaths:()=>{active=false;return [{scope:"project" as const,rootIndex:0,relativePath:"result.txt"}];},
    stageReturn:()=>{called++;},
  });
  const result=await revoked(base) as {code:string};
  assert.equal(result.code,"filesystem_execution_revoked");
  assert.equal(called,0);
  assert.equal(await revoked({...base,kind:"filesystem.write",bodyBase64:"AQ=="}),null);
});
