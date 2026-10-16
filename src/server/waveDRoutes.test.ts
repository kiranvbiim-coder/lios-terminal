import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express, { type Request } from "express";
import type { Quote } from "./marketData";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-proactive-controls-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { registerWaveDRoutes } = await import("./waveDRoutes");
const { updateWaveDState } = await import("./waveDStateStore");

test("proactive attention follows the owner's durable resolve, snooze and reopen decisions", { timeout: 120_000 }, async (t) => {
  await initDb();
  const [owner, other] = await getDb().insert(users).values(["owner", "other"].map(name => ({ name, email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", role: name === "owner" ? "internal_admin" as const : "internal_compliance" as const, organizationId: null }))).returning();
  let quoteSnapshots: Quote[] = [];
  const app = express();
  app.use(express.json());
  // Route-business harness: authentication itself is covered by the canonical auth suites.
  app.use((req, _res, next) => { req.user = req.header("x-test-user") === "other" ? other : owner; req.isAuthenticated = (() => true) as Request["isAuthenticated"]; next(); });
  registerWaveDRoutes(app, { quotes: async () => quoteSnapshots, news: async () => [] });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (url: string, method = "GET", body?: unknown, user = "owner") => {
    const response = await fetch(base + url, { method, headers: { "Content-Type": "application/json", "x-test-user": user }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.ok(response.ok, `${method} ${url}: ${response.status} ${await response.clone().text()}`);
    return response.json();
  };
  const created = await call("/api/wave-d/pulse/cards", "POST", { kind: "research", title: "Review changed thesis evidence", whatHappened: "An explicitly authored evidence condition changed.", whyItMatters: "Review the evidence before changing a decision.", whyItMattersToUser: "This is an owner-authored review request, not an execution instruction.", nextActions: ["analyse", "monitor"], thesisRelevance: 1, unread: true, evidence: [{ id: "fixture:source", source: "Isolated route fixture" }] });
  const cardId = created.card.id;
  const inboxId = `inbox:${cardId}`;
  const update = (status: string) => call(`/api/wave-d/action-inbox/${encodeURIComponent(inboxId)}`, "POST", { status });

  await t.test("resolved attention remains inspectable but is not presented as a new unread prompt", async () => {
    const before = await call("/api/wave-d/pulse");
    assert.equal(before.cards.find((card: { id: string }) => card.id === cardId).status, "unread");
    await update("resolved");
    const after = await call("/api/wave-d/pulse");
    assert.equal(after.cards.find((card: { id: string }) => card.id === cardId).status, "read");
    assert.equal(after.status, "caught_up");
    const unread = await call("/api/wave-d/pulse?unreadOnly=true");
    assert.equal(unread.cards.some((card: { id: string }) => card.id === cardId), false);
    const inbox = await call("/api/wave-d/action-inbox");
    assert.equal(inbox.status, "caught_up");
    assert.equal(inbox.items.find((item: { id: string }) => item.id === inboxId).status, "resolved");
  });

  await t.test("snoozed attention stays quiet until the owner explicitly reopens it", async () => {
    await update("snoozed");
    assert.equal((await call("/api/wave-d/pulse?unreadOnly=true")).cards.some((card: { id: string }) => card.id === cardId), false);
    assert.equal((await call("/api/wave-d/action-inbox")).status, "caught_up");
    await update("open");
    const reopened = await call("/api/wave-d/pulse?unreadOnly=true");
    assert.equal(reopened.cards.find((card: { id: string }) => card.id === cardId).status, "unread");
    assert.equal((await call("/api/wave-d/action-inbox")).status, "needs_attention");
  });

  await t.test("another account cannot observe or dismiss the owner's proactive card", async () => {
    const foreign = await call("/api/wave-d/pulse", "GET", undefined, "other");
    assert.equal(foreign.cards.some((card: { id: string }) => card.id === cardId), false);
    await call(`/api/wave-d/action-inbox/${encodeURIComponent(inboxId)}`, "POST", { status: "resolved" }, "other");
    const own = await call("/api/wave-d/pulse?unreadOnly=true");
    assert.equal(own.cards.find((card: { id: string }) => card.id === cardId).status, "unread");
  });

  await t.test("read-authorized compliance users can quiet their own attention without gaining authoring permission", async () => {
    const ownCard = { ...created.card, id: "pulse:compliance-review" };
    await updateWaveDState({ id: other.id, email: other.email, role: other.role, organizationId: null }, state => ({ ...state, pulseCards: [...state.pulseCards, ownCard] }));
    const response = await fetch(base + "/api/wave-d/pulse/cards", { method: "POST", headers: { "Content-Type": "application/json", "x-test-user": "other" }, body: JSON.stringify(ownCard) });
    assert.equal(response.status, 403, "quieting attention does not grant card-authoring authority");
    await call(`/api/wave-d/action-inbox/${encodeURIComponent(`inbox:${ownCard.id}`)}`, "POST", { status: "resolved" }, "other");
    const quiet = await call("/api/wave-d/pulse?unreadOnly=true", "GET", undefined, "other");
    assert.equal(quiet.cards.some((card: { id: string }) => card.id === ownCard.id), false);
  });

  await t.test("market attention never invents portfolio exposure or replaces a quote's observation time with poll time", async () => {
    const snapshot: Quote = {
      symbol: "AAPL", name: "Isolated quote fixture", price: 103.2, change: 3.2, changePercent: 3.2,
      volume: 1000, marketCap: null, pe: null, eps: null, revenue: null,
      high52: 110, low52: 90, open: 100, previousClose: 100, dayHigh: 104, dayLow: 99,
      avgVolume: 1000, exchange: "fixture", quoteSource: "Isolated fixture", isLive: false, currency: "USD",
      status: { provider: "Isolated fixture", freshness: "daily", asOf: new Date().toISOString(), delayLabel: "Fixture snapshot", isFallback: false },
      entitlement: { state: "eod_available", servedTier: "eod", bestAvailableTier: "eod", entitlementRequired: false, upgradeConnectorId: null, upgradeConnectorLabel: null, reason: "Isolated fixture" },
    };
    quoteSnapshots = [snapshot];
    const fresh = await call("/api/wave-d/pulse");
    const move = fresh.cards.find((card: { kind: string }) => card.kind === "market_move");
    assert.ok(move);
    assert.equal(fresh.actionInbox.some((item: { sourceCardId: string }) => item.sourceCardId === move.id), false, "a small market move cannot acquire priority from invented holdings");
    quoteSnapshots = [{ ...snapshot, changePercent: 10, status: { ...snapshot.status, asOf: "2020-01-02T16:00:00.000Z" } }];
    const historical = await call("/api/wave-d/pulse");
    const oldMove = historical.cards.find((card: { kind: string }) => card.kind === "market_move");
    assert.equal(oldMove.createdAt, "2020-01-02T16:00:00.000Z", "old observations must remain visibly old after a refresh");
    assert.equal(historical.actionInbox.some((item: { sourceCardId: string }) => item.sourceCardId === oldMove.id), false);
    quoteSnapshots = [];
  });
});
