/** Wave C readiness and safe planning endpoints. */
import crypto from "node:crypto";
import type { Express, Request } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "./auth";
import { resolvePersistedInstrument } from "./globalInstrumentMasterStore";
import { getEnvironmentSetupForUser } from "./environmentSetupService";
import { verifiedAIChatSelectionAttempt } from "./aiProviderVerification";
import { getPersonaPreferences, setMasterAiPreference, type PersonaPreferenceUser } from "./personaPreferenceService";
import { advanceMasterAiAuthorizationRevision, masterAiAuthorizationGeneration, masterAiAuthorizationRevision, requireMasterAiOn, turnMasterAiOff } from "./masterAiGate";
import { getMarketDatasetAsOf } from "./marketDatasetStore";
import { getProviderConfig } from "./byoaiRouter";
import { assertCurrentCredentialSnapshot } from "./credentialVault";
import { getEconomicDatasetAsOf } from "./economicDatasetStore";
import { getFinancialDatasetAsOf } from "./pointInTimeDatasetStore";
import {
  CANONICAL_MIGRATION_ADAPTERS,
  DETERMINISTIC_ENGINE_REGISTRY,
  EXPERIENCE_OBJECT_ACTIONS,
  EXPERIENCE_SHELL_SURFACES,
  buildDynamicAnalyticsCatalog,
  buildComparisonPlan,
  MARKET_PACKS,
  findMarketPack,
  getMarketClock,
  MASTER_AI_LOCALES,
  MASTER_AI_MODES,
  buildMasterAiFallback,
  normalizeMasterAiSessionState,
  requiresMasterAiConfirmation,
  validateMasterAiToolRequest,
  WAVE_C_CONTRACT_VERSION,
} from "@shared/waveCContracts";
import {
  adaptWaveCCanonicalRecord,
  WAVE_C_ADAPTER_FAMILIES,
  type WaveCCanonicalFamily,
} from "@shared/waveCCanonicalAdapters";
import {
  evaluateWaveCBenchmark,
  WAVE_C_BENCHMARK_DEFINITIONS,
  type WaveCBenchmarkEvent,
} from "@shared/waveCBenchmark";
import { getCanonicalField } from "@shared/dataFieldDictionary";

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;

const aiPlanSchema = z.object({
  toolId: z.enum(["data_fabric.query", "instrument.resolve", "deterministic.compute", "context.explain"]),
  fieldIds: z.array(z.string().trim().min(1)).max(100).optional(),
  engineId: z.string().trim().max(120).optional(),
  prompt: z.string().trim().max(4_000).optional(),
  action: z.enum(["send", "share", "delete", "monitor", "save", "open", "compute"]).default("compute"),
}).strict();

const instrumentResolveSchema = z.object({
  name: z.string().trim().min(1).max(240).optional(),
  ticker: z.string().trim().min(1).max(80).optional(),
  mic: z.string().trim().min(1).max(20).optional(),
  exchange: z.string().trim().min(1).max(120).optional(),
  identifierType: z.enum(["ticker", "provider_id", "figi", "composite_figi", "share_class_figi", "lei", "isin", "cik", "sedol", "cusip", "other"]).optional(),
  identifierValue: z.string().trim().min(1).max(240).optional(),
  identifierProvider: z.string().trim().min(1).max(120).optional(),
  includeHistorical: z.boolean().optional(),
  asOfDate: z.string().date().optional(),
}).strict().refine(
  (value) => Boolean(value.name || value.ticker || (value.identifierType && value.identifierValue)),
  { message: "Instrument resolution requires a name, ticker, or identifier pair." },
);

const aiExecuteSchema = aiPlanSchema.extend({
  instrument: instrumentResolveSchema.optional(),
  symbol: z.string().trim().min(1).max(80).optional(),
  snapshotId: z.string().uuid().optional(),
  asOf: z.coerce.date().optional(),
}).strict();

const canonicalAdaptSchema = z.object({
  family: z.enum(WAVE_C_ADAPTER_FAMILIES),
  input: z.record(z.unknown()),
}).strict();

const dynamicSeriesSchema = z.object({
  symbol: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9.^_=-]+$/),
  fieldId: z.string().trim().min(1).max(160),
  seriesId: z.string().trim().min(1).max(120).optional(),
  asOf: z.coerce.date().optional(),
}).strict();

const benchmarkSchema = z.object({
  targetSeconds: z.union([z.literal(10), z.literal(60)]),
  events: z.array(z.object({ id: z.string().trim().min(1).max(160), atMs: z.number().finite().nonnegative() }).strict()).max(100),
}).strict();

const aiStateSchema = z.object({ state: z.enum(["on", "off"]), mode: z.enum(["manual", "ai_assist", "ai_build", "ai_scenario"]) }).strict();

const comparisonSchema = z.object({ metricIds: z.array(z.string().trim().min(1)).min(1).max(40) }).strict();

export function registerWaveCRoutes(app: Express): void {
  app.get("/api/readiness/wave-c", requireRole(...READ_ROLES), (_req, res) => {
    const catalog = buildDynamicAnalyticsCatalog();
    res.json({
      wave: "C",
      contractVersion: WAVE_C_CONTRACT_VERSION,
      workstreams: ["V4-09 Dynamic Analytics", "V4-10 Master AI", "V4-11 New Experience Shell", "V4-23 Market Packs"],
      dynamicAnalytics: {
        catalogVersion: "universal-field-dictionary+financial-metrics",
        fieldCount: catalog.length,
        numericFieldCount: catalog.filter((field) => field.numeric).length,
        scopes: ["global", "region", "country", "exchange"],
        primaryListingOnly: true,
        canonicalMigrations: CANONICAL_MIGRATION_ADAPTERS,
      },
      masterAi: {
        defaultState: "off",
        modes: MASTER_AI_MODES,
        locales: MASTER_AI_LOCALES,
        deterministicEngines: DETERMINISTIC_ENGINE_REGISTRY,
        confirmationActions: ["send", "share", "delete", "monitor"],
      },
      experienceShell: { surfaces: EXPERIENCE_SHELL_SURFACES, objectActions: EXPERIENCE_OBJECT_ACTIONS, orientationTargetsSeconds: [10, 60] },
      marketPacks: MARKET_PACKS.map(({ id, label, region, countries, exchanges, currency, locale }) => ({ id, label, region, countries, exchanges, currency, locale })),
    });
  });

  app.get("/api/wave-c/analytics/catalog", requireRole(...READ_ROLES), (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 200) || 200, 1), 500);
    const query = String(req.query.q ?? "").trim().toLowerCase();
    const fields = buildDynamicAnalyticsCatalog().filter((field) => !query || field.searchableText.includes(query)).slice(0, limit);
    res.json({ count: fields.length, fields: fields.map(({ searchableText: _searchableText, ...field }) => field) });
  });

  app.get("/api/wave-c/market-packs", requireRole(...READ_ROLES), (req, res) => {
    const query = String(req.query.q ?? "").trim();
    const selected = query ? findMarketPack(query) : null;
    const packs = selected ? [selected] : MARKET_PACKS;
    res.json({ packs: packs.map((pack) => ({ ...pack, clock: getMarketClock(pack) })) });
  });

  app.post("/api/wave-c/ai/validate", requireRole(...READ_ROLES), (req, res) => {
    const parsed = aiPlanSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid Master AI request.", issues: parsed.error.issues });
    const validation = validateMasterAiToolRequest(parsed.data);
    if (!validation.ok) return res.status(400).json(validation);
    res.json({ ok: true, requiresConfirmation: requiresMasterAiConfirmation(parsed.data.action), executionAuthority: parsed.data.toolId === "deterministic.compute" ? parsed.data.engineId : "master-ai" });
  });

  // Canonical adapters are intentionally read-only. They provide a governed
  // bridge for legacy symbol-shaped payloads while making unresolved identity
  // visible to callers; no adapter persists or fabricates an instrument ID.
  app.post("/api/wave-c/canonical/adapt", requireRole(...READ_ROLES), (req, res) => {
    const parsed = canonicalAdaptSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid canonical adapter request.", issues: parsed.error.issues });
    try {
      res.json(adaptWaveCCanonicalRecord(parsed.data.family as WaveCCanonicalFamily, parsed.data.input));
    } catch (error) {
      res.status(422).json({ error: error instanceof Error ? error.message : "Canonical adapter rejected the payload." });
    }
  });

  app.get("/api/wave-c/analytics/series", requireRole(...READ_ROLES), async (req, res) => {
    const parsed = dynamicSeriesSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "symbol and fieldId are required.", issues: parsed.error.issues });
    const { symbol, fieldId, seriesId, asOf } = parsed.data;
    const field = getCanonicalField(fieldId);
    if (!field || !field.type || !["number", "integer", "currency_amount", "percentage", "ratio"].includes(field.type)) {
      return res.status(422).json({ status: "unavailable", reason: "field-not-numeric", fieldId });
    }
    const requestedAsOf = asOf ?? new Date();
    try {
      if (field.contractFamily === "price_history") {
        const supported = new Set(["open", "high", "low", "close", "volume", "priceReturn", "logReturn", "totalReturn"]);
        if (!supported.has(field.name)) return res.status(422).json({ status: "unavailable", reason: "field-not-in-market-snapshot", fieldId });
        const snapshot = await getMarketDatasetAsOf(symbol, requestedAsOf);
        if (!snapshot) return res.status(404).json({ status: "unavailable", reason: "no-attributed-market-snapshot", fieldId, symbol: symbol.toUpperCase() });
        const points = snapshot.payload.bars.map((bar) => ({ date: bar.date, value: bar[field.name as keyof typeof bar] }));
        return res.json({ status: "ready", fieldId, symbol: symbol.toUpperCase(), snapshotId: snapshot.id, provider: snapshot.provider, availableAt: snapshot.availableAt, points });
      }
      if (field.contractFamily === "financial_statements") {
        const snapshot = await getFinancialDatasetAsOf(symbol, requestedAsOf);
        if (!snapshot) return res.status(404).json({ status: "unavailable", reason: "no-attributed-financial-snapshot", fieldId, symbol: symbol.toUpperCase() });
        const points = snapshot.payload.periods.flatMap((period) => {
          const value = period.income[field.name] ?? period.balance[field.name] ?? period.cashflow[field.name];
          return Number.isFinite(value) ? [{ date: period.periodEnd, value }] : [];
        });
        return res.json({ status: points.length ? "ready" : "unavailable", reason: points.length ? undefined : "field-not-observed", fieldId, symbol: symbol.toUpperCase(), snapshotId: snapshot.id, provider: snapshot.provider, availableAt: snapshot.availableAt, points });
      }
      if (field.contractFamily === "macro") {
        if (!seriesId) return res.status(400).json({ status: "unavailable", reason: "seriesId-required-for-macro-field", fieldId });
        const snapshot = await getEconomicDatasetAsOf(seriesId, "economic_series", requestedAsOf);
        if (!snapshot || snapshot.dataClass !== "economic_series") return res.status(404).json({ status: "unavailable", reason: "no-attributed-economic-snapshot", fieldId, seriesId });
        const points = field.name === "value" ? snapshot.payload.observations.map((observation) => ({ date: observation.date, value: observation.value })) : [];
        return res.json({ status: points.length ? "ready" : "unavailable", reason: points.length ? undefined : "field-not-observed", fieldId, seriesId, snapshotId: snapshot.id, provider: snapshot.provider, availableAt: snapshot.availableAt, points });
      }
      return res.status(422).json({ status: "unavailable", reason: "provider-series-adapter-not-implemented", fieldId });
    } catch (error) {
      return res.status(502).json({ status: "unavailable", reason: error instanceof Error ? error.message : "Provider snapshot lookup failed.", fieldId });
    }
  });

  app.post("/api/wave-c/benchmarks/evaluate", requireRole(...READ_ROLES), (req, res) => {
    const parsed = benchmarkSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid benchmark evidence.", issues: parsed.error.issues });
    const definition = WAVE_C_BENCHMARK_DEFINITIONS.find((item) => item.targetSeconds === parsed.data.targetSeconds)!;
    res.json(evaluateWaveCBenchmark(definition, parsed.data.events as WaveCBenchmarkEvent[]));
  });

  // The bridge executes only governed, read-only plans. Deterministic engines
  // remain the authority for calculations; this endpoint never lets a model
  // invent a result or bypass confirmation for side effects.
  app.post("/api/wave-c/ai/execute", requireRole(...READ_ROLES), async (req, res) => {
    const parsed = aiExecuteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid Master AI execution request.", issues: parsed.error.issues });
    const validation = validateMasterAiToolRequest(parsed.data);
    if (!validation.ok) return res.status(400).json({ ...validation, executed: false });
    const attributionSetup = await getEnvironmentSetupForUser(req.user!.id).catch(() => null);
    const promptHash = crypto.createHash("sha256").update(parsed.data.prompt ?? "").digest("hex");
    const attribution = { provider: attributionSetup?.aiProviderId ?? "deterministic", model: attributionSetup?.aiModelId ?? "none", promptHash, evidenceIds: parsed.data.snapshotId ? [parsed.data.snapshotId] : [] };
    const requiresConfirmation = requiresMasterAiConfirmation(parsed.data.action);
    if (requiresConfirmation) return res.status(409).json({ status: "confirmation_required", executed: false, requiresConfirmation: true, action: parsed.data.action, attribution });

    if (parsed.data.toolId === "data_fabric.query") {
      const fields = parsed.data.fieldIds!.map((fieldId) => getCanonicalField(fieldId)).filter(Boolean).map((field) => ({ id: field!.id, name: field!.name, contractFamily: field!.contractFamily, type: field!.type }));
      return res.json({ status: "planned", executed: false, execution: "read_only_query_plan", fields, snapshotId: parsed.data.snapshotId ?? null, asOf: parsed.data.asOf?.toISOString() ?? null, warnings: parsed.data.snapshotId ? [] : ["A point-in-time snapshot is required before observations can be returned."], attribution });
    }
    if (parsed.data.toolId === "instrument.resolve") {
      if (!parsed.data.instrument) return res.status(400).json({ error: "instrument.resolve requires an instrument query.", executed: false });
      try {
        const query = parsed.data.instrument;
        const result = await resolvePersistedInstrument({
          name: query.name, ticker: query.ticker, mic: query.mic, exchange: query.exchange,
          identifier: query.identifierType && query.identifierValue ? { type: query.identifierType, value: query.identifierValue, provider: query.identifierProvider } : undefined,
          includeHistorical: query.includeHistorical, asOfDate: query.asOfDate,
        });
        return res.json({ status: "executed", executed: true, result, attribution: { ...attribution, evidenceIds: result.match ? [result.match.entityId, result.match.listingId].filter((id): id is string => Boolean(id)) : [] } });
      } catch (error) {
        return res.status(502).json({ status: "unavailable", executed: false, error: error instanceof Error ? error.message : "Instrument resolver unavailable.", attribution });
      }
    }
    if (parsed.data.toolId === "deterministic.compute") {
      const engine = DETERMINISTIC_ENGINE_REGISTRY.find((candidate) => candidate.id === parsed.data.engineId)!;
      return res.json({ status: "delegated", executed: false, executionAuthority: engine.authority, engineId: engine.id, message: "The deterministic engine is the computation authority; submit its explicit input contract to execute a run.", attribution });
    }
    if (!parsed.data.prompt?.trim()) return res.json({ status: "fallback", executed: false, fallback: buildMasterAiFallback("context-missing"), attribution });
    return res.json({ status: "context_ready", executed: false, context: { prompt: parsed.data.prompt, deterministicOnly: true }, attribution });
  });

  app.get("/api/wave-c/ai/state", requireAuth, async (req, res) => {
    try {
      const current = await getPersonaPreferences(personaUser(req));
      const raw = current.preferences.preferences.waveCMasterAi;
      const state = normalizeMasterAiSessionState(raw && typeof raw === "object" ? raw as { state?: "on" | "off"; mode?: "manual" | "ai_assist" | "ai_build" | "ai_scenario"; updatedAt?: string | null } : undefined);
      if (state.state === "on" && !(await requireMasterAiOn(personaUser(req))).ok) {
        state.state = "off";
      }
      res.json(state);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load Master AI state." });
    }
  });

  app.put("/api/wave-c/ai/state", requireAuth, async (req, res) => {
    const parsed = aiStateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid Master AI state.", issues: parsed.error.issues });
    try {
      const user = personaUser(req);
      const revision = parsed.data.state === "on" ? advanceMasterAiAuthorizationRevision(user.id) : masterAiAuthorizationRevision(user.id);
      const verifiedSelection = async () => {
        const setup = await getEnvironmentSetupForUser(user.id);
        const config = setup?.aiProviderId ? getProviderConfig(setup.aiProviderId) : undefined;
        if (config) (await assertCurrentCredentialSnapshot(config.envKey, config.vaultKey))();
        return revision === masterAiAuthorizationRevision(user.id)
          ? verifiedAIChatSelectionAttempt(user.id, setup?.aiProviderId ?? null, setup?.aiModelId ?? null, user.organizationId)
          : null;
      };
      if (parsed.data.state === "off") {
        await turnMasterAiOff(user, parsed.data.mode);
        const current = await getPersonaPreferences(user);
        return res.json(normalizeMasterAiSessionState(current.preferences.preferences.waveCMasterAi as Parameters<typeof normalizeMasterAiSessionState>[0]));
      }
      const verificationAttemptId = await verifiedSelection();
      if (verificationAttemptId === null) {
        return res.status(409).json({ error: "Save the selected provider and model, then explicitly verify chat in Connection Center before enabling Master AI. Endpoint, credential or model changes require a new probe." });
      }
      const state = { ...parsed.data, updatedAt: new Date().toISOString(), authorization: { generation: masterAiAuthorizationGeneration, revision, verificationAttemptId } };
      await setMasterAiPreference(user, state);
      if ((await verifiedSelection()) !== verificationAttemptId) {
        return res.status(409).json({ error: "AI configuration or permission changed while enabling. Verify the current selection again." });
      }
      res.json(normalizeMasterAiSessionState(state));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Unable to persist Master AI state." });
    }
  });

  app.post("/api/wave-c/analytics/comparison", requireRole(...READ_ROLES), (req, res) => {
    const parsed = comparisonSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "metricIds must contain at least one metric.", issues: parsed.error.issues });
    res.json(buildComparisonPlan(parsed.data.metricIds));
  });
}

function personaUser(req: Request): PersonaPreferenceUser {
  const user = req.user;
  if (!user) throw new Error("Authentication is required.");
  return { id: user.id, email: user.email, role: user.role as PersonaPreferenceUser["role"], organizationId: user.organizationId };
}
