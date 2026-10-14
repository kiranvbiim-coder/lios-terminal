/**
 * Durable session store backed by the same database as everything else.
 *
 * express-session's default MemoryStore loses every session on process
 * restart -- fine for a long-lived server, wrong for a desktop app that
 * gets quit and reopened constantly (every restart would force-log-out
 * every internal user). This persists sessions to the sessions table
 * instead, so signing in survives closing the app.
 */
import { Store } from "express-session";
import { eq, lt } from "drizzle-orm";
import { getDb } from "./db";
import { sessions } from "@shared/schema";

const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export class DrizzleSessionStore extends Store {
  constructor() {
    super();
    setInterval(() => this.pruneExpired(), PRUNE_INTERVAL_MS).unref();
  }

  private async pruneExpired(): Promise<void> {
    try {
      const db = getDb();
      await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
    } catch {
      // best-effort cleanup; a failed prune just means stale rows linger briefly
    }
  }

  get(sid: string, callback: (err: unknown, session?: any) => void): void {
    (async () => {
      try {
        const db = getDb();
        const [row] = await db.select().from(sessions).where(eq(sessions.sid, sid)).limit(1);
        if (!row || row.expiresAt.getTime() < Date.now()) return callback(null, null);
        callback(null, row.sessionData);
      } catch (err) {
        callback(err);
      }
    })();
  }

  set(sid: string, session: any, callback?: (err?: unknown) => void): void {
    (async () => {
      try {
        const db = getDb();
        const maxAgeMs = session.cookie?.maxAge ?? 30 * 24 * 60 * 60 * 1000;
        const expiresAt = new Date(Date.now() + maxAgeMs);
        await db.insert(sessions)
          .values({ sid, sessionData: session, expiresAt })
          .onConflictDoUpdate({ target: sessions.sid, set: { sessionData: session, expiresAt } });
        callback?.();
      } catch (err) {
        callback?.(err);
      }
    })();
  }

  destroy(sid: string, callback?: (err?: unknown) => void): void {
    (async () => {
      try {
        const db = getDb();
        await db.delete(sessions).where(eq(sessions.sid, sid));
        callback?.();
      } catch (err) {
        callback?.(err);
      }
    })();
  }

  touch(sid: string, session: any, callback?: (err?: unknown) => void): void {
    this.set(sid, session, callback);
  }
}
