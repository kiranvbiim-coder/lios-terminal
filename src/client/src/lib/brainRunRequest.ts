import { normalizeLinkedContext, type TerminalLinkedContext } from "./terminalLinkedContext";
import { resolveActiveTabLinkedContext } from "./terminalLinkedContextStore";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Brain run creation reads context at request time so the active tab is the
 * authoritative source. Only the canonical linked-context DTO is attached;
 * connector configuration, credentials and raw rows are never read here.
 */
export function withActiveBrainLinkedContext(
  method: string,
  url: string,
  data: unknown,
  linkedContext?: TerminalLinkedContext,
): unknown {
  if (method.toUpperCase() !== "POST" || url !== "/api/brain/runs" || !isRecord(data)) return data;
  return {
    ...data,
    linkedContext: normalizeLinkedContext(linkedContext ?? resolveActiveTabLinkedContext()),
  };
}
