/**
 * Real session-based authentication, replacing the old hardcoded email
 * allowlist + public 5-minute trial system. Every login now checks a real
 * password against the users table.
 *
 * One server exposes two hard-separated audiences: internal_* accounts use
 * the internal workstation surface; client_* accounts use the customer-safe
 * terminal bundle. Customer desktop builds may mirror a hosted client identity
 * locally, but hosted control-plane authentication remains authoritative.
 */
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import crypto from "node:crypto";
import type { Express, Request, Response, NextFunction } from "express";
import { getDb } from "./db";
import {
  users,
  organizations,
  organizationLicenses,
  domains,
  organizationDomains,
  INTERNAL_ROLES,
  CLIENT_ROLES,
  type User,
  type UserRole,
} from "@shared/schema";
import { checkPasswordPolicy } from "@shared/passwordPolicy";
import { DEFAULT_TRIAL_DAYS, TRIAL_PENDING_BILLING_STATE } from "@shared/commercialRuntime";
import { evaluateOrganizationAccess } from "./controlPlanePolicy";
import { recordAuditEvent } from "./auditEvents";
import {
  getDeviceAccessDecision,
  getOrganizationLicenseDecision,
  getOrganizationLicenseSummary,
  type OrganizationLicenseSummary,
} from "./controlPlaneService";
import { logClientAuditEvent } from "./clientAuditLog";
import { resolveLocalEffectiveAccess } from "./effectiveAccess";
import { evaluateCachedOfflineAccess } from "./offlineLeaseCache";
import { featureIsEntitled } from "@shared/identityContracts";
import { resolveSessionRestoration } from "./sessionRestoration";
import { getStoredEnterprisePolicy } from "./enterprisePolicyService";
import { resolveRuntimeMode } from "./runtimeMode";
import { readPrivateSecretFile } from "./privateSecretFile";
import { getSessionSecret } from "./sessionSecret";
import {
  OwnerBootstrapCredentialError,
  prepareOwnerSetupToken,
  removeOwnerSetupToken,
  verifyOwnerSetupToken,
} from "./ownerBootstrapCredential";

declare global {
  namespace Express {
    interface User extends Pick<import("@shared/schema").User, "id" | "email" | "role" | "organizationId" | "name" | "mustChangePassword"> {}
  }
}

// Brute-force protection: after this many wrong passwords in a row, the
// account is locked for LOCKOUT_MINUTES regardless of whether the next
// attempt would have been correct. Resets to 0 on any successful login.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;


/** One canonical account table and bootstrap route for Desktop Local and the user's server Home.
 * Server Homes accept only a fresh, empty user table; legacy-admin rotation stays desktop-only. */
export function isServerHomeOwnerBootstrapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveRuntimeMode(env) === "user_home_server";
}
export function isLocalRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveRuntimeMode(env) === "desktop_local";
}

export function isLocalAdminBootstrapEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return isLocalRuntime(env) && !env.DATABASE_URL?.trim();
}

const LEGACY_STANDARD_ADMIN_EMAIL = "admin@limuria.com";

type LocalAdminBootstrapState =
  | { required: false; mode: null; legacyAdmin: null }
  | { required: true; mode: "create"; legacyAdmin: null }
  | { required: true; mode: "rotate_legacy"; legacyAdmin: User };

function localAdminBootstrapState(admins: User[]): LocalAdminBootstrapState {
  const activeAdmins = admins.filter((admin) => admin.active);
  const nonLegacyAdmin = activeAdmins.find((admin) => admin.email.toLowerCase() !== LEGACY_STANDARD_ADMIN_EMAIL);
  if (nonLegacyAdmin) return { required: false, mode: null, legacyAdmin: null };
  const legacyAdmin = activeAdmins.find((admin) => admin.email.toLowerCase() === LEGACY_STANDARD_ADMIN_EMAIL);
  if (legacyAdmin) return { required: true, mode: "rotate_legacy", legacyAdmin };
  return { required: true, mode: "create", legacyAdmin: null };
}

async function getLocalAdminBootstrapState(): Promise<LocalAdminBootstrapState> {
  const admins = await getDb().select().from(users).where(eq(users.role, "internal_admin"));
  return localAdminBootstrapState(admins);
}

/** Browser-origin gate for first-owner setup. A remote Home needs real HTTPS (or an explicitly
 * trusted TLS-terminating proxy). Plain HTTP requires BOTH a loopback socket and a loopback
 * origin/Host: a reverse proxy on localhost must not make a remote HTTP page look local. */
export function isTrustedBootstrapOrigin(req: Request, serverHome: boolean): boolean {
  const origin = req.get("Origin");
  const host = req.get("Host");
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    if (origin !== parsed.origin || parsed.host !== host) return false;
    if (!serverHome) return parsed.protocol === "http:";
    if (parsed.protocol === "https:") return req.secure === true;
    const peer = req.socket.remoteAddress;
    const loopback = peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
    const localOrigin = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
    return parsed.protocol === "http:" && localOrigin && loopback && req.secure !== true;
  } catch {
    return false;
  }
}

// The desktop backend is one local process, but two renderer requests can
// still race during first launch. Serialize the one-time bootstrap operation
// so two tabs/windows cannot create two initial administrators.
let adminBootstrapInProgress = false;

export function canAuthenticateAccount(account: { active: boolean } | null | undefined): boolean {
  return account?.active === true;
}

export function hasFullClientAccess(organization: {
  status: string;
  lifecycleStage: "trial" | "client" | "churned";
} | null | undefined): boolean {
  return evaluateOrganizationAccess({
    organizationStatus: organization?.status,
    lifecycleStage: organization?.lifecycleStage,
  }).allowed;
}

export function configurePassport(): void {
  passport.use(new LocalStrategy(
    { usernameField: "email", passwordField: "password" },
    async (email, password, done) => {
      try {
        const db = getDb();
        const cleanEmail = email.trim().toLowerCase();
        const [user] = await db.select().from(users).where(eq(users.email, cleanEmail)).limit(1);

        if (!canAuthenticateAccount(user)) {
          return done(null, false, { message: "Invalid email or password." });
        }

        if (process.env.NODE_ENV === "production" && user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
          const minutesLeft = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
          return done(null, false, { message: `Too many failed attempts. Try again in ${minutesLeft} minute${minutesLeft === 1 ? "" : "s"}.` });
        }

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          const attempts = user.failedLoginAttempts + 1;
          const lockingNow = attempts >= MAX_FAILED_ATTEMPTS;
          await db.update(users).set({
            failedLoginAttempts: lockingNow ? 0 : attempts,
            lockedUntil: lockingNow ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
          }).where(eq(users.id, user.id));
          if (lockingNow) {
            await recordAuditEvent(user.id, "user_locked_out", { failedAttempts: attempts });
            return done(null, false, { message: `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.` });
          }
          return done(null, false, { message: "Invalid email or password." });
        }

        await db.update(users).set({ lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, user.id));
        return done(null, toSessionUser(user));
      } catch (err) {
        return done(err);
      }
    },
  ));

  passport.serializeUser((user: Express.User, done) => done(null, user.id));

  passport.deserializeUser(async (id: number, done) => {
    try {
      const db = getDb();
      const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!canAuthenticateAccount(user)) return done(null, false);
      done(null, toSessionUser(user));
    } catch (err) {
      done(err);
    }
  });
}

function toSessionUser(user: User): Express.User {
  return { id: user.id, email: user.email, role: user.role as UserRole, organizationId: user.organizationId, name: user.name, mustChangePassword: user.mustChangePassword };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: "Not signed in." });
}

export function requireInternal(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated() && INTERNAL_ROLES.includes(req.user!.role as (typeof INTERNAL_ROLES)[number])) {
    return next();
  }
  res.status(403).json({ error: "This terminal is restricted to internal accounts." });
}

/**
 * The Home owner may change what affects the whole install (licence, backups, which hold every organization's data).
 * That is an internal administrator everywhere, and additionally the customer administrator on a single-user
 * Desktop Local install, where that person is the owner. On a server Home a customer admin is one tenant among many.
 */
export function isHomeOwner(user: Pick<User, "role"> | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!user) return false;
  return user.role === "internal_admin" || (user.role === "client_admin" && resolveRuntimeMode(env) === "desktop_local");
}

export function requireHomeOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated() && isHomeOwner(req.user)) return next();
  res.status(403).json({ error: "Only the owner of this LiOS installation can do that." });
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.isAuthenticated() && roles.includes(req.user!.role as UserRole)) {
      return next();
    }
    res.status(403).json({ error: "You don't have permission to do that." });
  };
}

// The dashboard (Phase 3) only ever accepts client_* roles -- mirror image of
// requireInternal above. A client credential cannot reach internal-gated
// /api routes, and an internal credential cannot log into the dashboard
// (they use the terminal instead).
export function requireClient(req: Request, res: Response, next: NextFunction): void {
  if (req.isAuthenticated() && CLIENT_ROLES.includes(req.user!.role as (typeof CLIENT_ROLES)[number])) {
    return next();
  }
  res.status(403).json({ error: "Not signed in to the client dashboard." });
}
const DEVICE_BINDING_COOKIE = "lios_device_binding";
const DEVICE_BINDING_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function deviceBindingSecret(): string {
  return process.env.LIMURIA_DEVICE_BINDING_SECRET?.trim()
    || getSessionSecret();
}

function readCookie(req: Request, name: string): string | null {
  const cookieHeader = req.header("cookie");
  if (!cookieHeader) return null;
  const pair = cookieHeader.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return pair ? pair.slice(name.length + 1) : null;
}

function signDeviceToken(token: string): string {
  return crypto.createHmac("sha256", deviceBindingSecret()).update(token).digest("base64url");
}

function validDeviceToken(value: string | null): string | null {
  if (!value) return null;
  const [token, signature] = value.split(".");
  if (!token || !signature) return null;
  const expected = Buffer.from(signDeviceToken(token));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
  return token;
}

export function ensureDeviceBindingCookie(req: Request, res: Response): void {
  if (validDeviceToken(readCookie(req, DEVICE_BINDING_COOKIE))) return;
  const token = crypto.randomBytes(24).toString("base64url");
  const secure = req.secure || req.header("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";
  res.append("Set-Cookie", `${DEVICE_BINDING_COOKIE}=${token}.${signDeviceToken(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DEVICE_BINDING_MAX_AGE_SECONDS}${secure ? "; Secure" : ""}`);
}

function allowLegacyDeviceFingerprintHeader(): boolean {
  return process.env.NODE_ENV !== "production"
    && process.env.LIMURIA_ALLOW_LEGACY_DEVICE_FINGERPRINT_HEADER === "true";
}

export function deviceFingerprintHashFromRequest(req: Request): string | null {
  const desktopDeviceId = req.header("x-lios-desktop-device-id")?.trim();
  if (desktopDeviceId && desktopDeviceId.length >= 8 && desktopDeviceId.length <= 256) {
    return crypto.createHash("sha256").update(`desktop:${desktopDeviceId}`).digest("hex");
  }

  const token = validDeviceToken(readCookie(req, DEVICE_BINDING_COOKIE));
  if (token) return crypto.createHash("sha256").update(token).digest("hex");

  if (!allowLegacyDeviceFingerprintHeader()) return null;
  const fingerprint = req.header("x-lios-device-fingerprint")?.trim();
  return fingerprint && fingerprint.length >= 16 ? fingerprint : null;
}


// Current-client lifecycle gate shared by routes that require a converted,
// active client organization. Trial routes deliberately keep using
// requireTrialOrClient/requireClient and are not routed through this gate.
async function loadCurrentClientOrganization(req: Request, res: Response): Promise<typeof organizations.$inferSelect | null> {
  if (!req.isAuthenticated() || !CLIENT_ROLES.includes(req.user!.role as (typeof CLIENT_ROLES)[number])) {
    res.status(403).json({ error: "Not signed in to the client dashboard." });
    return null;
  }
  const orgId = req.user!.organizationId;
  if (orgId === null) {
    res.status(403).json({ error: "No organization associated." });
    return null;
  }

  const db = getDb();
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!hasFullClientAccess(org)) {
    res.status(403).json({ error: "This feature is available only to active client organizations." });
    return null;
  }
  return org;
}

export async function requireCurrentClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  const org = await loadCurrentClientOrganization(req, res);
  if (!org) return;
  next();
}

export async function requireFullClient(req: Request, res: Response, next: NextFunction): Promise<void> {
  const org = await loadCurrentClientOrganization(req, res);
  if (!org) return;
  const orgId = req.user!.organizationId!;
  const licenseDecision = await getOrganizationLicenseDecision(orgId);
  if (!licenseDecision.canUseEntitledFeatures) {
    res.status(403).json({ error: "Organization license does not allow this feature.", reason: licenseDecision.reason });
    return;
  }
  const deviceDecision = await getDeviceAccessDecision(orgId, deviceFingerprintHashFromRequest(req));
  if (!deviceDecision.allowed) {
    res.status(403).json({ error: "Device is not authorized for this organization.", reason: deviceDecision.reason });
    return;
  }

  next();
}

export function requireClientEntitlement(featureKey: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.isAuthenticated() || !CLIENT_ROLES.includes(req.user!.role as (typeof CLIENT_ROLES)[number])) {
      res.status(403).json({ error: "Not signed in to the client dashboard." });
      return;
    }
    const orgId = req.user!.organizationId;
    if (orgId === null) {
      res.status(403).json({ error: "No organization associated." });
      return;
    }
    const snapshot = await resolveLocalEffectiveAccess({
      user: req.user!,
      deviceFingerprintHash: deviceFingerprintHashFromRequest(req),
    });
    if (!featureIsEntitled(snapshot, featureKey)) {
      res.status(403).json({
        error: "Organization effective access does not include this feature.",
        featureKey,
        reason: "entitlement_missing",
        licenseReason: snapshot.license.reason,
        deviceReason: snapshot.deviceAccess.reason,
      });
      return;
    }
    next();
  };
}

// Session regeneration intentionally carries no caller-controlled session
// fields across authentication. Express preserves the cookie configuration
// while allocating a new session id; there is no pre-auth workflow state that
// needs to survive login.
function regenerateSessionForLogin(req: Request, callback: (err?: Error) => void): void {
  req.session.regenerate((err) => callback(err ?? undefined));
}

const ownerBootstrapInputSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(2).max(120),
  password: z.string(),
});
type OwnerBootstrapInput = z.infer<typeof ownerBootstrapInputSchema>;

export class OwnerBootstrapConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerBootstrapConflictError";
  }
}

/** One account-creation authority for desktop form, Home token and Home operator-secret modes.
 * The table lock serializes competing Home processes even when they share PostgreSQL but not a
 * local data root. Local PGlite supports the same lock, preserving legacy-admin rotation. */
export async function createBootstrapAdministrator(
  input: OwnerBootstrapInput,
  serverHome: boolean,
): Promise<{ administrator: User; rotatedLegacy: boolean }> {
  if (input.email === LEGACY_STANDARD_ADMIN_EMAIL) {
    throw new OwnerBootstrapConflictError("Choose an administrator email other than the legacy default.");
  }
  const policy = checkPasswordPolicy(input.password, { email: input.email, name: input.name });
  if (!policy.valid) throw new OwnerBootstrapCredentialError(policy.errors.join(" "));
  const passwordHash = await bcrypt.hash(input.password, 12);
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE "users" IN EXCLUSIVE MODE`);
    if (serverHome) {
      const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
      if (existing) throw new OwnerBootstrapConflictError("Accounts already exist. First-owner setup is closed.");
    }
    const admins = await tx.select().from(users).where(eq(users.role, "internal_admin"));
    const state = localAdminBootstrapState(admins);
    if (serverHome ? state.mode !== "create" : !state.required) {
      throw new OwnerBootstrapConflictError("An administrator already exists. Sign in with that account.");
    }
    const [emailOwner] = await tx.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
    if (emailOwner && emailOwner.id !== state.legacyAdmin?.id) {
      throw new OwnerBootstrapConflictError("That email address belongs to another LiOS account.");
    }
    const fields = {
      email: input.email,
      passwordHash,
      role: "internal_admin" as const,
      organizationId: null,
      name: input.name,
      active: true,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
    };
    const [administrator] = state.mode === "rotate_legacy" && state.legacyAdmin
      ? await tx.update(users).set(fields).where(eq(users.id, state.legacyAdmin.id)).returning()
      : await tx.insert(users).values(fields).returning();
    if (!administrator) throw new Error("Administrator account could not be created.");
    return { administrator, rotatedLegacy: state.mode === "rotate_legacy" };
  });
  await recordAuditEvent(result.administrator.id, result.rotatedLegacy ? "legacy_admin_rotated" : "initial_admin_created", {
    localFirstRun: !serverHome,
    serverHome,
    legacyCredentialRetired: result.rotatedLegacy,
  });
  return result;
}

/** Runs before listening. A Home with existing users cannot open a new first-owner enrollment. */
export async function initializeServerHomeOwner(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (!isServerHomeOwnerBootstrapEnabled(env)) return;
  const db = getDb();
  const [existing] = await db.select().from(users).limit(1);
  if (existing) {
    removeOwnerSetupToken();
    return;
  }

  const email = env.LIOS_OWNER_EMAIL?.trim().toLowerCase();
  const passwordFile = env.LIOS_OWNER_PASSWORD_FILE?.trim();
  if (email || passwordFile || env.LIOS_OWNER_NAME) {
    if (!email || !passwordFile) {
      throw new Error("LIOS_OWNER_EMAIL and LIOS_OWNER_PASSWORD_FILE must both be supplied for automated first-owner setup.");
    }
    const parsed = ownerBootstrapInputSchema.safeParse({
      email,
      name: env.LIOS_OWNER_NAME?.trim() || "LiOS Owner",
      password: readPrivateSecretFile(passwordFile, "owner password file (LIOS_OWNER_PASSWORD_FILE)"),
    });
    if (!parsed.success) throw new Error("Operator-supplied first-owner account does not meet the account policy.");
    await createBootstrapAdministrator(parsed.data, true);
    removeOwnerSetupToken();
    console.log("LiOS Home first owner created from an operator-supplied private password file.");
    return;
  }

  const setup = prepareOwnerSetupToken();
  if (setup.created) {
    // Print only on first generation; restarts reuse the 0600 token file without reprinting it.
    console.log(`LiOS Home one-time owner setup token: ${setup.token}`);
  }
  console.log("LiOS Home first-owner setup is ready. The token is in the private owner-setup.token file in the data root; use HTTPS to enter it (direct loopback HTTP is allowed).");
}

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/bootstrap/status", async (_req, res, next) => {
    try {
      if (isServerHomeOwnerBootstrapEnabled()) {
        const [existing] = await getDb().select({ id: users.id }).from(users).limit(1);
        return res.json({ setupRequired: !existing, setupAllowed: !existing, mode: existing ? null : "server_token" });
      }
      if (!isLocalAdminBootstrapEnabled()) return res.json({ setupRequired: false, setupAllowed: false });
      const state = await getLocalAdminBootstrapState();
      return res.json({ setupRequired: state.required, setupAllowed: state.required, mode: state.mode });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/auth/bootstrap/complete", async (req, res, next) => {
    const serverHome = isServerHomeOwnerBootstrapEnabled();
    if (!serverHome && !isLocalAdminBootstrapEnabled()) {
      return res.status(403).json({ error: "First-run administrator setup is not available in this runtime." });
    }
    if (!isTrustedBootstrapOrigin(req, serverHome)) {
      return res.status(403).json({ error: "First-owner setup requires a same-origin HTTPS request (or direct loopback HTTP)." });
    }
    if (adminBootstrapInProgress) {
      return res.status(409).json({ error: "Administrator setup is already in progress." });
    }

    adminBootstrapInProgress = true;
    try {
      if (serverHome) {
        const [existing] = await getDb().select({ id: users.id }).from(users).limit(1);
        if (existing) return res.status(409).json({ error: "Accounts already exist. First-owner setup is closed." });
        if (!verifyOwnerSetupToken(req.body?.setupToken)) {
          return res.status(403).json({ error: "The one-time setup token is invalid or expired. Find it in the Home data root; restart LiOS Home if it expired." });
        }
      } else {
        const state = await getLocalAdminBootstrapState();
        if (!state.required) return res.status(409).json({ error: "An administrator already exists. Sign in with that account." });
      }

      const parsed = ownerBootstrapInputSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "A valid email, name, and password are required." });
      const { administrator } = await createBootstrapAdministrator(parsed.data, serverHome);
      if (serverHome) {
        try { removeOwnerSetupToken(); }
        catch (error) { console.error("Could not remove the consumed owner setup token:", error instanceof Error ? error.message : error); }
      }
      const sessionUser = toSessionUser(administrator);
      await new Promise<void>((resolve, reject) => {
        regenerateSessionForLogin(req, (sessionErr) => {
          if (sessionErr) return reject(sessionErr);
          req.logIn(sessionUser, (loginErr) => loginErr ? reject(loginErr) : resolve());
        });
      });
      return res.status(201).json({
        success: true,
        user: {
          email: sessionUser.email,
          role: sessionUser.role,
          name: sessionUser.name,
          mustChangePassword: sessionUser.mustChangePassword,
        },
      });
    } catch (error) {
      if (error instanceof OwnerBootstrapConflictError) return res.status(409).json({ error: error.message });
      if (error instanceof OwnerBootstrapCredentialError) return res.status(400).json({ error: error.message });
      next(error);
    } finally {
      adminBootstrapInProgress = false;
    }
  });

  // One login for every account role. Internal and customer accounts share this stack; what a session may do is
  // decided by its role and entitlement on each route, not by which endpoint it came through.
  app.post("/api/auth/login", (req, res, next) => {
    const submittedEmail = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (isLocalRuntime() && submittedEmail === LEGACY_STANDARD_ADMIN_EMAIL) {
      return res.status(403).json({
        error: "The legacy local administrator identity has been retired. Complete secure administrator setup or use a current administrator account.",
        setupRequired: true,
      });
    }

    passport.authenticate("local", async (err: Error | null, user: Express.User | false, info: { message?: string }) => {
      try {
        if (err) return next(err);
        if (!user) return res.status(401).json({ error: info?.message ?? "Invalid email or password." });
        const customer = CLIENT_ROLES.includes(user.role as (typeof CLIENT_ROLES)[number]);
        if (customer && user.organizationId !== null) {
          const licenseDecision = await getOrganizationLicenseDecision(user.organizationId);
          if (!licenseDecision.canAuthenticate) {
            return res.status(403).json({ error: "Organization license does not allow login.", reason: licenseDecision.reason });
          }
        }
        regenerateSessionForLogin(req, (sessionErr) => {
          if (sessionErr) return next(sessionErr);
          req.logIn(user, (loginErr) => {
            if (loginErr) return next(loginErr);
            if (customer && user.organizationId !== null) {
              logClientAuditEvent({ organizationId: user.organizationId, userId: user.id, eventType: "login" });
            }
            res.json({ success: true, user: { email: user.email, role: user.role, name: user.name, mustChangePassword: user.mustChangePassword } });
          });
        });
      } catch (error) {
        next(error);
      }
    })(req, res, next);
  });

  app.post("/api/auth/logout", (req, res, next) => {
    const user = req.user;
    req.logout((err) => {
      if (err) return next(err);
      if (user && CLIENT_ROLES.includes(user.role as (typeof CLIENT_ROLES)[number]) && user.organizationId !== null) {
        logClientAuditEvent({ organizationId: user.organizationId, userId: user.id, eventType: "logout" });
      }
      res.json({ success: true });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: "Not signed in." });
    const user = req.user!;
    const db = getDb();
    let organizationName: string | null = null;
    // The customer shell reads these from the session response (no second round trip) to choose the trial or full
    // dashboard and to show a billing/grace banner when the licence state needs attention.
    let lifecycleStage: "trial" | "client" | "churned" | null = null;
    let license: OrganizationLicenseSummary | null = null;
    if (user.organizationId) {
      const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
      organizationName = org?.name ?? null;
      lifecycleStage = org?.lifecycleStage ?? null;
      license = await getOrganizationLicenseSummary(user.organizationId);
    }
    const access = await resolveLocalEffectiveAccess({ user, deviceFingerprintHash: deviceFingerprintHashFromRequest(req) });
    res.json({
      email: user.email,
      role: user.role,
      name: user.name,
      mustChangePassword: user.mustChangePassword,
      organizationId: user.organizationId,
      organizationName,
      lifecycleStage,
      licenseStatus: license?.status ?? null,
      licenseReason: license?.reason ?? null,
      licenseGraceEndsAt: license?.graceEndsAt ? license.graceEndsAt.toISOString() : null,
      authState: resolveSessionRestoration({ authenticated: true, user }),
      access,
    });
  });

  // Self-serve local trial account (desktop_local by default; see selfServeTrialsEnabled).
  app.post("/api/auth/register", async (req, res, next) => {
    const parsed = z.object({
      email: z.string().trim().toLowerCase().email(),
      password: z.string(),
      name: z.string().trim().min(2).max(120),
      organizationName: z.string().trim().min(2).max(160).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Valid account details are required." });
      return;
    }

    if (!selfServeTrialsEnabled()) {
      res.status(403).json({ error: "Self-serve LiOS trial enrollment is not enabled on this deployment." });
      return;
    }

    const passwordPolicy = checkPasswordPolicy(parsed.data.password, {
      email: parsed.data.email,
      name: parsed.data.name,
    });
    if (!passwordPolicy.valid) {
      res.status(400).json({ error: passwordPolicy.errors.join(" ") });
      return;
    }

    const db = getDb();
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email)).limit(1);
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists. Sign in instead." });
      return;
    }

    // The trial belongs to the installation, not to an account: once its clock has run out without a licence, a new
    // registration cannot restart it.
    const licensed = evaluateCachedOfflineAccess().allowed;
    const [trialStarted] = await db.select({ endsAt: organizationLicenses.trialEndsAt }).from(organizationLicenses)
      .where(and(eq(organizationLicenses.billingState, "trial"), isNotNull(organizationLicenses.trialEndsAt)))
      .orderBy(asc(organizationLicenses.trialEndsAt)).limit(1);
    if (!licensed && trialStarted?.endsAt && trialStarted.endsAt.getTime() < Date.now()) {
      res.status(402).json({ error: "The trial on this installation has ended. Import a LiOS licence to create more client accounts." });
      return;
    }

    const [financeDomain] = await db.select().from(domains).where(eq(domains.slug, "finance")).limit(1);
    if (!financeDomain) {
      res.status(503).json({ error: "LiOS trial enrollment is temporarily unavailable." });
      return;
    }

    const organizationName = parsed.data.organizationName || `${parsed.data.name}'s LiOS Workspace`;
    const slug = `trial-${crypto.randomBytes(12).toString("hex")}`;
    let organization: typeof organizations.$inferSelect | undefined;
    let createdUser: User | undefined;
    try {
      [organization] = await db.insert(organizations).values({
        name: organizationName,
        slug,
        status: "active",
        lifecycleStage: "trial",
      }).returning();

      const passwordHash = await bcrypt.hash(parsed.data.password, 12);
      [createdUser] = await db.insert(users).values({
        email: parsed.data.email,
        passwordHash,
        role: "client_admin",
        organizationId: organization.id,
        name: parsed.data.name,
        active: true,
        mustChangePassword: false,
      }).returning();

      await db.insert(organizationDomains).values({
        organizationId: organization.id,
        domainId: financeDomain.id,
      }).onConflictDoNothing();

      await db.insert(organizationLicenses).values({
        organizationId: organization.id,
        planId: null,
        status: "active",
        seatsPurchased: 1,
        // The owner chooses next: "Start 7-day trial" (POST /api/license/trial/start) or enter a licence key.
        // Until then the install is read-only and no trial clock runs.
        billingState: TRIAL_PENDING_BILLING_STATE,
        trialEndsAt: null,
      });

      await recordAuditEvent(createdUser.id, "self_serve_trial_registered", {
        organizationId: organization.id,
        trialDays: DEFAULT_TRIAL_DAYS,
        trialStarted: false,
      });
    } catch (error) {
      if (organization) {
        try { await db.delete(organizationLicenses).where(eq(organizationLicenses.organizationId, organization.id)); } catch {}
        try { await db.delete(organizationDomains).where(eq(organizationDomains.organizationId, organization.id)); } catch {}
      }
      if (createdUser) {
        try { await db.delete(users).where(eq(users.id, createdUser.id)); } catch {}
      }
      if (organization) {
        try { await db.delete(organizations).where(eq(organizations.id, organization.id)); } catch {}
      }
      next(error);
      return;
    }

    const sessionUser = toSessionUser(createdUser);
    regenerateSessionForLogin(req, (sessionErr) => {
      if (sessionErr) return next(sessionErr);
      req.logIn(sessionUser, (loginErr) => {
        if (loginErr) return next(loginErr);
        res.status(201).json({
          success: true,
          user: {
            email: sessionUser.email,
            role: sessionUser.role,
            name: sessionUser.name,
          },
        });
      });
    });
  });

  // Self-service permanent-password flow: turns an admin-generated temp
  // password into one the user actually chose. Requires the current
  // password (proves the session hasn't been hijacked, not just that a
  // cookie exists), and the new one must clear the shared policy -- same
  // check used for the strength meter on the client, re-verified here since
  // the client check is only a UX convenience.
  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    const parsed = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "A current and new password are required." });

    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.id, req.user!.id)).limit(1);
    if (!user) return res.status(404).json({ error: "User not found." });

    const currentValid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
    if (!currentValid) return res.status(401).json({ error: "Current password is incorrect." });

    const policy = checkPasswordPolicy(parsed.data.newPassword, { email: user.email, name: user.name });
    if (!policy.valid) return res.status(400).json({ error: policy.errors.join(" ") });

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await db.update(users).set({ passwordHash, mustChangePassword: false }).where(eq(users.id, user.id));
    await recordAuditEvent(user.id, "user_password_changed", { selfService: true });
    res.json({ success: true });
  });
}

export function selfServeTrialsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = (env.LIOS_SELF_SERVE_TRIALS ?? "").trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  // Desktop Local is a one-person install: its customer terminal has no other way to obtain an account now that no
  // hosted service signs people up, so the local trial is on by default. A server Home stays opt-in.
  return env.NODE_ENV === "development" || resolveRuntimeMode(env) === "desktop_local";
}

// Separate login surface for client_admin/client_user accounts. Accounts live in this Home's own database; nothing
// is verified by a LiOS-operated service. Entitlement comes from the local trial clock or an imported licence file.
export function registerClientAuthRoutes(app: Express): void {
  app.get("/api/client/control-plane/enterprise-policy", requireClient, async (req, res) => {
    const organizationId = req.user!.organizationId;
    if (!organizationId) {
      res.status(403).json({ error: "A client organization is required." });
      return;
    }
    const record = await getStoredEnterprisePolicy(organizationId);
    res.setHeader("Cache-Control", "no-store");
    res.json({
      policy: record?.policy ?? null,
      revision: record?.revision ?? null,
      updatedAt: record?.updatedAt?.toISOString() ?? null,
    });
  });

  app.get("/api/client/control-plane/snapshot", requireClient, async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await resolveLocalEffectiveAccess({
        user: req.user!,
        deviceFingerprintHash: deviceFingerprintHashFromRequest(req),
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/client/control-plane/access", requireClient, async (req, res) => {
    const user = req.user!;
    if (!user.organizationId) {
      res.json({ allowed: false, reason: "organization_missing" });
      return;
    }
    const db = getDb();
    const [organization] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId)).limit(1);
    if (!hasFullClientAccess(organization)) {
      res.json({ allowed: false, reason: "organization_not_client" });
      return;
    }

    const snapshot = await resolveLocalEffectiveAccess({
      user,
      deviceFingerprintHash: deviceFingerprintHashFromRequest(req),
    });
    if (!snapshot.license.canUseEntitledFeatures) {
      res.json({ allowed: false, reason: "license_blocked", licenseReason: snapshot.license.reason });
      return;
    }
    if (!snapshot.deviceAccess.allowed) {
      res.json({ allowed: false, reason: "device_blocked", licenseReason: snapshot.license.reason, deviceReason: snapshot.deviceAccess.reason });
      return;
    }

    const featureKey = typeof req.query.featureKey === "string" ? req.query.featureKey : undefined;
    if (featureKey && !featureIsEntitled(snapshot, featureKey)) {
      res.json({
        allowed: false,
        reason: "feature_blocked",
        licenseReason: snapshot.license.reason,
        deviceReason: snapshot.deviceAccess.reason,
        featureReason: "entitlement_missing",
      });
      return;
    }
    res.json({
      allowed: true,
      reason: "authorized",
      licenseReason: snapshot.license.reason,
      deviceReason: snapshot.deviceAccess.reason,
      ...(featureKey ? { featureReason: "entitlement_granted" } : {}),
    });
  });
}
