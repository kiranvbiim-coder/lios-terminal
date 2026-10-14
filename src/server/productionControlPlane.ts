import crypto from "node:crypto";
import { and, desc, eq, lt, isNull, sql } from "drizzle-orm";
import {
  dataDeletionReceipts,
  diagnosticEvents,
  enterpriseSamlRequests,
  enterpriseSsoDeviceAuthorizations,
  exportCustodyReceipts,
  productionRetentionPolicies,
} from "@shared/schema";
import { getDb } from "./db";
import { isEmailConfigured, sendEmail } from "./emailService";
import { getEnterprisePolicy } from "./enterprisePolicyService";

export const PRODUCTION_RETENTION_SCOPE = "platform";
export class EnterpriseLegalHoldError extends Error {
  constructor() {
    super("Organization data is under enterprise legal hold.");
    this.name = "EnterpriseLegalHoldError";
  }
}

function notUnderEnterpriseLegalHold(organizationColumn: any) {
  return sql`(${organizationColumn} IS NULL OR NOT EXISTS (
    SELECT 1 FROM "organization_enterprise_policies" ep
    WHERE ep."organization_id" = ${organizationColumn}
      AND COALESCE(ep."policy"->'retention'->>'legalHold', 'false') = 'true'
  ))`;
}

async function enterpriseLegalHoldEnabled(organizationId: number): Promise<boolean> {
  const policy = await getEnterprisePolicy(organizationId);
  return policy?.policy.retention.legalHold === true;
}


export interface ProductionRetentionPolicy {
  telemetryDays: number;
  deletionReceiptDays: number;
  exportReceiptDays: number;
}

export const DEFAULT_PRODUCTION_RETENTION: ProductionRetentionPolicy = Object.freeze({
  telemetryDays: 30,
  deletionReceiptDays: 365,
  exportReceiptDays: 90,
});

export type SafeDiagnosticDetails = Record<string, string | number | boolean | null>;

const SAFE_DETAIL_KEYS = new Set([
  "durationMs",
  "count",
  "code",
  "screen",
  "operation",
  "reason",
  "recoverable",
  "memoryMb",
  "status",
  "method",
  "retryCount",
  "queueDepth",
  "launchCount",
  "failureCount",
  "noResultCount",
  "linkedContextChanges",
  "completedMissions",
  "timingCount",
  "maxTimingMs",
]);

function boundedDays(value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Retention days must be an integer between ${min} and ${max}.`);
  return value;
}

function plusDays(now: Date, days: number): Date {
  return new Date(now.getTime() + days * 86_400_000);
}

function configuredBoolean(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

export function publicHttpsUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:") return null;
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".invalid")
    ) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function buildPublicDistributionManifest(env: NodeJS.ProcessEnv = process.env) {
  const updateUrl = publicHttpsUrl(env.LIOS_UPDATE_URL);
  const macDownloadUrl = publicHttpsUrl(env.LIOS_DOWNLOAD_MAC_URL);
  const windowsDownloadUrl = publicHttpsUrl(env.LIOS_DOWNLOAD_WINDOWS_URL);
  const releaseNotesUrl = publicHttpsUrl(env.LIOS_RELEASE_NOTES_URL);
  const websiteUrl = publicHttpsUrl(env.LIOS_PUBLIC_APP_URL);
  const blockers: string[] = [];
  if (!updateUrl) blockers.push("LIOS_UPDATE_URL is not configured as a public HTTPS update feed.");
  if (!macDownloadUrl) blockers.push("LIOS_DOWNLOAD_MAC_URL is not configured as a public HTTPS signed macOS download.");
  if (!windowsDownloadUrl) blockers.push("LIOS_DOWNLOAD_WINDOWS_URL is not configured as a public HTTPS signed Windows download.");
  if (!websiteUrl) blockers.push("LIOS_PUBLIC_APP_URL is not configured as the public LiOS website/account origin.");
  return {
    contractVersion: "1.0.0",
    ready: blockers.length === 0,
    version: env.LIOS_PUBLIC_VERSION?.trim() || null,
    channel: env.LIOS_RELEASE_CHANNEL?.trim() || "stable",
    updateUrl,
    downloads: {
      macosArm64: macDownloadUrl,
      windowsX64: windowsDownloadUrl,
    },
    releaseNotesUrl,
    websiteUrl,
    blockers,
  };
}

async function probePublicUrl(url: string): Promise<{ ok: boolean; status: number }> {
  try {
    let response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10_000), redirect: "follow" });
    if (response.status === 405) {
      response = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(10_000),
        redirect: "follow",
      });
    }
    return { ok: response.ok || (response.status >= 300 && response.status < 400) || response.status === 206, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function verifyPublicDistributionEndpoints(now = new Date(), env: NodeJS.ProcessEnv = process.env) {
  const manifest = buildPublicDistributionManifest(env);
  if (!manifest.ready || !manifest.updateUrl || !manifest.downloads.macosArm64 || !manifest.downloads.windowsX64 || !manifest.websiteUrl) {
    return { verified: false, reason: "distribution_manifest_incomplete", checks: [] as Array<{ name: string; url: string; ok: boolean; status: number }> };
  }

  const updateBase = manifest.updateUrl.endsWith("/") ? manifest.updateUrl : `${manifest.updateUrl}/`;
  const targets = [
    { name: "website", url: manifest.websiteUrl },
    { name: "macos_download", url: manifest.downloads.macosArm64 },
    { name: "windows_download", url: manifest.downloads.windowsX64 },
    { name: "macos_update_metadata", url: new URL("latest-mac.yml", updateBase).toString() },
    { name: "windows_update_metadata", url: new URL("latest.yml", updateBase).toString() },
  ];
  const checks = await Promise.all(targets.map(async (target) => ({ ...target, ...(await probePublicUrl(target.url)) })));
  const verified = checks.every((check) => check.ok);
  if (verified) {
    await recordDiagnosticEvent({
      category: "runtime",
      eventName: "distribution_endpoints_verified",
      severity: "info",
      details: { operation: "distribution_probe", count: checks.length, status: 200 },
      force: true,
      now,
    });
  }
  return { verified, reason: verified ? null : "one_or_more_distribution_endpoints_failed", checks };
}

export async function latestDistributionEvidence() {
  const [row] = await getDb().select().from(diagnosticEvents)
    .where(eq(diagnosticEvents.eventName, "distribution_endpoints_verified"))
    .orderBy(desc(diagnosticEvents.createdAt))
    .limit(1);
  return row ?? null;
}

export async function ensureProductionRetentionPolicy(): Promise<ProductionRetentionPolicy> {
  const db = getDb();
  await db.insert(productionRetentionPolicies).values({
    scope: PRODUCTION_RETENTION_SCOPE,
    ...DEFAULT_PRODUCTION_RETENTION,
  }).onConflictDoNothing();
  const [row] = await db.select().from(productionRetentionPolicies)
    .where(eq(productionRetentionPolicies.scope, PRODUCTION_RETENTION_SCOPE))
    .limit(1);
  if (!row) return { ...DEFAULT_PRODUCTION_RETENTION };
  return {
    telemetryDays: row.telemetryDays,
    deletionReceiptDays: row.deletionReceiptDays,
    exportReceiptDays: row.exportReceiptDays,
  };
}

export async function updateProductionRetentionPolicy(
  input: ProductionRetentionPolicy,
  actorUserId: number,
): Promise<ProductionRetentionPolicy> {
  const policy = {
    telemetryDays: boundedDays(input.telemetryDays, 1, 365),
    deletionReceiptDays: boundedDays(input.deletionReceiptDays, 30, 3650),
    exportReceiptDays: boundedDays(input.exportReceiptDays, 1, 3650),
  };
  const db = getDb();
  await db.insert(productionRetentionPolicies).values({
    scope: PRODUCTION_RETENTION_SCOPE,
    ...policy,
    updatedByUserId: actorUserId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: productionRetentionPolicies.scope,
    set: { ...policy, updatedByUserId: actorUserId, updatedAt: new Date() },
  });
  return policy;
}

export function sanitizeDiagnosticDetails(value: unknown): SafeDiagnosticDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: SafeDiagnosticDetails = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!SAFE_DETAIL_KEYS.has(key)) continue;
    if (raw === null || typeof raw === "boolean") output[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) output[key] = raw;
    else if (typeof raw === "string") output[key] = raw.trim().slice(0, 160);
  }
  return output;
}

export function diagnosticFingerprint(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  const firstFrame = error instanceof Error ? error.stack?.split("\n")[1]?.trim() ?? "" : "";
  return crypto.createHash("sha256").update(`${name}|${message.slice(0, 240)}|${firstFrame}`).digest("hex");
}

export async function recordDiagnosticEvent(input: {
  organizationId?: number | null;
  userId?: number | null;
  category: "runtime" | "crash" | "performance";
  eventName: string;
  severity: "info" | "warning" | "error" | "fatal";
  appVersion?: string | null;
  platform?: string | null;
  arch?: string | null;
  fingerprint?: string | null;
  details?: unknown;
  force?: boolean;
  now?: Date;
}): Promise<{ accepted: boolean; id?: number; reason?: string }> {
  if (!input.force && !configuredBoolean(process.env.LIOS_TELEMETRY_ENABLED)) {
    return { accepted: false, reason: "remote_diagnostics_disabled" };
  }
  const policy = await ensureProductionRetentionPolicy();
  const now = input.now ?? new Date();
  const [row] = await getDb().insert(diagnosticEvents).values({
    organizationId: input.organizationId ?? null,
    userId: input.userId ?? null,
    category: input.category,
    eventName: input.eventName.trim().slice(0, 120),
    severity: input.severity,
    appVersion: input.appVersion?.trim().slice(0, 80) || null,
    platform: input.platform?.trim().slice(0, 40) || null,
    arch: input.arch?.trim().slice(0, 40) || null,
    fingerprint: input.fingerprint?.trim().slice(0, 128) || null,
    details: sanitizeDiagnosticDetails(input.details),
    createdAt: now,
    expiresAt: plusDays(now, policy.telemetryDays),
  }).returning();
  return { accepted: true, id: row.id };
}

export async function registerExportCustodyReceipt(input: {
  organizationId: number;
  userId: number;
  format: "pdf" | "xlsx" | "csv" | "json" | "zip" | "other";
  artifactNameHash: string;
  sha256: string;
  byteSize: number;
  generatedAt: Date;
}, now = new Date()) {
  const policy = await ensureProductionRetentionPolicy();
  const id = `export:${crypto.randomUUID()}`;
  const [receipt] = await getDb().insert(exportCustodyReceipts).values({
    id,
    organizationId: input.organizationId,
    userId: input.userId,
    format: input.format,
    artifactNameHash: input.artifactNameHash.toLowerCase(),
    sha256: input.sha256.toLowerCase(),
    byteSize: input.byteSize,
    custody: "local_only",
    generatedAt: input.generatedAt,
    registeredAt: now,
    expiresAt: plusDays(now, policy.exportReceiptDays),
  }).returning();
  return receipt;
}

export async function listExportCustodyReceipts(organizationId: number, userId?: number) {
  const db = getDb();
  const condition = userId
    ? and(eq(exportCustodyReceipts.organizationId, organizationId), eq(exportCustodyReceipts.userId, userId))
    : eq(exportCustodyReceipts.organizationId, organizationId);
  return db.select().from(exportCustodyReceipts).where(condition).orderBy(desc(exportCustodyReceipts.registeredAt)).limit(200);
}

export async function markExportCustodyDeleted(id: string, organizationId: number, userId: number, now = new Date()) {
  if (await enterpriseLegalHoldEnabled(organizationId)) throw new EnterpriseLegalHoldError();
  const [row] = await getDb().update(exportCustodyReceipts).set({ deletedAt: now })
    .where(and(
      eq(exportCustodyReceipts.id, id),
      eq(exportCustodyReceipts.organizationId, organizationId),
      eq(exportCustodyReceipts.userId, userId),
      isNull(exportCustodyReceipts.deletedAt),
    ))
    .returning();
  return row ?? null;
}

async function createDeletionReceipt(input: {
  organizationId?: number | null;
  requestedByUserId?: number | null;
  scope: string;
  status: "completed" | "partial" | "blocked";
  reason?: string | null;
  counts: Record<string, number>;
  now: Date;
}) {
  const policy = await ensureProductionRetentionPolicy();
  const [receipt] = await getDb().insert(dataDeletionReceipts).values({
    id: `deletion:${crypto.randomUUID()}`,
    organizationId: input.organizationId ?? null,
    requestedByUserId: input.requestedByUserId ?? null,
    scope: input.scope,
    status: input.status,
    reason: input.reason?.trim().slice(0, 500) || null,
    counts: input.counts,
    requestedAt: input.now,
    completedAt: input.status === "completed" ? input.now : null,
    expiresAt: plusDays(input.now, policy.deletionReceiptDays),
  }).returning();
  return receipt;
}

export async function purgeExpiredProductionMetadata(now = new Date()) {
  const db = getDb();
  const expiredDiagnostics = await db.delete(diagnosticEvents).where(and(
    lt(diagnosticEvents.expiresAt, now),
    notUnderEnterpriseLegalHold(diagnosticEvents.organizationId),
  )).returning();
  const expiredExports = await db.delete(exportCustodyReceipts).where(and(
    lt(exportCustodyReceipts.expiresAt, now),
    notUnderEnterpriseLegalHold(exportCustodyReceipts.organizationId),
  )).returning();
  // Browser-to-desktop SSO tickets are ephemeral authentication material, not
  // business records. Expired tickets are removed regardless of legal hold so
  // verifier hashes do not become retained customer content.
  const expiredSsoDeviceAuthorizations = await db.delete(enterpriseSsoDeviceAuthorizations)
    .where(lt(enterpriseSsoDeviceAuthorizations.expiresAt, now)).returning();
  const expiredSamlRequests = await db.delete(enterpriseSamlRequests)
    .where(lt(enterpriseSamlRequests.expiresAt, now)).returning();
  const expiredReceipts = await db.delete(dataDeletionReceipts).where(and(
    lt(dataDeletionReceipts.expiresAt, now),
    notUnderEnterpriseLegalHold(dataDeletionReceipts.organizationId),
  )).returning();
  const counts = {
    diagnosticEvents: expiredDiagnostics.length,
    exportCustodyReceipts: expiredExports.length,
    enterpriseSsoDeviceAuthorizations: expiredSsoDeviceAuthorizations.length,
    enterpriseSamlRequests: expiredSamlRequests.length,
    priorDeletionReceipts: expiredReceipts.length,
  };
  const receipt = await createDeletionReceipt({
    scope: "retention_expiry",
    status: "completed",
    counts,
    now,
  });
  return { counts, receipt };
}

export async function purgeOrganizationOperationalMetadata(
  organizationId: number,
  actorUserId: number,
  reason: string,
  now = new Date(),
) {
  const db = getDb();
  if (await enterpriseLegalHoldEnabled(organizationId)) {
    const counts = { diagnosticEvents: 0 };
    const receipt = await createDeletionReceipt({
      organizationId,
      requestedByUserId: actorUserId,
      scope: "operational_diagnostics",
      status: "blocked",
      reason: `Legal hold blocked purge: ${reason}`,
      counts,
      now,
    });
    return { counts, receipt, blockedByLegalHold: true };
  }
  const diagnostics = await db.delete(diagnosticEvents).where(eq(diagnosticEvents.organizationId, organizationId)).returning();
  const counts = { diagnosticEvents: diagnostics.length };
  const receipt = await createDeletionReceipt({
    organizationId,
    requestedByUserId: actorUserId,
    scope: "operational_diagnostics",
    status: "completed",
    reason,
    counts,
    now,
  });
  return { counts, receipt };
}

export async function latestDeletionReceipt(scope?: string) {
  const db = getDb();
  const rows = scope
    ? await db.select().from(dataDeletionReceipts)
        .where(eq(dataDeletionReceipts.scope, scope))
        .orderBy(desc(dataDeletionReceipts.requestedAt))
        .limit(1)
    : await db.select().from(dataDeletionReceipts)
        .orderBy(desc(dataDeletionReceipts.requestedAt))
        .limit(1);
  return rows[0] ?? null;
}

export async function latestExportCustodyReceipt() {
  const [row] = await getDb().select().from(exportCustodyReceipts)
    .orderBy(desc(exportCustodyReceipts.registeredAt))
    .limit(1);
  return row ?? null;
}

export async function listDeletionReceipts(limit = 100) {
  return getDb().select().from(dataDeletionReceipts).orderBy(desc(dataDeletionReceipts.requestedAt)).limit(Math.max(1, Math.min(limit, 500)));
}

function validEmail(value: string | undefined): string | null {
  const email = value?.trim();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export async function sendOperationsNotification(subject: string, text: string, now = new Date()) {
  const destination = validEmail(process.env.LIOS_OPERATIONS_ALERT_EMAIL);
  if (!destination || !isEmailConfigured()) return { delivered: false, reason: "operations_email_not_configured" };
  const result = await sendEmail({
    to: destination,
    subject: subject.trim().slice(0, 160),
    text: text.trim().slice(0, 4_000),
  });
  if (!result.sent) return { delivered: false, reason: result.reason ?? "SMTP delivery failed." };
  await recordDiagnosticEvent({
    category: "runtime",
    eventName: "operations_notification_delivered",
    severity: "info",
    details: { operation: "smtp", status: 200 },
    force: true,
    now,
  });
  return { delivered: true, deliveredAt: now.toISOString() };
}

export async function latestOperationsNotificationEvidence() {
  const [row] = await getDb().select().from(diagnosticEvents)
    .where(eq(diagnosticEvents.eventName, "operations_notification_delivered"))
    .orderBy(desc(diagnosticEvents.createdAt))
    .limit(1);
  return row ?? null;
}

export async function latestDiagnosticEvidence(category?: "runtime" | "crash" | "performance") {
  const db = getDb();
  const rows = category
    ? await db.select().from(diagnosticEvents).where(eq(diagnosticEvents.category, category)).orderBy(desc(diagnosticEvents.createdAt)).limit(1)
    : await db.select().from(diagnosticEvents).orderBy(desc(diagnosticEvents.createdAt)).limit(1);
  return rows[0] ?? null;
}

export async function productionOperationalCounts() {
  const db = getDb();
  const [diagnostics, deletions, exports] = await Promise.all([
    db.select({ id: diagnosticEvents.id }).from(diagnosticEvents),
    db.select({ id: dataDeletionReceipts.id }).from(dataDeletionReceipts),
    db.select({ id: exportCustodyReceipts.id }).from(exportCustodyReceipts),
  ]);
  return {
    diagnosticEvents: diagnostics.length,
    deletionReceipts: deletions.length,
    exportCustodyReceipts: exports.length,
  };
}
