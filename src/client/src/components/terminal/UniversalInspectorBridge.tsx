import { useEffect, useRef, useState } from "react";
import { openTerminalInspector, type TerminalInspectorRequest } from "@/lib/terminalInspector";
import type { ViewMode } from "@/lib/terminalTypes";

function compact(text: string | null | undefined, max = 100): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

export function inspectionRequestForElement(rawTarget: HTMLElement): TerminalInspectorRequest | null {
  if (!rawTarget.closest(".terminal-root")) return null;
  const target = rawTarget.closest<HTMLElement>("[data-intelligence-label],[data-analytical-role],td,th,[data-terminal-object],[data-artifact-id]");
  if (!target) return null;
  const pane = target.closest<HTMLElement>("[data-testid^='workspace-pane-']");
  const canonical = target.closest<HTMLElement>("[data-artifact-id]");
  const view = (pane?.dataset.view ?? (canonical ? "research" : undefined)) as ViewMode | undefined;
  if (!view) return null;
  const dataValue = target.dataset.intelligenceValue;
  const request: TerminalInspectorRequest = {
    view, symbol: pane?.dataset.symbol,
    label: compact(target.dataset.intelligenceLabel) ?? compact(target.getAttribute("aria-label")) ?? "Visible analytical value",
    value: compact(dataValue ?? target.innerText, 120),
    metricKey: compact(target.dataset.scenarioKey ?? target.dataset.metricKey, 80),
    sourceHint: "Context only: no exact canonical source binding was published for this value.",
  };
  if (canonical) {
    const cell = target.closest<HTMLElement>("[data-cell-ref],[data-table-row]");
    request.target = {
      artifactId: canonical.dataset.artifactId ?? "",
      version: Number(canonical.dataset.artifactVersion),
      contentHash: canonical.dataset.artifactHash ?? "",
      ...(cell?.dataset.cellRef ? { cell: { kind: "spreadsheet" as const, sheetId: cell.dataset.sheetId ?? "", ref: cell.dataset.cellRef } } :
        cell?.dataset.tableRow !== undefined ? { cell: { kind: "table" as const, row: Number(cell.dataset.tableRow), column: cell.dataset.tableColumn ?? "" } } : {}),
      ...(target.dataset.sourceRef ? { sourceRef: target.dataset.sourceRef } : {}),
      ...(target.dataset.receiptId ? { receiptId: target.dataset.receiptId } : {}),
    };
  }
  return request;
}

export default function UniversalInspectorBridge() {
  const focused = useRef<HTMLElement | null>(null);
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const inspect = (element: HTMLElement) => {
      const request = inspectionRequestForElement(element);
      if (!request) return false;
      openTerminalInspector(request);
      return true;
    };
    const click = (event: MouseEvent) => {
      if (!event.altKey || event.button !== 0 || !(event.target instanceof HTMLElement)) return;
      if (!inspectionRequestForElement(event.target)) return;
      event.preventDefault(); event.stopPropagation(); inspect(event.target);
    };
    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement) || event.target.dataset.inspectFocused !== undefined) return;
      focused.current = inspectionRequestForElement(event.target) ? event.target : null;
      setAvailable(focused.current !== null);
    };
    const key = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== "i" || !(event.target instanceof HTMLElement)) return;
      if (!inspectionRequestForElement(event.target)) return;
      event.preventDefault(); event.stopPropagation(); inspect(event.target);
    };
    window.addEventListener("click", click, true);
    window.addEventListener("focusin", focus);
    window.addEventListener("keydown", key, true);
    return () => { window.removeEventListener("click", click, true); window.removeEventListener("focusin", focus); window.removeEventListener("keydown", key, true); };
  }, []);
  return available ? <button type="button" data-inspect-focused="true" aria-keyshortcuts="Alt+I" onClick={() => { if (focused.current) { focused.current.focus(); const request = inspectionRequestForElement(focused.current); if (request) openTerminalInspector(request); } }} className="fixed bottom-3 right-3 z-[76] rounded border border-cyan-300/40 bg-black px-3 py-2 text-sm text-cyan-200">Inspect focused value · Alt+I</button> : null;
}
