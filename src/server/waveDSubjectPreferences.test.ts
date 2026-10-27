import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express, { type Request } from "express";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-pulse-follow-mute-"));
process.env.LIOS_DATA_ROOT = root;
process.env.LIMURIA_DATA_DIR = root;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { registerWaveDRoutes } = await import("./waveDRoutes");
const { getWaveDState } = await import("./waveDStateStore");

test("authenticated Follow/Mute survives persistence, isolates users and never creates monitors", { timeout: 120_000 }, async t => {
  await initDb();
  const [owner, second] = await getDb().insert(users).values(["owner", "second"].map(name => ({
    name, email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only",
    role: "internal_admin" as const, organizationId: null,
  }))).returning();
  const app = express();
  app.use(express.json());
  // Route test injects the actor; real session establishment is verified in auth suites.
  app.use((req, _res, next) => {
    req.user = req.header("x-test-user") === "second" ? second : owner;
    req.isAuthenticated = (() => true) as Request["isAuthenticated"];
    next();
  });
  registerWaveDRoutes(app, { quotes: async () => [], news: async () => [] });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (route:string, method="GET", body?:unknown, actor="owner") => {
    const response = await fetch(base + route, { method,
      headers: { "Content-Type": "application/json", "x-test-user": actor },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {status:response.status,body:await response.json() as any};
  };
  const fixture = (subjectKey:string) => ({
    kind:"research", title:"Evidence for " + subjectKey, whatHappened:"Recorded research development.",
    whyItMatters:"Requires source review.", whyItMattersToUser:"Check observed evidence.",
    nextActions:["analyse","save"], thesisRelevance:1, unread:true, subjectKey,
    evidence:[{id:"source:"+subjectKey,source:"Stored owner evidence"}],
  });
  const created = await call("/api/wave-d/pulse/cards","POST",fixture("SOLAR"));
  assert.equal(created.status,201);
  const id = created.body.card.id as string;

  const initial = await call("/api/wave-d/pulse?channel=following");
  assert.equal(initial.status,200);
  assert.deepEqual(initial.body.cards,[]);
  assert.deepEqual(initial.body.preferences,{followed:[],muted:[]});

  const followed = await call("/api/wave-d/pulse/preferences","PUT",{subjectKey:"  solar  ",choice:"follow"});
  assert.equal(followed.status,200);
  assert.equal(followed.body.persisted,true);
  assert.deepEqual(followed.body.preferences,{followed:["SOLAR"],muted:[]});
  const saved = await call("/api/wave-d/pulse/preferences");
  assert.deepEqual(saved.body.preferences,followed.body.preferences);
  const followedFeed = await call("/api/wave-d/pulse?channel=following&subjectKeys=INJECTED");
  assert.deepEqual(followedFeed.body.cards.map((c:{id:string})=>c.id),[id]);
  assert.equal(followedFeed.body.monitoring.activeRules,0);

  const otherBefore = await call("/api/wave-d/pulse/preferences","GET",undefined,"second");
  assert.deepEqual(otherBefore.body.preferences,{followed:[],muted:[]});
  const otherFeed = await call("/api/wave-d/pulse?channel=following","GET",undefined,"second");
  assert.deepEqual(otherFeed.body.cards,[]);

  const muted = await call("/api/wave-d/pulse/preferences","PUT",{subjectKey:"SOLAR",choice:"mute"});
  assert.equal(muted.status,200);
  assert.deepEqual(muted.body.preferences,{followed:[],muted:["SOLAR"]});
  const mutedFeed = await call("/api/wave-d/pulse");
  assert.ok(!mutedFeed.body.cards.some((c:{id:string})=>c.id===id));
  assert.ok(mutedFeed.body.actionInbox.some((entry:{sourceCardId:string})=>entry.sourceCardId===id),
    "Mute is a discovery preference and must not silence action/alert safety");
  const mutedBrief = await call("/api/wave-d/briefs/morning");
  assert.ok(!mutedBrief.body.cards.some((c:{id:string})=>c.id===id));
  const stored = await getWaveDState({id:owner.id,email:owner.email,role:owner.role,organizationId:owner.organizationId});
  assert.deepEqual(stored.pulsePreferences,{followed:[],muted:["SOLAR"]});
  assert.equal(stored.signalRules.length,0);
  assert.equal(stored.scheduledMonitors.length,0);
  const secondStored = await getWaveDState({id:second.id,email:second.email,role:second.role,organizationId:second.organizationId});
  assert.deepEqual(secondStored.pulsePreferences,{followed:[],muted:[]});

  const unmute = await call("/api/wave-d/pulse/preferences","PUT",{subjectKey:"solar",choice:"clear"});
  assert.deepEqual(unmute.body.preferences,{followed:[],muted:[]});
  const restored = await call("/api/wave-d/pulse");
  assert.ok(restored.body.cards.some((c:{id:string})=>c.id===id));
  for(const body of [
    {subjectKey:"",choice:"follow"},
    {subjectKey:"SOLAR\nINJECT",choice:"mute"},
    {subjectKey:"SOLAR",choice:"enable_monitor"},
    {subjectKey:"SOLAR",choice:"follow",userId:second.id},
  ]) {
    const response=await call("/api/wave-d/pulse/preferences","PUT",body);
    assert.equal(response.status,400,JSON.stringify(body));
  }
});
