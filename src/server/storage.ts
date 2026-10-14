import { eq, and, desc } from "drizzle-orm";
import { getDb } from "./db";
import {
  watchlistItems, alerts, chatMessages,
  type WatchlistItem, type InsertWatchlistItem,
  type Alert, type InsertAlert,
  type ChatMessage, type InsertChatMessage,
} from "@shared/schema";

/**
 * Personal terminal state -- each internal user's own watchlist, alerts, and
 * chat history. Scoped by userId on every call: this used to be a single
 * global file (fine when only one person ever ran the terminal), but with
 * real internal accounts now in play, multiple analysts share this same
 * backend and must not see each other's working set.
 *
 * Not to be confused with the client-facing dashboardWatchlistItems /
 * clientAlerts tables in shared/schema.ts, which are curated by internal
 * staff FOR client orgs and unrelated to an analyst's own personal terminal
 * state.
 */
export interface IStorage {
  getWatchlist(userId: number): Promise<WatchlistItem[]>;
  addWatchlistItem(userId: number, item: InsertWatchlistItem): Promise<WatchlistItem>;
  removeWatchlistItem(userId: number, id: number): Promise<void>;

  getAlerts(userId: number): Promise<Alert[]>;
  addAlert(userId: number, alert: InsertAlert): Promise<Alert>;
  deleteAlert(userId: number, id: number): Promise<void>;
  triggerAlert(id: number, details: { triggerPrice: number; triggeredAt: Date }): Promise<void>;

  getChatMessages(userId: number): Promise<ChatMessage[]>;
  addChatMessage(userId: number, msg: InsertChatMessage): Promise<ChatMessage>;
  clearChatMessages(userId: number): Promise<void>;

  // Cross-user reads for background jobs (alert monitor, live-quote broadcast)
  getAllActiveAlerts(): Promise<Alert[]>;
  getAllWatchlistSymbols(): Promise<string[]>;
}

const DEFAULT_WATCHLIST: Array<{ symbol: string; name: string }> = [
  { symbol: "AAPL", name: "Apple Inc." },
  { symbol: "MSFT", name: "Microsoft Corp." },
  { symbol: "NVDA", name: "NVIDIA Corp." },
  { symbol: "TSLA", name: "Tesla Inc." },
  { symbol: "GOOGL", name: "Alphabet Inc." },
  { symbol: "AMZN", name: "Amazon.com Inc." },
  { symbol: "META", name: "Meta Platforms" },
  { symbol: "BRK-B", name: "Berkshire Hathaway" },
];

class PostgresStorage implements IStorage {
  private seededUsers = new Set<number>();

  private async ensureSeeded(userId: number): Promise<void> {
    if (this.seededUsers.has(userId)) return;
    this.seededUsers.add(userId);
    const db = getDb();
    const existing = await db.select().from(watchlistItems).where(eq(watchlistItems.userId, userId)).limit(1);
    if (existing.length) return;
    await db.insert(watchlistItems).values(
      DEFAULT_WATCHLIST.map((d) => ({ userId, symbol: d.symbol, name: d.name })),
    );
  }

  async getWatchlist(userId: number): Promise<WatchlistItem[]> {
    await this.ensureSeeded(userId);
    const db = getDb();
    return db.select().from(watchlistItems).where(eq(watchlistItems.userId, userId));
  }

  async addWatchlistItem(userId: number, item: InsertWatchlistItem): Promise<WatchlistItem> {
    const db = getDb();
    const [row] = await db.insert(watchlistItems).values({ userId, ...item }).returning();
    return row;
  }

  async removeWatchlistItem(userId: number, id: number): Promise<void> {
    const db = getDb();
    await db.delete(watchlistItems).where(and(eq(watchlistItems.id, id), eq(watchlistItems.userId, userId)));
  }

  async getAlerts(userId: number): Promise<Alert[]> {
    const db = getDb();
    return db.select().from(alerts).where(eq(alerts.userId, userId)).orderBy(desc(alerts.createdAt));
  }

  async addAlert(userId: number, alert: InsertAlert): Promise<Alert> {
    const db = getDb();
    const [row] = await db.insert(alerts).values({ userId, ...alert }).returning();
    return row;
  }

  async deleteAlert(userId: number, id: number): Promise<void> {
    const db = getDb();
    await db.delete(alerts).where(and(eq(alerts.id, id), eq(alerts.userId, userId)));
  }

  async triggerAlert(id: number, details: { triggerPrice: number; triggeredAt: Date }): Promise<void> {
    const db = getDb();
    await db.update(alerts)
      .set({ triggered: true, triggerPrice: details.triggerPrice, triggeredAt: details.triggeredAt })
      .where(eq(alerts.id, id));
  }

  async getChatMessages(userId: number): Promise<ChatMessage[]> {
    const db = getDb();
    return db.select().from(chatMessages).where(eq(chatMessages.userId, userId)).orderBy(chatMessages.createdAt);
  }

  async addChatMessage(userId: number, msg: InsertChatMessage): Promise<ChatMessage> {
    const db = getDb();
    const [row] = await db.insert(chatMessages).values({ userId, ...msg }).returning();
    return row;
  }

  async clearChatMessages(userId: number): Promise<void> {
    const db = getDb();
    await db.delete(chatMessages).where(eq(chatMessages.userId, userId));
  }

  async getAllActiveAlerts(): Promise<Alert[]> {
    const db = getDb();
    return db.select().from(alerts).where(eq(alerts.triggered, false));
  }

  async getAllWatchlistSymbols(): Promise<string[]> {
    const db = getDb();
    const rows = await db.select({ symbol: watchlistItems.symbol }).from(watchlistItems);
    return Array.from(new Set(rows.map((r) => r.symbol)));
  }
}

export const storage: IStorage = new PostgresStorage();
