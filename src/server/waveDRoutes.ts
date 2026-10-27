/** Wave D continuous-intelligence contracts backed by existing terminal data. */
import crypto from "node:crypto";
import { editorialMediaSchema, eligibleEditorialMedia } from "@shared/editorialMedia";
import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { capturePulseReviewedSnapshot, comparePulseWithReviewedSnapshot } from "./pulseReviewContinuity";
import { effectivePulseFollowingSubjects, normalizePulseSubjectKey, suppressMutedPulseCards, updatePulseSubjectPreferences } from "@shared/pulseSubjectPreferences";
import { requireRole } from "./auth";
import { requireExecutableTrialOrClient, requireTrialOrClient } from "./trialAccess";
import { storage } from "./storage";
import { getNews, getQuotes } from "./marketData";
import { alertMetricLabel, parseAlertCondition } from "./alertsEngine";
import { getWaveDState, personaPreferenceUser, updateWaveDState } from "./waveDStateStore";
import {
  buildCommunicationPlan,
  buildWhatChanged,
  computeReportRefreshState,
  deriveActionInbox,
  evaluateSignalRule,
  evaluateThesisPillars,
  getWaveDReadiness,
  normalizeEventRoom,
  proposeNaturalLanguageMonitor,
  rankPulseCards,
  type PulseCardDraft,
  type LivingReportRecord,
  type LivingThesisRecord,
  type StoredEventRoom,
  type StoredSignalRule,
  type SignalRule,
} from "@shared/waveDContracts";
import {
  buildContextualAsk,
  buildEventNote,
  buildNotificationEnvelope,
  buildPulseBrief,
  buildThesisImpactLink,
  classifySignalMetric,
  compareEventExpectations,
  dueScheduledMonitors,
  filterPulseCards,
  normalizeJournalEntry,
  normalizeMemoryRecord,
  normalizeScheduledMonitor,
  reconcileExportReferences,
  WAVE_D_REPORT_TEMPLATES,
  type BriefMode,
} from "@shared/waveDAdvancedContracts";
import { generateReportPack, listReportTemplates } from "./reportEngine";
import { detectChanges } from "./researchIntelligenceEngines";
import { answerContextualQuestion, dispatchWaveDNotification } from "./waveDIntegrations";

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;
const AUTHOR_ROLES = ["internal_admin", "internal_analyst"] as const;

async function requireWaveDRetailRead(req: Request, res: Response, next: NextFunction): Promise<void> {
  const internal = Boolean(req.isAuthenticated() && READ_ROLES.includes(req.user!.role as (typeof READ_ROLES)[number]));
  if (internal) {
    next();
    return;
  }

  let clientAccess = false;
  await requireTrialOrClient(req, res, () => { clientAccess = true; });
  if (!clientAccess) return;
  await requireExecutableTrialOrClient(req, res, next);
}

const whatChangedSchema = z.object({
  subjectType: z.enum(["company", "instrument", "portfolio", "valuation", "thesis", "industry", "report", "workspace"]),
  subjectKey: z.string().trim().min(1).max(240),
  before: z.record(z.unknown()),
  after: z.record(z.unknown()),
  asOf: z.string().datetime().optional(),
}).strict();

const thesisSchema = z.object({
  pillars: z.array(z.object({
    id: z.string().trim().min(1).max(120),
    title: z.string().trim().min(1).max(240),
    metric: z.string().trim().min(1).max(160),
    operator: z.enum(["above", "below", "equals", "between"]),
    threshold: z.number().finite(),
    upperThreshold: z.number().finite().optional(),
    unit: z.string().trim().min(1).max(80),
    evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100),
  }).strict()).max(100),
  observations: z.array(z.object({
    metric: z.string().trim().min(1).max(160),
    value: z.number().finite().nullable(),
    observedAt: z.string().datetime(),
    evidenceId: z.string().trim().min(1).max(240).optional(),
  }).strict()).max(100),
}).strict();

const eventRoomSchema = z.object({
  id: z.string().trim().min(1).max(160),
  type: z.enum(["earnings", "central_bank", "macro_release", "investor_day", "corporate_action", "other"]),
  title: z.string().trim().min(1).max(240),
  scheduledAt: z.string().datetime(),
  subjectKey: z.string().trim().max(240).optional(),
  evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100),
  marketReaction: z.record(z.number().finite().nullable()).optional(),
  expectations: z.record(z.number().finite().nullable()).optional(),
  reported: z.record(z.number().finite().nullable()).optional(),
  now: z.string().datetime().optional(),
}).strict();

const referencesSchema = z.object({
  saved: z.array(z.object({ kind: z.enum(["field", "snapshot", "calculation", "chart", "scenario", "thesis", "narrative"]), id: z.string().trim().min(1).max(240), revision: z.string().trim().min(1).max(240) }).strict()).max(500),
  current: z.array(z.object({ kind: z.enum(["field", "snapshot", "calculation", "chart", "scenario", "thesis", "narrative"]), id: z.string().trim().min(1).max(240), revision: z.string().trim().min(1).max(240) }).strict()).max(500),
}).strict();

const communicationSchema = z.object({
  permission: z.enum(["notifications_only", "read_analyse", "draft_send"]),
  operation: z.enum(["notify", "read", "analyse", "draft", "send"]),
}).strict();

const proposalSchema = z.object({
  prompt: z.string().trim().min(1).max(2_000),
  subjectKey: z.string().trim().min(1).max(240),
}).strict();

const signalRuleSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240),
  subjectKey: z.string().trim().min(1).max(240),
  metric: z.string().trim().min(1).max(160),
  operator: z.enum(["above", "below", "equals", "changed_by_at_least"]),
  threshold: z.number().finite(),
  unit: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
}).strict();

const signalRulePatchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  threshold: z.number().finite().optional(),
  enabled: z.boolean().optional(),
  status: z.enum(["watching", "disabled"]).optional(),
}).strict();

const thesisRecordSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240),
  subjectKey: z.string().trim().min(1).max(240),
  pillars: thesisSchema.shape.pillars,
}).strict();

const reportRecordSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(240),
  templateId: z.string().trim().min(1).max(120),
  references: referencesSchema.shape.saved,
}).strict();

const communicationConnectionSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  provider: z.enum(["gmail", "microsoft365", "imap_smtp", "slack", "teams", "webhook"]),
  permission: z.enum(["notifications_only", "read_analyse", "draft_send"]),
  status: z.enum(["planned", "connected", "degraded", "revoked"]).default("planned"),
  scopes: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
}).strict();

const inboxActionSchema = z.object({
  status: z.enum(["open", "snoozed", "resolved"]),
}).strict();

const pulseFilterSchema = z.object({
  channel: z.enum(["for_you", "following", "markets", "research"]).default("for_you"),
  kinds: z.array(z.enum(["news", "market_move", "earnings", "portfolio", "valuation", "research", "email", "alert", "macro", "ai_insight", "workflow", "report", "community_idea"])).max(20).optional(),
  subjectKeys: z.array(z.string().trim().min(1).max(240)).max(100).optional(),
  unreadOnly: z.boolean().default(false),
}).strict();

const pulseSubjectWriteSchema = z.object({
  action: z.enum(["follow", "mute", "clear"]),
  cardId: z.string().trim().min(1).max(240).optional(),
  subjectKey: z.string().trim().min(1).max(160).optional(),
}).strict().superRefine((value, context) => {
  const cardWrite = value.action !== "clear";
  if (cardWrite && (!value.cardId || value.subjectKey)) context.addIssue({
    code: z.ZodIssueCode.custom, message: "Follow/Mute must identify one currently authorized Pulse card.", path: ["cardId"],
  });
  if (!cardWrite && (Boolean(value.cardId) === Boolean(value.subjectKey))) context.addIssue({
    code: z.ZodIssueCode.custom, message: "Clear requires exactly one card or already-saved subject.", path: ["subjectKey"],
  });
});

const pulseCardSchema = z.object({
  media: editorialMediaSchema.optional(),
  id: z.string().trim().min(1).max(240).optional(),
  kind: z.enum(["news", "market_move", "earnings", "portfolio", "valuation", "research", "email", "alert", "macro", "ai_insight", "workflow", "report", "community_idea"]),
  title: z.string().trim().min(1).max(240),
  whatHappened: z.string().trim().min(1).max(4_000),
  whyItMatters: z.string().trim().min(1).max(4_000),
  whyItMattersToUser: z.string().trim().min(1).max(4_000),
  nextActions: z.array(z.enum(["analyse", "impact", "chart", "compare", "value", "ask", "monitor", "save", "share", "create_report"])).min(1).max(20),
  createdAt: z.string().datetime().optional(),
  symbol: z.string().trim().max(80).optional(),
  subjectKey: z.string().trim().max(240).optional(),
  unread: z.boolean().default(true),
  magnitude: z.number().finite().nullable().optional(),
  portfolioExposure: z.number().finite().nullable().optional(),
  thesisRelevance: z.number().finite().nullable().optional(),
  upcomingEvent: z.number().finite().nullable().optional(),
  evidence: z.array(z.object({ id: z.string().trim().min(1).max(240), source: z.string().trim().min(1).max(240), provider: z.string().trim().max(120).optional(), snapshotId: z.string().trim().max(240).optional(), availableAt: z.string().datetime().optional(), url: z.string().url().optional() }).strict()).max(100),
}).strict();

const contextualAskSchema = z.object({ cardId: z.string().trim().min(1).max(240), question: z.string().trim().min(1).max(2_000) }).strict();

const scheduleSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  ruleId: z.string().trim().min(1).max(160),
  family: z.enum(["price", "valuation", "portfolio", "fundamental", "macro", "connector", "thesis", "model"]).optional(),
  cadence: z.enum(["hourly", "daily", "weekly", "event"]),
  timezone: z.string().trim().min(1).max(80).default("UTC"),
  nextRunAt: z.string().datetime().nullable().optional(),
  enabled: z.boolean().default(true),
}).strict();

const impactLinkSchema = z.object({
  id: z.string().trim().min(1).max(240).optional(),
  thesisId: z.string().trim().min(1).max(160),
  targetType: z.enum(["valuation", "portfolio", "model"]),
  targetKey: z.string().trim().min(1).max(240),
  relationship: z.enum(["supports", "challenges", "depends_on"]),
  evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100),
}).strict();

const memorySchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  kind: z.enum(["research", "evidence", "hypothesis", "counterevidence", "workflow"]),
  subjectKey: z.string().trim().max(240).optional(),
  title: z.string().trim().min(1).max(240),
  content: z.string().trim().min(1).max(20_000),
  evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100),
}).strict();

const journalSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  subjectKey: z.string().trim().max(240).optional(),
  question: z.string().trim().min(1).max(2_000),
  decision: z.string().trim().min(1).max(4_000),
  rationale: z.string().trim().min(1).max(20_000),
  evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100),
  outcome: z.string().trim().max(4_000).optional(),
}).strict();

const notificationSchema = z.object({
  channel: z.enum(["desktop", "webhook", "email", "slack", "teams"]),
  destination: z.string().trim().max(500).optional(),
  title: z.string().trim().min(1).max(240),
  body: z.string().trim().min(1).max(10_000),
  evidenceIds: z.array(z.string().trim().min(1).max(240)).max(100),
  permission: z.enum(["notifications_only", "read_analyse", "draft_send"]),
}).strict().superRefine((value, context) => {
  if (value.channel !== "desktop" && !value.destination) context.addIssue({ code: z.ZodIssueCode.custom, path: ["destination"], message: "A destination is required for this channel." });
});

const notificationDeliverySchema = z.object({ confirm: z.literal(true) }).strict();

const eventActionSchema = z.object({ action: z.enum(["explain", "compare_expectations", "update_model", "recalculate_value", "reevaluate_thesis", "assess_portfolio_impact", "generate_event_note"]), payload: z.record(z.unknown()).optional() }).strict();

const exportReconcileSchema = z.object({ format: z.enum(["pdf", "xlsx", "json"]), saved: referencesSchema.shape.saved, current: referencesSchema.shape.current }).strict();

const reportRenderSchema = z.object({
  templateId: z.enum(["investment_memo", "valuation_report", "executive_board_brief", "portfolio_report", "research_note"]),
  title: z.string().trim().min(1).max(240),
  subtitle: z.string().trim().max(500).optional(),
  symbol: z.string().trim().max(80).optional(),
  sectionData: z.record(z.unknown()).default({}),
}).strict();

const changeDetectionSchema = z.object({
  subjectType: z.enum(["company", "portfolio", "valuation", "instrument", "model"]),
  subjectKey: z.string().trim().min(1).max(240),
  currentData: z.array(z.object({ field: z.string().trim().min(1).max(160), value: z.union([z.number().finite(), z.string(), z.null()]), source: z.string().trim().min(1).max(240), asOf: z.string().datetime() }).strict()).max(500),
  previousData: z.array(z.object({ field: z.string().trim().min(1).max(160), value: z.union([z.number().finite(), z.string(), z.null()]), source: z.string().trim().min(1).max(240), asOf: z.string().datetime() }).strict()).max(500),
  materialityThresholdPct: z.number().finite().min(0).max(10).default(0.05),
}).strict();

function iso(value: Date | string | null | undefined, fallback: Date): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return fallback.toISOString();
}

function waveUser(req: Request) {
  if (!req.user) throw new Error("Authentication is required.");
  return personaPreferenceUser(req.user);
}

function id(prefix: string, requested?: string): string {
  return requested?.trim() || `${prefix}:${crypto.randomUUID()}`;
}

function pulseFilterFromRequest(req: Request) {
  const query = req.query as Record<string, unknown>;
  const asList = (value: unknown): string[] | undefined => {
    if (typeof value !== "string") return undefined;
    const list = value.split(",").map((item) => item.trim()).filter(Boolean);
    return list.length ? list : undefined;
  };
  const parsed = pulseFilterSchema.safeParse({ channel: query.channel, kinds: asList(query.kinds), subjectKeys: asList(query.subjectKeys), unreadOnly: query.unreadOnly === "true" });
  return parsed.success ? parsed.data : { channel: "for_you" as const, unreadOnly: false };
}
type PulseSources = Readonly<{ quotes: typeof getQuotes; news: typeof getNews }>;
const LIVE_PULSE_SOURCES: PulseSources = { quotes: getQuotes, news: getNews };


async function buildPulseForUser(req: Request, sources: PulseSources) {
  const now = new Date();
  const [alerts, watchlist, storedState] = await Promise.all([
    storage.getAlerts(req.user!.id),
    storage.getWatchlist(req.user!.id),
    getWaveDState(waveUser(req)),
  ]);
  const symbols = Array.from(new Set(watchlist.map((item) => item.symbol.toUpperCase()))).slice(0, 40);
  const quotes = symbols.length ? await sources.quotes(symbols).catch(() => []) : [];
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
  const cards: PulseCardDraft[] = [];

  for (const card of storedState?.pulseCards ?? []) cards.push(card);

  // The existing public RSS/news adapter is safe to hydrate into Pulse
  // because every item carries its feed provider, URL and publication time.
  // Keep this bounded so Pulse remains responsive; licensed feeds can be
  // added later through the same attributed card contract.
  const newsBySymbol = await Promise.all(symbols.slice(0, 4).map(async (symbol) => [symbol, await sources.news(symbol).catch(() => [])] as const));
  for (const [symbol, items] of newsBySymbol) {
    for (const item of items.slice(0, 2)) {
      cards.push({
        id: `news:${symbol}:${item.url}`,
        kind: "news",
        ...(item.media ? { media: item.media } : {}),
        title: item.title,
        whatHappened: item.summary || item.title,
        whyItMatters: "A provider-attributed news item was published for a followed instrument.",
        whyItMattersToUser: `${symbol} is in the current working set; review the source before changing a decision.`,
        nextActions: ["analyse", "save", "ask"],
        createdAt: item.publishedAt,
        symbol,
        subjectKey: symbol,
        unread: true,
        evidence: [{ id: `news-evidence:${item.url}`, source: item.source, provider: item.feedProvider, availableAt: item.publishedAt, url: item.url }],
      });
    }
  }

  for (const alert of alerts.filter((item) => item.triggered)) {
    const condition = alertMetricLabel(alert.condition);
    cards.push({
      id: `alert:${alert.id}`,
      kind: "alert",
      title: `${alert.symbol.toUpperCase()} ${condition} alert breached`,
      whatHappened: `${condition} crossed the configured threshold at ${alert.triggerPrice ?? "an unavailable observed value"}.`,
      whyItMatters: "A user-authored monitoring rule has fired.",
      whyItMattersToUser: "Review the evidence before changing a decision, thesis or monitor.",
      nextActions: ["analyse", "chart", "monitor", "save"],
      createdAt: iso(alert.triggeredAt, now),
      symbol: alert.symbol.toUpperCase(),
      subjectKey: alert.symbol.toUpperCase(),
      unread: true,
      magnitude: alert.triggerPrice,
      evidence: [{ id: `alert:${alert.id}`, source: "LiOS alert monitor", availableAt: iso(alert.triggeredAt, now) }],
    });
  }

  for (const rule of storedState?.signalRules.filter((item) => item.status === "breached") ?? []) {
    if (cards.some((card) => card.id === `signal:${rule.id}`)) continue;
    cards.push({
      id: `signal:${rule.id}`,
      kind: "alert",
      title: `${rule.title} signal breached`,
      whatHappened: rule.lastEvaluation?.observedValue === null || rule.lastEvaluation?.observedValue === undefined ? "The persisted signal is breached, but its observed value is unavailable." : `The observed value is ${rule.lastEvaluation.observedValue}.`,
      whyItMatters: "A Wave D monitoring rule has entered a breached state.",
      whyItMattersToUser: "Investigate the evidence before updating the rule or an affected thesis.",
      nextActions: ["analyse", "monitor", "save"],
      createdAt: rule.lastEvaluation?.evaluatedAt ?? rule.updatedAt,
      symbol: rule.subjectKey,
      subjectKey: rule.subjectKey,
      unread: true,
      magnitude: rule.lastEvaluation?.observedValue,
      evidence: rule.lastEvaluation?.evidence ?? [],
    });
  }

  for (const thesis of storedState?.theses.filter((item) => item.status === "challenged") ?? []) {
    cards.push({
      id: `thesis:${thesis.id}`,
      kind: "research",
      title: `${thesis.title} needs review`,
      whatHappened: "One or more explicit thesis pillars are challenged.",
      whyItMatters: "The saved reasoning has a recorded condition that no longer holds.",
      whyItMattersToUser: "Re-evaluate the thesis using the linked evidence; no conclusion is inferred here.",
      nextActions: ["analyse", "ask", "save"],
      createdAt: thesis.updatedAt,
      subjectKey: thesis.subjectKey,
      unread: true,
      thesisRelevance: 1,
      evidence: thesis.pillars.flatMap((pillar) => pillar.evidenceIds.map((evidenceId) => ({ id: evidenceId, source: "saved thesis pillar" }))),
    });
  }

  for (const quote of quotes) {
    if (!Number.isFinite(quote.changePercent) || Math.abs(quote.changePercent) < 3) continue;
    const observedAt = quote.status.asOf;
    if (!observedAt || !Number.isFinite(Date.parse(observedAt))) continue;
    cards.push({
      id: `market-move:${quote.symbol.toUpperCase()}:${observedAt.slice(0, 13)}`,
      kind: "market_move",
      title: `${quote.symbol.toUpperCase()} moved ${quote.changePercent >= 0 ? "up" : "down"} ${Math.abs(quote.changePercent).toFixed(2)}%`,
      whatHappened: `The observed quote moved ${quote.changePercent.toFixed(2)}% to ${quote.price}.`,
      whyItMatters: "The move is large enough to merit review against the user's working set.",
      whyItMattersToUser: watchlist.some((item) => item.symbol.toUpperCase() === quote.symbol.toUpperCase()) ? "This instrument is on your watchlist." : "This instrument was included in the current market snapshot.",
      nextActions: ["analyse", "chart", "compare", "save"],
      createdAt: observedAt,
      symbol: quote.symbol.toUpperCase(),
      subjectKey: quote.symbol.toUpperCase(),
      unread: true,
      magnitude: quote.changePercent,
      evidence: [{ id: `quote:${quote.symbol.toUpperCase()}:${observedAt}`, source: "market quote", provider: quote.quoteSource, availableAt: observedAt }],
    });
  }

  const ranked = rankPulseCards(cards, now);
  const actionInbox = deriveActionInbox(ranked).map((item) => ({ ...item, status: storedState?.inboxStatuses[item.id] ?? item.status }));
  const controlledCards = ranked.map((card) => {
    const status = storedState?.inboxStatuses[`inbox:${card.id}`];
    return status === "resolved" || status === "snoozed"
      ? { ...card, unread: false, status: "read" as const }
      : card;
  });
  return { now, alerts, watchlist, quotes, cards: controlledCards, actionInbox, storedState };
}

export function registerWaveDRoutes(app: Express, sources: PulseSources = LIVE_PULSE_SOURCES): void {
  app.get("/api/readiness/wave-d", requireRole(...READ_ROLES), (_req, res) => {
    res.json({ wave: "D", ...getWaveDReadiness() });
  });

  app.get("/api/wave-d/pulse", requireWaveDRetailRead, async (req, res) => {
    try {
      const result = await buildPulseForUser(req, sources);
      const requestedFilter = pulseFilterFromRequest(req);
      const preferences = result.storedState.pulseSubjects;
      const permittedFollowing = effectivePulseFollowingSubjects(preferences, result.watchlist.map((item) => item.symbol));
      const filter = requestedFilter.channel === "following"
        ? { ...requestedFilter, subjectKeys: requestedFilter.subjectKeys?.length
            ? permittedFollowing.filter(key => requestedFilter.subjectKeys!.map(normalizePulseSubjectKey).includes(key))
            : permittedFollowing }
        : requestedFilter;
      const cards = filterPulseCards(suppressMutedPulseCards(result.cards, preferences), filter);
      const discoveryChanges = comparePulseWithReviewedSnapshot(cards, result.storedState.pulseReview);
      res.json({ discoveryChanges, contractVersion: getWaveDReadiness().contractVersion, asOf: result.now.toISOString(), status: cards.some((card) => card.status === "unread") ? "attention" : "caught_up", filter, cards, preferences, actionInbox: result.actionInbox, monitoring: { activeRules: result.alerts.filter((item) => !item.triggered).length + (result.storedState?.signalRules.filter((item) => item.enabled).length ?? 0), watchlistSymbols: result.watchlist.length } });
    } catch (error) {
      res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Pulse data unavailable." });
    }
  });

  app.post("/api/wave-d/pulse/review", requireWaveDRetailRead, async (req, res) => {
    // Source identities and hashes are always recomputed server-side from the
    // current authenticated Pulse; never trust client-provided card IDs.
    if (req.body && (typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length))
      return res.status(400).json({ error: "Review capture takes no client-supplied source claims." });
    try {
      const current = await buildPulseForUser(req, sources);
      const visible = suppressMutedPulseCards(current.cards, current.storedState.pulseSubjects);
      const snapshot = capturePulseReviewedSnapshot(visible, current.now);
      const stored = await updateWaveDState(waveUser(req), state => ({
        ...state,
        pulseReview: snapshot,
      }));
      res.json({ status: "saved", persisted: true,
        discoveryChanges: comparePulseWithReviewedSnapshot(visible, stored.pulseReview),
        updatedAt: stored.updatedAt });
    } catch {
      res.status(502).json({ status: "unavailable", reason: "Current intelligence could not be reviewed and saved." });
    }
  });

  app.get("/api/wave-d/pulse/preferences", requireWaveDRetailRead, async (req, res) => {
    try {
      const state = await getWaveDState(waveUser(req));
      res.json({ preferences: state.pulseSubjects, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: "Discovery preferences unavailable." }); }
  });

  app.post("/api/wave-d/pulse/preferences", requireWaveDRetailRead, async (req, res) => {
    const parsed = pulseSubjectWriteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid discovery preference action.", issues: parsed.error.issues });
    try {
      const change = parsed.data;
      let key: string | null = null;
      if (change.cardId) {
        const currentPulse = await buildPulseForUser(req, sources);
        const card = currentPulse.cards.find(item => item.id === change.cardId);
        key = normalizePulseSubjectKey(card?.subjectKey ?? card?.symbol);
        if (!key) return res.status(404).json({ error: "Selected card has no currently accessible subject." });
      } else if (change.subjectKey) {
        key = normalizePulseSubjectKey(change.subjectKey);
        const owned = (await getWaveDState(waveUser(req))).pulseSubjects;
        if (!key || !(owned.muted.includes(key) || owned.followed.includes(key)))
          return res.status(404).json({ error: "No saved discovery preference matches this subject." });
      }
      if (!key) return res.status(400).json({ error: "A recorded subject is required." });
      const subject = key;
      const next = await updateWaveDState(waveUser(req), state => ({
        ...state,
        pulseSubjects: updatePulseSubjectPreferences(state.pulseSubjects, subject, change.action),
      }));
      res.json({ status: "saved", persisted: true, preferences: next.pulseSubjects, updatedAt: next.updatedAt });
    } catch (error) {
      res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Discovery preference could not be saved." });
    }
  });

  app.get("/api/wave-d/briefs/:mode", requireWaveDRetailRead, async (req, res) => {
    const mode = req.params.mode as BriefMode;
    if (mode !== "morning" && mode !== "evening") return res.status(400).json({ error: "Brief mode must be morning or evening." });
    try {
      const result = await buildPulseForUser(req, sources);
      // Apply the same discovery mute posture to editorial briefs. Existing
      // monitor alerts and canonical actionable inbox remain independent.
      res.json(buildPulseBrief(mode, suppressMutedPulseCards(result.cards, result.storedState.pulseSubjects), result.actionInbox, result.now));
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Brief unavailable." }); }
  });

  app.post("/api/wave-d/pulse/cards", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = pulseCardSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid Pulse card.", issues: parsed.error.issues });
    if (parsed.data.media && !eligibleEditorialMedia(
      parsed.data.media, parsed.data.evidence.map(evidence => evidence.id), new Date().toISOString(),
    )) return res.status(400).json({ error: "Media rights are unverified, expired, revoked or not linked to an attached evidence ID." });
    const card: PulseCardDraft = { ...parsed.data, id: id("pulse", parsed.data.id), createdAt: parsed.data.createdAt ?? new Date().toISOString(), evidence: parsed.data.evidence };
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, pulseCards: [...current.pulseCards.filter((item) => item.id !== card.id), card] }));
      res.status(201).json({ status: "created", card, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Pulse card could not be persisted." }); }
  });

  app.delete("/api/wave-d/pulse/cards/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    try {
      let removed = false;
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, pulseCards: current.pulseCards.filter((item) => { if (item.id !== req.params.id) return true; removed = true; return false; }) }));
      if (!removed) return res.status(404).json({ error: "Pulse card not found." });
      res.json({ status: "deleted", id: req.params.id, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Pulse card could not be deleted." }); }
  });

  app.post("/api/wave-d/pulse/ask", requireRole(...READ_ROLES), async (req, res) => {
    const parsed = contextualAskSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "cardId and question are required.", issues: parsed.error.issues });
    try {
      const result = await buildPulseForUser(req, sources);
      const card = result.cards.find((item) => item.id === parsed.data.cardId);
      const ask = buildContextualAsk(card, parsed.data.question);
      const answer = ask.status === "ready" ? await answerContextualQuestion(card, parsed.data.question) : { status: "unavailable" as const, reason: ask.reason };
      res.json({ ...ask, answerStatus: answer.status, answer: answer.answer, provider: answer.provider, model: answer.model, attribution: answer.attribution, answerReason: answer.reason, providerRequired: ask.status === "ready" });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Contextual question unavailable." }); }
  });

  app.get("/api/wave-d/schedules", requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ schedules: (await getWaveDState(waveUser(req))).scheduledMonitors }); }
    catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Monitor schedules unavailable." }); }
  });

  app.get("/api/wave-d/schedules/due", requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ schedules: dueScheduledMonitors((await getWaveDState(waveUser(req))).scheduledMonitors), asOf: new Date().toISOString() }); }
    catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Due monitor schedules unavailable." }); }
  });

  app.post("/api/wave-d/schedules", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid monitor schedule.", issues: parsed.error.issues });
    const now = new Date();
    const schedule = normalizeScheduledMonitor({ ...parsed.data, id: id("schedule", parsed.data.id), family: parsed.data.family ?? classifySignalMetric(parsed.data.ruleId.split(":")[0]) }, now);
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, scheduledMonitors: [...current.scheduledMonitors.filter((item) => item.id !== schedule.id), schedule] }));
      res.status(201).json({ status: "created", schedule, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Monitor schedule could not be persisted." }); }
  });

  app.delete("/api/wave-d/schedules/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    try {
      let removed = false;
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, scheduledMonitors: current.scheduledMonitors.filter((item) => { if (item.id !== req.params.id) return true; removed = true; return false; }) }));
      if (!removed) return res.status(404).json({ error: "Monitor schedule not found." });
      res.json({ status: "deleted", id: req.params.id, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Monitor schedule could not be deleted." }); }
  });

  app.get("/api/wave-d/signals", requireRole(...READ_ROLES), async (req, res) => {
    try {
      const alerts = await storage.getAlerts(req.user!.id);
      const state = await getWaveDState(waveUser(req));
      const symbols = Array.from(new Set([...alerts.map((item) => item.symbol.toUpperCase()), ...state.signalRules.map((item) => item.subjectKey.toUpperCase())]));
      const quotes = symbols.length ? await getQuotes(symbols).catch(() => []) : [];
      const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol.toUpperCase(), quote]));
      const evaluatedAt = new Date();
      const evaluations = alerts.map((alert) => {
        const parsed = parseAlertCondition(alert.condition);
        const quote = quoteBySymbol.get(alert.symbol.toUpperCase());
        const rule: SignalRule = { id: `alert:${alert.id}`, title: `${alert.symbol.toUpperCase()} ${alertMetricLabel(alert.condition)}`, subjectKey: alert.symbol.toUpperCase(), metric: parsed?.metric ?? "price", operator: parsed?.direction ?? "above", threshold: alert.price, unit: parsed?.metric === "price" ? "currency" : "value", enabled: !alert.triggered, createdAt: iso(alert.createdAt, evaluatedAt) };
        // The quote contract only carries a live price.  Valuation/fundamental
        // metrics remain explicitly unavailable here until an attributed
        // snapshot-backed observation is supplied; never coerce a quote into
        // a different metric family.
        const observation = quote && parsed ? { metric: parsed.metric, value: parsed.metric === "price" ? quote.price : null, observedAt: evaluatedAt.toISOString(), source: quote.quoteSource } : null;
        const evaluation = evaluateSignalRule(rule, observation, evaluatedAt);
        return { rule, evaluation: alert.triggered ? { ...evaluation, status: "breached" as const, observedValue: alert.triggerPrice ?? evaluation.observedValue, reason: "persisted-alert-trigger" } : evaluation };
      });
      const storedEvaluations = state.signalRules.map((storedRule) => {
        const quote = quoteBySymbol.get(storedRule.subjectKey.toUpperCase());
        const observation = quote && storedRule.metric === "price" ? { metric: "price", value: quote.price, observedAt: evaluatedAt.toISOString(), source: quote.quoteSource } : null;
        const rule: SignalRule = { ...storedRule };
        const evaluation = storedRule.enabled ? evaluateSignalRule(rule, observation, evaluatedAt) : { ruleId: storedRule.id, status: "disabled" as const, observedValue: null, evaluatedAt: evaluatedAt.toISOString(), reason: "disabled-by-user" };
        return { rule, evaluation: { ...evaluation, evidence: observation ? [{ id: `quote:${storedRule.subjectKey}:${evaluatedAt.toISOString()}`, source: "market quote", provider: observation.source, availableAt: observation.observedAt }] : [] }, source: "wave_d" as const };
      });
      if (storedEvaluations.length) {
        await updateWaveDState(waveUser(req), (current) => ({
          ...current,
          signalRules: current.signalRules.map((rule) => {
            const item = storedEvaluations.find((entry) => entry.rule.id === rule.id);
            if (!item) return rule;
            return { ...rule, status: item.evaluation.status, lastEvaluation: item.evaluation, updatedAt: evaluatedAt.toISOString() };
          }),
        }));
      }
      const allEvaluations = [...evaluations, ...storedEvaluations];
      res.json({ asOf: evaluatedAt.toISOString(), evaluations: allEvaluations, summary: { total: allEvaluations.length, breached: allEvaluations.filter((item) => item.evaluation.status === "breached").length, watching: allEvaluations.filter((item) => item.evaluation.status === "watching").length, unavailable: allEvaluations.filter((item) => item.evaluation.status === "unavailable").length } });
    } catch (error) {
      res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Signal data unavailable." });
    }
  });

  app.get("/api/wave-d/action-inbox", requireWaveDRetailRead, async (req, res) => {
    try {
      const result = await buildPulseForUser(req, sources);
      res.json({ asOf: result.now.toISOString(), items: result.actionInbox, status: result.actionInbox.some((item) => item.status === "open") ? "needs_attention" : "caught_up" });
    } catch (error) {
      res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Action inbox unavailable." });
    }
  });

  app.post("/api/wave-d/signals/propose", requireRole(...READ_ROLES), (req, res) => {
    const parsed = proposalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Prompt and subjectKey are required.", issues: parsed.error.issues });
    res.json(proposeNaturalLanguageMonitor(parsed.data.prompt, parsed.data.subjectKey));
  });

  app.post("/api/wave-d/thesis/evaluate", requireRole(...READ_ROLES), (req, res) => {
    const parsed = thesisSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid thesis pillar evaluation request.", issues: parsed.error.issues });
    const evaluations = evaluateThesisPillars(parsed.data.pillars, parsed.data.observations);
    res.json({ status: evaluations.some((item) => item.status === "breached") ? "challenged" : evaluations.some((item) => item.status === "unavailable") ? "incomplete" : "intact", evaluations });
  });

  app.post("/api/wave-d/what-changed", requireRole(...READ_ROLES), (req, res) => {
    const parsed = whatChangedSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid What Changed request.", issues: parsed.error.issues });
    res.json(buildWhatChanged(parsed.data));
  });

  app.post("/api/wave-d/what-changed/detect", requireRole(...READ_ROLES), (req, res) => {
    const parsed = changeDetectionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid What Changed detection request.", issues: parsed.error.issues });
    const { subjectType, subjectKey, ...inputs } = parsed.data;
    res.json({ subjectType, subjectKey, ...detectChanges(inputs) });
  });

  app.post("/api/wave-d/event-room", requireRole(...READ_ROLES), (req, res) => {
    const parsed = eventRoomSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid event room request.", issues: parsed.error.issues });
    const { now, ...input } = parsed.data;
    res.json(normalizeEventRoom(input, now ? new Date(now) : new Date()));
  });

  app.post("/api/wave-d/reports/reconcile", requireRole(...READ_ROLES), (req, res) => {
    const parsed = referencesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid living-report references.", issues: parsed.error.issues });
    res.json(computeReportRefreshState(parsed.data.saved, parsed.data.current));
  });

  app.post("/api/wave-d/communications/plan", requireRole(...READ_ROLES), (req, res) => {
    const parsed = communicationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid communication plan.", issues: parsed.error.issues });
    res.json(buildCommunicationPlan(parsed.data.permission, parsed.data.operation));
  });

  // Durable Wave D state lives in the tenant-scoped persona preference document
  // until dedicated domain tables are introduced.  These routes expose the
  // lifecycle explicitly; none of them accepts provider credentials.
  app.get("/api/wave-d/state", requireRole(...READ_ROLES), async (req, res) => {
    try {
      res.json(await getWaveDState(waveUser(req)));
    } catch (error) {
      res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Wave D state unavailable." });
    }
  });

  app.post("/api/wave-d/signals", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = signalRuleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid signal rule.", issues: parsed.error.issues });
    const now = new Date().toISOString();
    const rule: StoredSignalRule = {
      ...parsed.data,
      id: id("signal", parsed.data.id),
      status: parsed.data.enabled ? "watching" : "disabled",
      createdAt: now,
      updatedAt: now,
    };
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, signalRules: [...current.signalRules.filter((item) => item.id !== rule.id), rule] }));
      res.status(201).json({ status: "created", rule, persisted: true, updatedAt: state.updatedAt });
    } catch (error) {
      res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Signal could not be persisted." });
    }
  });

  app.patch("/api/wave-d/signals/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = signalRulePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid signal update.", issues: parsed.error.issues });
    try {
      let found: StoredSignalRule | undefined;
      const state = await updateWaveDState(waveUser(req), (current) => {
        const signalRules = current.signalRules.map((rule) => {
          if (rule.id !== req.params.id) return rule;
          found = { ...rule, ...parsed.data, enabled: parsed.data.enabled ?? rule.enabled, status: parsed.data.enabled === false || parsed.data.status === "disabled" ? "disabled" : parsed.data.status === "watching" || parsed.data.enabled === true ? "watching" : rule.status, updatedAt: new Date().toISOString() };
          return found;
        });
        return found ? { ...current, signalRules } : current;
      });
      if (!found) return res.status(404).json({ error: "Signal rule not found." });
      res.json({ status: "updated", rule: found, persisted: true, updatedAt: state.updatedAt });
    } catch (error) {
      res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Signal could not be updated." });
    }
  });

  app.delete("/api/wave-d/signals/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    try {
      let removed = false;
      const state = await updateWaveDState(waveUser(req), (current) => {
        const signalRules = current.signalRules.filter((rule) => {
          if (rule.id !== req.params.id) return true;
          removed = true;
          return false;
        });
        return { ...current, signalRules };
      });
      if (!removed) return res.status(404).json({ error: "Signal rule not found." });
      res.json({ status: "deleted", id: req.params.id, persisted: true, updatedAt: state.updatedAt });
    } catch (error) {
      res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Signal could not be deleted." });
    }
  });

  app.post("/api/wave-d/action-inbox/:id", requireWaveDRetailRead, async (req, res) => {
    const parsed = inboxActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid Action Inbox update.", issues: parsed.error.issues });
    const itemId = String(req.params.id);
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, inboxStatuses: { ...current.inboxStatuses, [itemId]: parsed.data.status } }));
      res.json({ status: parsed.data.status, id: itemId, persisted: true, updatedAt: state.updatedAt });
    } catch (error) {
      res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Action Inbox update failed." });
    }
  });

  app.get("/api/wave-d/theses", requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ theses: (await getWaveDState(waveUser(req))).theses }); }
    catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Theses unavailable." }); }
  });

  app.post("/api/wave-d/theses", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = thesisRecordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid living thesis.", issues: parsed.error.issues });
    const now = new Date().toISOString();
    const thesis: LivingThesisRecord = { ...parsed.data, id: id("thesis", parsed.data.id), status: "incomplete", updatedAt: now };
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, theses: [...current.theses.filter((item) => item.id !== thesis.id), thesis] }));
      res.status(201).json({ status: "created", thesis, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Thesis could not be persisted." }); }
  });

  app.post("/api/wave-d/theses/:id/evaluate", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = thesisSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid thesis evaluation request.", issues: parsed.error.issues });
    const evaluations = evaluateThesisPillars(parsed.data.pillars, parsed.data.observations);
    const status: LivingThesisRecord["status"] = evaluations.some((item) => item.status === "breached") ? "challenged" : evaluations.some((item) => item.status === "unavailable") ? "incomplete" : "intact";
    try {
      let updated: LivingThesisRecord | undefined;
      const state = await updateWaveDState(waveUser(req), (current) => {
        const theses = current.theses.map((thesis) => {
          if (thesis.id !== req.params.id) return thesis;
          updated = { ...thesis, pillars: parsed.data.pillars, status, updatedAt: new Date().toISOString() };
          return updated;
        });
        return updated ? { ...current, theses } : current;
      });
      if (!updated) return res.status(404).json({ error: "Living thesis not found." });
      res.json({ status, evaluations, thesis: updated, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Thesis evaluation failed." }); }
  });

  app.get("/api/wave-d/event-rooms", requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ eventRooms: (await getWaveDState(waveUser(req))).eventRooms }); }
    catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Event rooms unavailable." }); }
  });

  app.post("/api/wave-d/event-rooms", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = eventRoomSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid event room.", issues: parsed.error.issues });
    const { now, ...input } = parsed.data;
    const normalized = normalizeEventRoom(input, now ? new Date(now) : new Date());
    const room: StoredEventRoom = { ...normalized, updatedAt: new Date().toISOString() };
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, eventRooms: [...current.eventRooms.filter((item) => item.id !== room.id), room] }));
      res.status(201).json({ status: "created", eventRoom: room, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Event room could not be persisted." }); }
  });

  app.get("/api/wave-d/reports", requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ reports: (await getWaveDState(waveUser(req))).reports }); }
    catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Living reports unavailable." }); }
  });

  app.post("/api/wave-d/reports", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = reportRecordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid living report.", issues: parsed.error.issues });
    const report: LivingReportRecord = { ...parsed.data, id: id("report", parsed.data.id), status: "current", updatedAt: new Date().toISOString() };
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, reports: [...current.reports.filter((item) => item.id !== report.id), report] }));
      res.status(201).json({ status: "created", report, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Living report could not be persisted." }); }
  });

  app.post("/api/wave-d/reports/:id/reconcile", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = referencesSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid living-report references.", issues: parsed.error.issues });
    const refresh = computeReportRefreshState(parsed.data.saved, parsed.data.current);
    try {
      let updated: LivingReportRecord | undefined;
      const state = await updateWaveDState(waveUser(req), (current) => {
        const reports = current.reports.map((report) => {
          if (report.id !== req.params.id) return report;
          updated = { ...report, status: refresh.status, updatedAt: new Date().toISOString() };
          return updated;
        });
        return updated ? { ...current, reports } : current;
      });
      if (!updated) return res.status(404).json({ error: "Living report not found." });
      res.json({ ...refresh, report: updated, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Living report reconciliation failed." }); }
  });

  app.get("/api/wave-d/communications/connections", requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ connections: (await getWaveDState(waveUser(req))).communications }); }
    catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Communication connections unavailable." }); }
  });

  app.post("/api/wave-d/communications/connections", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = communicationConnectionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid communication connection.", issues: parsed.error.issues });
    const connection = { ...parsed.data, id: id("connection", parsed.data.id), updatedAt: new Date().toISOString() };
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, communications: [...current.communications.filter((item) => item.id !== connection.id), connection] }));
      res.status(201).json({ status: "created", connection, persisted: true, credentialsAccepted: false, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Communication connection could not be persisted." }); }
  });

  app.delete("/api/wave-d/communications/connections/:id", requireRole(...AUTHOR_ROLES), async (req, res) => {
    try {
      let revoked = false;
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, communications: current.communications.map((connection) => {
        if (connection.id !== req.params.id) return connection;
        revoked = true;
        return { ...connection, status: "revoked" as const, updatedAt: new Date().toISOString() };
      }) }));
      if (!revoked) return res.status(404).json({ error: "Communication connection not found." });
      res.json({ status: "revoked", id: req.params.id, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Communication connection could not be revoked." }); }
  });

  app.get("/api/wave-d/theses/impact-links", requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ links: (await getWaveDState(waveUser(req))).impactLinks }); }
    catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Thesis impact links unavailable." }); }
  });

  app.post("/api/wave-d/theses/impact-links", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = impactLinkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid thesis impact link.", issues: parsed.error.issues });
    const link = buildThesisImpactLink(parsed.data);
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, impactLinks: [...current.impactLinks.filter((item) => item.id !== link.id), link] }));
      res.status(201).json({ status: "created", link, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Thesis impact link could not be persisted." }); }
  });

  app.get("/api/wave-d/memory", requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ memory: (await getWaveDState(waveUser(req))).memory }); }
    catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Analytical memory unavailable." }); }
  });

  app.post("/api/wave-d/memory", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = memorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid analytical memory record.", issues: parsed.error.issues });
    const memory = normalizeMemoryRecord(parsed.data, id("memory", parsed.data.id));
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, memory: [...current.memory.filter((item) => item.id !== memory.id), memory] }));
      res.status(201).json({ status: "created", memory, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Analytical memory could not be persisted." }); }
  });

  app.get("/api/wave-d/journal", requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ entries: (await getWaveDState(waveUser(req))).journal }); }
    catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Decision journal unavailable." }); }
  });

  app.post("/api/wave-d/journal", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = journalSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid decision journal entry.", issues: parsed.error.issues });
    const entry = normalizeJournalEntry(parsed.data, id("journal", parsed.data.id));
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, journal: [...current.journal.filter((item) => item.id !== entry.id), entry] }));
      res.status(201).json({ status: "created", entry, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Decision journal entry could not be persisted." }); }
  });

  app.get("/api/wave-d/event-rooms/:id/comparison", requireRole(...READ_ROLES), async (req, res) => {
    try {
      const room = (await getWaveDState(waveUser(req))).eventRooms.find((item) => item.id === req.params.id);
      if (!room) return res.status(404).json({ error: "Event room not found." });
      res.json({ eventRoomId: room.id, comparison: compareEventExpectations(room.expectations, room.reported) });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Event comparison unavailable." }); }
  });

  app.post("/api/wave-d/event-rooms/:id/action", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = eventActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid Event Room action.", issues: parsed.error.issues });
    try {
      const room = (await getWaveDState(waveUser(req))).eventRooms.find((item) => item.id === req.params.id);
      if (!room) return res.status(404).json({ error: "Event room not found." });
      const comparison = compareEventExpectations(room.expectations, room.reported);
      const result = parsed.data.action === "compare_expectations" ? comparison : parsed.data.action === "generate_event_note" ? buildEventNote(room, comparison) : { action: parsed.data.action, status: "queued" as const, reason: "The action is explicit and awaits the corresponding deterministic engine or provider snapshot." };
      res.json({ eventRoomId: room.id, action: parsed.data.action, result, providerRequired: ["update_model", "recalculate_value"].includes(parsed.data.action) });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Event Room action failed." }); }
  });

  app.get("/api/wave-d/report-templates", requireRole(...READ_ROLES), (_req, res) => {
    res.json({ templates: WAVE_D_REPORT_TEMPLATES, existingTemplates: listReportTemplates() });
  });

  app.post("/api/wave-d/reports/render", requireRole(...AUTHOR_ROLES), (req, res) => {
    const parsed = reportRenderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid report render request.", issues: parsed.error.issues });
    const templateMap = { investment_memo: "investment_memo", valuation_report: "dcf_model_pack", executive_board_brief: "decision_receipt_report", portfolio_report: "portfolio_review", research_note: "earnings_preview" } as const;
    const pack = generateReportPack({ templateId: templateMap[parsed.data.templateId], title: parsed.data.title, subtitle: parsed.data.subtitle, symbol: parsed.data.symbol, sectionData: parsed.data.sectionData });
    res.json({ status: "rendered", templateId: parsed.data.templateId, pack, exportReady: true, reconciliationRequired: true });
  });

  app.post("/api/wave-d/exports/reconcile", requireRole(...READ_ROLES), (req, res) => {
    const parsed = exportReconcileSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid export reconciliation request.", issues: parsed.error.issues });
    res.json(reconcileExportReferences(parsed.data.saved, parsed.data.current, parsed.data.format));
  });

  app.get("/api/wave-d/notifications", requireRole(...READ_ROLES), async (req, res) => {
    try { res.json({ notifications: (await getWaveDState(waveUser(req))).notifications }); }
    catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Notifications unavailable." }); }
  });

  app.post("/api/wave-d/notifications", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = notificationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid notification request.", issues: parsed.error.issues });
    const { permission, ...notificationInput } = parsed.data;
    const notification = buildNotificationEnvelope(notificationInput, permission);
    try {
      const state = await updateWaveDState(waveUser(req), (current) => ({ ...current, notifications: [...current.notifications.filter((item) => item.id !== notification.id), notification] }));
      res.status(notification.status === "blocked" ? 403 : 201).json({ ...notification, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Notification could not be persisted." }); }
  });

  app.post("/api/wave-d/notifications/:id/deliver", requireRole(...AUTHOR_ROLES), async (req, res) => {
    const parsed = notificationDeliverySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Explicit delivery confirmation is required.", issues: parsed.error.issues });
    try {
      const current = await getWaveDState(waveUser(req));
      const existing = current.notifications.find((item) => item.id === req.params.id);
      if (!existing) return res.status(404).json({ error: "Notification not found." });
      if (existing.status === "delivered") return res.json({ ...existing, persisted: true, alreadyDelivered: true, updatedAt: current.updatedAt });
      if (existing.status === "blocked" && !existing.deliveryError) {
        return res.status(403).json({ ...existing, persisted: true, reason: "Notification permission blocked this delivery." });
      }

      const result = await dispatchWaveDNotification(existing, parsed.data.confirm);
      const next = result.status === "delivered"
        ? { ...existing, status: "delivered" as const, deliveredAt: result.deliveredAt, deliveryError: undefined }
        : { ...existing, status: "blocked" as const, deliveryError: result.reason };
      const state = await updateWaveDState(waveUser(req), (state) => ({
        ...state,
        notifications: [...state.notifications.filter((item) => item.id !== next.id), next],
      }));
      res.status(result.status === "delivered" ? 200 : 403).json({ ...next, persisted: true, updatedAt: state.updatedAt });
    } catch (error) { res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Notification delivery failed." }); }
  });
}
