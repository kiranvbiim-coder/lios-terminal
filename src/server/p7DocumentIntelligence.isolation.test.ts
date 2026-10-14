import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildP7DoclingIsolationRequest } from "./p7DocumentIntelligence";

test("isolated PDF parsing uses Docling's model-free native pipeline and explicit offline posture", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-docling-contract-"));
  const input = path.join(root, "embedded-text.pdf");
  fs.writeFileSync(input, Buffer.from("%PDF-1.4\n% contract fixture\n", "ascii"));

  try {
    const { request } = buildP7DoclingIsolationRequest(input);
    const script = request.argv[2] ?? "";

    assert.match(script, /NativePdfPipelineOptions/);
    assert.match(script, /NativePdfFormatOption/);
    assert.match(script, /InputFormat\.PDF/);
    assert.doesNotMatch(script, /DocumentConverter\(\)\.convert\(source\)/);
    assert.match(script, /HF_HUB_OFFLINE.*1/);
    assert.match(script, /TRANSFORMERS_OFFLINE.*1/);
    assert.match(script, /DOCLING_ALLOW_REMOTE_SERVICES.*false/);
    assert.equal(request.isolation.network, "deny");
    assert.equal(Object.keys(request.env ?? {}).length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
