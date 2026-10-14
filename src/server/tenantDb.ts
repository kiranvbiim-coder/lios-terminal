import { sql } from "drizzle-orm";
import { getDb, type DrizzleDb } from "./db";
import type { TenantContext } from "./tenantContext";

type TenantTransaction = Parameters<Parameters<DrizzleDb["transaction"]>[0]>[0];

/**
 * Hosted-Postgres tenant context.
 *
 * SET LOCAL is deliberately transaction-scoped so a pooled connection cannot
 * accidentally retain one organization's context for the next request.
 * The helper is also a no-op for the current PGlite desktop mode, where RLS
 * is not yet enabled.
 */
export async function withTenantTransaction<T>(ctx: TenantContext, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
  if (ctx.organizationId === null) throw new Error("TENANT_CONTEXT_REQUIRED");
  const db: DrizzleDb = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organization', ${String(ctx.organizationId)}, true)`);
    return work(tx);
  });
}

/** Transaction context for both organization-owned and internal user-owned rows. */
export async function withUserTransaction<T>(ctx: TenantContext, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
  if (!Number.isInteger(ctx.userId) || ctx.userId <= 0) throw new Error("USER_CONTEXT_REQUIRED");
  const db: DrizzleDb = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_user_id', ${String(ctx.userId)}, true)`);
    if (ctx.organizationId !== null) {
      await tx.execute(sql`select set_config('app.current_organization', ${String(ctx.organizationId)}, true)`);
    }
    return work(tx);
  });
}

export async function withOrganizationId<T>(organizationId: number, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
  if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error("INVALID_ORGANIZATION_ID");
  const db: DrizzleDb = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.current_organization', ${String(organizationId)}, true)`);
    return work(tx);
  });
}
