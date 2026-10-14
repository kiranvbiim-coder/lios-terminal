import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAnalyticalTransferIntent,
  createAnalyticalContext,
  describeAnalyticalTransfer,
  getOpenWithActions,
  getSendToActions,
} from "./terminalActionContracts";

test("security context is preserved only when the destination is symbol aware", () => {
  const context = createAnalyticalContext("financialstatements", "nvda");
  assert.equal(context.symbol, "NVDA");
  const intent = buildAnalyticalTransferIntent({
    sourceView: "financialstatements",
    targetView: "valuation",
    relationship: "next",
    context,
    reason: "Value the operating forecast.",
  });
  assert.equal(intent.context.symbol, "NVDA");
  assert.equal(intent.mode, "split-right");
  assert.deepEqual(intent.transformations, []);
  assert.match(describeAnalyticalTransfer(intent), /No hidden transformations/);
});

test("global destinations do not accidentally inherit stale security symbols", () => {
  const context = createAnalyticalContext("valuation", "AAPL");
  const intent = buildAnalyticalTransferIntent({
    sourceView: "valuation",
    targetView: "alerts",
    relationship: "monitor",
    context,
    reason: "Monitor the conclusion.",
  });
  assert.equal(intent.context.symbol, undefined);
});

test("open with and send to are derived from Tool Graph semantics", () => {
  const openWith = getOpenWithActions("valuation", true);
  assert.equal(openWith.some((action) => action.view === "peercomp"), true);
  const sendTo = getSendToActions("supplychainquant", true);
  assert.equal(sendTo.some((action) => action.view === "spreadsheet"), true);
});
