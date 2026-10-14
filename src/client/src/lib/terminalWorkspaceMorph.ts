import type { PaneId, ViewMode, WorkspaceState } from "./terminalTypes";
import { getWorkspacePane } from "./terminalWorkspace";

export interface WorkspaceMorph {
  id: string;
  label: string;
  description: string;
  triggerFrom: ViewMode[];
  targetPane: PaneId;
  targetView: ViewMode;
  preserveSymbol: boolean;
}

export const WORKSPACE_MORPHS: readonly WorkspaceMorph[] = [
  { id: "financials-to-dcf", label: "Anchor Financials + Open DCF", description: "Keep statements visible and morph the adjacent pane into intrinsic value.", triggerFrom: ["financialstatements", "companyfundamentals"], targetPane: "secondary", targetView: "valuation", preserveSymbol: true },
  { id: "dcf-to-peers", label: "Add Relative Value", description: "Keep DCF anchored while adding Peer Comps beside it.", triggerFrom: ["valuation"], targetPane: "secondary", targetView: "peercomp", preserveSymbol: true },
  { id: "dcf-to-risk", label: "Challenge Valuation", description: "Keep valuation visible while adding advanced downside and risk diagnostics.", triggerFrom: ["valuation", "peercomp"], targetPane: "tertiary", targetView: "advancedrisk", preserveSymbol: true },
  { id: "portfolio-to-stress", label: "Stress Portfolio", description: "Keep holdings anchored and add portfolio stress beside them.", triggerFrom: ["portfolio", "portfolioattribution"], targetPane: "secondary", targetView: "portfoliostress", preserveSymbol: false },
  { id: "macro-to-policy", label: "Model Policy", description: "Keep macro context visible while adding the policy quant engine.", triggerFrom: ["macrodashboard", "econsignals"], targetPane: "secondary", targetView: "econpolicyquant", preserveSymbol: false },
  { id: "supply-to-quant", label: "Model Supply Chain", description: "Keep operational context visible and open the quantitative engine.", triggerFrom: ["supplychaindashboard", "supplychainindicators"], targetPane: "secondary", targetView: "supplychainquant", preserveSymbol: false },
];

export function getWorkspaceMorphs(view: ViewMode): WorkspaceMorph[] {
  return WORKSPACE_MORPHS.filter((morph) => morph.triggerFrom.includes(view));
}

export function applyWorkspaceMorph(workspace: WorkspaceState, morph: WorkspaceMorph): WorkspaceState {
  const source = getWorkspacePane(workspace, workspace.focusedPane) ?? workspace.primary;
  const symbol = morph.preserveSymbol ? source.symbol : workspace.primary.symbol;
  const next = { ...workspace, [morph.targetPane]: { view: morph.targetView, symbol }, focusedPane: morph.targetPane } as WorkspaceState;
  if (morph.targetPane === "tertiary" && !next.secondary) next.secondary = { view: source.view, symbol: source.symbol };
  if (morph.targetPane === "quaternary" && !next.tertiary) next.tertiary = { view: source.view, symbol: source.symbol };
  return next;
}
