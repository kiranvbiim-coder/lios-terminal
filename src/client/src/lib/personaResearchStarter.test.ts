import test from "node:test";
import assert from "node:assert/strict";
import { deriveResearchStarterQuestion } from "./terminalPersona";

test("persona research starters produce role-specific questions with explicit symbols", () => {
  assert.equal(
    deriveResearchStarterQuestion("equity_research", "AAPL"),
    "What evidence supports or challenges the current view for AAPL, and what developments could change the thesis?",
  );
  assert.match(deriveResearchStarterQuestion("portfolio_risk", null), /risk outlook/);
  assert.match(deriveResearchStarterQuestion("unknown", "MSFT"), /MSFT/);
});
