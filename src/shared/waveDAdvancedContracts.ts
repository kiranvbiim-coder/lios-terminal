/** Deterministic Wave D completion contracts for the remaining local-first work. */
import type {
  ActionInboxItem,
  EventRoomInput,
  IntelligenceCard,
  LivingReportReference,
  PulseCardKind,
  PulseEvidence,
  StoredEventRoom,
} from "./waveDContracts";

export type PulseChannel = "for_you" | "following" | "markets" | "research";

export interface PulseFilter {
  channel: PulseChannel;
  kinds?: PulseCardKind[];
  subjectKeys?: string[];
  unreadOnly?: boolean;
}

export function filterPulseCards(cards: readonly IntelligenceCard[], filter: PulseFilter): IntelligenceCard[] {
  const following = new Set((filter.subjectKeys ?? []).map((key) => key.toUpperCase()));
  return cards.filter((card) => {
    if (filter.kinds?.length && !filter.kinds.includes(card.kind)) return false;
    if (filter.unreadOnly && card.status !== "unread") return false;
    if (following.size && (!card.subjectKey || !following.has(card.subjectKey.toUpperCase()))) return false;
    if (filter.channel === "markets") return ["market_move", "macro", "portfolio", "valuation"].includes(card.kind);
    if (filter.channel === "research") return ["research", "earnings", "news", "email", "ai_insight", "community_idea"].includes(card.kind);
    if (filter.channel === "following") return following.size > 0 && !!card.subjectKey && following.has(card.subjectKey.toUpperCase());
    return true;
  });
}

export type BriefMode = "morning" | "evening";

export interface PulseBrief {
  id: string;
  mode: BriefMode;
  generatedAt: string;
  status: "ready" | "caught_up" | "unavailable";
  headline: string;
  cards: IntelligenceCard[];
  actionInbox: ActionInboxItem[];
  evidence: PulseEvidence[];
}

export function buildPulseBrief(mode: BriefMode, cards: readonly IntelligenceCard[], actionInbox: readonly ActionInboxItem[], asOf = new Date()): PulseBrief {
  const ordered = [...cards].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const selected = mode === "morning" ? ordered.slice(0, 12) : ordered.filter((card) => card.status !== "dismissed").slice(0, 12);
  const evidence = selected.flatMap((card) => card.evidence).filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index).slice(0, 100);
  const needsAttention = actionInbox.filter((item) => item.status === "open").length;
  return {
    id: `brief:${mode}:${asOf.toISOString().slice(0, 13)}`,
    mode,
    generatedAt: asOf.toISOString(),
    status: selected.length ? "ready" : "caught_up",
    headline: selected.length ? `${selected.length} decision-relevant updates${needsAttention ? `; ${needsAttention} actions need attention` : ""}.` : "You are caught up.",
    cards: selected,
    actionInbox: actionInbox.slice(0, 50),
    evidence,
  };
}

export interface ContextualAsk {
  question: string;
  subjectKey?: string;
  cardId: string;
  status: "ready" | "unavailable";
  reason: string;
  evidence: PulseEvidence[];
  requiredSources: string[];
}

export function buildContextualAsk(card: IntelligenceCard | undefined, question: string): ContextualAsk {
  const normalized = question.trim();
  if (!card || !normalized) return { question: normalized, cardId: card?.id ?? "", status: "unavailable", reason: "A Pulse card and a non-empty question are required.", evidence: [], requiredSources: [] };
  return { question: normalized, subjectKey: card.subjectKey, cardId: card.id, status: card.evidence.length ? "ready" : "unavailable", reason: card.evidence.length ? "Question is grounded in the card evidence; an AI provider may explain it without changing the underlying facts." : "No attributed evidence is attached to this card.", evidence: card.evidence, requiredSources: card.evidence.length ? [] : ["attributed-card-evidence"] };
}

export type SignalFamily = "price" | "valuation" | "portfolio" | "fundamental" | "macro" | "connector" | "thesis" | "model";

export function classifySignalMetric(metric: string): SignalFamily {
  const normalized = metric.trim().toLowerCase();
  if (["price", "change", "drawdown", "volatility", "beta"].includes(normalized)) return normalized === "price" ? "price" : "portfolio";
  if (["pe", "p/e", "ev_ebitda", "fair_value", "valuation"].includes(normalized)) return "valuation";
  if (["revenue", "revenuegrowth", "eps", "roe", "margin", "earnings", "estimate_revision"].includes(normalized)) return "fundamental";
  if (["gdp", "cpi", "inflation", "rates", "yield", "macro", "policy"].includes(normalized)) return "macro";
  if (["connector_health", "data_freshness", "ingestion"].includes(normalized)) return "connector";
  if (["thesis", "pillar", "counterevidence"].includes(normalized)) return "thesis";
  if (["model", "model_drift", "assumption"].includes(normalized)) return "model";
  return "model";
}

export type MonitorCadence = "hourly" | "daily" | "weekly" | "event";
export interface ScheduledMonitor {
  id: string;
  ruleId: string;
  family: SignalFamily;
  cadence: MonitorCadence;
  timezone: string;
  nextRunAt: string | null;
  enabled: boolean;
  updatedAt: string;
}

export function normalizeScheduledMonitor(input: Omit<ScheduledMonitor, "nextRunAt" | "updatedAt"> & { nextRunAt?: string | null }, now = new Date()): ScheduledMonitor {
  const next = input.nextRunAt && Number.isFinite(Date.parse(input.nextRunAt)) ? new Date(input.nextRunAt).toISOString() : input.cadence === "event" ? null : new Date(now.getTime() + (input.cadence === "hourly" ? 3_600_000 : input.cadence === "daily" ? 86_400_000 : 604_800_000)).toISOString();
  return { ...input, nextRunAt: next, updatedAt: now.toISOString() };
}

export function dueScheduledMonitors(schedules: readonly ScheduledMonitor[], now = new Date()): ScheduledMonitor[] {
  return schedules.filter((schedule) => schedule.enabled && schedule.nextRunAt !== null && !!schedule.nextRunAt && Number.isFinite(Date.parse(schedule.nextRunAt)) && Date.parse(schedule.nextRunAt) <= now.getTime()).sort((a, b) => a.id.localeCompare(b.id));
}

export interface ThesisImpactLink {
  id: string;
  thesisId: string;
  targetType: "valuation" | "portfolio" | "model";
  targetKey: string;
  relationship: "supports" | "challenges" | "depends_on";
  evidenceIds: string[];
  updatedAt: string;
}

export function buildThesisImpactLink(input: Omit<ThesisImpactLink, "id" | "updatedAt">, now = new Date()): ThesisImpactLink {
  return { ...input, id: `impact:${input.thesisId}:${input.targetType}:${input.targetKey}`, updatedAt: now.toISOString() };
}

export interface AnalyticalMemoryRecord {
  id: string;
  kind: "research" | "evidence" | "hypothesis" | "counterevidence" | "workflow";
  subjectKey?: string;
  title: string;
  content: string;
  evidenceIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DecisionJournalEntry {
  id: string;
  subjectKey?: string;
  question: string;
  decision: string;
  rationale: string;
  evidenceIds: string[];
  outcome?: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeMemoryRecord(input: Omit<AnalyticalMemoryRecord, "id" | "createdAt" | "updatedAt">, id: string, now = new Date()): AnalyticalMemoryRecord {
  return { ...input, id, content: input.content.trim().slice(0, 20_000), title: input.title.trim().slice(0, 240), createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export function normalizeJournalEntry(input: Omit<DecisionJournalEntry, "id" | "createdAt" | "updatedAt">, id: string, now = new Date()): DecisionJournalEntry {
  return { ...input, id, question: input.question.trim().slice(0, 2_000), decision: input.decision.trim().slice(0, 4_000), rationale: input.rationale.trim().slice(0, 20_000), createdAt: now.toISOString(), updatedAt: now.toISOString() };
}

export interface EventComparison {
  status: "matched" | "changed" | "unavailable";
  fields: Array<{ field: string; expectation: number | null; reported: number | null; delta: number | null; direction: "up" | "down" | "unchanged" | "unavailable" }>;
}

export function compareEventExpectations(expectations: Record<string, number | null> | undefined, reported: Record<string, number | null> | undefined): EventComparison {
  if (!expectations || !reported) return { status: "unavailable", fields: [] };
  const fields = [...new Set([...Object.keys(expectations), ...Object.keys(reported)])].sort().map((field) => {
    const expectation = expectations[field] ?? null;
    const actual = reported[field] ?? null;
    const delta = expectation !== null && actual !== null ? actual - expectation : null;
    return { field, expectation, reported: actual, delta, direction: delta === null ? "unavailable" as const : delta > 0 ? "up" as const : delta < 0 ? "down" as const : "unchanged" as const };
  });
  return { status: fields.some((field) => field.delta !== null && field.delta !== 0) ? "changed" : "matched", fields };
}

export type EventAction = "explain" | "compare_expectations" | "update_model" | "recalculate_value" | "reevaluate_thesis" | "assess_portfolio_impact" | "generate_event_note";

export function buildEventNote(room: StoredEventRoom | EventRoomInput, comparison: EventComparison, now = new Date()) {
  return {
    id: `event-note:${room.id}`,
    title: `${room.title} event note`,
    status: room.evidenceIds.length && comparison.status !== "unavailable" ? "ready" as const : "incomplete" as const,
    summary: comparison.status === "unavailable" ? "Expectations and reported results are not both available; no comparison is inferred." : comparison.status === "matched" ? "Reported values match the supplied expectations." : "Reported values differ from the supplied expectations; review the explicit deltas.",
    comparison,
    evidenceIds: room.evidenceIds,
    generatedAt: now.toISOString(),
  };
}

export const WAVE_D_REPORT_TEMPLATES = [
  { id: "investment_memo", label: "Investment memo", requiredSections: ["summary", "thesis", "valuation", "risks", "sources"] },
  { id: "valuation_report", label: "Valuation report", requiredSections: ["summary", "valuation", "assumptions", "sensitivity", "sources"] },
  { id: "executive_board_brief", label: "Executive / board brief", requiredSections: ["summary", "decisions", "risks", "actions", "sources"] },
  { id: "portfolio_report", label: "Portfolio report", requiredSections: ["summary", "exposure", "risk", "actions", "sources"] },
  { id: "research_note", label: "Research note", requiredSections: ["summary", "what_changed", "thesis", "sources"] },
] as const;

export function reconcileExportReferences(saved: readonly LivingReportReference[], current: readonly LivingReportReference[], format: "pdf" | "xlsx" | "json") {
  const currentByKey = new Map(current.map((reference) => [`${reference.kind}:${reference.id}`, reference.revision]));
  const stale = saved.filter((reference) => currentByKey.get(`${reference.kind}:${reference.id}`) !== reference.revision).map((reference) => `${reference.kind}:${reference.id}`);
  const missing = saved.filter((reference) => !currentByKey.has(`${reference.kind}:${reference.id}`)).map((reference) => `${reference.kind}:${reference.id}`);
  return { format, status: stale.length || missing.length ? "blocked" as const : "ready" as const, stale, missing, reason: stale.length || missing.length ? "Refresh or remove stale references before export." : "All saved references match the current snapshot." };
}

export interface NotificationEnvelope {
  id: string;
  channel: "desktop" | "webhook" | "email" | "slack" | "teams";
  destination?: string;
  title: string;
  body: string;
  evidenceIds: string[];
  requiresConfirmation: boolean;
  status: "queued" | "blocked" | "delivered";
  createdAt: string;
  deliveredAt?: string;
  deliveryError?: string;
}

export function buildNotificationEnvelope(input: Pick<NotificationEnvelope, "channel" | "destination" | "title" | "body" | "evidenceIds">, permission: "notifications_only" | "read_analyse" | "draft_send", now = new Date()): NotificationEnvelope {
  const send = input.channel !== "desktop";
  const allowed = permission === "draft_send" || (permission === "notifications_only" && !send);
  return { ...input, id: `notification:${now.getTime()}:${input.channel}`, requiresConfirmation: send, status: allowed ? "queued" : "blocked", createdAt: now.toISOString() };
}
