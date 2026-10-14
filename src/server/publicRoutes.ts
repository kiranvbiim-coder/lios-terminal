/**
 * Deliberately small unauthenticated surface.
 *
 * The public LiOS entry experience is a non-executable product preview. It may
 * explain capabilities and collect an explicit lead, but it must not expose AI,
 * research, data, engine, connector, Project, Chat or Artifact execution.
 */
import type { Express } from "express";
import { getDb } from "./db";
import { leads, insertLeadSchema } from "@shared/schema";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const MAX_TRACKED_ANONYMOUS_IPS = 4_096;
const attemptsByIp = new Map<string, number[]>();

function pruneRateLimitStore(store: Map<string, number[]>, now: number, windowMs: number): void {
  for (const [key, timestamps] of store) {
    if (!timestamps.some((timestamp) => now - timestamp < windowMs)) store.delete(key);
  }
}

function rateLimited(store: Map<string, number[]>, ip: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  if (!store.has(ip) && store.size >= MAX_TRACKED_ANONYMOUS_IPS) {
    pruneRateLimitStore(store, now, windowMs);
    if (store.size >= MAX_TRACKED_ANONYMOUS_IPS) return true;
  }
  const attempts = (store.get(ip) ?? []).filter((timestamp) => now - timestamp < windowMs);
  attempts.push(now);
  store.set(ip, attempts);
  return attempts.length > max;
}

export function registerPublicRoutes(app: Express): void {
  app.post("/api/public/leads", async (req, res) => {
    const ip = req.ip ?? "unknown";
    if (rateLimited(attemptsByIp, ip, WINDOW_MS, MAX_PER_WINDOW)) {
      return res.status(429).json({ error: "Too many requests. Please try again later." });
    }

    const parsed = insertLeadSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const db = getDb();
    await db.insert(leads).values(parsed.data);
    return res.json({ ok: true });
  });
}
