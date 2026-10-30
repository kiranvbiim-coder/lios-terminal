import type { Express, NextFunction, Request, Response } from "express";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { CLIENT_ROLES, organizationLicenses, organizations, users } from "@shared/schema";
import {
  DEFAULT_TRIAL_DAYS,
  READ_ONLY_ERROR_CODE,
  TRIAL_PENDING_BILLING_STATE,
  resolveInstallationAccessMode,
  resolveTrialLifecycle,
  isExecutableLicenseStatus,
  type InstallationAccessMode,
  type InstallationAccessReason,
} from "@shared/commercialRuntime";
import { getDb, isDbInitialized } from "./db";
import { evaluateCachedOfflineAccess, readCachedOfflineLeaseBundle } from "./offlineLeaseCache";
import { resolveRuntimeMode } from "./runtimeMode";
import { getRequestIdentity } from "./requestContext";

/**
 * The one place that decides whether this installation may start new work. Trial state (the Home's own database)
 * and the imported license key (verified against the pinned trust anchors) are combined by the pure rule in
 * `shared/commercialRuntime.ts`; nothing here contacts a server. Chokepoints that start work (conversation runs,
 * every AI provider call, governed tool invocation, automation runs, provider/connection setup) call
 * `assertExecutionAllowed`; reads, viewing and export never do.
 */

export type ExecutionCapability = "conversation" | "ai" | "tool" | "automation" | "analysis" | "connection";

export const READ_ONLY_MESSAGE =
  "LiOS is read-only: your trial or license has ended. You can still open and export your work. Enter a license key to continue.";

export class ReadOnlyModeError extends Error {
  readonly code = READ_ONLY_ERROR_CODE;
  readonly status = 402;
  constructor(readonly reason: InstallationAccessReason, readonly capability: ExecutionCapability, readonly access: InstallationAccessMode) {
    super(READ_ONLY_MESSAGE);
    this.name = "ReadOnlyModeError";
  }
  body(): Record<string, unknown> {
    return {
      error: this.message,
      code: this.code,
      reason: this.reason,
      capability: this.capability,
      trialEndsAt: this.access.trialEndsAt,
      licenseExpiresAt: this.access.licenseExpiresAt,
    };
  }
}

export function isReadOnlyModeError(error: unknown): error is ReadOnlyModeError {
  return error instanceof ReadOnlyModeError;
}

const TRIAL_BILLING_STATES = ["trial", "trial_pending"];

/**
 * The explicit "this is a packaged customer desktop" signal. Only the Electron main process sets it, in the
 * environment it gives the server it spawns (main.cjs); no request header, body or stored row can turn it on or
 * off. Server Homes, development runs and tests do not carry it and stay unmanaged.
 */
export function desktopCustomerMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LIOS_DESKTOP_PACKAGED === "true";
}

/** A packaged desktop's owner is an internal_admin with no organization, so the install carries its own trial record. */
export const INSTALLATION_ORG_SLUG = "lios-installation";
/** The high-water mark only advances when the clock has moved this far, to avoid a write on every check. */
const CLOCK_MARK_STEP_MS = 60_000;

type DbExecutor = Pick<ReturnType<typeof getDb>, "select" | "insert" | "update">;

/** Idempotent: creates the installation's trial record in the not-yet-started state, never restarting an existing one. */
export async function ensureInstallationTrialRecord(db: DbExecutor = getDb()): Promise<{ organizationId: number }> {
  await db.insert(organizations)
    .values({ name: "LiOS Installation", slug: INSTALLATION_ORG_SLUG, status: "active", lifecycleStage: "trial" })
    .onConflictDoNothing();
  const [organization] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, INSTALLATION_ORG_SLUG)).limit(1);
  if (!organization) throw new Error("The installation trial record could not be created.");
  await db.insert(organizationLicenses)
    .values({ organizationId: organization.id, planId: null, status: "active", seatsPurchased: 1, billingState: TRIAL_PENDING_BILLING_STATE, trialEndsAt: null })
    .onConflictDoNothing();
  return { organizationId: organization.id };
}

/**
 * Trial time can only move forward. The last time the installation checked is kept on its own trial record
 * (`updatedAt`); a system clock set back below it is treated as that recorded time, so winding the clock back
 * cannot extend a trial or an expiring key. It is a cheap local mitigation, not tamper-proofing.
 */
async function clockFloor(): Promise<Date | null> {
  const [row] = await getDb().select({ id: organizationLicenses.id, updatedAt: organizationLicenses.updatedAt }).from(organizationLicenses)
    .innerJoin(organizations, eq(organizations.id, organizationLicenses.organizationId))
    .where(eq(organizations.slug, INSTALLATION_ORG_SLUG)).limit(1);
  return row ? row.updatedAt : null;
}

async function advanceClockMark(now: Date): Promise<void> {
  const [organization] = await getDb().select({ id: organizations.id }).from(organizations).where(eq(organizations.slug, INSTALLATION_ORG_SLUG)).limit(1);
  if (!organization) return;
  await getDb().update(organizationLicenses).set({ updatedAt: now })
    .where(and(eq(organizationLicenses.organizationId, organization.id), lt(organizationLicenses.updatedAt, new Date(now.getTime() - CLOCK_MARK_STEP_MS))));
}

/** Desktop accounts share one trial; server-Home customer trials never govern the installation or other tenants. */
async function installationTrial(now: Date, env: NodeJS.ProcessEnv) {
  const rows = await getDb()
    .select({ billingState: organizationLicenses.billingState, trialEndsAt: organizationLicenses.trialEndsAt, createdAt: organizationLicenses.createdAt })
    .from(organizationLicenses)
    .innerJoin(organizations, eq(organizations.id, organizationLicenses.organizationId))
    .where(and(
      inArray(organizationLicenses.billingState, TRIAL_BILLING_STATES),
      eq(organizations.lifecycleStage, "trial"),
      resolveRuntimeMode(env) === "user_home_server" ? eq(organizations.slug, INSTALLATION_ORG_SLUG) : undefined,
    ))
    .orderBy(asc(organizationLicenses.createdAt), asc(organizationLicenses.id));
  const row = rows.find((candidate) => candidate.billingState === "trial") ?? rows[0];
  if (!row) return null;
  if (row.billingState === TRIAL_PENDING_BILLING_STATE) return { state: "not_started" as const, endsAt: null };
  // Installs that pre-date the explicit trial end derive it from creation, never from the current request.
  const endsAt = row.trialEndsAt ?? new Date(row.createdAt.getTime() + DEFAULT_TRIAL_DAYS * 86_400_000);
  return { state: resolveTrialLifecycle({ serverNow: now, startedAt: row.createdAt, endsAt }), endsAt };
}

export async function resolveInstallationAccess(now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<InstallationAccessMode> {
  const managed = desktopCustomerMode(env);
  const noLicense = { present: false, valid: false, expiresAt: null, expired: false };
  // Before the database exists nothing can have been started; a managed install fails closed.
  if (!isDbInitialized()) return resolveInstallationAccessMode({ now, managed, license: noLicense, trial: null });
  let effectiveNow = now;
  if (managed) {
    await ensureInstallationTrialRecord();
    const floor = await clockFloor();
    if (floor && floor.getTime() > now.getTime()) effectiveNow = floor;
    else await advanceClockMark(now);
  }
  const bundle = readCachedOfflineLeaseBundle(env);
  const decision = evaluateCachedOfflineAccess(undefined, effectiveNow, env);
  const expiresAt = bundle ? new Date(bundle.lease.payload.expiresAt) : null;
  return resolveInstallationAccessMode({
    now: effectiveNow,
    managed,
    license: {
      present: Boolean(bundle),
      valid: decision.allowed,
      expiresAt: expiresAt && Number.isFinite(expiresAt.getTime()) ? expiresAt : null,
      expired: decision.reason === "offline_lease_expired",
    },
    trial: await installationTrial(effectiveNow, env),
  });
}

/** Server-Home client access uses only that client's own trial, never the installation's or another customer's. */
export async function resolveCustomerTrialAccess(organizationId: number | null, now = new Date(), env: NodeJS.ProcessEnv = process.env): Promise<InstallationAccessMode> {
  const [row] = organizationId === null ? [] : await getDb()
    .select({
      organizationStatus: organizations.status,
      lifecycleStage: organizations.lifecycleStage,
      slug: organizations.slug,
      licenseStatus: organizationLicenses.status,
      billingState: organizationLicenses.billingState,
      trialEndsAt: organizationLicenses.trialEndsAt,
      createdAt: organizationLicenses.createdAt,
    })
    .from(organizations)
    .leftJoin(organizationLicenses, eq(organizationLicenses.organizationId, organizations.id))
    .where(eq(organizations.id, organizationId)).limit(1);
  const installation = await resolveInstallationAccess(now, env);
  if (row?.organizationStatus === "active" && row.slug !== INSTALLATION_ORG_SLUG && row.lifecycleStage === "client"
    && row.licenseStatus !== null && isExecutableLicenseStatus(row.licenseStatus)) {
    return { ...installation, canStartTrial: false };
  }
  const eligible = row?.organizationStatus === "active" && row.slug !== INSTALLATION_ORG_SLUG
    && row.lifecycleStage === "trial" && row.licenseStatus !== null && isExecutableLicenseStatus(row.licenseStatus);
  // A Home-imported signed key retains its existing conversion behavior; a customer cannot import one.
  if (eligible && installation.reason === "license_valid") return { ...installation, canStartTrial: false };
  const pending = eligible && row.billingState === TRIAL_PENDING_BILLING_STATE && row.trialEndsAt === null;
  const endsAt = eligible && row.billingState === "trial" && row.createdAt
    ? row.trialEndsAt ?? new Date(row.createdAt.getTime() + DEFAULT_TRIAL_DAYS * 86_400_000)
    : null;
  return resolveInstallationAccessMode({
    now,
    managed: true,
    license: { present: false, valid: false, expiresAt: null, expired: false },
    trial: pending ? { state: "not_started", endsAt: null }
      : { state: endsAt && row?.createdAt ? resolveTrialLifecycle({ serverNow: now, startedAt: row.createdAt, endsAt }) : "revoked", endsAt },
  });
}

export async function assertExecutionAllowed(capability: ExecutionCapability, now = new Date()): Promise<void> {
  const identity = getRequestIdentity();
  let access: InstallationAccessMode;
  if (resolveRuntimeMode() === "user_home_server" && identity?.userId != null && isDbInitialized()) {
    const [actor] = await getDb().select({
      role: users.role, organizationId: users.organizationId, active: users.active,
      mustChangePassword: users.mustChangePassword, lockedUntil: users.lockedUntil,
    }).from(users).where(eq(users.id, identity.userId)).limit(1);
    if (!actor || CLIENT_ROLES.includes(actor.role as (typeof CLIENT_ROLES)[number])) {
      const current = actor?.active && !actor.mustChangePassword && (!actor.lockedUntil || actor.lockedUntil <= now)
        && actor.organizationId !== null && actor.organizationId === identity.organizationId;
      access = await resolveCustomerTrialAccess(current ? actor!.organizationId : null, now);
    } else {
      access = await resolveInstallationAccess(now);
    }
  } else {
    access = await resolveInstallationAccess(now);
  }
  if (access.mode === "read_only") throw new ReadOnlyModeError(access.reason, capability, access);
}

/** Answers a ReadOnlyModeError with the typed 402 body; returns false for any other error. */
export function respondReadOnly(res: Response, error: unknown): boolean {
  if (!isReadOnlyModeError(error)) return false;
  res.status(error.status).json(error.body());
  return true;
}

const REFUSED_METHODS: Record<string, true> = { POST: true, PUT: true, PATCH: true };
/** Withdrawing consent is never refused, whichever way the request is shaped. */
const ALWAYS_ALLOWED_PATHS: Record<string, true> = { "/api/setup/community-data-consent": true };
/** Only the existing cancellation endpoints may stop running work while the installation is read-only. */
function isExecutionCancellation(req: Request): boolean {
  return req.method === "POST"
    && /^\/api\/(?:calculation-jobs|quant-lab\/runs)\/[^/]+\/cancel\/?$/i.test(req.originalUrl.split("?")[0] ?? "");
}

/**
 * Express guard for route families that run analysis or create connections. Only signed-in, state-changing
 * requests are checked; reads, DELETE (removing a connection) and anonymous requests pass through untouched.
 */
export function guardExecutionRoutes(app: Express, prefixes: readonly string[], capability: ExecutionCapability): void {
  for (const prefix of prefixes) {
    app.use(prefix, (req: Request, res: Response, next: NextFunction) => {
      if (!REFUSED_METHODS[req.method] || !req.isAuthenticated?.() || ALWAYS_ALLOWED_PATHS[req.originalUrl.split("?")[0] ?? ""] || isExecutionCancellation(req)) return next();
      assertExecutionAllowed(capability).then(() => next(), (error) => {
        if (!respondReadOnly(res, error)) next(error);
      });
    });
  }
}
