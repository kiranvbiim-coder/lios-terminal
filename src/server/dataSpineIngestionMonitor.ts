/**
 * Scheduled ingestion and change monitoring for the Data Spine.
 *
 * Every capture function built this session (captureFinancialStatements
 * ConflictSnapshot, captureMarketDatasetSnapshot, ...) is already
 * content-hash deduped and revision-chained -- calling one twice for
 * unchanged data is a correctly-detected no-op (`created: false`), and a
 * genuine change creates a new snapshot linked to its parent via
 * parentSnapshotId. What was missing was WHEN to call them: nothing in
 * this codebase periodically re-checked a symbol on its own. This module
 * is that trigger, reusing alertMonitor.ts's existing generic interval-
 * cycle runner (createAlertMonitor) rather than building a second
 * scheduling primitive -- the same one already drives alert evaluation
 * and decision monitoring in index.ts.
 *
 * The monitored symbol universe is deliberately derived from real,
 * already-recorded user activity (portfolio holdings, personal and client
 * dashboard watchlists) rather than an invented seed list -- "symbols
 * someone here actually holds or watches" is the only honest definition
 * of "what should stay fresh" available without fabricating scope.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "./db";
import { alerts, dashboardWatchlistItems, positions, users, watchlistItems } from "@shared/schema";
import { captureFinancialStatementsConflictSnapshot } from "./financialStatementsBroker";
import { recordAuditEvent } from "./auditEvents";

export async function getMonitoredSymbols(): Promise<string[]> {
  const db = getDb();
  const [fromPositions, fromWatchlist, fromDashboardWatchlist, fromAlerts] = await Promise.all([
    db.select({ symbol: positions.symbol }).from(positions),
    db.select({ symbol: watchlistItems.symbol }).from(watchlistItems),
    db.select({ symbol: dashboardWatchlistItems.symbol }).from(dashboardWatchlistItems),
    db.select({ symbol: alerts.symbol }).from(alerts),
  ]);
  const all = [...fromPositions, ...fromWatchlist, ...fromDashboardWatchlist, ...fromAlerts].map((row) => row.symbol.trim().toUpperCase());
  return Array.from(new Set(all)).filter(Boolean).sort();
}

async function resolveSystemUserId(): Promise<number | null> {
  const db = getDb();
  const [admin] = await db.select({ id: users.id }).from(users).where(and(eq(users.role, "internal_admin"), eq(users.active, true))).orderBy(users.id).limit(1);
  return admin?.id ?? null;
}

export interface DataSpineIngestionResult {
  symbolsChecked: number;
  changed: Array<{ symbol: string; snapshotId: string; conflictCount: number }>;
  unchanged: number;
  failures: Array<{ symbol: string; message: string }>;
}

/**
 * One ingestion pass: re-captures a financial-statement conflict snapshot
 * for every monitored symbol. Sequential, not concurrent, across symbols
 * -- each capture already fans out to up to 8 real providers internally
 * (financialStatementsBroker.ts), so running symbols in parallel too would
 * multiply real request volume against those providers' rate limits for
 * no benefit a background job needs to rush.
 */
export async function runDataSpineIngestionCycle(): Promise<DataSpineIngestionResult> {
  const symbols = await getMonitoredSymbols();
  const systemUserId = await resolveSystemUserId();
  const changed: DataSpineIngestionResult["changed"] = [];
  const failures: DataSpineIngestionResult["failures"] = [];
  let unchanged = 0;

  if (systemUserId === null) {
    return { symbolsChecked: 0, changed, unchanged, failures: [{ symbol: "*", message: "No active internal administrator is provisioned yet; skipping this cycle." }] };
  }

  for (const symbol of symbols) {
    try {
      const result = await captureFinancialStatementsConflictSnapshot(symbol, "income", "FY", systemUserId);
      if (result.created) {
        changed.push({ symbol, snapshotId: result.snapshot.id, conflictCount: result.snapshot.payload.conflicts.length });
      } else {
        unchanged++;
      }
    } catch (error) {
      failures.push({ symbol, message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (changed.length > 0 || failures.length > 0) {
    await recordAuditEvent(systemUserId, "data_spine_ingestion_cycle", {
      symbolsChecked: symbols.length,
      changedCount: changed.length,
      unchangedCount: unchanged,
      failedCount: failures.length,
      changed,
      failures,
    });
  }

  return { symbolsChecked: symbols.length, changed, unchanged, failures };
}
