import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");

test("the original P11 Studio keeps one source engine and adds explicit receipt/destination review",()=>{
  const studio=source("../components/panels/IntegratedModelStudioPanel.tsx");
  assert.match(studio,/apiRequest\("POST", "\/api\/financial-models\/integrated"/);
  assert.match(studio,/saveIntegratedModelRunArtifact\(request\.runId/);
  assert.match(studio,/modelRunReviewKey\(model, selectedDestination\)/);
  assert.match(studio,/reviewedSaveKey === currentSaveReviewKey/);
  assert.match(studio,/data-testid="integrated-model-save-review"/);
  assert.match(studio,/data-testid="integrated-model-confirm-review"/);
  assert.match(studio,/aria-pressed=\{saveIsReviewed\}/);
  assert.match(studio,/!saveIsReviewed/);
  assert.match(studio,/verifiedReopenedModelRun\(displayed, reopened\)/);
  assert.match(studio,/currentSaveReviewKeyRef\.current !== capturedKey/);
  assert.match(studio,/savedModelArtifactMatchesReceipt\(detail, displayed\.receipt, request\)/);
  assert.match(studio,/setReviewedSaveKey\(null\)/);
  assert.match(studio,/Check the Library before retrying; the server may have committed it/);
  assert.doesNotMatch(studio,/Math\.random\(|localStorage\.setItem\([^\n]*saveReviewed/);
});
test("P11 server reopens owned receipt and checks live source entitlement; P4 persists existing engine projection",()=>{
  const server=source("../../../server/integratedModelArtifact.ts");
  const helper=source("./reviewedModelRunArtifact.ts");
  assert.match(server,/export async function readIntegratedModelRun/);
  assert.match(server,/assertIntegratedModelDatasetSourceCurrent\(ctx, snapshot\.id, revision, requiredUses\)/);
  assert.match(server,/expectedHash !== run\.resultHash/);
  assert.match(server,/financial-model-result-sha256:/);
  assert.match(server,/dataset-content-sha256:/);
  assert.match(server,/persistConversationDraft\(ctx,/);
  assert.match(helper,/artifact\.origin === "conversation"/);
  assert.match(helper,/version\.refreshSpec\.engineRef\.endsWith/);
  assert.match(helper,/financial-model-run:/);
  assert.match(helper,/financial-model-result-sha256:/);
  assert.match(helper,/dataset-snapshot:/);
  assert.match(helper,/dataset-content-sha256:/);
});
