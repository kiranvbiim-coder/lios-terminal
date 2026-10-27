/**
 * Wave D contracts (V4-12 Pulse, V4-13 Signals, V4-14 Communications,
 * V4-17 Stateful Intelligence, V4-18 Event Rooms and V4-19 Living Outputs).
 *
 * Wave D deliberately starts with pure, snapshot-aware contracts.  The
 * server may hydrate these contracts from existing alerts, quotes, decisions
 * and reports, but these functions never invent observations or silently
 * enable side effects.
 */

import type { EditorialMedia } from "./editorialMedia";

export const WAVE_D_CONTRACT_VERSION = "1.0.0" as const;

export const WAVE_D_WORKSTREAMS = [
  "V4-12 Pulse Intelligence",
  "V4-13 Signals and Action Inbox",
  "V4-14 Communications",
  "V4-17 Stateful Intelligence",
  "V4-18 Live Intelligence / Event Rooms",
  "V4-19 Living Outputs",
] as const;


export type PulseCardKind =
  | "news"
  | "market_move"
  | "earnings"
  | "portfolio"
  | "valuation"
  | "research"
  | "email"
  | "alert"
  | "macro"
  | "ai_insight"
  | "workflow"
  | "report"
  | "community_idea";

export type PulsePriority = "critical" | "important" | "fyi";
export type PulseAction = "analyse" | "impact" | "chart" | "compare" | "value" | "ask" | "monitor" | "save" | "share" | "create_report";

export interface PulseEvidence {
  id: string;
  source: string;
  provider?: string;
  snapshotId?: string;
  availableAt?: string;
  url?: string;
}

export interface PulseCardDraft {
  /** Only independently rights-approved media linked to a recorded source may be displayed. */
  media?: EditorialMedia;
  id: string;
  kind: PulseCardKind;
  title: string;
  whatHappened: string;
  whyItMatters: string;
  whyItMattersToUser: string;
  nextActions: PulseAction[];
  createdAt: string;
  symbol?: string;
  subjectKey?: string;
  unread?: boolean;
  magnitude?: number | null;
  portfolioExposure?: number | null;
  thesisRelevance?: number | null;
  upcomingEvent?: number | null;
  evidence: PulseEvidence[];
}

export interface IntelligenceCard extends PulseCardDraft {
  score: number;
  priority: PulsePriority;
  status: "unread" | "read" | "saved" | "dismissed";
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
}

function normalizedMagnitude(value: number | null | undefined): number {
  return clamp(Math.abs(value ?? 0) / 10);
}

/**
 * Rank by decision relevance, not engagement.  All inputs are explicit so a
 * caller can explain why a card rose in the feed and reproduce the result.
 */
export function scorePulseCard(card: PulseCardDraft, now = new Date()): number {
  const created = Date.parse(card.createdAt);
  const ageHours = Number.isFinite(created) ? Math.max(0, (now.getTime() - created) / 3_600_000) : Number.POSITIVE_INFINITY;
  const recency = ageHours === Number.POSITIVE_INFINITY ? 0 : Math.exp(-ageHours / 48);
  const unread = card.unread === false ? 0 : 1;
  const magnitude = normalizedMagnitude(card.magnitude);
  const exposure = clamp(card.portfolioExposure ?? 0);
  const thesis = clamp(card.thesisRelevance ?? 0);
  const upcoming = clamp(card.upcomingEvent ?? 0);
  return Math.round((recency * 30 + magnitude * 25 + exposure * 20 + thesis * 15 + upcoming * 5 + unread * 5) * 100) / 100;
}

export function pulsePriority(score: number): PulsePriority {
  if (score >= 75) return "critical";
  if (score >= 45) return "important";
  return "fyi";
}

export function rankPulseCards(cards: readonly PulseCardDraft[], now = new Date()): IntelligenceCard[] {
  return cards
    .map((card) => {
      const score = scorePulseCard(card, now);
      const status: IntelligenceCard["status"] = card.unread === false ? "read" : "unread";
      return { ...card, score, priority: pulsePriority(score), status };
    })
    .sort((a, b) => b.score - a.score || Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id));
}

export type ActionInboxAction = "investigate" | "recalculate" | "update" | "dismiss" | "snooze" | "monitor";

export interface ActionInboxItem {
  id: string;
  sourceCardId: string;
  title: string;
  reason: string;
  priority: Exclude<PulsePriority, "fyi">;
  suggestedActions: ActionInboxAction[];
  createdAt: string;
  status: "open" | "snoozed" | "resolved";
  evidence: PulseEvidence[];
}

export function deriveActionInbox(cards: readonly IntelligenceCard[]): ActionInboxItem[] {
  return cards
    .filter((card): card is IntelligenceCard & { priority: "critical" | "important" } => card.priority !== "fyi" && card.status === "unread")
    .map((card) => ({
      id: `inbox:${card.id}`,
      sourceCardId: card.id,
      title: card.title,
      reason: `${card.whatHappened} ${card.whyItMattersToUser}`.trim(),
      priority: card.priority,
      suggestedActions: card.nextActions.some((action) => action === "monitor") ? ["investigate", "monitor", "dismiss", "snooze"] : ["investigate", "update", "dismiss", "snooze"],
      createdAt: card.createdAt,
      status: "open",
      evidence: card.evidence,
    }));
}

export type SignalOperator = "above" | "below" | "equals" | "changed_by_at_least";
export type SignalStatus = "breached" | "watching" | "unavailable" | "disabled";

export interface SignalRule {
  id: string;
  title: string;
  subjectKey: string;
  metric: string;
  operator: SignalOperator;
  threshold: number;
  unit: string;
  enabled: boolean;
  createdAt: string;
}

export interface SignalObservation {
  metric: string;
  value: number | null;
  observedAt: string;
  source: string;
  snapshotId?: string;
}

export interface SignalEvaluation {
  ruleId: string;
  status: SignalStatus;
  observedValue: number | null;
  evaluatedAt: string;
  reason?: string;
  evidence?: PulseEvidence[];
}

export interface StoredSignalRule extends SignalRule {
  status: SignalStatus;
  lastEvaluation?: SignalEvaluation;
  updatedAt: string;
}

export interface LivingThesisRecord {
  id: string;
  title: string;
  subjectKey: string;
  pillars: ThesisPillar[];
  status: "intact" | "challenged" | "incomplete";
  updatedAt: string;
}

export function evaluateSignalRule(rule: SignalRule, observation: SignalObservation | null, evaluatedAt = new Date()): SignalEvaluation {
  if (!rule.enabled) return { ruleId: rule.id, status: "disabled", observedValue: null, evaluatedAt: evaluatedAt.toISOString(), reason: "rule-disabled" };
  if (!observation || observation.metric !== rule.metric || typeof observation.value !== "number" || !Number.isFinite(observation.value)) {
    return { ruleId: rule.id, status: "unavailable", observedValue: null, evaluatedAt: evaluatedAt.toISOString(), reason: "observation-unavailable" };
  }
  const value = observation.value;
  const breached = rule.operator === "above" ? value >= rule.threshold
    : rule.operator === "below" ? value <= rule.threshold
      : rule.operator === "equals" ? value === rule.threshold
        : Math.abs(value) >= Math.abs(rule.threshold);
  return {
    ruleId: rule.id,
    status: breached ? "breached" : "watching",
    observedValue: value,
    evaluatedAt: evaluatedAt.toISOString(),
    evidence: [{ id: `${rule.id}:${observation.observedAt}`, source: observation.source, snapshotId: observation.snapshotId, availableAt: observation.observedAt }],
  };
}

export interface NaturalLanguageMonitorProposal {
  status: "proposed" | "needs_review" | "unsupported";
  subjectKey: string;
  metric?: string;
  operator?: SignalOperator;
  threshold?: number;
  unit?: string;
  requiresReview: true;
  reason: string;
}

/** Parse only explicit threshold language; never silently enables a rule. */
export function proposeNaturalLanguageMonitor(prompt: string, subjectKey: string): NaturalLanguageMonitorProposal {
  const text = prompt.trim();
  const match = text.match(/\b(price|pe|p\/e|drawdown|roe|beta|revenue growth)\b[^\d-]*(above|over|greater than|below|under|less than|equals?)?[^\d-]*(-?\d+(?:\.\d+)?)/i);
  if (!match) return { status: "unsupported", subjectKey, requiresReview: true, reason: "No explicit metric and threshold were found; no monitor was created." };
  const metricToken = match[1].toLowerCase();
  const metric = metricToken === "p/e" ? "pe" : metricToken === "revenue growth" ? "revenueGrowth" : metricToken;
  const direction = (match[2] ?? "").toLowerCase();
  const operator: SignalOperator = direction.includes("below") || direction.includes("under") || direction.includes("less") ? "below" : direction.includes("equal") ? "equals" : "above";
  const threshold = Number(match[3]);
  return { status: "proposed", subjectKey, metric, operator, threshold, unit: metric === "price" ? "currency" : "value", requiresReview: true, reason: "Explicit rule proposed; user review and enablement are required." };
}

export type PillarOperator = "above" | "below" | "equals" | "between";
export type ThesisPillarStatus = "intact" | "challenged" | "breached" | "unavailable";

export interface ThesisPillar {
  id: string;
  title: string;
  metric: string;
  operator: PillarOperator;
  threshold: number;
  upperThreshold?: number;
  unit: string;
  evidenceIds: string[];
}

export interface ThesisObservation {
  metric: string;
  value: number | null;
  observedAt: string;
  evidenceId?: string;
}

export interface ThesisPillarEvaluation {
  id: string;
  status: ThesisPillarStatus;
  observedValue: number | null;
  reason: string;
  evidenceIds: string[];
}

export function evaluateThesisPillars(pillars: readonly ThesisPillar[], observations: readonly ThesisObservation[]): ThesisPillarEvaluation[] {
  const byMetric = new Map(observations.map((observation) => [observation.metric, observation]));
  return pillars.map((pillar) => {
    const observation = byMetric.get(pillar.metric);
    if (!observation || observation.value === null || !Number.isFinite(observation.value)) return { id: pillar.id, status: "unavailable", observedValue: null, reason: "Point-in-time observation unavailable; no conclusion made.", evidenceIds: pillar.evidenceIds };
    const value = observation.value;
    const ok = pillar.operator === "above" ? value > pillar.threshold : pillar.operator === "below" ? value < pillar.threshold : pillar.operator === "equals" ? value === pillar.threshold : value >= pillar.threshold && value <= (pillar.upperThreshold ?? pillar.threshold);
    return { id: pillar.id, status: ok ? "intact" : "breached", observedValue: value, reason: ok ? "Observed value remains inside the explicit pillar condition." : "Observed value violates the explicit pillar condition.", evidenceIds: [...pillar.evidenceIds, ...(observation.evidenceId ? [observation.evidenceId] : [])] };
  });
}

export interface WhatChangedInput {
  subjectType: "company" | "instrument" | "portfolio" | "valuation" | "thesis" | "industry" | "report" | "workspace";
  subjectKey: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  asOf?: string;
}

export interface WhatChangedItem {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
}

export function buildWhatChanged(input: WhatChangedInput): { subjectType: WhatChangedInput["subjectType"]; subjectKey: string; asOf: string | null; changes: WhatChangedItem[]; status: "changed" | "unchanged" } {
  const keys = new Set([...Object.keys(input.before), ...Object.keys(input.after)]);
  const changes: WhatChangedItem[] = [];
  for (const field of [...keys].sort()) {
    const before = input.before[field];
    const after = input.after[field];
    const valid = (value: unknown): value is string | number | boolean | null => value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
    if (!valid(before) || !valid(after) || Object.is(before, after)) continue;
    changes.push({ field, before: before ?? null, after: after ?? null });
  }
  return { subjectType: input.subjectType, subjectKey: input.subjectKey, asOf: input.asOf ?? null, changes, status: changes.length ? "changed" : "unchanged" };
}

export type EventRoomType = "earnings" | "central_bank" | "macro_release" | "investor_day" | "corporate_action" | "other";
export interface EventRoomInput {
  id: string;
  type: EventRoomType;
  title: string;
  scheduledAt: string;
  subjectKey?: string;
  evidenceIds: string[];
  marketReaction?: Record<string, number | null>;
  expectations?: Record<string, number | null>;
  reported?: Record<string, number | null>;
}

export interface StoredEventRoom extends EventRoomInput {
  phase: "scheduled" | "live" | "completed" | "unavailable";
  missing: string[];
  updatedAt: string;
}

export function normalizeEventRoom(input: EventRoomInput, now = new Date()) {
  const scheduled = Date.parse(input.scheduledAt);
  const phase = !Number.isFinite(scheduled) ? "unavailable" as const : scheduled > now.getTime() ? "scheduled" as const : scheduled + 24 * 3_600_000 >= now.getTime() ? "live" as const : "completed" as const;
  const missing: string[] = [];
  if (!input.evidenceIds.length) missing.push("event-evidence");
  if (!input.reported) missing.push("reported-results");
  if (!input.expectations) missing.push("expectations");
  return { ...input, phase, missing, actions: ["explain", "compare_expectations", "update_model", "recalculate_value", "reevaluate_thesis", "assess_portfolio_impact", "generate_event_note"] as const };
}

export interface LivingReportReference {
  kind: "field" | "snapshot" | "calculation" | "chart" | "scenario" | "thesis" | "narrative";
  id: string;
  revision: string;
}

export interface LivingReportRecord {
  id: string;
  title: string;
  templateId: string;
  references: LivingReportReference[];
  status: "current" | "refresh_required";
  updatedAt: string;
}

export interface CommunicationConnectionRecord {
  id: string;
  provider: "gmail" | "microsoft365" | "imap_smtp" | "slack" | "teams" | "webhook";
  permission: CommunicationPermission;
  status: "planned" | "connected" | "degraded" | "revoked";
  scopes: string[];
  updatedAt: string;
}

export function computeReportRefreshState(saved: readonly LivingReportReference[], current: readonly LivingReportReference[]) {
  const currentByKey = new Map(current.map((reference) => [`${reference.kind}:${reference.id}`, reference.revision]));
  const stale = saved.filter((reference) => currentByKey.get(`${reference.kind}:${reference.id}`) !== reference.revision).map((reference) => `${reference.kind}:${reference.id}`);
  const missing = saved.filter((reference) => !currentByKey.has(`${reference.kind}:${reference.id}`)).map((reference) => `${reference.kind}:${reference.id}`);
  return { status: stale.length || missing.length ? "refresh_required" as const : "current" as const, stale, missing, refreshable: stale.length > 0 && missing.length === 0 };
}

export type CommunicationPermission = "notifications_only" | "read_analyse" | "draft_send";
export type CommunicationOperation = "notify" | "read" | "analyse" | "draft" | "send";

export function buildCommunicationPlan(permission: CommunicationPermission, operation: CommunicationOperation) {
  const allowed = permission === "draft_send" || (permission === "read_analyse" && ["read", "analyse"].includes(operation)) || (permission === "notifications_only" && operation === "notify");
  const confirmationRequired = operation === "send";
  return { permission, operation, allowed, confirmationRequired, status: !allowed ? "blocked" as const : confirmationRequired ? "confirmation_required" as const : "ready" as const, reason: !allowed ? "The connection permission does not cover this operation." : confirmationRequired ? "Sending remains side-effectful and requires explicit confirmation." : "Operation is within the granted connection permission." };
}

export function getWaveDReadiness() {
  return {
    contractVersion: WAVE_D_CONTRACT_VERSION,
    workstreams: WAVE_D_WORKSTREAMS,
    guarantees: [
      "Pulse ranking is decision-relevance based and reproducible.",
      "Signals never auto-enable from natural language; proposals require review.",
      "Unavailable point-in-time data remains unavailable.",
      "Communication sends remain confirmation-gated.",
      "Living reports expose stale references before refresh/export.",
      "Pulse channels and briefs are deterministic views over attributed cards.",
      "Scheduled monitors, analytical memory and decision journal records are user/tenant scoped.",
      "Event actions and report exports fail closed when required evidence is unavailable.",
    ],
  } as const;
}
