import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  SI01_OFFLINE_DEPENDENCY_INVENTORY,
  assertDesktopLocalZeroVendorRuntime,
  assertOfflineBaselineInventory,
  offlineDeterministicFinanceFamilies,
} from "./si01OfflineBaseline";
import {
  EgressBlockedError,
  createGuardedFetch,
  parseEgressPolicy,
} from "./egressPolicy";
import { fetchWithRetry } from "./providerUtils";
import { runP6PersonalFinance } from "./p6FinanceRoutes";
import { resolveSessionRestoration } from "./sessionRestoration";
import { getQuotes } from "./marketData";
import { runWithRequestIdentity } from "./requestContext";

test("SI-01.15 dependency inventory is unique, owned and explicit", () => {
  assert.doesNotThrow(() => assertOfflineBaselineInventory());
  const ids = SI01_OFFLINE_DEPENDENCY_INVENTORY.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(SI01_OFFLINE_DEPENDENCY_INVENTORY.some(
    (item) => item.id === "external.market-data" && item.state === "provider-dependent",
  ));
  assert.ok(SI01_OFFLINE_DEPENDENCY_INVENTORY.some(
    (item) => item.id === "finance.personal" && item.state === "deterministic-local",
  ));
});

test("offline inventory source owners remain real repository paths", () => {
  for (const item of SI01_OFFLINE_DEPENDENCY_INVENTORY) {
    for (const sourcePath of item.sourcePaths) {
      assert.equal(
        fs.existsSync(path.resolve(process.cwd(), sourcePath)),
        true,
        `${item.id} references missing owner path ${sourcePath}`,
      );
    }
  }
});

test("Desktop Local zero-vendor-runtime profile remains conformant in offline mode", () => {
  assert.doesNotThrow(() => assertDesktopLocalZeroVendorRuntime());
});

test("provider utility surfaces explicit offline denial before native transport", async () => {
  const originalFetch = globalThis.fetch;
  const nativeCalls: string[] = [];
  const native = (async (input: Parameters<typeof fetch>[0]) => {
    nativeCalls.push(String(input));
    return new Response("unexpected", { status: 200 });
  }) as typeof fetch;
  globalThis.fetch = createGuardedFetch(native, parseEgressPolicy({ LIOS_EGRESS_MODE: "offline" }));
  try {
    await assert.rejects(
      () => fetchWithRetry("https://provider.example.invalid/data", {}, 1),
      (error: unknown) => {
        assert.ok(error instanceof EgressBlockedError);
        assert.equal(error.reason, "offline");
        return true;
      },
    );
    assert.deepEqual(nativeCalls, [], "offline provider request must not reach transport");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authenticated offline scope with no selected market connectors returns missing data, not a fabricated quote", async () => {
  const quotes = await runWithRequestIdentity(
    {
      userId: 101,
      organizationId: null,
      selectedConnectorIds: [],
      providerStackOrder: [],
      credentials: {},
      communityYahooConsent: false,
      publicFillerConsent: false,
    },
    () => getQuotes(["AAPL"]),
  );
  assert.deepEqual(quotes, []);
});

test("deterministic personal finance remains functional with provider egress absent", () => {
  const result = runP6PersonalFinance({
    schemaVersion: "1",
    asOf: "2026-10-04",
    accounts: [
      { id: "cash", kind: "bank", balance: 100_000, currency: "INR" },
      { id: "loan", kind: "loan", balance: 20_000, currency: "INR" },
    ],
    transactions: [
      { id: "salary", at: "2026-09-20", amount: 50_000, category: "salary", accountId: "cash" },
      { id: "expense", at: "2026-09-25", amount: -10_000, category: "living", accountId: "cash" },
    ],
    debts: [],
    goals: [],
    retirement: null,
  });
  assert.equal(result.deterministic, true);
  assert.equal(result.engineId, "lios.personal-finance.core-v1");
  assert.equal(result.netWorth, 80_000);
  assert.equal(result.trailingMonthlyCashFlow, 40_000);
  assert.match(result.inputHash, /^[a-f0-9]{64}$/);
});

test("offline session restoration is explicit and does not pretend online connectivity", () => {
  const restored = resolveSessionRestoration({
    authenticated: true,
    offline: true,
    now: new Date("2026-10-04T00:00:00.000Z"),
    user: {
      id: 11,
      email: "offline@example.test",
      name: "Offline User",
      role: "client_user",
      organizationId: 5,
    },
  });
  assert.equal(restored.state, "authenticated_offline");
  assert.equal(restored.reason, "offline_lease_authorized");
  assert.equal(restored.restoredAt, "2026-10-04T00:00:00.000Z");
});

test("deterministic workflow registry remains available independently of remote providers", () => {
  const families = offlineDeterministicFinanceFamilies();
  assert.ok(families.includes("personal_finance"));
  assert.ok(families.includes("capital_allocation"));
  assert.ok(families.includes("valuation"));
});
