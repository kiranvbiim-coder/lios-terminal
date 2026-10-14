export interface BrainLinkedContextTime {
  enabled: boolean;
  asOfDate: string | null;
  mode: "latest" | "as-known-on";
}

export interface BrainLinkedContext {
  instrument?: string;
  time?: BrainLinkedContextTime;
  scenarioId?: string | null;
  portfolioId?: string | null;
  benchmarkId?: string | null;
}

type BrainTaskWithInput = { input: Record<string, unknown> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function cleanString(value: unknown, maxLength = 200): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return cleanString(value) ?? null;
}

function normalizeTime(value: unknown): BrainLinkedContextTime | undefined {
  if (!isRecord(value)) return undefined;
  const validDate = typeof value.asOfDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.asOfDate)
    ? value.asOfDate
    : null;
  const enabled = value.enabled === true && Boolean(validDate);
  return {
    enabled,
    asOfDate: enabled ? validDate : null,
    mode: enabled ? "as-known-on" : "latest",
  };
}

/**
 * Rebuild, rather than trust, the terminal context received from a client.
 * The output is intentionally smaller than connector/runtime state: arbitrary
 * objects, rows and credential-like fields have no representation here and
 * are therefore impossible to copy into Brain task inputs through this path.
 */
export function normalizeBrainLinkedContext(value: unknown): BrainLinkedContext | null {
  if (!isRecord(value)) return null;

  const context: BrainLinkedContext = {};
  const instrument = cleanString(value.instrument, 128);
  if (instrument) context.instrument = instrument.toUpperCase();

  const time = normalizeTime(value.time);
  if (time) context.time = time;

  const scenarioId = normalizeId(value.scenarioId);
  if (scenarioId !== undefined) context.scenarioId = scenarioId;
  const portfolioId = normalizeId(value.portfolioId);
  if (portfolioId !== undefined) context.portfolioId = portfolioId;
  const benchmarkId = normalizeId(value.benchmarkId);
  if (benchmarkId !== undefined) context.benchmarkId = benchmarkId;

  return Object.keys(context).length ? context : null;
}

export function attachBrainLinkedContextToPlan<T extends BrainTaskWithInput>(
  plan: T[],
  value: unknown,
): T[] {
  const linkedContext = normalizeBrainLinkedContext(value);
  if (!linkedContext) return plan;
  return plan.map((task) => ({
    ...task,
    input: { ...task.input, linkedContext },
  }));
}

/**
 * Human task edits may change tool-specific inputs but cannot replace the
 * linked analytical snapshot captured when the run was created. Rebuild the
 * stored snapshot before reattaching it so even legacy/malformed task state
 * cannot bypass the linked-context allowlist.
 */
export function sanitizeBrainTaskInput(
  input: Record<string, unknown>,
  existingInput?: Record<string, unknown> | null,
): Record<string, unknown> {
  const { linkedContext: _ignoredLinkedContext, ...rest } = input;
  const linkedContext = normalizeBrainLinkedContext(existingInput?.linkedContext);
  return linkedContext ? { ...rest, linkedContext } : rest;
}
