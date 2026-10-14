/**
 * Phase 3: the client-facing dashboard's data API. Everything here is
 * read-only, org-scoped (a client only ever sees rows tied to their own
 * organizationId -- never another org's, never the internal team's raw
 * workspace), and registered before the app.use("/api", requireInternal)
 * gate in routes.ts so client_* credentials aren't blocked from their own
 * endpoints.
 */
import type { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { eq, and, or, desc, inArray, ilike, gte, lt } from "drizzle-orm";
import { getDb } from "./db";
import { createMemoryUpload, CLIENT_UPLOAD_LIMIT_BYTES, safeUploadFileName, validateUploadFileSignature } from "./uploadPolicy";
import { isHostedProductionRuntime } from "./runtimeSecurity";
import { belongsToOrganization } from "./tenantScope";
import { logClientAuditEvent } from "./clientAuditLog";
import {
  publishedContent, contentOrganizationLinks, users, portfolios, positions,
  dashboardWatchlistItems, clientAlerts, platformSettings, PLATFORM_SETTING_AI_SUPPRESSED,
  domains, organizationDomains, consultingRequests, consultingApprovals, consultingComments,
  consultingQuotes, insertConsultingRequestSchema,
  engagements, workstreams, deliverables, meetings, workstreamComments,
  insertWorkstreamCommentSchema, clientAuditEvents,
  decisionRecords, clientDatasets, authorizedDevices, organizationLicenses, platformPlans,
} from "@shared/schema";
import { requireClient, requireClientEntitlement, requireFullClient, requireRole, deviceFingerprintHashFromRequest } from "./auth";
import { auditActor, recordAuditEvent } from "./auditEvents";
import { getQuotes, getOHLCV } from "./marketData";
import { getIndicatorQuotes, getIndicatorHistory, getIndicatorCatalog } from "./fredData";
import { ingestAndProfile, supportedExtensions, extOf } from "./uideEngine/profiler";
import { computeForecastAccountability, type ForecastRecord } from "./decisionReceiptEngine";

const RANGE_TO_YAHOO: Record<string, string> = { "1M": "1M", "3M": "3M", "6M": "6M", "1Y": "1Y" };

async function getOrgPositions(orgId: number) {
  const db = getDb();
  const orgPortfolios = await db.select().from(portfolios).where(eq(portfolios.organizationId, orgId));
  if (!orgPortfolios.length) return [];
  const portfolioIds = orgPortfolios.map((p) => p.id);
  return db.select().from(positions).where(inArray(positions.portfolioId, portfolioIds));
}

// Engagement Health (Wave 5): computed on read, not stored -- derived
// entirely from signals that already exist (workstream status, request SLA/
// escalation), so there's no separate health value that can drift out of
// sync with the data it's supposed to summarize.
export type EngagementHealth = "on_track" | "attention" | "at_risk";

function computeEngagementHealth(params: {
  engagementStatus: typeof engagements.$inferSelect["status"];
  workstreamStatuses: Array<typeof workstreams.$inferSelect["status"]>;
  requestStatuses: Array<typeof consultingRequests.$inferSelect["status"]>;
  slaBreached: boolean;
}): EngagementHealth {
  if (params.workstreamStatuses.includes("blocked")) return "at_risk";
  if (params.requestStatuses.includes("escalated")) return "at_risk";
  if (params.slaBreached) return "at_risk";
  if (params.engagementStatus === "proposed" || params.engagementStatus === "negotiating") return "attention";
  if (params.engagementStatus === "active" && params.workstreamStatuses.length === 0) return "attention";
  return "on_track";
}

// Predictive Engagement Health (Major Bet, Roadmap Rev.3 §10): "upgrades
// Wave 5's reactive badge to a velocity-trend model." The reactive check
// above only ever catches a problem once it's already a fact (a blocked
// workstream, a breached SLA). This adds one real leading indicator: is the
// org's own Terminal activity (clientAuditEvents -- logins, watchlist
// changes, exports, decisions logged, requests, everything Wave 5 already
// logs) speeding up or drying up, compared two weeks against the two weeks
// before that. A quiet client heading toward churn shows up here before
// anything is technically broken. Deliberately one-directional: trend can
// only ever escalate concern (on_track -> attention), never soften a
// reactive at_risk/attention that's already based on a hard fact.
export type HealthTrendDirection = "improving" | "stable" | "declining";
export interface HealthTrend {
  direction: HealthTrendDirection;
  recentActivityCount: number;
  priorActivityCount: number;
}

async function computeActivityTrend(orgId: number): Promise<HealthTrend> {
  const db = getDb();
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const twentyEightDaysAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

  const [recentRows, priorRows] = await Promise.all([
    db.select({ id: clientAuditEvents.id }).from(clientAuditEvents)
      .where(and(eq(clientAuditEvents.organizationId, orgId), gte(clientAuditEvents.createdAt, fourteenDaysAgo))),
    db.select({ id: clientAuditEvents.id }).from(clientAuditEvents)
      .where(and(
        eq(clientAuditEvents.organizationId, orgId),
        gte(clientAuditEvents.createdAt, twentyEightDaysAgo),
        lt(clientAuditEvents.createdAt, fourteenDaysAgo),
      )),
  ]);

  const recentActivityCount = recentRows.length;
  const priorActivityCount = priorRows.length;

  // A brand-new org with near-zero history in both windows isn't
  // "declining," it's just new -- only call a direction once there's enough
  // prior-window signal to meaningfully compare against.
  let direction: HealthTrendDirection = "stable";
  if (priorActivityCount >= 3) {
    if (recentActivityCount <= priorActivityCount * 0.4) direction = "declining";
    else if (recentActivityCount >= priorActivityCount * 1.6) direction = "improving";
  }
  return { direction, recentActivityCount, priorActivityCount };
}

function applyTrendToHealth(reactive: EngagementHealth, trend: HealthTrend): EngagementHealth {
  if (reactive === "on_track" && trend.direction === "declining") return "attention";
  return reactive;
}

interface ClientDomainSummary {
  id: number;
  slug: string;
  name: string;
  icon: string | null;
  active: boolean;
}

async function readLocalClientDomains(orgId: number): Promise<ClientDomainSummary[]> {
  const db = getDb();
  return db.select({
    id: domains.id,
    slug: domains.slug,
    name: domains.name,
    icon: domains.icon,
    active: domains.active,
  }).from(organizationDomains)
    .innerJoin(domains, eq(organizationDomains.domainId, domains.id))
    .where(eq(organizationDomains.organizationId, orgId));
}

async function cacheRemoteClientDomains(orgId: number, rows: ClientDomainSummary[]): Promise<ClientDomainSummary[]> {
  const db = getDb();
  const localDomainIds: number[] = [];
  for (const remote of rows) {
    if (!remote?.slug || !remote?.name) continue;
    let [local] = await db.select().from(domains).where(eq(domains.slug, remote.slug)).limit(1);
    if (!local) {
      [local] = await db.insert(domains).values({
        slug: remote.slug,
        name: remote.name,
        icon: remote.icon ?? null,
        active: remote.active !== false,
      }).returning();
    } else {
      [local] = await db.update(domains).set({
        name: remote.name,
        icon: remote.icon ?? local.icon,
        active: remote.active !== false,
      }).where(eq(domains.id, local.id)).returning();
    }
    localDomainIds.push(local.id);
    await db.insert(organizationDomains).values({ organizationId: orgId, domainId: local.id }).onConflictDoNothing();
  }

  const current = await db.select().from(organizationDomains).where(eq(organizationDomains.organizationId, orgId));
  for (const grant of current) {
    if (!localDomainIds.includes(grant.domainId)) {
      await db.delete(organizationDomains).where(and(
        eq(organizationDomains.organizationId, orgId),
        eq(organizationDomains.domainId, grant.domainId),
      ));
    }
  }
  return readLocalClientDomains(orgId);
}

// Resolves a ?domain=<slug> query param to a domain row the org actually has
// access to -- returns null (not the finance domain) if the org isn't
// subscribed, so callers can 403 instead of silently leaking data from a
// domain the client never paid for. Falls back to the org's first
// subscribed domain when no slug is given, so single-domain orgs (every org
// today) don't need to know this concept exists at all.
async function resolveOrgDomain(orgId: number, slug: string | undefined) {
  const db = getDb();
  const subscribed = await db.select({ domain: domains })
    .from(organizationDomains)
    .innerJoin(domains, eq(organizationDomains.domainId, domains.id))
    .where(eq(organizationDomains.organizationId, orgId));

  if (!subscribed.length) return null;
  if (!slug) return subscribed[0].domain;
  return subscribed.find((s) => s.domain.slug === slug)?.domain ?? null;
}

export function requireLocalByodIngestion(_req: Request, res: Response, next: NextFunction): void {
  if (isHostedProductionRuntime()) {
    res.status(403).json({ error: "Customer BYOD file ingestion is local-desktop only." });
    return;
  }
  next();
}

export function registerClientRoutes(app: Express): void {
  app.post("/api/client/device/request-authorization", requireClient, async (req, res, next) => {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.status(400).json({ error: "A client organization is required." });
      return;
    }
    const parsed = z.object({ deviceLabel: z.string().trim().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const fingerprintHash = deviceFingerprintHashFromRequest(req);
    if (!fingerprintHash) {
      res.status(400).json({ error: "The server-issued device binding cookie is missing or invalid." });
      return;
    }
    try {
      const db = getDb();
      const [existing] = await db.select().from(authorizedDevices).where(and(
        eq(authorizedDevices.organizationId, organizationId),
        eq(authorizedDevices.deviceFingerprintHash, fingerprintHash),
      )).limit(1);
      if (existing) {
        res.json({ id: existing.id, status: existing.status, fingerprintHash });
        return;
      }
      const existingDevices = await db.select().from(authorizedDevices).where(eq(authorizedDevices.organizationId, organizationId));
      let registrationStatus: "authorized" | "pending" = "pending";
      const desktopRegistration = Boolean(req.header("x-lios-desktop-device-id")?.trim());
      if (desktopRegistration) {
        const [license] = await db.select().from(organizationLicenses).where(eq(organizationLicenses.organizationId, organizationId)).limit(1);
        const [plan] = license?.planId
          ? await db.select().from(platformPlans).where(eq(platformPlans.id, license.planId)).limit(1)
          : [null];
        const authorizedCount = existingDevices.filter((row) => row.status === "authorized").length;
        const withinConfiguredLimit = plan
          ? plan.deviceLimit === null || authorizedCount < plan.deviceLimit
          : existingDevices.length === 0;
        if (withinConfiguredLimit) registrationStatus = "authorized";
      }

      const [device] = await db.insert(authorizedDevices).values({
        organizationId,
        userId: req.user!.id,
        deviceFingerprintHash: fingerprintHash,
        deviceLabel: parsed.data.deviceLabel,
        status: registrationStatus,
        firstSeenAt: new Date(),
      }).returning();
      await recordAuditEvent(req.user!.id, "device_authorization_requested", {
        organizationId,
        deviceId: device.id,
        deviceLabel: parsed.data.deviceLabel,
        autoAuthorized: registrationStatus === "authorized",
        ...auditActor(req.user!),
      });
      res.status(201).json({ id: device.id, status: device.status, fingerprintHash });
    } catch (error) {
      next(error);
    }
  });

  // Which domains this org can switch between. Empty/single-item response
  // means the dashboard never shows a switcher at all -- every org today
  // has exactly one (finance), so this is invisible until an admin grants
  // a second domain.
  app.get("/api/client/dashboard/domains", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);

    res.json(await readLocalClientDomains(orgId));
  });

  app.get("/api/client/dashboard/content", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);

    const domain = await resolveOrgDomain(orgId, req.query.domain as string | undefined);
    if (!domain) return res.json([]);

    const db = getDb();
    const [killSwitch] = await db.select().from(platformSettings)
      .where(eq(platformSettings.key, PLATFORM_SETTING_AI_SUPPRESSED)).limit(1);
    const aiSuppressed = killSwitch?.value === true;

    const links = await db.select({ contentId: contentOrganizationLinks.contentId })
      .from(contentOrganizationLinks).where(eq(contentOrganizationLinks.organizationId, orgId));
    const linkedIds = links.map((l) => l.contentId);

    const visibilityConditions = linkedIds.length
      ? or(eq(publishedContent.visibility, "all_clients"), inArray(publishedContent.id, linkedIds))
      : eq(publishedContent.visibility, "all_clients");

    const rows = await db.select({
      id: publishedContent.id,
      title: publishedContent.title,
      body: publishedContent.body,
      contentType: publishedContent.contentType,
      isAiGenerated: publishedContent.isAiGenerated,
      publishedAt: publishedContent.publishedAt,
      authorName: users.name,
    }).from(publishedContent)
      .leftJoin(users, eq(publishedContent.authorUserId, users.id))
      .where(and(eq(publishedContent.status, "published"), eq(publishedContent.domainId, domain.id), visibilityConditions))
      .orderBy(desc(publishedContent.publishedAt));

    const visible = aiSuppressed ? rows.filter((r) => !r.isAiGenerated) : rows;
    res.json(visible);
  });

  app.get("/api/client/dashboard/portfolio", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);

    const db = getDb();
    const orgPortfolios = await db.select().from(portfolios).where(eq(portfolios.organizationId, orgId));
    if (!orgPortfolios.length) return res.json([]);

    const portfolioIds = orgPortfolios.map((p) => p.id);
    const allPositions = await db.select().from(positions).where(inArray(positions.portfolioId, portfolioIds));

    const symbols = Array.from(new Set(allPositions.map((p) => p.symbol)));
    const quotes = symbols.length ? await getQuotes(symbols) : [];
    const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]));

    const result = orgPortfolios.map((portfolio) => {
      const portfolioPositions = allPositions
        .filter((p) => p.portfolioId === portfolio.id)
        .map((p) => {
          const quote = quoteBySymbol.get(p.symbol);
          const price = quote?.price ?? null;
          const marketValue = price !== null ? price * p.shares : null;
          const costBasis = p.avgCost * p.shares;
          const gainLoss = marketValue !== null ? marketValue - costBasis : null;
          const gainLossPct = marketValue !== null && costBasis !== 0 ? (gainLoss! / costBasis) * 100 : null;
          return {
            id: p.id,
            symbol: p.symbol,
            shares: p.shares,
            avgCost: p.avgCost,
            price,
            isLive: quote?.isLive ?? false,
            marketValue,
            gainLoss,
            gainLossPct,
            sector: quote?.sector ?? "Other",
          };
        });
      return { id: portfolio.id, name: portfolio.name, positions: portfolioPositions };
    });

    res.json(result);
  });

  // Server-rendered holdings CSV export.
  app.get("/api/client/dashboard/portfolio/:portfolioId/export", requireFullClient, requireClientEntitlement("export.holdings_csv"), async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization associated." });
    const portfolioId = Number(req.params.portfolioId);

    const db = getDb();
    const [portfolio] = await db.select().from(portfolios)
      .where(and(eq(portfolios.id, portfolioId), eq(portfolios.organizationId, orgId)))
      .limit(1);
    if (!portfolio) return res.status(404).json({ error: "Portfolio not found." });

    const portfolioPositions = await db.select().from(positions).where(eq(positions.portfolioId, portfolioId));
    const symbols = Array.from(new Set(portfolioPositions.map((p) => p.symbol)));
    const quotes = symbols.length ? await getQuotes(symbols) : [];
    const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]));

    const header = "Symbol,Shares,Avg Cost,Price,Market Value,Gain/Loss,Gain/Loss %\n";
    const rows = portfolioPositions.map((p) => {
      const price = quoteBySymbol.get(p.symbol)?.price ?? null;
      const marketValue = price !== null ? price * p.shares : null;
      const costBasis = p.avgCost * p.shares;
      const gainLoss = marketValue !== null ? marketValue - costBasis : null;
      const gainLossPct = marketValue !== null && costBasis !== 0 ? (gainLoss! / costBasis) * 100 : null;
      return [p.symbol, p.shares, p.avgCost, price ?? "", marketValue ?? "", gainLoss ?? "", gainLossPct?.toFixed(2) ?? ""].join(",");
    });

    logClientAuditEvent({ organizationId: orgId, userId: req.user!.id, eventType: "csv_export", details: { portfolioId, portfolioName: portfolio.name } });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${portfolio.name.replace(/\s+/g, "-").toLowerCase()}-holdings.csv"`);
    res.send(header + rows.join("\n"));
  });

  // Reconstructs the org's total portfolio value per trading day from each
  // position's own OHLCV history (shares held x close price that day,
  // forward-filled across the union of trading dates so a US/India/Japan
  // mixed portfolio doesn't produce gaps on days only some exchanges are
  // open), plus a %-return-normalized S&P 500 line for benchmarking. This
  // is reconstructed on the fly rather than stored -- there's no daily
  // portfolio-snapshot table, and shares/avgCost rarely change day to day,
  // so recomputing from real historical prices is both simpler and more
  // accurate than trying to keep a snapshot table in sync.
  app.get("/api/client/dashboard/performance", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json({ series: [] });

    const range = RANGE_TO_YAHOO[String(req.query.range)] ?? "3M";
    const orgPositions = await getOrgPositions(orgId);
    if (!orgPositions.length) return res.json({ series: [] });

    const symbols = Array.from(new Set(orgPositions.map((p) => p.symbol)));
    const [historyBySymbol, benchmarkBars] = await Promise.all([
      Promise.all(symbols.map(async (symbol) => [symbol, await getOHLCV(symbol, range, "1d")] as const)),
      getOHLCV("^GSPC", range, "1d"),
    ]);

    const closesBySymbol = new Map(
      historyBySymbol.map(([symbol, bars]) => [symbol, bars.map((b) => [b.date, b.close] as const)]),
    );
    const allDates = Array.from(new Set(historyBySymbol.flatMap(([, bars]) => bars.map((b) => b.date)))).sort();

    function lastKnownClose(dates: readonly (readonly [string, number])[], asOf: string): number | null {
      let value: number | null = null;
      for (const [date, close] of dates) {
        if (date > asOf) break;
        value = close;
      }
      return value;
    }

    const series = allDates.map((date) => {
      let value = 0;
      for (const p of orgPositions) {
        const dates = closesBySymbol.get(p.symbol) ?? [];
        const close = lastKnownClose(dates, date);
        if (close !== null) value += close * p.shares;
      }
      return { date, value: Math.round(value * 100) / 100 };
    });

    const firstValue = series.find((s) => s.value > 0)?.value ?? null;
    const benchmarkFirst = benchmarkBars[0]?.close ?? null;
    const benchmark = firstValue !== null && benchmarkFirst
      ? benchmarkBars.map((b) => ({
          date: b.date,
          value: Math.round(firstValue * (b.close / benchmarkFirst) * 100) / 100,
        }))
      : [];

    res.json({ series, benchmark });
  });

  app.get("/api/client/dashboard/sparklines", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json({});

    const symbols = String(req.query.symbols ?? "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (!symbols.length) return res.json({});

    const results = await Promise.all(symbols.map(async (symbol) => {
      const bars = await getOHLCV(symbol, "1M", "1d").catch(() => []);
      return [symbol, bars.map((b) => b.close)] as const;
    }));
    res.json(Object.fromEntries(results));
  });

  app.get("/api/client/dashboard/market-snapshot", requireFullClient, async (_req, res) => {
    const quotes = await getQuotes(["^GSPC", "^DJI", "^IXIC", "^VIX"]);
    res.json(quotes.map((q) => ({ symbol: q.symbol, price: q.price, changePercent: q.changePercent })));
  });

  app.get("/api/client/dashboard/quote/:symbol", requireClient, async (req, res) => {
    const symbol = String(req.params.symbol).toUpperCase();
    const [quote] = await getQuotes([symbol]);
    const history = await getOHLCV(symbol, "3M", "1d").catch(() => []);
    res.json({ quote, history });
  });

  // ─── Economics & Public Policy domain ───────────────────────────────────
  app.get("/api/client/dashboard/economics/indicators", requireFullClient, async (_req, res) => {
    const quotes = await getIndicatorQuotes(getIndicatorCatalog("economics_policy").map((i) => i.seriesId));
    res.json(quotes);
  });

  app.get("/api/client/dashboard/economics/indicator/:seriesId", requireFullClient, async (req, res) => {
    const seriesId = String(req.params.seriesId).toUpperCase();
    const [quote] = await getIndicatorQuotes([seriesId]);
    const history = await getIndicatorHistory(seriesId, 60);
    res.json({ quote, history });
  });

  // ─── Operations & Supply Chain Logistics domain ─────────────────────────
  app.get("/api/client/dashboard/supplychain/indicators", requireFullClient, async (_req, res) => {
    const quotes = await getIndicatorQuotes(getIndicatorCatalog("supply_chain").map((i) => i.seriesId));
    res.json(quotes);
  });

  app.get("/api/client/dashboard/supplychain/indicator/:seriesId", requireFullClient, async (req, res) => {
    const seriesId = String(req.params.seriesId).toUpperCase();
    const [quote] = await getIndicatorQuotes([seriesId]);
    const history = await getIndicatorHistory(seriesId, 60);
    res.json({ quote, history });
  });

  app.get("/api/client/dashboard/watchlist", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);

    const db = getDb();
    const items = await db.select().from(dashboardWatchlistItems).where(eq(dashboardWatchlistItems.organizationId, orgId));
    const symbols = Array.from(new Set(items.map((i) => i.symbol)));
    const quotes = symbols.length ? await getQuotes(symbols) : [];
    const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]));

    const result = items.map((item) => {
      const quote = quoteBySymbol.get(item.symbol);
      return {
        id: item.id,
        symbol: item.symbol,
        name: item.name,
        price: quote?.price ?? null,
        change: quote?.change ?? null,
        changePercent: quote?.changePercent ?? null,
        isLive: quote?.isLive ?? false,
      };
    });
    res.json(result);
  });

  app.get("/api/client/dashboard/alerts", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);

    const db = getDb();
    const items = await db.select().from(clientAlerts).where(eq(clientAlerts.organizationId, orgId));
    const symbols = Array.from(new Set(items.map((i) => i.symbol)));
    const quotes = symbols.length ? await getQuotes(symbols) : [];
    const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]));

    const result = items.map((item) => ({
      id: item.id,
      symbol: item.symbol,
      condition: item.condition,
      price: item.price,
      triggered: item.triggered,
      triggerPrice: item.triggerPrice,
      currentPrice: quoteBySymbol.get(item.symbol)?.price ?? null,
      // createdAt/triggeredAt round out the shape to match the internal
      // Alert type (shared/schema.ts) -- the Terminal's AlertsPanel/TopBar
      // (client/src/lib/useAlerts.ts) sort and display by these, and this
      // response is now what the client-audience Terminal build reads too.
      createdAt: item.createdAt,
      triggeredAt: item.triggeredAt,
    }));
    res.json(result);
  });

  // Clients can curate their own watchlist/alerts on top of whatever the
  // internal team seeded -- client_admin only (client_user is read-only),
  // and every write is scoped to the caller's own organizationId so one
  // client can never see or touch another org's rows even by guessing ids.
  const addWatchlistSchema = z.object({ symbol: z.string().trim().min(1).toUpperCase(), name: z.string().trim().min(1) });

  app.post("/api/client/dashboard/watchlist", requireFullClient, requireRole("client_admin"), async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization on this account." });
    const parsed = addWatchlistSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [item] = await db.insert(dashboardWatchlistItems).values({
      organizationId: orgId, symbol: parsed.data.symbol, name: parsed.data.name, addedByUserId: req.user!.id,
    }).returning();
    logClientAuditEvent({ organizationId: orgId, userId: req.user!.id, eventType: "watchlist_add", details: { symbol: item.symbol } });
    res.json(item);
  });

  app.delete("/api/client/dashboard/watchlist/:id", requireFullClient, requireRole("client_admin"), async (req, res) => {
    const orgId = req.user!.organizationId;
    const id = Number(req.params.id);
    const db = getDb();
    const [existing] = await db.select().from(dashboardWatchlistItems).where(eq(dashboardWatchlistItems.id, id)).limit(1);
    if (!existing || existing.organizationId !== orgId) return res.status(404).json({ error: "Not found." });
    await db.delete(dashboardWatchlistItems).where(eq(dashboardWatchlistItems.id, id));
    logClientAuditEvent({ organizationId: orgId!, userId: req.user!.id, eventType: "watchlist_remove", details: { symbol: existing.symbol } });
    res.json({ ok: true });
  });

  const addAlertSchema = z.object({
    symbol: z.string().trim().min(1).toUpperCase(),
    condition: z.string().regex(/^(above|below|price:(above|below)|trailingPE:(above|below)|forwardPE:(above|below)|priceToBook:(above|below)|beta:(above|below)|debtToEquity:(above|below)|returnOnEquity:(above|below)|dividendYield:(above|below))$/),
    price: z.number().positive(),
  });

  app.post("/api/client/dashboard/alerts", requireFullClient, requireRole("client_admin"), async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization on this account." });
    const parsed = addAlertSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [alert] = await db.insert(clientAlerts).values({
      organizationId: orgId, symbol: parsed.data.symbol, condition: parsed.data.condition,
      price: parsed.data.price, createdByUserId: req.user!.id,
    }).returning();
    logClientAuditEvent({ organizationId: orgId, userId: req.user!.id, eventType: "alert_add", details: { symbol: alert.symbol, condition: alert.condition, price: alert.price } });
    res.json(alert);
  });

  app.delete("/api/client/dashboard/alerts/:id", requireFullClient, requireRole("client_admin"), async (req, res) => {
    const orgId = req.user!.organizationId;
    const id = Number(req.params.id);
    const db = getDb();
    const [existing] = await db.select().from(clientAlerts).where(eq(clientAlerts.id, id)).limit(1);
    if (!existing || existing.organizationId !== orgId) return res.status(404).json({ error: "Not found." });
    await db.delete(clientAlerts).where(eq(clientAlerts.id, id));
    logClientAuditEvent({ organizationId: orgId!, userId: req.user!.id, eventType: "alert_remove", details: { symbol: existing.symbol } });
    res.json({ ok: true });
  });

  // ─── Decision Memory (Major Bet, Roadmap Rev.3) ────────────────────────────
  // Log a real decision + forecast now; come back later and record what
  // actually happened. No AI anywhere in this loop -- see shared/schema.ts's
  // decisionRecords docstring. Same write-gating as watchlist/alerts above
  // (client_admin only), reads open to any full client.
  app.get("/api/client/decisions", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);

    const db = getDb();
    const rows = await db.select({
      id: decisionRecords.id,
      question: decisionRecords.question,
      assumptions: decisionRecords.assumptions,
      forecast: decisionRecords.forecast,
      metric: decisionRecords.metric,
      forecastValue: decisionRecords.forecastValue,
      targetDate: decisionRecords.targetDate,
      status: decisionRecords.status,
      actualOutcome: decisionRecords.actualOutcome,
      actualValue: decisionRecords.actualValue,
      resolvedAt: decisionRecords.resolvedAt,
      createdAt: decisionRecords.createdAt,
      createdByName: users.name,
    })
      .from(decisionRecords)
      .innerJoin(users, eq(decisionRecords.createdByUserId, users.id))
      .where(eq(decisionRecords.organizationId, orgId))
      .orderBy(desc(decisionRecords.createdAt));

    res.json(rows);
  });

  // ─── Forecast Accountability (structured metric | forecastValue | actualValue
  // additive to the free-text fields above) -- computeForecastAccountability
  // (decisionReceiptEngine.ts) is a pure function; this route is its only
  // caller. Only rows with both forecastValue and actualValue populated
  // (i.e. logged with a structured forecast, then resolved with a
  // structured actual) are eligible; free-text-only rows are excluded.
  app.get("/api/client/decisions/accuracy", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json({ forecasts: [], meanAbsoluteError: 0, meanPercentageError: 0, overPredictionBias: 0, totalForecasts: 0, resolvedForecasts: 0, accuracyScore: 0, mostAccurateMetric: null, leastAccurateMetric: null });

    const db = getDb();
    const rows = await db.select({
      id: decisionRecords.id,
      metric: decisionRecords.metric,
      forecastValue: decisionRecords.forecastValue,
      createdAt: decisionRecords.createdAt,
      targetDate: decisionRecords.targetDate,
      actualValue: decisionRecords.actualValue,
      resolvedAt: decisionRecords.resolvedAt,
      createdByName: users.name,
      createdByUserId: decisionRecords.createdByUserId,
    })
      .from(decisionRecords)
      .innerJoin(users, eq(decisionRecords.createdByUserId, users.id))
      .where(eq(decisionRecords.organizationId, orgId));

    const records: ForecastRecord[] = rows
      .filter((row) => row.metric != null && row.forecastValue != null && row.actualValue != null)
      .map((row) => ({
        id: String(row.id),
        metric: row.metric!,
        forecastValue: row.forecastValue!,
        forecastDate: row.createdAt.toISOString(),
        targetDate: row.targetDate.toISOString(),
        actualValue: row.actualValue!,
        actualDate: (row.resolvedAt ?? row.targetDate).toISOString(),
        engineId: "decision-memory",
        receiptId: String(row.id),
        owner: { userId: row.createdByUserId, name: row.createdByName },
      }));

    res.json(computeForecastAccountability(records));
  });

  const logDecisionSchema = z.object({
    question: z.string().trim().min(1),
    assumptions: z.string().trim().min(1),
    forecast: z.string().trim().min(1),
    targetDate: z.coerce.date(),
    metric: z.string().trim().min(1).optional(),
    forecastValue: z.coerce.number().finite().optional(),
  }).refine((data) => (data.metric == null) === (data.forecastValue == null), {
    message: "metric and forecastValue must be provided together.",
  });

  app.post("/api/client/decisions", requireFullClient, requireRole("client_admin"), async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization on this account." });
    const parsed = logDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [record] = await db.insert(decisionRecords).values({
      organizationId: orgId,
      question: parsed.data.question,
      assumptions: parsed.data.assumptions,
      forecast: parsed.data.forecast,
      targetDate: parsed.data.targetDate,
      metric: parsed.data.metric ?? null,
      forecastValue: parsed.data.forecastValue ?? null,
      createdByUserId: req.user!.id,
    }).returning();
    logClientAuditEvent({ organizationId: orgId, userId: req.user!.id, eventType: "decision_logged", details: { decisionId: record.id, question: record.question } });
    res.json(record);
  });

  const resolveDecisionSchema = z.object({
    actualOutcome: z.string().trim().min(1),
    actualValue: z.coerce.number().finite().optional(),
  });

  app.patch("/api/client/decisions/:id/resolve", requireFullClient, requireRole("client_admin"), async (req, res) => {
    const orgId = req.user!.organizationId;
    const id = Number(req.params.id);
    const parsed = resolveDecisionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [existing] = await db.select().from(decisionRecords).where(eq(decisionRecords.id, id)).limit(1);
    if (!existing || existing.organizationId !== orgId) return res.status(404).json({ error: "Not found." });
    if (existing.status === "resolved") return res.status(400).json({ error: "This decision is already resolved." });

    const [updated] = await db.update(decisionRecords).set({
      status: "resolved",
      actualOutcome: parsed.data.actualOutcome,
      actualValue: parsed.data.actualValue ?? null,
      resolvedByUserId: req.user!.id,
      resolvedAt: new Date(),
    }).where(eq(decisionRecords.id, id)).returning();
    logClientAuditEvent({ organizationId: orgId!, userId: req.user!.id, eventType: "decision_resolved", details: { decisionId: id } });
    res.json(updated);
  });

  // ─── BYOD -- Bring Your Own Data (Major Bet, Roadmap Rev.3) ────────────────
  // "Client data never gets raw, unrestricted AI access. It flows through
  // the Data Layer, gets validated and normalized... reaches the client
  // only through the consultant or an approved Terminal workflow." Reuses
  // uideEngine/profiler.ts's ingestAndProfile -- the same deterministic
  // column profiler internal UIDE uploads already use -- so this is a real
  // second entry point onto real ingestion code, not a parallel parser.
  // Only the profile is ever stored (see shared/schema.ts's clientDatasets
  // docstring); this profile is never read by /api/chat or any other AI
  // call anywhere in this codebase -- the "no raw AI access" guarantee is
  // structural (nothing wires it in), not a policy comment.
  const datasetUpload = createMemoryUpload(supportedExtensions(), CLIENT_UPLOAD_LIMIT_BYTES);

  app.get("/api/client/datasets", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);
    const db = getDb();
    const rows = await db.select({
      id: clientDatasets.id, fileName: clientDatasets.fileName, fileExt: clientDatasets.fileExt,
      sheetCount: clientDatasets.sheetCount, totalRows: clientDatasets.totalRows,
      createdAt: clientDatasets.createdAt, uploadedByName: users.name,
    })
      .from(clientDatasets)
      .innerJoin(users, eq(clientDatasets.uploadedByUserId, users.id))
      .where(eq(clientDatasets.organizationId, orgId))
      .orderBy(desc(clientDatasets.createdAt));
    res.json(rows);
  });

  app.get("/api/client/datasets/:id", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    const id = Number(req.params.id);
    const db = getDb();
    const [row] = await db.select().from(clientDatasets).where(eq(clientDatasets.id, id)).limit(1);
    if (!row || !belongsToOrganization(row.organizationId, orgId)) return res.status(404).json({ error: "Not found." });
    res.json(row);
  });

  app.post("/api/client/datasets", requireFullClient, requireRole("client_admin"), requireLocalByodIngestion, datasetUpload.single("file"), async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization on this account." });
    if (!req.file) return res.status(400).json({ error: "No file uploaded. Attach a file under the 'file' field." });

    const safeFileName = safeUploadFileName(req.file.originalname);
    const ext = extOf(safeFileName);
    if (!supportedExtensions().includes(ext)) {
      return res.status(400).json({ error: `Unsupported file type ".${ext}". Supported: ${supportedExtensions().join(", ")}` });
    }
    const signatureError = validateUploadFileSignature(req.file.buffer, ext);
    if (signatureError) return res.status(400).json({ error: signatureError });

    let profile;
    try {
      ({ profile } = ingestAndProfile(req.file.buffer, safeFileName));
    } catch (err: any) {
      return res.status(400).json({ error: err?.message || "Failed to parse file." });
    }

    const totalRows = profile.sheets.reduce(
      (sum: number, s: any) => sum + (s.tabular?.rowCount ?? s.layout?.rowCount ?? 0), 0,
    );

    const db = getDb();
    const [dataset] = await db.insert(clientDatasets).values({
      organizationId: orgId,
      uploadedByUserId: req.user!.id,
      fileName: profile.fileName,
      fileExt: profile.fileExt,
      sheetCount: profile.sheetNames.length,
      totalRows,
      profile,
    }).returning();

    logClientAuditEvent({ organizationId: orgId, userId: req.user!.id, eventType: "dataset_uploaded", details: { datasetId: dataset.id, fileName: dataset.fileName } });
    res.json(dataset);
  });

  app.delete("/api/client/datasets/:id", requireFullClient, requireRole("client_admin"), async (req, res) => {
    const orgId = req.user!.organizationId;
    const id = Number(req.params.id);
    const db = getDb();
    const [existing] = await db.select().from(clientDatasets).where(eq(clientDatasets.id, id)).limit(1);
    if (!existing || !belongsToOrganization(existing.organizationId, orgId)) return res.status(404).json({ error: "Not found." });
    await db.delete(clientDatasets).where(eq(clientDatasets.id, id));
    logClientAuditEvent({ organizationId: orgId!, userId: req.user!.id, eventType: "dataset_deleted", details: { fileName: existing.fileName } });
    res.json({ ok: true });
  });

  // ─── Consulting Requests (Client Portal Workflow) ──────────────────────────
  app.get("/api/client/consulting/requests", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);

    const db = getDb();
    const rows = await db.select({
      id: consultingRequests.id,
      title: consultingRequests.title,
      description: consultingRequests.description,
      packType: consultingRequests.packType,
      slaHours: consultingRequests.slaHours,
      slaDeadline: consultingRequests.slaDeadline,
      status: consultingRequests.status,
      createdAt: consultingRequests.createdAt,
      domainId: consultingRequests.domainId,
      domainName: domains.name,
      domainSlug: domains.slug,
      assignedAdminName: users.name,
    })
    .from(consultingRequests)
    .innerJoin(domains, eq(consultingRequests.domainId, domains.id))
    .leftJoin(users, eq(consultingRequests.assignedAdminId, users.id))
    .where(eq(consultingRequests.organizationId, orgId))
    .orderBy(desc(consultingRequests.createdAt));

    res.json(rows);
  });

  app.post("/api/client/consulting/requests", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization attached to account." });

    const parsed = insertConsultingRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { engagementId, domainId, title, description, packType, attachedFiles } = parsed.data;

    // No pricing tier, no auto-computed SLA -- a consultant scopes and
    // quotes this request (see consultingQuotes); slaHours/slaDeadline get
    // set once the client accepts a quote.
    const db = getDb();
    const [request] = await db.insert(consultingRequests).values({
      organizationId: orgId,
      engagementId,
      domainId,
      submittedByUserId: req.user!.id,
      title,
      description,
      packType,
      status: "pending",
      attachedFiles: attachedFiles || [],
    }).returning();

    res.json(request);
  });

  app.get("/api/client/consulting/requests/:id", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (orgId === null) return res.status(403).json({ error: "No organization associated." });
    const id = Number(req.params.id);
    const db = getDb();

    const [request] = await db.select()
      .from(consultingRequests)
      .where(and(eq(consultingRequests.id, id), eq(consultingRequests.organizationId, orgId)))
      .limit(1);

    if (!request) return res.status(404).json({ error: "Request not found." });

    const approvals = await db.select().from(consultingApprovals).where(eq(consultingApprovals.requestId, id));
    const comments = await db.select({
      id: consultingComments.id,
      message: consultingComments.message,
      createdAt: consultingComments.createdAt,
      authorName: users.name,
      authorRole: users.role,
    })
    .from(consultingComments)
    .innerJoin(users, eq(consultingComments.authorUserId, users.id))
    .where(and(eq(consultingComments.requestId, id), eq(consultingComments.isInternalNote, false)))
    .orderBy(desc(consultingComments.createdAt));
    const quotes = await db.select().from(consultingQuotes).where(eq(consultingQuotes.requestId, id)).orderBy(desc(consultingQuotes.createdAt));

    res.json({ ...request, approvals, comments, quotes });
  });

  app.post("/api/client/consulting/requests/:id/quotes/:quoteId/accept", requireFullClient, requireRole("client_admin"), async (req, res) => {
    const orgId = req.user!.organizationId;
    if (orgId === null) return res.status(403).json({ error: "No organization associated." });
    const id = Number(req.params.id);
    const quoteId = Number(req.params.quoteId);
    const db = getDb();

    const [request] = await db.select()
      .from(consultingRequests)
      .where(and(eq(consultingRequests.id, id), eq(consultingRequests.organizationId, orgId)))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request not found." });

    const [quote] = await db.select().from(consultingQuotes)
      .where(and(eq(consultingQuotes.id, quoteId), eq(consultingQuotes.requestId, id), eq(consultingQuotes.status, "proposed")))
      .limit(1);
    if (!quote) return res.status(404).json({ error: "No pending quote found at that id." });

    // SLA is only known once a timeline is actually agreed -- a quote with
    // no proposedTimelineDays (fully custom-scoped work) leaves slaHours/
    // slaDeadline null rather than fabricating a number.
    const slaHours = quote.proposedTimelineDays !== null ? quote.proposedTimelineDays * 24 : null;
    const updatedQuote = await db.transaction(async (tx) => {
      const [updated] = await tx.update(consultingQuotes)
        .set({ status: "accepted", respondedAt: new Date(), respondedByUserId: req.user!.id })
        .where(eq(consultingQuotes.id, quoteId))
        .returning();

      await tx.update(consultingRequests)
        .set({
          status: "accepted",
          slaHours,
          slaDeadline: slaHours !== null ? new Date(Date.now() + slaHours * 3600000) : null,
          updatedAt: new Date(),
        })
        .where(eq(consultingRequests.id, id));

      return updated;
    });

    logClientAuditEvent({ organizationId: orgId, userId: req.user!.id, eventType: "quote_accepted", details: { requestId: id, quoteId, amount: quote.amount } });
    res.json(updatedQuote);
  });

  app.post("/api/client/consulting/requests/:id/quotes/:quoteId/decline", requireFullClient, requireRole("client_admin"), async (req, res) => {
    const orgId = req.user!.organizationId;
    if (orgId === null) return res.status(403).json({ error: "No organization associated." });
    const id = Number(req.params.id);
    const quoteId = Number(req.params.quoteId);
    const db = getDb();

    const [request] = await db.select()
      .from(consultingRequests)
      .where(and(eq(consultingRequests.id, id), eq(consultingRequests.organizationId, orgId)))
      .limit(1);
    if (!request) return res.status(404).json({ error: "Request not found." });

    const [quote] = await db.select().from(consultingQuotes)
      .where(and(eq(consultingQuotes.id, quoteId), eq(consultingQuotes.requestId, id), eq(consultingQuotes.status, "proposed")))
      .limit(1);
    if (!quote) return res.status(404).json({ error: "No pending quote found at that id." });

    const updatedQuote = await db.transaction(async (tx) => {
      const [updated] = await tx.update(consultingQuotes)
        .set({ status: "declined", respondedAt: new Date(), respondedByUserId: req.user!.id })
        .where(eq(consultingQuotes.id, quoteId))
        .returning();

      // Back into the workable queue -- "assigned" if a consultant already
      // has it (so they see it needs a re-quote), "pending" if no one does yet.
      await tx.update(consultingRequests)
        .set({ status: request.assignedAdminId ? "assigned" : "pending", updatedAt: new Date() })
        .where(eq(consultingRequests.id, id));

      return updated;
    });

    logClientAuditEvent({ organizationId: orgId, userId: req.user!.id, eventType: "quote_declined", details: { requestId: id, quoteId } });
    res.json(updatedQuote);
  });

  app.post("/api/client/consulting/requests/:id/comments", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (orgId === null) return res.status(403).json({ error: "No organization associated." });
    const id = Number(req.params.id);
    const { message } = req.body;

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }

    const db = getDb();
    const [request] = await db.select()
      .from(consultingRequests)
      .where(and(eq(consultingRequests.id, id), eq(consultingRequests.organizationId, orgId)))
      .limit(1);

    if (!request) return res.status(404).json({ error: "Request not found." });

    const [comment] = await db.insert(consultingComments).values({
      requestId: id,
      authorUserId: req.user!.id,
      message: message.trim(),
      isInternalNote: false,
    }).returning();

    res.json(comment);
  });

  // ─── Engagements & Workstreams (Wave 2: core collaboration loop) ───────────
  app.get("/api/client/engagements", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);

    const db = getDb();
    const rows = await db.select({
      id: engagements.id,
      title: engagements.title,
      engagementModel: engagements.engagementModel,
      status: engagements.status,
      startDate: engagements.startDate,
      endDate: engagements.endDate,
      domainId: engagements.domainId,
      domainName: domains.name,
    })
    .from(engagements)
    .innerJoin(domains, eq(engagements.domainId, domains.id))
    .where(eq(engagements.organizationId, orgId))
    .orderBy(desc(engagements.createdAt));

    if (!rows.length) return res.json([]);

    // Batched, not N+1: one query each for workstreams and requests across
    // every engagement this org has, grouped in JS below. Small row counts
    // in practice (a handful of engagements per org), but no reason to do
    // it the slow way.
    const engagementIds = rows.map((r) => r.id);
    const [allWorkstreams, allRequests] = await Promise.all([
      db.select({ engagementId: workstreams.engagementId, status: workstreams.status })
        .from(workstreams).where(inArray(workstreams.engagementId, engagementIds)),
      db.select({ engagementId: consultingRequests.engagementId, status: consultingRequests.status, slaDeadline: consultingRequests.slaDeadline })
        .from(consultingRequests).where(inArray(consultingRequests.engagementId, engagementIds)),
    ]);

    const now = new Date();
    // One org-level trend, not one per engagement -- clientAuditEvents isn't
    // engagement-scoped (a login or a watchlist edit isn't "about" any one
    // engagement), so the same trend applies to every engagement this org has.
    const trend = await computeActivityTrend(orgId);
    const withHealth = rows.map((r) => {
      const wsStatuses = allWorkstreams.filter((w) => w.engagementId === r.id).map((w) => w.status);
      const reqRows = allRequests.filter((req) => req.engagementId === r.id);
      const slaBreached = reqRows.some((req) =>
        (req.status === "accepted" || req.status === "in_progress") && req.slaDeadline !== null && req.slaDeadline < now
      );
      const reactiveHealth = computeEngagementHealth({
        engagementStatus: r.status,
        workstreamStatuses: wsStatuses,
        requestStatuses: reqRows.map((req) => req.status),
        slaBreached,
      });
      const health = applyTrendToHealth(reactiveHealth, trend);
      return { ...r, health, healthTrend: trend };
    });

    res.json(withHealth);
  });

  app.get("/api/client/engagements/:id/workstreams", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);
    const engagementId = Number(req.params.id);

    const db = getDb();
    const [engagement] = await db.select().from(engagements)
      .where(and(eq(engagements.id, engagementId), eq(engagements.organizationId, orgId))).limit(1);
    if (!engagement) return res.status(404).json({ error: "Engagement not found." });

    const rows = await db.select({
      id: workstreams.id,
      title: workstreams.title,
      description: workstreams.description,
      status: workstreams.status,
      sequence: workstreams.sequence,
      startDate: workstreams.startDate,
      endDate: workstreams.endDate,
      ownerAdminName: users.name,
    })
    .from(workstreams)
    .leftJoin(users, eq(workstreams.ownerAdminId, users.id))
    .where(eq(workstreams.engagementId, engagementId))
    .orderBy(workstreams.sequence);

    res.json(rows);
  });

  // Org ownership is verified by joining through engagements -- workstreams
  // themselves carry no organizationId (they're scoped via their parent
  // engagement), same normalization as consultingRequests -> domains above.
  app.get("/api/client/workstreams/:id", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization associated." });
    const id = Number(req.params.id);

    const db = getDb();
    const [row] = await db.select({
      id: workstreams.id,
      engagementId: workstreams.engagementId,
      title: workstreams.title,
      description: workstreams.description,
      status: workstreams.status,
      sequence: workstreams.sequence,
      startDate: workstreams.startDate,
      endDate: workstreams.endDate,
      engagementTitle: engagements.title,
      organizationId: engagements.organizationId,
    })
    .from(workstreams)
    .innerJoin(engagements, eq(workstreams.engagementId, engagements.id))
    .where(eq(workstreams.id, id))
    .limit(1);

    if (!row || row.organizationId !== orgId) return res.status(404).json({ error: "Workstream not found." });

    const [workstreamDeliverables, workstreamMeetings, comments] = await Promise.all([
      db.select().from(deliverables).where(eq(deliverables.workstreamId, id)).orderBy(desc(deliverables.createdAt)),
      db.select().from(meetings).where(eq(meetings.workstreamId, id)).orderBy(desc(meetings.scheduledAt)),
      db.select({
        id: workstreamComments.id,
        message: workstreamComments.message,
        createdAt: workstreamComments.createdAt,
        authorName: users.name,
      })
      .from(workstreamComments)
      .innerJoin(users, eq(workstreamComments.authorUserId, users.id))
      .where(and(eq(workstreamComments.workstreamId, id), eq(workstreamComments.isInternalNote, false)))
      .orderBy(desc(workstreamComments.createdAt)),
    ]);

    const { organizationId, ...workstream } = row;
    res.json({ ...workstream, deliverables: workstreamDeliverables, meetings: workstreamMeetings, comments });
  });

  app.post("/api/client/workstreams/:id/comments", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.status(403).json({ error: "No organization associated." });
    const id = Number(req.params.id);

    const parsed = insertWorkstreamCommentSchema.safeParse({ workstreamId: id, message: req.body?.message });
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    const [owned] = await db.select({ organizationId: engagements.organizationId })
      .from(workstreams)
      .innerJoin(engagements, eq(workstreams.engagementId, engagements.id))
      .where(eq(workstreams.id, id))
      .limit(1);
    if (!owned || owned.organizationId !== orgId) return res.status(404).json({ error: "Workstream not found." });

    const [comment] = await db.insert(workstreamComments).values({
      workstreamId: id,
      authorUserId: req.user!.id,
      message: parsed.data.message,
      isInternalNote: false,
    }).returning();

    res.json(comment);
  });

  // ─── Activity Timeline (Wave 5) ─────────────────────────────────────────
  // A unified, reverse-chronological feed of engagement-relevant events.
  // Deliberately assembled at read time from tables that already exist
  // (quotes, deliverables, meetings) rather than a new
  // write-time event log -- that would mean touching every mutation route
  // in this file (and adminRoutes.ts) to also write a log row, for a
  // feature that's read far less often than the data it summarizes changes.
  interface ActivityEvent {
    id: string;
    type: string;
    title: string;
    detail: string | null;
    timestamp: string;
  }

  app.get("/api/client/dashboard/activity", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);
    const db = getDb();

    const [quoteRows, deliverableRows, meetingRows] = await Promise.all([
      db.select({
        id: consultingQuotes.id,
        status: consultingQuotes.status,
        amount: consultingQuotes.amount,
        currency: consultingQuotes.currency,
        createdAt: consultingQuotes.createdAt,
        respondedAt: consultingQuotes.respondedAt,
        requestTitle: consultingRequests.title,
      })
      .from(consultingQuotes)
      .innerJoin(consultingRequests, eq(consultingQuotes.requestId, consultingRequests.id))
      .where(eq(consultingRequests.organizationId, orgId))
      .orderBy(desc(consultingQuotes.createdAt))
      .limit(25),

      db.select({
        id: deliverables.id,
        title: deliverables.title,
        status: deliverables.status,
        createdAt: deliverables.createdAt,
        deliveredAt: deliverables.deliveredAt,
        workstreamTitle: workstreams.title,
      })
      .from(deliverables)
      .innerJoin(workstreams, eq(deliverables.workstreamId, workstreams.id))
      .innerJoin(engagements, eq(workstreams.engagementId, engagements.id))
      .where(eq(engagements.organizationId, orgId))
      .orderBy(desc(deliverables.createdAt))
      .limit(25),

      db.select({
        id: meetings.id,
        title: meetings.title,
        status: meetings.status,
        scheduledAt: meetings.scheduledAt,
      })
      .from(meetings)
      .innerJoin(engagements, eq(meetings.engagementId, engagements.id))
      .where(eq(engagements.organizationId, orgId))
      .orderBy(desc(meetings.scheduledAt))
      .limit(25),
    ]);

    const events: ActivityEvent[] = [];

    for (const q of quoteRows) {
      const amountLabel = q.amount !== null ? `${q.currency} ${q.amount.toLocaleString()}` : "no separate charge";
      if (q.status === "accepted" || q.status === "declined") {
        events.push({
          id: `quote-${q.id}-${q.status}`,
          type: `quote_${q.status}`,
          title: `Quote ${q.status} for "${q.requestTitle}"`,
          detail: q.status === "accepted" ? amountLabel : null,
          timestamp: (q.respondedAt ?? q.createdAt).toISOString(),
        });
      } else {
        events.push({
          id: `quote-${q.id}-proposed`,
          type: "quote_proposed",
          title: `New quote proposed for "${q.requestTitle}"`,
          detail: amountLabel,
          timestamp: q.createdAt.toISOString(),
        });
      }
    }

    for (const d of deliverableRows) {
      if (d.deliveredAt) {
        events.push({
          id: `deliverable-${d.id}-delivered`,
          type: "deliverable_delivered",
          title: `Deliverable "${d.title}" delivered`,
          detail: d.workstreamTitle,
          timestamp: d.deliveredAt.toISOString(),
        });
      } else {
        events.push({
          id: `deliverable-${d.id}-created`,
          type: "deliverable_created",
          title: `Deliverable "${d.title}" started`,
          detail: d.workstreamTitle,
          timestamp: d.createdAt.toISOString(),
        });
      }
    }

    for (const m of meetingRows) {
      events.push({
        id: `meeting-${m.id}`,
        type: `meeting_${m.status}`,
        title: `Meeting "${m.title}" ${m.status === "scheduled" ? "scheduled" : m.status}`,
        detail: null,
        timestamp: m.scheduledAt.toISOString(),
      });
    }

    events.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    res.json(events.slice(0, 40));
  });

  // ─── Audit Trail (Wave 5) ───────────────────────────────────────────────
  // Distinct from the Activity Timeline above: this is "who on my team did
  // what" (accountability), not "what happened with my engagement"
  // (business narrative) -- restricted to client_admin, same as every other
  // account-level view (wallet grants, watchlist/alert management).
  app.get("/api/client/dashboard/audit-log", requireFullClient, requireRole("client_admin"), async (req, res) => {
    const orgId = req.user!.organizationId;
    if (!orgId) return res.json([]);
    const db = getDb();

    const rows = await db.select({
      id: clientAuditEvents.id,
      eventType: clientAuditEvents.eventType,
      details: clientAuditEvents.details,
      createdAt: clientAuditEvents.createdAt,
      userName: users.name,
      userEmail: users.email,
    })
    .from(clientAuditEvents)
    .leftJoin(users, eq(clientAuditEvents.userId, users.id))
    .where(eq(clientAuditEvents.organizationId, orgId))
    .orderBy(desc(clientAuditEvents.createdAt))
    .limit(100);

    res.json(rows);
  });

  // ─── Global Search (Wave 5) ─────────────────────────────────────────────
  // Title search across everything an org can navigate to from the portal.
  // Every branch is independently org-scoped (never a single WHERE clause
  // trusted to cover all five) -- published content additionally reuses the
  // exact visibility + domain-subscription rules from the content route
  // above, since search must never surface something the normal browse view
  // would have hidden.
  app.get("/api/client/dashboard/search", requireFullClient, async (req, res) => {
    const orgId = req.user!.organizationId;
    const q = String(req.query.q ?? "").trim();
    if (!orgId || q.length < 2) return res.json([]);
    const db = getDb();
    const pattern = `%${q}%`;

    const [subscribedDomains, links] = await Promise.all([
      db.select({ domainId: organizationDomains.domainId }).from(organizationDomains).where(eq(organizationDomains.organizationId, orgId)),
      db.select({ contentId: contentOrganizationLinks.contentId }).from(contentOrganizationLinks).where(eq(contentOrganizationLinks.organizationId, orgId)),
    ]);
    const subscribedDomainIds = subscribedDomains.map((d) => d.domainId);
    const linkedContentIds = links.map((l) => l.contentId);

    const [engagementRows, workstreamRows, deliverableRows, requestRows, contentRows] = await Promise.all([
      db.select({ id: engagements.id, title: engagements.title })
        .from(engagements)
        .where(and(eq(engagements.organizationId, orgId), ilike(engagements.title, pattern)))
        .limit(5),

      db.select({ id: workstreams.id, title: workstreams.title, engagementId: workstreams.engagementId })
        .from(workstreams)
        .innerJoin(engagements, eq(workstreams.engagementId, engagements.id))
        .where(and(eq(engagements.organizationId, orgId), ilike(workstreams.title, pattern)))
        .limit(5),

      db.select({ id: deliverables.id, title: deliverables.title, workstreamId: deliverables.workstreamId, engagementId: workstreams.engagementId })
        .from(deliverables)
        .innerJoin(workstreams, eq(deliverables.workstreamId, workstreams.id))
        .innerJoin(engagements, eq(workstreams.engagementId, engagements.id))
        .where(and(eq(engagements.organizationId, orgId), ilike(deliverables.title, pattern)))
        .limit(5),

      db.select({ id: consultingRequests.id, title: consultingRequests.title })
        .from(consultingRequests)
        .where(and(eq(consultingRequests.organizationId, orgId), ilike(consultingRequests.title, pattern)))
        .limit(5),

      subscribedDomainIds.length === 0 ? Promise.resolve([]) : db.select({ id: publishedContent.id, title: publishedContent.title, contentType: publishedContent.contentType })
        .from(publishedContent)
        .where(and(
          eq(publishedContent.status, "published"),
          inArray(publishedContent.domainId, subscribedDomainIds),
          linkedContentIds.length
            ? or(eq(publishedContent.visibility, "all_clients"), inArray(publishedContent.id, linkedContentIds))
            : eq(publishedContent.visibility, "all_clients"),
          ilike(publishedContent.title, pattern),
        ))
        .limit(5),
    ]);

    res.json({
      engagements: engagementRows,
      workstreams: workstreamRows,
      deliverables: deliverableRows,
      consultingRequests: requestRows,
      content: contentRows,
    });
  });
}
