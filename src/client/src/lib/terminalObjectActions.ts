import type { IntelligenceObject } from "./terminalIntelligenceObjects";
import type { ViewMode } from "./terminalTypes";

export type IntelligenceObjectActionKind = "inspect" | "open" | "compare" | "send-to" | "monitor" | "pin" | "scenario" | "decision" | "graph";

export interface IntelligenceObjectAction {
  id: string;
  kind: IntelligenceObjectActionKind;
  label: string;
  view?: ViewMode;
  objectId: string;
  targetObjectId?: string;
  payload?: Record<string, string | number | boolean | null>;
}

const EVENT_NAME = "lios:intelligence-object-action";

const SEND_TARGETS: Partial<Record<IntelligenceObject["kind"], Array<{ view: ViewMode; label: string }>>> = {
  metric: [{ view: "chart", label: "Send to Chart" }, { view: "valuation", label: "Send to Valuation" }, { view: "advancedrisk", label: "Send to Risk" }],
  model: [{ view: "valuation", label: "Send to Valuation" }, { view: "advancedrisk", label: "Send to Risk" }, { view: "spreadsheet", label: "Send to Spreadsheet" }],
  evidence: [{ view: "filingintel", label: "Send to Filing Intelligence" }, { view: "decisionmemory", label: "Send to Decision Memory" }],
  document: [{ view: "filingintel", label: "Send to Filing Intelligence" }, { view: "decisionmemory", label: "Send to Decision Memory" }],
  risk: [{ view: "advancedrisk", label: "Send to Risk" }, { view: "portfoliostress", label: "Send to Stress" }],
  scenario: [{ view: "macrostress", label: "Send to Macro Stress" }, { view: "portfoliostress", label: "Send to Portfolio Stress" }],
  portfolio: [{ view: "portfolio", label: "Send to Portfolio" }, { view: "portfolioattribution", label: "Send to Attribution" }],
  policy: [{ view: "econpolicyquant", label: "Send to Policy Quant" }, { view: "indicatorworkbench", label: "Send to Indicator Workbench" }],
  dataset: [{ view: "datastats", label: "Send to Data Stats" }, { view: "spreadsheet", label: "Send to Spreadsheet" }],
  chart: [{ view: "spreadsheet", label: "Send to Spreadsheet" }, { view: "decisionmemory", label: "Send to Decision Memory" }],
  table: [{ view: "spreadsheet", label: "Send to Spreadsheet" }, { view: "datastats", label: "Send to Data Stats" }],
  decision: [{ view: "alerts", label: "Send to Monitoring" }, { view: "decisionmemory", label: "Send to Decision Memory" }],
  monitor: [{ view: "alerts", label: "Send to Alerts" }],
};

export function actionsForIntelligenceObject(object: IntelligenceObject): IntelligenceObjectAction[] {
  const actions: IntelligenceObjectAction[] = [
    { id: `inspect:${object.id}`, kind: "inspect", label: "Inspect", objectId: object.id },
    { id: `graph:${object.id}`, kind: "graph", label: "Open in Graph", objectId: object.id },
    { id: `scenario:${object.id}`, kind: "scenario", label: "Branch Scenario", objectId: object.id },
    { id: `decision:${object.id}`, kind: "decision", label: "Attach to Decision", objectId: object.id },
    { id: `monitor:${object.id}`, kind: "monitor", label: "Monitor", objectId: object.id },
    { id: `compare:${object.id}`, kind: "compare", label: "Compare", objectId: object.id },
    { id: `pin:${object.id}`, kind: "pin", label: "Pin", objectId: object.id },
  ];
  if (object.view) actions.unshift({ id: `open:${object.id}`, kind: "open", label: "Open", view: object.view, objectId: object.id });
  for (const target of SEND_TARGETS[object.kind] ?? []) {
    if (target.view === object.view) continue;
    actions.push({ id: `send:${target.view}:${object.id}`, kind: "send-to", label: target.label, view: target.view, objectId: object.id });
  }
  return actions;
}

export function requestIntelligenceObjectAction(action: IntelligenceObjectAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: action }));
}

export function subscribeIntelligenceObjectActions(listener: (action: IntelligenceObjectAction) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (event instanceof CustomEvent && event.detail) listener(event.detail as IntelligenceObjectAction);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
