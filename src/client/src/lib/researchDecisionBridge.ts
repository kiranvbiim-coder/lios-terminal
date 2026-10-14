export interface DecisionCaseBridgePayload {
  title: string;
  question: string;
  decisionType: "investment";
  materiality: "material";
  symbol: string | null;
  investigationId: number;
  brainRunId: null;
}

type InvestigationBridgeInput = {
  id: number;
  title: string;
  question: string;
  primarySymbol: string | null;
};

/** Starts a case from authoritative investigation context without inventing a recommendation. */
export function buildDecisionCaseBridgePayload(
  investigation: InvestigationBridgeInput,
  briefTitle?: string,
): DecisionCaseBridgePayload {
  const sourceTitle = briefTitle?.trim() || investigation.title.trim();
  return {
    title: `${sourceTitle} decision`,
    question: investigation.question,
    decisionType: "investment",
    materiality: "material",
    symbol: investigation.primarySymbol?.trim() || null,
    investigationId: investigation.id,
    brainRunId: null,
  };
}

/** Builds the existing terminal workspace URL without double-encoding the JSON query. */
export function buildDecisionEngineHandoffUrl(
  symbol: string,
  currentUrl = typeof window !== "undefined" ? window.location.href : "http://localhost/",
): string {
  const url = new URL(currentUrl);
  const workspace = {
    primary: { view: "decisionengine", symbol: symbol.trim() },
    secondary: null,
    focusedPane: "primary",
  };
  url.searchParams.set("ws", JSON.stringify(workspace));
  url.hash = "#/";
  return url.toString();
}
