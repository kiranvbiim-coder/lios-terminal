import assert from "node:assert/strict";
import type { Request, Response } from "express";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-p6-license-access-"));
process.env.LIOS_DATA_ROOT = path.join(root, "home");
process.env.HOME = path.join(root, "user");
process.env.LIOS_LICENSE_CACHE_DIR = path.join(root, "license-cache");
process.env.LIOS_DESKTOP_PACKAGED = "true";
fs.mkdirSync(process.env.HOME, { recursive: true });
delete process.env.DATABASE_URL;
delete process.env.HOST;
delete process.env.LIOS_DESKTOP_DEVICE_ID;

// Isolate the real installation database/cache before loading the production routes.
const { default: express } = await import("express");
const { default: session } = await import("express-session");
const { default: passport } = await import("passport");
const { eq } = await import("drizzle-orm");
const { organizationLicenses } = await import("@shared/schema");
const { p6PersonalFinanceRequestSchema } = await import("@shared/p6FinanceContracts");
const { closeDb, getDb, initDb } = await import("./db");
const { configurePassport, registerAuthRoutes } = await import("./auth");
const { registerLicenseRoutes } = await import("./licenseRoutes");
const { ensureInstallationTrialRecord } = await import("./accessMode");
const { createP6FinanceRouteHandlers, registerP6FinanceRoutes, runP6MarketBacktest, runP6PersonalFinance } = await import("./p6FinanceRoutes");

const app = express();
app.use(express.json());
app.use(session({ secret: "p6-license-access-test", resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());
configurePassport();
registerAuthRoutes(app);
registerLicenseRoutes(app);
registerP6FinanceRoutes(app);
const server = app.listen(0, "127.0.0.1");
const base = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
let cookie = "";

async function call(url: string, body?: unknown) {
  const response = await fetch(`${base()}${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base(), ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0] as string;
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

const personalFinance = p6PersonalFinanceRequestSchema.parse({
  schemaVersion: "1", asOf: "2026-09-22",
  accounts: [
    { id: "bank", kind: "bank", balance: 200000, currency: "USD" },
    { id: "loan", kind: "loan", balance: -50000, currency: "USD" },
  ],
  transactions: [], debts: [], goals: [],
});
const backtest = {
  symbol: "TEST", range: "5Y" as const,
  strategy: { schemaVersion: "1" as const, id: "bh", name: "Buy and Hold", kind: "buy_and_hold" as const, parameters: {}, sourceLanguage: "rules" as const, source: "" },
  assumptions: { startingCapital: 100000, feesBps: 5, slippageBps: 5, riskFreeRateAnnual: 0, maxParticipationRate: 0.05, seed: 42 },
};

async function handlerResponse(handler: (req: Request, res: Response) => Promise<void>, body: unknown) {
  let status = 200;
  let result: Record<string, unknown> = {};
  await handler({ body } as never, {
    status(code: number) { status = code; return this; },
    json(value: Record<string, unknown>) { result = value; return this; },
  } as never);
  return { status, body: result };
}

test.before(async () => { await initDb(); });
test.after(async () => {
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
  await closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});

test("production P6 POSTs retain auth, compute during a real trial, and refuse before calculation/market access after expiry", async () => {
  for (const endpoint of ["/api/finance/p6-personal-finance", "/api/finance/p6-backtest"]) {
    assert.equal((await call(endpoint, {})).status, 401, endpoint);
  }
  assert.equal((await call("/api/auth/bootstrap/complete", {
    email: "p6-owner@example.test", name: "P6 Owner", password: "Zx9!kQ4#vLm2$Rt8",
  })).status, 201);
  assert.equal((await call("/api/license/trial/start")).status, 200);

  const active = await call("/api/finance/p6-personal-finance", personalFinance);
  assert.equal(active.status, 200);
  assert.equal(active.body.engineId, "lios.personal-finance.core-v1");
  assert.equal(active.body.netWorth, 150000);
  assert.equal(active.body.assets, 200000);
  assert.equal(active.body.liabilities, 50000);

  const { organizationId } = await ensureInstallationTrialRecord();
  await getDb().update(organizationLicenses).set({
    trialEndsAt: new Date(Date.now() - 86_400_000), updatedAt: new Date(),
  }).where(eq(organizationLicenses.organizationId, organizationId));

  for (const [endpoint, input] of [
    ["/api/finance/p6-personal-finance", personalFinance],
    ["/api/finance/p6-backtest", backtest],
  ] as const) {
    const refused = await call(endpoint, input);
    assert.equal(refused.status, 402, endpoint);
    assert.equal(refused.body.code, "license_read_only", endpoint);
    assert.equal(refused.body.reason, "trial_expired", endpoint);
    assert.equal(refused.body.capability, "analysis", endpoint);
  }

  // Supplement the production HTTP proof with tripwires at the two execution seams;
  // the decision still comes from the same real expired installation, not a mocked guard.
  let personalCalculations = 0;
  let marketDataReads = 0;
  const handlers = createP6FinanceRouteHandlers(
    (input) => runP6MarketBacktest(input, async () => {
      marketDataReads += 1;
      throw new Error("Expired installation reached market data.");
    }),
    (input) => { personalCalculations += 1; return runP6PersonalFinance(input); },
  );
  assert.equal((await handlerResponse(handlers.runPersonalFinance, personalFinance)).status, 402);
  assert.equal((await handlerResponse(handlers.runBacktest, backtest)).status, 402);
  assert.equal(personalCalculations, 0);
  assert.equal(marketDataReads, 0);

  // Pure numerical runners intentionally remain reusable without installation admission.
  assert.equal((await runP6PersonalFinance(personalFinance)).netWorth, 150000);
});
