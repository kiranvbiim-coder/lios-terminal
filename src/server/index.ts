// Must stay the first import: the desktop hands over its local trust token and vault secret on stdin before any module opens the vault.
import "./desktopHandoff";
import dotenv from "dotenv";
import path from "path";
import { parse as parseUrl } from "url";
// Unlike static.ts (which only ever runs against the bundled dist/index.cjs),
// these dotenv lines run at the very top of this file regardless of
// dev/production -- and `npm run dev` runs this file unbundled via tsx,
// where it executes as real ESM (__dirname doesn't exist there). Bundled
// CJS (esbuild --format=cjs, the packaged app) has native __dirname but
// rewrites `import.meta` to `{}`, so import.meta.url isn't usable there
// either. Prefer whichever one actually exists in the current context
// rather than assuming a single module system for this file.
const dirname = typeof __dirname !== "undefined" ? __dirname : path.dirname(process.argv[1] || process.cwd());
dotenv.config({ path: path.resolve(dirname, ".env") });
dotenv.config({ path: path.resolve(dirname, "../.env") });
dotenv.config();
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import passport from "passport";
import { DrizzleSessionStore } from "./sessionStore";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer, ServerResponse } from "http";
import type { Socket } from "net";
import { listenWithFallback } from "./listenConfig";
import { createAlertMonitor, runAlertEvaluationCycle } from "./alertMonitor";
import { runDecisionMonitoringCycle } from "./decisionMonitor";
import { runDataSpineIngestionCycle } from "./dataSpineIngestionMonitor";
import { emitP9AutomationEvent, startP9AutomationRuntime } from "./p9AutomationService";
import { storage } from "./storage";
import { getQuotes, getNews, getEconomicsSnapshot, getForexQuotes, getFundamentals } from "./marketData";
import { WebSocketServer } from "ws";
import { initLiveStream } from "./liveStream";
import { closeDb, initDb } from "./db";
import { DATA_ROOT_EXIT_CODE, DataRootUnavailableError, prepareDataRoot, stateDir } from "./dataRoot";
import { migrateLegacyConfigCredentials, migrateVaultToCurrentKey } from "./credentialVault";
import { hasLocalTrust, requireLocalDesktopTrust } from "./localDesktopTrust";
import { isAllowedWebSocketOrigin } from "./webSocketOrigin";
import { isLoopbackIpAddress } from "./netPolicy/ip";
import type { User } from "@shared/schema";
import { GATEWAY_DEVICE_PATH, GATEWAY_PATH } from "@shared/gatewayProtocol";
import { deviceNetwork, devicePairing } from "./deviceRuntime";
import { gatewayHub, notifyDataChanged, publishQuoteUpdate } from "./gatewayRuntime";
import { registerGatewayConversation } from "./gatewayConversation";
import { registerDeviceContinuityGateway } from "./gatewayDeviceContinuity";
import { configurePassport, ensureDeviceBindingCookie, initializeServerHomeOwner, isHomeOwner } from "./auth";
import { getSessionSecret } from "./sessionSecret";
import { installEgressGuard } from "./egressPolicy";
import { startBackupScheduler } from "./backupService";
import { ensureCommercialPlans, ensurePlatformDomains } from "./platformBootstrap";
import { startPythonService, stopPythonService } from "./pythonService";
import { getProcessSupervisor } from "./exec";
import { recoverConversationExecutions } from "./exec/execution-scope";
import { launcherPidFromEnvironment, watchLauncher } from "./parentWatch";
import { bootstrapVoiceProviders } from "./voiceProviderSetup";
import { csrfProtection, registerCsrfRoutes } from "./csrf";
import { log } from "./logger";
import { registerSecurityHeaders } from "./securityHeaders";
import { registerRateLimits } from "./rateLimit";
import { secureSessionCookieRequired, trustProxySetting } from "./runtimeSecurity";
import { runWithRequestIdentity } from "./requestContext";
import { hasActiveCommunityConsent } from "./communityDataConsent";
import { getEnvironmentSetupForUser } from "./environmentSetupService";
import { parseDataStackPins } from "@shared/dataStackPins";
import { loadOrganizationCredentials } from "./organizationCredentialVault";
import fs from "fs";
import crypto from "crypto";
import { uploadErrorResponse } from "./uploadPolicy";
import {
  diagnosticFingerprint,
  purgeExpiredProductionMetadata,
  recordDiagnosticEvent,
} from "./productionControlPlane";

let wss: WebSocketServer | null = null;

async function generatePreMarketBrief() {
  try {
    log("Starting automatic pre-market brief generation...");
    const [news, economics, forex] = await Promise.all([
      getNews().catch(() => []),
      getEconomicsSnapshot().catch(() => null),
      getForexQuotes().catch(() => []),
    ]);
    const brief = {
      generatedAt: new Date().toISOString(),
      summary: "Limuria AI Automated Pre-Market Insight Briefing",
      macroStatus: economics,
      movers: news.slice(0, 5).map(n => ({ title: n.title, source: n.source, url: n.url })),
      // ForexQuote uses pair/rate, not symbol/price -- map explicitly rather
      // than relying on field-name coincidence (there wasn't one: this used
      // to render "undefined: N/A" for every row).
      forexRate: forex.slice(0, 4).map((fx) => ({ symbol: fx.pair, price: fx.rate, change: fx.change, changePercent: fx.changePercent })),
    };
    const dataDir = stateDir();
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "premarket-brief.json"), JSON.stringify(brief, null, 2), "utf8");
    log("Pre-market brief generated successfully.");
  } catch (err) {
    console.error("Failed to generate pre-market brief:", err);
  }
}

const app = express();
// Desktop only: requests from anything but the app's own window lack the per-launch token (GM-03 / Q5).
app.use(requireLocalDesktopTrust);
app.disable("x-powered-by");
registerSecurityHeaders(app);

// PaaS platforms poll this to know the process is alive and ready to receive traffic.
app.get("/health", (_req, res) => res.json({ ok: true }));

const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage { rawBody: unknown; }
}

app.use(express.json({
  limit: "5mb",
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false }));

// GM-03: refuse to run over a data root LiOS already initialized but can no longer find (unmounted drive,
// moved or deleted folder) instead of quietly creating an empty replacement. The desktop treats this exit
// code as "do not restart-loop; tell the user".
try {
  const dataRootState = prepareDataRoot();
  try {
    const migrated = migrateVaultToCurrentKey();
    if (migrated > 0) console.log(`Re-encrypted ${migrated} saved credential(s) under the current vault key.`);
    const moved = migrateLegacyConfigCredentials();
    if (moved > 0) console.log(`Moved ${moved} plaintext credential(s) from config.json into the encrypted vault (original kept as config.json.pre-gm07.bak).`);
  } catch (error) {
    // Entries stay readable and are re-encrypted individually on first use; do not block startup.
    console.error("Vault key migration did not complete:", error instanceof Error ? error.message : error);
  }
  if (dataRootState.firstRun) console.log(`Initialising a new LiOS data root at ${dataRootState.root}.`);
} catch (error) {
  if (error instanceof DataRootUnavailableError) {
    console.error(`[data-root] ${error.message}`);
    process.exit(DATA_ROOT_EXIT_CODE);
  }
  throw error;
}

// GM-07d: the Home owner's outbound-network policy applies to every server-side fetch from here on.
installEgressGuard();

app.set("trust proxy", trustProxySetting());
const sessionSecret = getSessionSecret();
const sessionMiddleware = session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new DrizzleSessionStore(),
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: "lax",
    secure: secureSessionCookieRequired(),
  },
});
app.use(sessionMiddleware);
app.use(passport.initialize());
app.use(passport.session());
app.use((req, res, next) => {
  ensureDeviceBindingCookie(req, res);
  next();
});

// Establish authenticated tenant/user identity for downstream services.
app.use(async (req, _res, next) => {
  try {
    const organizationId = req.user?.organizationId ?? null;
    const setup = req.user ? await getEnvironmentSetupForUser(req.user.id) : null;
    const communityYahooConsent = req.user
      ? await hasActiveCommunityConsent(req.user.id, "yahoo_community")
      : false;
    const publicFillerConsent = req.user
      ? await hasActiveCommunityConsent(req.user.id, "public_filler")
      : false;
    const credentials = organizationId !== null
      ? await loadOrganizationCredentials(organizationId)
      : undefined;
    runWithRequestIdentity({
      userId: req.user?.id ?? null,
      organizationId,
      credentials,
      selectedConnectorIds: setup?.selectedConnectorIds ?? [],
      providerStackOrder: setup?.providerStackOrder ?? [],
      // Drizzle's $type<T>() is a compile-time assertion only; a row
      // written before the P0.3 migration (or corrupted by hand) is
      // re-validated here rather than trusted blindly -- resolveFamilyProviderOrder
      // must never crash or silently misbehave on malformed persisted state.
      dataStackPins: parseDataStackPins(setup?.dataStackPins ?? []),
      communityYahooConsent,
      publicFillerConsent,
    }, next);
  } catch (error) {
    next(error);
  }
});
// Shared logger lives outside the bootstrap module so sidecar/service imports
// cannot execute the server's startup IIFE as a side effect.

registerCsrfRoutes(app);
app.use(csrfProtection);
registerRateLimits(app);

// Log request metadata only. Never serialize API response bodies into logs.
app.use((req, res, next) => {
  const start = Date.now();
  const requestPath = req.path;
  res.on("finish", () => {
    if (requestPath.startsWith("/api")) log(`${req.method} ${requestPath} ${res.statusCode} in ${Date.now() - start}ms`);
  });
  next();
});

(async () => {
  await initDb();
  await recoverConversationExecutions();
  await ensurePlatformDomains();
  await ensureCommercialPlans();
  // Finish first-owner setup before the server accepts requests. Never seed a default account.
  await initializeServerHomeOwner();
  configurePassport();
  void startPythonService();
  startBackupScheduler();
  bootstrapVoiceProviders();
  await registerRoutes(httpServer, app);

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const uploadError = uploadErrorResponse(err);
    const status = uploadError?.status || err.status || err.statusCode || 500;
    const requestId = req.headers["x-request-id"] || crypto.randomUUID();
    console.error("Internal Server Error", { requestId, path: req.path, method: req.method, status, errorName: err?.name ?? "Error", fingerprint: diagnosticFingerprint(err) });
    if (status >= 500 && process.env.DATABASE_URL) {
      void recordDiagnosticEvent({
        organizationId: req.user?.organizationId ?? null,
        userId: req.user?.id ?? null,
        category: "crash",
        eventName: "server_request_error",
        severity: "error",
        appVersion: process.env.LIOS_PUBLIC_VERSION ?? null,
        platform: process.platform,
        arch: process.arch,
        fingerprint: diagnosticFingerprint(err),
        details: { status, method: req.method, recoverable: true },
      }).catch(() => undefined);
    }
    if (res.headersSent) return next(err);
    const publicMessage = uploadError?.message || (status >= 500 ? "Internal server error." : (err.publicMessage || "Request could not be completed."));
    res.setHeader("X-Request-ID", String(requestId));
    return res.status(status).json({ error: publicMessage, requestId });
  });

  const requestedPort = parseInt(process.env.PORT || "5052", 10);
  const allowPortFallback = process.env.NODE_ENV !== "production" && !process.env.PORT;
  const port = await listenWithFallback(httpServer, requestedPort, { allowFallback: allowPortFallback });
  if (port !== requestedPort) {
    log(`port ${requestedPort} is occupied; selected ${port} for this development session`);
  }
  log(`serving on port ${port}`);
  if (process.env.NODE_ENV !== "production") {
    log(`open http://localhost:${port}`);
  }

    // Do not use WebSocketServer({ server }) here: that accepts every
    // handshake before Express session middleware can authenticate it. The
    // explicit upgrade path below authenticates the same session cookie used
    // by the HTTP application and rejects cross-origin browser handshakes.
    wss = new WebSocketServer({ noServer: true, maxPayload: gatewayHub.policy.maxPayload });
    httpServer.on("upgrade", (req, socket, head) => {
      const pathname = parseUrl(req.url || "").pathname;
      if (!hasLocalTrust(req)) { socket.destroy(); return; }
      if (pathname === GATEWAY_DEVICE_PATH) {
        // The primary HTTP listener may be operator-bound to a public address. Device proofs are local-only here;
        // non-local devices must use the separately opted-in TLS listener.
        if (!isLoopbackIpAddress(req.socket.remoteAddress)) { socket.destroy(); return; }
        // Paired devices carry no cookie or browser Origin; the connect handshake authenticates them by key proof.
        wss!.handleUpgrade(req, socket as unknown as Socket, head, (ws) => {
          gatewayHub.attachUnauthenticated(ws, devicePairing, req.socket.remoteAddress);
        });
        return;
      }
      if (pathname !== GATEWAY_PATH) {
        // Vite owns HMR upgrades in development. In production nothing else may answer, so an unknown path must
        // not be left hanging as an open half-handshake.
        if (process.env.NODE_ENV === "production") socket.destroy();
        return;
      }

      if (!isAllowedWebSocketOrigin(req)) {
        socket.destroy();
        return;
      }

      const response = new ServerResponse(req);
      response.assignSocket(socket as unknown as Socket);
      sessionMiddleware(req as any, response as any, () => {
        passport.initialize()(req as any, response as any, () => {
          passport.session()(req as any, response as any, () => {
            const user = (req as any).user as { id?: number; organizationId?: number | null; role?: User["role"]; email?: string } | undefined;
            if (!user?.id) {
              response.removeHeader("Set-Cookie");
              response.statusCode = 401;
              response.end();
              return;
            }

            wss!.handleUpgrade(req, socket as unknown as Socket, head, (ws) => {
              gatewayHub.attach(ws, {
                userId: user.id!,
                email: user.email ?? "",
                role: user.role!,
                organizationId: user.organizationId ?? null,
                grantedScopes: isHomeOwner(user as Pick<User, "role">) ? ["read", "write", "admin"] : ["read", "write"],
              });
            });
          });
        });
      });
    });

    registerGatewayConversation(gatewayHub);
    registerDeviceContinuityGateway(gatewayHub);
    gatewayHub.start();
    try {
      await deviceNetwork.start();
    } catch (error) {
      // Fail closed on LAN while preserving access to the local Home and its repair controls.
      console.error("Device listener did not start:", error);
    }

    // Real-time trade streaming (Finnhub) — feeds the same quote_update
    // broadcast the client already consumes; no-op without an API key.
    const stopLiveStream = initLiveStream(publishQuoteUpdate, async () => {
      return storage.getAllWatchlistSymbols();
    });

    // Watchlist quote broadcast, independent of alerts. (Previously the only
    // broadcast path was inside the alert cycle, which skips entirely when no
    // active alerts exist — so clients never received live updates.) Serves
    // cached quotes, so this costs no extra upstream calls; it's the polling
    // fallback when Finnhub streaming is off, and harmless alongside it.
    const quoteBroadcastTimer = setInterval(async () => {
      if (gatewayHub.size === 0) return;
      try {
        const symbols = await storage.getAllWatchlistSymbols();
        if (!symbols.length) return;
        const quotes = await getQuotes(symbols);
        if (quotes.length) {
          publishQuoteUpdate(quotes.map((q) => ({ symbol: q.symbol, price: q.price, change: q.change, changePercent: q.changePercent })));
        }
      } catch {
        // transient upstream failure — next tick retries
      }
    }, 15_000);

    const briefFile = path.join(stateDir(), "premarket-brief.json");
    if (!fs.existsSync(briefFile)) generatePreMarketBrief();

    // Schedule pre-market brief generator at 08:30 daily local time
    const briefTimer = setInterval(() => {
      const now = new Date();
      if (now.getHours() === 8 && now.getMinutes() === 30) generatePreMarketBrief();
    }, 60_000);

    const stopAlertMonitor = createAlertMonitor(
      async () => runAlertEvaluationCycle({
        loadAlerts: async () => {
          const alerts = await storage.getAllActiveAlerts();
          return alerts.map((alert) => ({
            id: alert.id,
            userId: alert.userId,
            symbol: alert.symbol,
            condition: alert.condition,
            price: alert.price,
            triggered: alert.triggered,
          }));
        },
        fetchQuotes: async (symbols) => {
          const quotes = await getQuotes(symbols);
          if (quotes.length > 0) {
            publishQuoteUpdate(quotes.map(q => ({ symbol: q.symbol, price: q.price, change: q.change, changePercent: q.changePercent })));
          }
          const fundamentalsEntries = await Promise.all(symbols.map(async (symbol) => [symbol, await getFundamentals(symbol)] as const));
          const fundamentalsBySymbol = new Map(fundamentalsEntries);
          return quotes.map((quote) => {
            const fundamentals = fundamentalsBySymbol.get(quote.symbol);
            return {
              symbol: quote.symbol,
              price: quote.price,
              trailingPE: fundamentals?.trailingPE ?? quote.pe ?? null,
              forwardPE: fundamentals?.forwardPE ?? null,
              priceToBook: fundamentals?.priceToBook ?? null,
              beta: fundamentals?.beta ?? null,
              debtToEquity: fundamentals?.debtToEquity ?? null,
              returnOnEquity: fundamentals?.returnOnEquity ?? null,
              dividendYield: fundamentals?.dividendYield ?? null,
            };
          });
        },
        triggerAlert: (id, details) => storage.triggerAlert(id, details),
        onTriggered: async (details) => {
          if (!details.userId) return;
          notifyDataChanged("alerts", { userId: details.userId });
          await emitP9AutomationEvent({
            eventType: "price_threshold",
            occurredAt: details.triggeredAt.toISOString(),
            projectId: null,
            ownerUserId: details.userId,
            organizationId: null,
            sourceRef: "price-alert:" + details.id,
            payload: {
              symbol: details.symbol,
              metric: details.metric,
              triggerPrice: details.triggerPrice,
            },
          });
        },
      }),
      15_000,
    );
    const stopDecisionMonitor = createAlertMonitor(
      async () => {
        await runDecisionMonitoringCycle();
        return 0;
      },
      5 * 60_000,
    );
    // Re-captures financial-statement conflict snapshots for every symbol
    // in a real portfolio/watchlist/alert -- each capture already dedups
    // via content hash, so this is cheap when nothing changed and creates
    // a genuine revision when something did. 6h: frequent enough to catch
    // same-day restatements/corrections without hammering the up-to-8
    // providers each capture fans out to per symbol.
    const stopDataSpineIngestion = createAlertMonitor(
      async () => {
        const result = await runDataSpineIngestionCycle();
        for (const item of result.changed) {
          await emitP9AutomationEvent({
            eventType: "data_refresh",
            occurredAt: new Date().toISOString(),
            projectId: null,
            ownerUserId: null,
            organizationId: null,
            sourceRef: "data-spine:" + item.snapshotId,
            payload: { symbol: item.symbol, snapshotId: item.snapshotId, conflictCount: item.conflictCount },
          });
        }
        return result.changed.length;
      },
      6 * 60 * 60_000,
    );
    const stopP9Automation = startP9AutomationRuntime();

    // Hosted control-plane retention is an executed lifecycle, not just a
    // configuration document. Customer desktops have no DATABASE_URL, so the
    // purge worker never runs against local BYOD workspaces.
    let productionRetentionTimer: NodeJS.Timeout | null = null;
    if (process.env.NODE_ENV === "production" && process.env.DATABASE_URL) {
      void purgeExpiredProductionMetadata().catch((error) => {
        console.error("Production retention purge failed:", error);
      });
      productionRetentionTimer = setInterval(() => {
        void purgeExpiredProductionMetadata().catch((error) => {
          console.error("Production retention purge failed:", error);
        });
      }, 24 * 60 * 60_000);
    }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopLiveStream();
    clearInterval(quoteBroadcastTimer);
    await gatewayHub.shutdown("Home is shutting down");
    await deviceNetwork.stop();
    stopDecisionMonitor();
    stopDataSpineIngestion();
    stopP9Automation();
    stopAlertMonitor();
    if (productionRetentionTimer) clearInterval(productionRetentionTimer);
    stopPythonService();
    await getProcessSupervisor().shutdown();
    const closed = new Promise<void>((resolve) => httpServer.close(() => resolve()));
    // Keep-alive and WebSocket connections would otherwise hold close() open forever, so the process never
    // exited on SIGTERM and the database was never released.
    httpServer.closeAllConnections();
    await closed;
    await closeDb();
  };
  const shutdownAndExit = () => { void shutdown().finally(() => process.exit(0)); };
  process.once("SIGINT", shutdownAndExit);
  process.once("SIGTERM", shutdownAndExit);
  const launcherPid = launcherPidFromEnvironment(process.env);
  if (launcherPid !== null) {
    watchLauncher(launcherPid, () => {
      console.error(`Launcher process ${launcherPid} is gone; shutting down so no orphaned server keeps the port and database.`);
      shutdownAndExit();
    });
  }
})();
