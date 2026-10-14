import {
  conversationRequestSchema,
  workingContextSnapshotSchema,
  WORKING_CONTEXT_VERSION,
  type ConversationRequest,
  type ConversationScope,
  type WorkflowPlan,
  type WorkingContextSnapshot,
} from "./conversationRuntime";
import { CREDENTIAL_SHAPES, WORKING_CONTEXT_POLICY } from "./terminalConvergenceContracts";

/**
 * TC-02 Hidden Working Context: the pure rules. It extends the existing conversation request and run path (no second context
 * service or store): the server derives a snapshot after each turn, saved chats keep it in the assistant message metadata,
 * Temporary chats keep it in client memory, and the next turn resolves "compare this" / "make this more conservative" /
 * "why did this number change?" from it. Nothing here is shown to the user (see WORKING_CONTEXT_POLICY).
 *
 * Entity precedence (owner decision, TC-02): an explicit ticker typed in the message, then a deliberate selection, then the
 * chat's carried context (only for a follow-up that refers back), then the ambient workbench symbol. Resolving the request
 * once, before planning, keeps the planner and the capability resolver (which both honour `context.symbol` first) consistent.
 * Company *names* typed in a message are not resolved here; that is TC-19 under P5 identity.
 */

export const WORKING_CONTEXT_MAX_BYTES = 6_144;

/** Looks like a ticker but is a finance or macro acronym or an ordinary word; never accepted as an explicit mention. */
const NOT_A_TICKER: Record<string, true> = Object.fromEntries(
  (
    "A AI AN AND API AS ASK AT BE BY CAGR CEO CFO COO CPI CSV DCF DO EBIT EBITDA EPS EQUITY ESG ETF EUR FAQ FCF FED FOR FX GAAP GBP GDP "
    + "IF IFRS IN INR IPO IRR IS IT JPY LBO MACD MBO NAV NPV OF ON OR PB PDF PE PPI PRICE PS QOQ RBI ROA ROE ROI ROIC RSI SEBI SEC SHARES SO "
    + "STOCK STRATEGY SYMBOL THE TICKER TO TTM UK US USA USD VAR WACC WITH YOY YTD"
  ).split(" ").map((word) => [word, true] as const),
);

const TICKER_SHAPE = /^[A-Z0-9][A-Z0-9.\-]{0,15}$/;
const ARTIFACT_REF = /^artifact:[0-9a-f-]{36}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function acceptTicker(candidate: string | undefined): string | null {
  if (!candidate) return null;
  const upper = candidate.toUpperCase();
  return TICKER_SHAPE.test(upper) && !NOT_A_TICKER[upper] ? upper : null;
}

/** High-precision forms only: a bare capitalised word is not an explicit ticker ("the FED", "ROI"), so it never outranks context. */
export function extractExplicitSymbol(message: string): string | null {
  const dollar = acceptTicker(/\$([A-Za-z][A-Za-z0-9.\-]{0,15})\b/.exec(message)?.[1]);
  if (dollar) return dollar;
  const keyword = acceptTicker(/\b(?:ticker|symbol)\s+([A-Za-z][A-Za-z0-9.\-]{0,15})\b/i.exec(message)?.[1]);
  if (keyword) return keyword;
  const exchange = acceptTicker(/\b(\d{1,5}\.[A-Za-z]{1,3})\b/.exec(message)?.[1]);
  if (exchange) return exchange;
  const afterVerb = /\b(?:analy[sz]e|backtest|research|review|assess|chart|quote|technicals?|resolve|lookup|identify)\s+(?:for\s+|of\s+|on\s+)?([A-Z][A-Z0-9]{0,5}(?:\.[A-Z]{1,3}|-[A-Z]{3})?)\b/i.exec(message)?.[1];
  return afterVerb && afterVerb === afterVerb.toUpperCase() ? acceptTicker(afterVerb) : null;
}

/** Collect only the same high-precision forms accepted by the single-symbol resolver. */
function explicitSymbols(message: string): string[] {
  const symbols = new Set<string>();
  const first = extractExplicitSymbol(message);
  if (first) symbols.add(first);
  for (const pattern of [
    /\$([A-Za-z][A-Za-z0-9.\-]{0,15})\b/g,
    /\b(?:ticker|symbol)\s+([A-Za-z][A-Za-z0-9.\-]{0,15})\b/gi,
    /\b(\d{1,5}\.[A-Za-z]{1,3})\b/g,
  ]) {
    for (const match of message.matchAll(pattern)) {
      const symbol = acceptTicker(match[1]);
      if (symbol) symbols.add(symbol);
    }
  }
  return [...symbols];
}

/** Older snapshots accumulated unrelated history; only their latest subject is relevant. */
function currentSubjects(snapshot: WorkingContextSnapshot | null): WorkingContextSnapshot["entities"] {
  if (!snapshot) return [];
  const fresh = snapshot.entities.filter((entity) => entity.source !== "carried");
  if (fresh.length > 1) return fresh;
  const objectiveSymbols = explicitSymbols(snapshot.objective ?? "");
  const subjects = snapshot.entities.filter((entity) => objectiveSymbols.includes(entity.symbol));
  if (subjects.some((entity) => entity.symbol === snapshot.entities[0]?.symbol)) return subjects;
  // Legacy follow-ups marked the entire accumulated history as carried. Without
  // a current-objective entity set, its first subject is the only active one.
  return fresh.length ? fresh : snapshot.entities.slice(0, 1);
}

const DEICTIC_NOUN = /\b(?:this|that|these|those|the same|same|above|previous|earlier|last)\s+(?:company|stock|ticker|security|name|one|model|valuation|dcf|analysis|chart|table|number|figure|estimate|forecast|scenario|artifact|result|assumption|output)s?\b/i;
const PRONOUN_VERB = /\b(?:compare|contrast|benchmark|stress|re-?run|redo|revise|update|adjust|tweak|make|set|change|show|explain|analy[sz]e|review|value|check|chart|plot|model|backtest|break down|drill (?:into|down))\b[^.?!\n]{0,40}\b(?:this|that|it|them|these|those)\b/i;
const PRONOUN_DEGREE = /\b(?:this|that|it|these|those)\b[^.?!\n]{0,40}\b(?:more|less)\s+(?:conservative|aggressive|optimistic|pessimistic|bullish|bearish)\b/i;
const CHANGE_QUESTION = /\bwhy\b[^.?!\n]{0,40}\b(?:did|does|is|was|has|have)\b[^.?!\n]{0,40}\b(?:number|figure|value|estimate|target|margin|growth|result|output|change[d]?|move[d]?|differ(?:ent)?)\b|\bwhat\s+(?:has\s+)?changed\b/i;
const ELLIPTICAL_FOLLOW_UP = /^\s*(?:and|also|then|now|what about|how about)\b[^.?!\n]{0,60}\b(?:its|their|the company's|p\/?e|pe ratio|eps|revenue|margins?|growth|wacc|dcf|sensitivity|valuation|price target|dividend|debt|cash flow|fcf|ebitda|rsi|macd|chart|outlook|forecast|earnings|risks?)\b/i;

/**
 * Does the message refer back to what the chat was already about? Deliberately conservative: carrying an entity into an
 * unrelated question ("what is a DCF?") would route it to finance work, so a bare finance term is not enough.
 */
export function isReferentialFollowUp(message: string): boolean {
  return DEICTIC_NOUN.test(message) || PRONOUN_VERB.test(message) || PRONOUN_DEGREE.test(message)
    || CHANGE_QUESTION.test(message) || ELLIPTICAL_FOLLOW_UP.test(message);
}

export type WorkingContextEntitySource = "message" | "selection" | "carried" | "workspace";

export interface WorkingContextResolution {
  /** The request to plan and run: `context.symbol` / `context.activeObjectRefs` filled according to the precedence. */
  request: ConversationRequest;
  entity: { symbol: string; source: WorkingContextEntitySource } | null;
  referential: boolean;
  /** A real clarification, not a guessed entity. Callers must ask before planning or executing. */
  clarification: { symbols: string[]; message: string } | null;
}

export function resolveWorkingContextRequest(request: ConversationRequest, carried: WorkingContextSnapshot | null): WorkingContextResolution {
  const referential = isReferentialFollowUp(request.message);
  const explicitSet = explicitSymbols(request.message);
  const explicit = explicitSet[0] ?? null;
  const selectionSymbol = request.context?.selection?.symbol?.trim().toUpperCase() || null;
  const selectedTextSymbols = explicitSymbols(request.context?.selection?.text ?? "");
  const selectedSet = [...new Set([...(selectionSymbol ? [selectionSymbol] : []), ...selectedTextSymbols])];
  const selection = selectedSet[0] ?? null;
  const ambient = request.context?.symbol?.trim().toUpperCase() || null;
  const subjects = referential ? currentSubjects(carried) : [];
  const candidates = explicit ? explicitSet : selectedSet.length ? selectedSet : subjects.map((entity) => entity.symbol);
  if (referential && WORKING_CONTEXT_POLICY.askOnMaterialAmbiguity && candidates.length > 1) {
    return {
      request: conversationRequestSchema.parse({ ...request, context: { ...request.context, symbol: undefined } }),
      entity: null,
      referential,
      clarification: {
        symbols: candidates,
        message: `Which company do you mean: ${candidates.map((symbol) => `$${symbol}`).join(", ")}? Please name one explicit $ticker so I do not guess.`,
      },
    };
  }
  const carriedSymbol = subjects[0]?.symbol ?? null;
  const entity = explicit ? { symbol: explicit, source: "message" as const }
    : selection ? { symbol: selection, source: "selection" as const }
      : carriedSymbol ? { symbol: carriedSymbol, source: "carried" as const }
        : ambient ? { symbol: ambient, source: "workspace" as const }
          : null;

  const hasArtifactRef = request.context?.activeObjectRefs?.some((ref) => ARTIFACT_REF.test(ref)) ?? false;
  const carriedArtifact = referential && !hasArtifactRef ? carried?.activeArtifact ?? null : null;
  if (!carriedArtifact && (!entity || entity.source === "workspace")) return { request, entity, referential, clarification: null };

  const context = {
    ...request.context,
    ...(entity ? { symbol: entity.symbol } : {}),
    ...(carriedArtifact ? { activeObjectRefs: [...(request.context?.activeObjectRefs ?? []), carriedArtifact].slice(0, 50) } : {}),
  };
  return { request: conversationRequestSchema.parse({ ...request, context }), entity, referential, clarification: null };
}

export function containsCredentialShape(value: unknown): boolean {
  try {
    const text = JSON.stringify(value);
    return CREDENTIAL_SHAPES.some((pattern) => pattern.test(text));
  } catch {
    return true;
  }
}

export interface WorkingContextOwner {
  scope: ConversationScope;
  projectId: number | null;
  chatId: number | null;
}

/**
 * Validates a stored or client-held snapshot. Fails closed (null) on anything unexpected: unknown version or keys, oversize,
 * a credential-shaped value, or a snapshot that belongs to a different chat or Project (no cross-Project bleed). A chat moved
 * from Quick into a Project keeps its snapshot (its Project id was null); Temporary snapshots must not carry an Artifact.
 * Artifact references remain hints: only the canonical Artifact store can authorize their use.
 */
export function restoreWorkingContext(raw: unknown, owner: WorkingContextOwner): WorkingContextSnapshot | null {
  if (raw === null || raw === undefined) return null;
  try {
    if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > WORKING_CONTEXT_MAX_BYTES) return null;
  } catch {
    return null;
  }
  const parsed = workingContextSnapshotSchema.safeParse(raw);
  if (!parsed.success || containsCredentialShape(parsed.data)) return null;
  const snapshot = parsed.data;
  if (owner.scope === "temporary") {
    return owner.chatId === null && owner.projectId === null
      && snapshot.scope === "temporary" && snapshot.chatId === null && snapshot.projectId === null && snapshot.activeArtifact === null
      ? snapshot : null;
  }
  if (owner.chatId === null || snapshot.chatId !== owner.chatId) return null;
  if (owner.scope === "quick") {
    return owner.projectId === null && snapshot.scope === "quick" && snapshot.projectId === null ? snapshot : null;
  }
  if (owner.projectId === null) return null;
  if (snapshot.scope === "quick" && snapshot.projectId === null) return { ...snapshot, scope: "project", projectId: owner.projectId };
  if (snapshot.scope !== "project" || snapshot.projectId !== owner.projectId) return null;
  return snapshot;
}

const CONFIDENCE_BY_SOURCE: Record<WorkingContextEntitySource, number> = { message: 0.95, selection: 0.85, carried: 0.65, workspace: 0.5 };

function firstWords(message: string): string {
  return message.replace(/\s+/g, " ").trim().slice(0, 240);
}

export interface DeriveWorkingContextInput {
  previous: WorkingContextSnapshot | null;
  owner: WorkingContextOwner;
  /** The resolution produced for this turn; `request` is the request that actually ran. */
  resolution: WorkingContextResolution;
  plan: Pick<WorkflowPlan, "intent" | "capabilities">;
  result: { receiptIds: string[] };
  providerId: string | null;
  now?: Date;
}

/** The snapshot to remember after a completed turn, or null if it cannot be made valid and safe. */
export function deriveWorkingContext(input: DeriveWorkingContextInput): WorkingContextSnapshot | null {
  const { previous, owner, resolution, plan, result } = input;
  const request = resolution.request;
  if (resolution.clarification) return null;
  const plannedSymbol = typeof plan.intent.parameters.symbol === "string" ? acceptTicker(plan.intent.parameters.symbol) : null;
  const primary = resolution.entity && TICKER_SHAPE.test(resolution.entity.symbol)
    ? resolution.entity
    : plannedSymbol ? { symbol: plannedSymbol, source: "message" as const } : null;

  // Only the current turn's subject set is carried, never a growing ticker history.
  const entities: WorkingContextSnapshot["entities"] = primary?.source === "message"
    ? explicitSymbols(request.message).map((symbol) => ({ symbol, source: "message" }))
    : primary ? [primary] : [];
  if (!entities.length && primary) entities.push(primary);
  if (primary?.source === "carried") {
    entities.splice(0, entities.length, ...currentSubjects(previous).map((entity) => ({ symbol: entity.symbol, source: "carried" as const })));
  }
  if (entities.length > 8) return null;

  const requestArtifact = request.context?.activeObjectRefs?.find((ref) => ARTIFACT_REF.test(ref)) ?? null;
  const receipts = [...result.receiptIds, ...(previous?.receiptRefs ?? [])]
    .filter((id, index, all) => UUID.test(id) && all.indexOf(id) === index).slice(0, 10);
  const selection = request.context?.selection ?? null;
  const objective = resolution.referential && primary?.source === "carried" && previous?.objective ? previous.objective : firstWords(request.message);

  const candidate = {
    version: WORKING_CONTEXT_VERSION,
    scope: owner.scope,
    projectId: owner.projectId,
    chatId: owner.chatId,
    turn: (previous?.turn ?? 0) + 1,
    updatedAt: (input.now ?? new Date()).toISOString(),
    entities,
    activeArtifact: owner.scope === "temporary" ? null : requestArtifact ?? previous?.activeArtifact ?? null,
    selectedElement: selection ? { kind: selection.kind, id: selection.id?.slice(0, 300) ?? null, label: selection.label?.slice(0, 120) ?? null } : null,
    objective: objective && !containsCredentialShape(objective) ? objective : null,
    sourcePosture: request.sourceScope,
    assumptionRefs: [],
    asOf: null,
    capabilityIds: plan.capabilities.map((capability) => capability.id).filter((id) => id.length <= 80).slice(0, 12),
    aiPosture: { executionMode: request.executionMode, providerId: input.providerId?.slice(0, 80) ?? null },
    receiptRefs: receipts,
    workspaceSessionRef: request.context?.sessionId ?? previous?.workspaceSessionRef ?? null,
    confidence: primary ? CONFIDENCE_BY_SOURCE[primary.source] : previous?.confidence ?? 0.3,
  };
  return restoreWorkingContext(candidate, owner);
}
