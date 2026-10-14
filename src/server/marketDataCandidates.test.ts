import test from "node:test";
import assert from "node:assert/strict";
import { isStoredReferenceCandidateSymbol } from "./marketData";

test("stored reference candidates exclude synthetic fund and non-equity symbols", () => {
  assert.equal(isStoredReferenceCandidateSymbol("0P0000W82O.AX"), false);
  assert.equal(isStoredReferenceCandidateSymbol("BTC-USD"), false);
  assert.equal(isStoredReferenceCandidateSymbol("GC=F"), false);
  assert.equal(isStoredReferenceCandidateSymbol("^GSPC"), false);
  assert.equal(isStoredReferenceCandidateSymbol("AAPL"), true);
  assert.equal(isStoredReferenceCandidateSymbol("BHP.AX"), true);
});
