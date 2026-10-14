export type DecisionDraftArrival = "unchanged" | "adopt" | "conflict";

/**
 * Local draft comparison only, never a canonical content hash.
 * Database JSON may reorder object keys; arrays, types and authored values must still match.
 */
export function decisionDraftSignature(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(decisionDraftSignature).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries: Array<[string, unknown]> = Object.entries(value);
    entries.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${decisionDraftSignature(item)}`).join(",")}}`;
  }
  if (typeof value === "number") return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
  return JSON.stringify(value) ?? "undefined";
}

/** Never replace authored values with display strings or parse them as numbers/formulas. */
export function editDecisionRecordText(record: Record<string, unknown>, key: string, text: string): Record<string, unknown> {
  if (Object.prototype.hasOwnProperty.call(record, key) && typeof record[key] !== "string") return record;
  return { ...record, [key]: text };
}

export function decisionDraftArrival(input: {
  baseVersion: number; incomingVersion: number; baseline: string; draft: string;
  incoming: string; submitted: string | null;
}): DecisionDraftArrival {
  if (input.baseVersion === input.incomingVersion && input.baseline === input.incoming) return "unchanged";
  if (input.submitted !== null) return input.incoming === input.submitted ? "adopt" : "conflict";
  return input.draft === input.baseline ? "adopt" : "conflict";
}

export function decisionApprovalMatchesVersion(
  inspection: { artifactId: string; version: number; contentHash: string } | undefined,
  identity: { artifactId: string; version: number; contentHash: string },
): boolean {
  return inspection !== undefined && inspection.artifactId === identity.artifactId
    && inspection.version === identity.version && inspection.contentHash === identity.contentHash;
}
