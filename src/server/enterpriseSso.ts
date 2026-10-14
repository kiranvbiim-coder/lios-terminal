import crypto from "node:crypto";
import { deflateRawSync } from "node:zlib";
import bcrypt from "bcryptjs";
import { and, eq, gt, lt } from "drizzle-orm";
import type { Express, Request, Response, NextFunction } from "express";
import { getDb } from "./db";
import { enterpriseSamlRequests, enterpriseSsoDeviceAuthorizations, organizationEnterprisePolicies, organizations, users, type User } from "@shared/schema";
import { normalizeEnterprisePolicy } from "@shared/enterpriseContracts";
import { getEnterprisePolicy } from "./enterprisePolicyService";
import { getOrganizationCredential } from "./organizationCredentialVault";
import { getOrganizationLicenseDecision } from "./controlPlaneService";
import { recordSecurityAuditEvent, auditActor } from "./auditEvents";

declare module "express-session" {
  interface SessionData {
    liosEnterpriseSso?: EnterpriseSsoTransient;
  }
}

const SSO_TTL_MS = 10 * 60 * 1000;
const CLOCK_SKEW_SECONDS = 120;
const SSO_CLIENT_SECRET_CREDENTIAL = "enterprise_sso_client_secret";
const SAML_VERIFIER_SECRET_CREDENTIAL = "enterprise_saml_verifier_secret";

type SsoProtocol = "oidc" | "saml";

interface EnterpriseSsoTransient {
  organizationId: number;
  protocol: SsoProtocol;
  state: string;
  nonce?: string;
  codeVerifier?: string;
  requestId?: string;
  deviceRequestId?: string;
  returnTo: string;
  createdAt: number;
}

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface OidcTokenResponse {
  id_token?: string;
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface EnterpriseIdentity {
  subject: string;
  email: string;
  name: string;
  emailVerified: boolean;
}

type OidcJwk = import("node:crypto").JsonWebKey & { kid?: string; use?: string; alg?: string };

interface SamlVerifierResponse extends EnterpriseIdentity {
  valid: boolean;
  issuer: string;
  audience: string;
  inResponseTo?: string | null;
}

export class EnterpriseSsoError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "EnterpriseSsoError";
    this.status = status;
    this.code = code;
  }
}

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function verifierHash(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("hex");
}


function samlRelayMacInput(organizationId: number, requestId: string, expiresAtSeconds: number): string {
  return `saml-relay-v1:${organizationId}:${requestId}:${expiresAtSeconds}`;
}

export function signEnterpriseSamlRelayState(input: {
  organizationId: number;
  requestId: string;
  expiresAt: Date;
  secret: string;
}): string {
  if (!Number.isInteger(input.organizationId) || input.organizationId <= 0) {
    throw new EnterpriseSsoError(500, "saml_relay_invalid", "SAML RelayState organization is invalid.");
  }
  if (!/^_lios_[A-Za-z0-9_-]{16,128}$/.test(input.requestId)) {
    throw new EnterpriseSsoError(500, "saml_relay_invalid", "SAML RelayState request ID is invalid.");
  }
  if (input.secret.length < 24) {
    throw new EnterpriseSsoError(503, "saml_verifier_secret_missing", "Organization SAML verifier secret is not configured.");
  }
  const expiresAtSeconds = Math.floor(input.expiresAt.getTime() / 1000);
  const signature = crypto.createHmac("sha256", input.secret)
    .update(samlRelayMacInput(input.organizationId, input.requestId, expiresAtSeconds))
    .digest("base64url");
  return `v1.${input.requestId}.${expiresAtSeconds}.${signature}`;
}

export function verifyEnterpriseSamlRelayState(input: {
  organizationId: number;
  relayState: string;
  secret: string;
  now?: Date;
}): { requestId: string; expiresAt: Date } {
  const match = /^v1\.(_lios_[A-Za-z0-9_-]{16,128})\.(\d{10,13})\.([A-Za-z0-9_-]{43})$/.exec(input.relayState);
  if (!match) throw new EnterpriseSsoError(401, "saml_relay_invalid", "SAML RelayState is malformed.");
  const requestId = match[1];
  const expiresAtSeconds = Number(match[2]);
  const supplied = Buffer.from(match[3]);
  const expectedText = crypto.createHmac("sha256", input.secret)
    .update(samlRelayMacInput(input.organizationId, requestId, expiresAtSeconds))
    .digest("base64url");
  const expected = Buffer.from(expectedText);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new EnterpriseSsoError(401, "saml_relay_invalid", "SAML RelayState authentication failed.");
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const expiresAtMs = expiresAtSeconds * 1000;
  if (!Number.isFinite(expiresAtMs)
      || expiresAtMs < nowMs - CLOCK_SKEW_SECONDS * 1000
      || expiresAtMs > nowMs + SSO_TTL_MS + CLOCK_SKEW_SECONDS * 1000) {
    throw new EnterpriseSsoError(401, "saml_relay_expired", "SAML RelayState is expired or outside the allowed authentication window.");
  }
  return { requestId, expiresAt: new Date(expiresAtMs) };
}

async function claimEnterpriseSamlRequest(
  organizationId: number,
  relayState: string,
  secret: string,
): Promise<typeof enterpriseSamlRequests.$inferSelect> {
  const verifiedRelay = verifyEnterpriseSamlRelayState({ organizationId, relayState, secret });
  const now = new Date();
  const [row] = await getDb().update(enterpriseSamlRequests).set({
    status: "processing",
    claimedAt: now,
  }).where(and(
    eq(enterpriseSamlRequests.id, verifiedRelay.requestId),
    eq(enterpriseSamlRequests.organizationId, organizationId),
    eq(enterpriseSamlRequests.status, "pending"),
    gt(enterpriseSamlRequests.expiresAt, now),
  )).returning();
  if (!row) {
    throw new EnterpriseSsoError(409, "saml_request_replayed", "SAML authentication request is expired, already in progress, or already consumed.");
  }
  if (Math.abs(row.expiresAt.getTime() - verifiedRelay.expiresAt.getTime()) > 1_500) {
    await getDb().update(enterpriseSamlRequests).set({ status: "expired" })
      .where(eq(enterpriseSamlRequests.id, row.id));
    throw new EnterpriseSsoError(401, "saml_relay_mismatch", "SAML RelayState expiry does not match server request state.");
  }
  return row;
}

async function restoreEnterpriseSamlRequest(requestId: string, organizationId: number): Promise<void> {
  const now = new Date();
  await getDb().update(enterpriseSamlRequests).set({
    status: "pending",
    claimedAt: null,
  }).where(and(
    eq(enterpriseSamlRequests.id, requestId),
    eq(enterpriseSamlRequests.organizationId, organizationId),
    eq(enterpriseSamlRequests.status, "processing"),
    gt(enterpriseSamlRequests.expiresAt, now),
  ));
}

async function consumeEnterpriseSamlRequest(requestId: string, organizationId: number): Promise<void> {
  const now = new Date();
  const [consumed] = await getDb().update(enterpriseSamlRequests).set({
    status: "consumed",
    consumedAt: now,
  }).where(and(
    eq(enterpriseSamlRequests.id, requestId),
    eq(enterpriseSamlRequests.organizationId, organizationId),
    eq(enterpriseSamlRequests.status, "processing"),
    gt(enterpriseSamlRequests.expiresAt, now),
  )).returning();
  if (!consumed) {
    throw new EnterpriseSsoError(409, "saml_request_replayed", "SAML authentication request could not be consumed safely.");
  }
}

async function discoverEnterpriseSsoOrganization(emailInput: string): Promise<number> {
  const email = emailInput.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new EnterpriseSsoError(400, "sso_email_invalid", "A valid work email is required.");
  }
  const db = getDb();
  const [existing] = await db.select({
    organizationId: users.organizationId,
    role: users.role,
    active: users.active,
  }).from(users).where(eq(users.email, email)).limit(1);
  if (existing?.active && existing.organizationId && (existing.role === "client_admin" || existing.role === "client_user")) {
    const record = await getEnterprisePolicy(existing.organizationId);
    if (record && record.policy.sso.mode !== "disabled" && record.policy.sso.status === "ready") {
      return existing.organizationId;
    }
  }

  const domain = email.split("@")[1] ?? "";
  const candidates = await db.select({
    organizationId: organizationEnterprisePolicies.organizationId,
    policy: organizationEnterprisePolicies.policy,
    organizationStatus: organizations.status,
  }).from(organizationEnterprisePolicies)
    .innerJoin(organizations, eq(organizations.id, organizationEnterprisePolicies.organizationId));
  const matches = candidates.filter((candidate) => {
    if (candidate.organizationStatus !== "active") return false;
    const policy = normalizeEnterprisePolicy(candidate.policy);
    return policy.sso.mode !== "disabled"
      && policy.sso.status === "ready"
      && policy.sso.externalProvisioning
      && policy.seats.allowedEmailDomains.some((allowed) => allowed.trim().toLowerCase() === domain);
  });
  if (matches.length !== 1) {
    throw new EnterpriseSsoError(404, "sso_not_available", "Enterprise SSO is not available for this work email.");
  }
  return matches[0].organizationId;
}

async function deviceRequest(
  requestId: string,
  organizationId?: number,
): Promise<typeof enterpriseSsoDeviceAuthorizations.$inferSelect | null> {
  const db = getDb();
  const [row] = organizationId
    ? await db.select().from(enterpriseSsoDeviceAuthorizations).where(and(
        eq(enterpriseSsoDeviceAuthorizations.id, requestId),
        eq(enterpriseSsoDeviceAuthorizations.organizationId, organizationId),
      )).limit(1)
    : await db.select().from(enterpriseSsoDeviceAuthorizations).where(eq(enterpriseSsoDeviceAuthorizations.id, requestId)).limit(1);
  return row ?? null;
}

async function requirePendingDeviceRequest(requestId: string, organizationId: number): Promise<void> {
  const row = await deviceRequest(requestId, organizationId);
  if (!row || row.status !== "pending" || row.expiresAt.getTime() <= Date.now()) {
    throw new EnterpriseSsoError(410, "sso_device_request_expired", "Desktop SSO authorization request is invalid or expired.");
  }
}

async function approveDeviceRequest(requestId: string | undefined, organizationId: number, userId: number): Promise<void> {
  if (!requestId) return;
  const now = new Date();
  const [approved] = await getDb().update(enterpriseSsoDeviceAuthorizations).set({
    status: "approved",
    userId,
    approvedAt: now,
  }).where(and(
    eq(enterpriseSsoDeviceAuthorizations.id, requestId),
    eq(enterpriseSsoDeviceAuthorizations.organizationId, organizationId),
    eq(enterpriseSsoDeviceAuthorizations.status, "pending"),
    gt(enterpriseSsoDeviceAuthorizations.expiresAt, now),
  )).returning();
  if (!approved) throw new EnterpriseSsoError(410, "sso_device_request_expired", "Desktop SSO authorization request expired before approval.");
}

export async function createEnterpriseSsoDeviceAuthorization(req: Request, email: string): Promise<{
  requestId: string;
  verifier: string;
  verificationUrl: string;
  expiresAt: string;
}> {
  const organizationId = await discoverEnterpriseSsoOrganization(email);
  await loadSsoPolicy(organizationId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SSO_TTL_MS);
  const requestId = `sso-device:${crypto.randomUUID()}`;
  const verifier = randomToken(32);
  await getDb().delete(enterpriseSsoDeviceAuthorizations).where(lt(enterpriseSsoDeviceAuthorizations.expiresAt, now));
  await getDb().insert(enterpriseSsoDeviceAuthorizations).values({
    id: requestId,
    organizationId,
    verifierHash: verifierHash(verifier),
    status: "pending",
    createdAt: now,
    expiresAt,
  });
  const verificationUrl = new URL(`/api/client/auth/sso/${organizationId}/start`, hostedBaseUrl(req));
  verificationUrl.searchParams.set("deviceRequest", requestId);
  verificationUrl.searchParams.set("returnTo", "/#/sso-complete");
  return { requestId, verifier, verificationUrl: verificationUrl.toString(), expiresAt: expiresAt.toISOString() };
}

export async function pollEnterpriseSsoDeviceAuthorization(req: Request, requestId: string, verifier: string): Promise<{
  status: "pending" | "authenticated";
  user?: User;
}> {
  const row = await deviceRequest(requestId);
  if (!row) throw new EnterpriseSsoError(404, "sso_device_request_not_found", "Desktop SSO authorization request was not found.");
  const suppliedHash = verifierHash(verifier);
  const expected = Buffer.from(row.verifierHash);
  const supplied = Buffer.from(suppliedHash);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    throw new EnterpriseSsoError(401, "sso_device_verifier_invalid", "Desktop SSO authorization verifier is invalid.");
  }
  const now = new Date();
  if (row.expiresAt.getTime() <= now.getTime()) {
    if (row.status !== "consumed") {
      await getDb().update(enterpriseSsoDeviceAuthorizations).set({ status: "expired" })
        .where(eq(enterpriseSsoDeviceAuthorizations.id, requestId));
    }
    throw new EnterpriseSsoError(410, "sso_device_request_expired", "Desktop SSO authorization request has expired.");
  }
  if (row.status === "pending") return { status: "pending" };
  if (row.status !== "approved" || !row.userId) {
    throw new EnterpriseSsoError(410, "sso_device_request_consumed", "Desktop SSO authorization request is no longer usable.");
  }

  const [claimed] = await getDb().update(enterpriseSsoDeviceAuthorizations).set({
    status: "consumed",
    consumedAt: now,
  }).where(and(
    eq(enterpriseSsoDeviceAuthorizations.id, requestId),
    eq(enterpriseSsoDeviceAuthorizations.status, "approved"),
    gt(enterpriseSsoDeviceAuthorizations.expiresAt, now),
  )).returning();
  if (!claimed?.userId) throw new EnterpriseSsoError(409, "sso_device_request_raced", "Desktop SSO authorization was already consumed.");

  const [user] = await getDb().select().from(users).where(eq(users.id, claimed.userId)).limit(1);
  if (!user || !user.active || user.organizationId !== row.organizationId) {
    throw new EnterpriseSsoError(403, "sso_device_user_invalid", "Approved enterprise user is no longer active.");
  }
  const { policy } = await loadSsoPolicy(row.organizationId);
  try {
    await establishSession(req, user, row.organizationId, policy.sso.mode as SsoProtocol);
    return { status: "authenticated", user };
  } catch (error) {
    // A session-store or durable-audit failure must not burn the one-time
    // device approval. Restore it only if this call still owns the consumed
    // state and the ticket remains inside its original expiry window.
    await getDb().update(enterpriseSsoDeviceAuthorizations).set({
      status: "approved",
      consumedAt: null,
    }).where(and(
      eq(enterpriseSsoDeviceAuthorizations.id, requestId),
      eq(enterpriseSsoDeviceAuthorizations.status, "consumed"),
      gt(enterpriseSsoDeviceAuthorizations.expiresAt, new Date()),
    ));
    throw error;
  }
}

function safeReturnTo(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.length > 500 || /[\r\n]/.test(value)) return "/";
  return value;
}

function secureUrl(value: string, label: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EnterpriseSsoError(503, "sso_configuration_invalid", `${label} is not a valid URL.`);
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local && url.protocol === "http:")) {
    throw new EnterpriseSsoError(503, "sso_configuration_invalid", `${label} must use HTTPS.`);
  }
  if (url.username || url.password) throw new EnterpriseSsoError(503, "sso_configuration_invalid", `${label} must not contain credentials.`);
  return url;
}

function hostedBaseUrl(req: Request): URL {
  const configured = process.env.LIOS_HOME_PUBLIC_URL?.trim();
  if (configured) return secureUrl(configured, "LIOS_HOME_PUBLIC_URL");
  if (process.env.NODE_ENV === "production") {
    throw new EnterpriseSsoError(503, "sso_public_url_missing", "LIOS_HOME_PUBLIC_URL (this Home's public https origin) is required for enterprise SSO.");
  }
  const proto = req.get("x-forwarded-proto")?.split(",")[0]?.trim() || (req.secure ? "https" : "http");
  const host = req.get("host");
  if (!host) throw new EnterpriseSsoError(503, "sso_public_url_missing", "Request host is unavailable.");
  return secureUrl(`${proto}://${host}/`, "request origin");
}

function callbackUrl(req: Request, organizationId: number, protocol: SsoProtocol): string {
  const path = protocol === "oidc"
    ? `/api/client/auth/sso/${organizationId}/callback`
    : `/api/client/auth/sso/${organizationId}/saml/acs`;
  return new URL(path, hostedBaseUrl(req)).toString();
}

async function loadSsoPolicy(organizationId: number, expected?: SsoProtocol) {
  const record = await getEnterprisePolicy(organizationId);
  if (!record) throw new EnterpriseSsoError(404, "organization_not_found", "Organization not found.");
  const policy = record.policy;
  if (policy.sso.mode === "disabled") throw new EnterpriseSsoError(409, "sso_disabled", "Enterprise SSO is disabled for this organization.");
  if (expected && policy.sso.mode !== expected) throw new EnterpriseSsoError(409, "sso_protocol_mismatch", `Organization SSO is configured for ${policy.sso.mode}.`);
  if (policy.sso.status !== "ready") throw new EnterpriseSsoError(409, "sso_not_ready", "Enterprise SSO configuration is not marked ready.");
  if (!policy.sso.issuer || !policy.sso.clientId) throw new EnterpriseSsoError(503, "sso_configuration_incomplete", "SSO issuer and client ID/entity ID are required.");
  return { record, policy };
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: globalThis.Response;
  try {
    response = await fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(10_000) });
  } catch {
    throw new EnterpriseSsoError(502, "sso_upstream_unreachable", "Enterprise identity provider is unreachable.");
  }
  if (!response.ok) throw new EnterpriseSsoError(502, "sso_upstream_error", `Enterprise identity provider returned HTTP ${response.status}.`);
  try {
    return await response.json() as T;
  } catch {
    throw new EnterpriseSsoError(502, "sso_upstream_invalid", "Enterprise identity provider returned invalid JSON.");
  }
}

export async function discoverOidc(issuer: string): Promise<OidcDiscovery> {
  const issuerUrl = secureUrl(issuer, "OIDC issuer");
  const discoveryUrl = `${issuerUrl.toString().replace(/\/$/, "")}/.well-known/openid-configuration`;
  const metadata = await fetchJson<Partial<OidcDiscovery>>(discoveryUrl);
  if (!metadata.issuer || !metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.jwks_uri) {
    throw new EnterpriseSsoError(502, "oidc_discovery_invalid", "OIDC discovery metadata is incomplete.");
  }
  if (metadata.issuer.replace(/\/$/, "") !== issuerUrl.toString().replace(/\/$/, "")) {
    throw new EnterpriseSsoError(502, "oidc_issuer_mismatch", "OIDC discovery issuer does not match organization policy.");
  }
  secureUrl(metadata.authorization_endpoint, "OIDC authorization endpoint");
  secureUrl(metadata.token_endpoint, "OIDC token endpoint");
  secureUrl(metadata.jwks_uri, "OIDC JWKS endpoint");
  return metadata as OidcDiscovery;
}

function base64UrlJson<T>(segment: string): T {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
  } catch {
    throw new EnterpriseSsoError(401, "oidc_token_invalid", "OIDC ID token is malformed.");
  }
}

function verifyJwtSignature(signingInput: string, signature: Buffer, jwk: OidcJwk, alg: string): boolean {
  const hashes: Record<string, string> = {
    RS256: "RSA-SHA256", RS384: "RSA-SHA384", RS512: "RSA-SHA512",
    ES256: "SHA256", ES384: "SHA384", ES512: "SHA512",
  };
  const algorithm = hashes[alg];
  if (!algorithm) throw new EnterpriseSsoError(401, "oidc_alg_rejected", `Unsupported OIDC signing algorithm ${alg}.`);
  try {
    const key = crypto.createPublicKey({ key: jwk, format: "jwk" });
    return crypto.verify(
      algorithm,
      Buffer.from(signingInput),
      alg.startsWith("ES") ? { key, dsaEncoding: "ieee-p1363" } : key,
      signature,
    );
  } catch {
    return false;
  }
}

export async function validateOidcIdToken(input: {
  idToken: string;
  issuer: string;
  clientId: string;
  nonce: string;
  jwksUri: string;
  now?: Date;
}): Promise<EnterpriseIdentity> {
  const parts = input.idToken.split(".");
  if (parts.length !== 3) throw new EnterpriseSsoError(401, "oidc_token_invalid", "OIDC ID token is malformed.");
  const header = base64UrlJson<{ alg?: string; kid?: string; typ?: string }>(parts[0]);
  const claims = base64UrlJson<Record<string, unknown>>(parts[1]);
  if (!header.alg || header.alg === "none" || !header.kid) throw new EnterpriseSsoError(401, "oidc_token_invalid", "OIDC ID token signing metadata is incomplete.");

  const jwks = await fetchJson<{ keys?: OidcJwk[] }>(secureUrl(input.jwksUri, "OIDC JWKS endpoint").toString());
  const key = jwks.keys?.find((candidate) => candidate.kid === header.kid && (!candidate.use || candidate.use === "sig"));
  if (!key) throw new EnterpriseSsoError(401, "oidc_key_not_found", "OIDC signing key was not found.");

  const signingInput = `${parts[0]}.${parts[1]}`;
  if (!verifyJwtSignature(signingInput, Buffer.from(parts[2], "base64url"), key, header.alg)) {
    throw new EnterpriseSsoError(401, "oidc_signature_invalid", "OIDC ID token signature validation failed.");
  }

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const issuer = typeof claims.iss === "string" ? claims.iss : "";
  const audience = Array.isArray(claims.aud) ? claims.aud.filter((v): v is string => typeof v === "string") : typeof claims.aud === "string" ? [claims.aud] : [];
  if (issuer.replace(/\/$/, "") !== input.issuer.replace(/\/$/, "")) throw new EnterpriseSsoError(401, "oidc_issuer_mismatch", "OIDC token issuer mismatch.");
  if (!audience.includes(input.clientId)) throw new EnterpriseSsoError(401, "oidc_audience_mismatch", "OIDC token audience mismatch.");
  if (audience.length > 1 && claims.azp !== input.clientId) throw new EnterpriseSsoError(401, "oidc_authorized_party_mismatch", "OIDC token authorized-party mismatch.");
  if (claims.nonce !== input.nonce) throw new EnterpriseSsoError(401, "oidc_nonce_mismatch", "OIDC nonce validation failed.");
  if (typeof claims.exp !== "number" || claims.exp < nowSeconds - CLOCK_SKEW_SECONDS) throw new EnterpriseSsoError(401, "oidc_token_expired", "OIDC ID token has expired.");
  if (typeof claims.iat === "number" && claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) throw new EnterpriseSsoError(401, "oidc_token_future", "OIDC ID token issue time is invalid.");

  const subject = typeof claims.sub === "string" ? claims.sub : "";
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim() : email;
  const emailVerified = claims.email_verified !== false;
  if (!subject || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new EnterpriseSsoError(401, "oidc_identity_incomplete", "OIDC identity is missing a valid subject or email.");
  if (!emailVerified) throw new EnterpriseSsoError(403, "oidc_email_unverified", "Enterprise identity email is not verified.");
  return { subject, email, name, emailVerified };
}

async function provisionEnterpriseUser(organizationId: number, identity: EnterpriseIdentity): Promise<User> {
  const { policy } = await loadSsoPolicy(organizationId);
  const domain = identity.email.split("@")[1]?.toLowerCase() ?? "";
  if (policy.seats.allowedEmailDomains.length > 0 && !policy.seats.allowedEmailDomains.some((allowed) => allowed.toLowerCase() === domain)) {
    throw new EnterpriseSsoError(403, "sso_domain_denied", "This email domain is not permitted for the organization.");
  }

  const db = getDb();
  const [organization] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!organization || organization.status !== "active") throw new EnterpriseSsoError(403, "organization_inactive", "Organization is not active.");

  let [user] = await db.select().from(users).where(eq(users.email, identity.email)).limit(1);
  if (user && user.organizationId !== organizationId) throw new EnterpriseSsoError(409, "sso_identity_conflict", "This email is already associated with another LiOS account.");
  if (user && !["client_admin", "client_user"].includes(user.role)) throw new EnterpriseSsoError(409, "sso_identity_conflict", "This email belongs to a non-client LiOS account.");

  if (!user) {
    if (!policy.sso.externalProvisioning) throw new EnterpriseSsoError(403, "sso_provisioning_disabled", "Automatic enterprise user provisioning is disabled.");
    const orgUsers = await db.select({ id: users.id, role: users.role, active: users.active }).from(users).where(eq(users.organizationId, organizationId));
    const activeSeats = orgUsers.filter((entry) => entry.active && (entry.role === "client_admin" || entry.role === "client_user")).length;
    if (policy.seats.maxSeats !== null && activeSeats >= policy.seats.maxSeats) throw new EnterpriseSsoError(409, "seat_limit_reached", "Organization seat limit has been reached.");
    const passwordHash = await bcrypt.hash(randomToken(32), 12);
    [user] = await db.insert(users).values({
      email: identity.email,
      passwordHash,
      role: "client_user",
      organizationId,
      name: identity.name.slice(0, 120),
      active: true,
      mustChangePassword: false,
      lastLoginAt: new Date(),
    }).returning();
  } else {
    if (!user.active) throw new EnterpriseSsoError(403, "account_inactive", "This LiOS account is inactive.");
    [user] = await db.update(users).set({
      name: identity.name.slice(0, 120),
      lastLoginAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: null,
    }).where(eq(users.id, user.id)).returning();
  }

  const license = await getOrganizationLicenseDecision(organizationId);
  if (!license.canAuthenticate) throw new EnterpriseSsoError(403, "license_login_blocked", "Organization license does not allow login.");
  return user;
}

function sessionUser(user: User): Express.User {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    organizationId: user.organizationId,
    name: user.name,
    mustChangePassword: false,
  };
}

async function establishSession(req: Request, user: User, organizationId: number, protocol: SsoProtocol): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((regenerateError) => {
      if (regenerateError) return reject(regenerateError);
      req.logIn(sessionUser(user), (loginError) => loginError ? reject(loginError) : resolve());
    });
  });
  await recordSecurityAuditEvent(user.id, "enterprise_sso_login", { organizationId, protocol, ...auditActor(user) });
}

function transient(req: Request, organizationId: number, protocol: SsoProtocol, state: string): EnterpriseSsoTransient {
  const value = req.session.liosEnterpriseSso;
  if (!value || value.organizationId !== organizationId || value.protocol !== protocol || value.state !== state) {
    throw new EnterpriseSsoError(401, "sso_state_invalid", "Enterprise SSO state validation failed.");
  }
  if (Date.now() - value.createdAt > SSO_TTL_MS) {
    delete req.session.liosEnterpriseSso;
    throw new EnterpriseSsoError(401, "sso_state_expired", "Enterprise SSO request has expired.");
  }
  return value;
}

async function oidcStart(req: Request, organizationId: number, returnTo: string, deviceRequestId?: string): Promise<string> {
  const { policy } = await loadSsoPolicy(organizationId, "oidc");
  const discovery = await discoverOidc(policy.sso.issuer!);
  const state = randomToken();
  const nonce = randomToken();
  const codeVerifier = randomToken(48);
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  req.session.liosEnterpriseSso = { organizationId, protocol: "oidc", state, nonce, codeVerifier, deviceRequestId, returnTo, createdAt: Date.now() };
  const authorize = secureUrl(policy.sso.authorizationUrl || discovery.authorization_endpoint, "OIDC authorization endpoint");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", policy.sso.clientId!);
  authorize.searchParams.set("redirect_uri", callbackUrl(req, organizationId, "oidc"));
  authorize.searchParams.set("scope", "openid profile email");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);
  authorize.searchParams.set("code_challenge", codeChallenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  return authorize.toString();
}

async function oidcCallback(req: Request, organizationId: number): Promise<{ user: User; returnTo: string; deviceRequestId?: string }> {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state) throw new EnterpriseSsoError(400, "oidc_callback_invalid", "OIDC callback is missing code or state.");
  const flow = transient(req, organizationId, "oidc", state);
  const { policy } = await loadSsoPolicy(organizationId, "oidc");
  const discovery = await discoverOidc(policy.sso.issuer!);
  const secret = await getOrganizationCredential(organizationId, SSO_CLIENT_SECRET_CREDENTIAL);
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(req, organizationId, "oidc"),
    client_id: policy.sso.clientId!,
    code_verifier: flow.codeVerifier!,
  });
  if (secret) form.set("client_secret", secret);
  const token = await fetchJson<OidcTokenResponse>(discovery.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: form.toString(),
  });
  if (!token.id_token) throw new EnterpriseSsoError(401, "oidc_id_token_missing", "OIDC token response did not include an ID token.");
  const identity = await validateOidcIdToken({
    idToken: token.id_token,
    issuer: policy.sso.issuer!,
    clientId: policy.sso.clientId!,
    nonce: flow.nonce!,
    jwksUri: discovery.jwks_uri,
  });
  const user = await provisionEnterpriseUser(organizationId, identity);
  delete req.session.liosEnterpriseSso;
  return { user, returnTo: flow.returnTo, deviceRequestId: flow.deviceRequestId };
}

function samlRequestXml(issuer: string, acsUrl: string, requestId: string, destination: string, now = new Date()): string {
  const escapeXml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]!));
  return `<?xml version="1.0" encoding="UTF-8"?><samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${escapeXml(requestId)}" Version="2.0" IssueInstant="${now.toISOString()}" Destination="${escapeXml(destination)}" AssertionConsumerServiceURL="${escapeXml(acsUrl)}" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>${escapeXml(issuer)}</saml:Issuer><samlp:NameIDPolicy AllowCreate="true" Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"/></samlp:AuthnRequest>`;
}

async function samlStart(req: Request, organizationId: number, returnTo: string, deviceRequestId?: string): Promise<string> {
  const { policy } = await loadSsoPolicy(organizationId, "saml");
  if (!policy.sso.authorizationUrl) throw new EnterpriseSsoError(503, "saml_configuration_incomplete", "SAML SSO URL is not configured.");
  const secret = await getOrganizationCredential(organizationId, SAML_VERIFIER_SECRET_CREDENTIAL);
  if (!secret || secret.length < 24) throw new EnterpriseSsoError(503, "saml_verifier_secret_missing", "Organization SAML verifier secret is not configured.");

  const requestId = `_lios_${randomToken(24)}`;
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SSO_TTL_MS);
  await getDb().delete(enterpriseSamlRequests).where(lt(enterpriseSamlRequests.expiresAt, createdAt));
  await getDb().insert(enterpriseSamlRequests).values({
    id: requestId,
    organizationId,
    status: "pending",
    returnTo,
    deviceRequestId: deviceRequestId ?? null,
    createdAt,
    expiresAt,
  });

  const ssoUrl = secureUrl(policy.sso.authorizationUrl, "SAML SSO URL");
  const xml = samlRequestXml(policy.sso.clientId!, callbackUrl(req, organizationId, "saml"), requestId, ssoUrl.toString(), createdAt);
  const relayState = signEnterpriseSamlRelayState({ organizationId, requestId, expiresAt, secret });
  ssoUrl.searchParams.set("SAMLRequest", deflateRawSync(Buffer.from(xml)).toString("base64"));
  ssoUrl.searchParams.set("RelayState", relayState);
  return ssoUrl.toString();
}

async function verifySamlResponse(req: Request, organizationId: number): Promise<{
  user: User;
  returnTo: string;
  deviceRequestId?: string;
  samlRequestId: string;
}> {
  const samlResponse = typeof req.body?.SAMLResponse === "string" ? req.body.SAMLResponse : "";
  const relayState = typeof req.body?.RelayState === "string" ? req.body.RelayState : "";
  if (!samlResponse || !relayState || samlResponse.length > 2_000_000 || relayState.length > 512) {
    throw new EnterpriseSsoError(400, "saml_callback_invalid", "SAML callback is invalid.");
  }

  const { policy } = await loadSsoPolicy(organizationId, "saml");
  const verifierUrlRaw = process.env.LIOS_SAML_VERIFIER_URL?.trim();
  if (!verifierUrlRaw) throw new EnterpriseSsoError(503, "saml_verifier_missing", "Hosted SAML signature verifier is not configured.");
  const verifierUrl = secureUrl(verifierUrlRaw, "SAML verifier URL");
  const secret = await getOrganizationCredential(organizationId, SAML_VERIFIER_SECRET_CREDENTIAL);
  if (!secret || secret.length < 24) throw new EnterpriseSsoError(503, "saml_verifier_secret_missing", "Organization SAML verifier secret is not configured.");

  const flow = await claimEnterpriseSamlRequest(organizationId, relayState, secret);
  try {
    const payload = JSON.stringify({
      samlResponse,
      expectedIssuer: policy.sso.issuer,
      expectedAudience: policy.sso.clientId,
      expectedAcsUrl: callbackUrl(req, organizationId, "saml"),
      requestId: flow.id,
    });
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const verified = await fetchJson<SamlVerifierResponse>(verifierUrl.toString(), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lios-saml-signature-sha256": signature,
      },
      body: payload,
    });
    if (!verified.valid) throw new EnterpriseSsoError(401, "saml_assertion_invalid", "SAML assertion signature or conditions are invalid.");
    if (verified.issuer !== policy.sso.issuer || verified.audience !== policy.sso.clientId) {
      throw new EnterpriseSsoError(401, "saml_assertion_scope_invalid", "SAML assertion issuer or audience mismatch.");
    }
    if (verified.inResponseTo !== flow.id) {
      throw new EnterpriseSsoError(401, "saml_request_mismatch", "SAML assertion does not match the authentication request.");
    }
    if (!verified.emailVerified) throw new EnterpriseSsoError(403, "saml_email_unverified", "Enterprise identity email is not verified.");

    // Once a signed assertion has been accepted, consume the LiOS request
    // before provisioning/session creation. If a later local step fails the
    // user starts a fresh SSO request; the accepted assertion can never be
    // replayed through LiOS.
    await consumeEnterpriseSamlRequest(flow.id, organizationId);
    const user = await provisionEnterpriseUser(organizationId, verified);
    return {
      user,
      returnTo: flow.returnTo,
      deviceRequestId: flow.deviceRequestId ?? undefined,
      samlRequestId: flow.id,
    };
  } catch (error) {
    // This is a no-op after successful consumption, but restores a request
    // when the verifier is unavailable or rejects the assertion before LiOS
    // has accepted it.
    await restoreEnterpriseSamlRequest(flow.id, organizationId);
    throw error;
  }
}

function organizationId(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new EnterpriseSsoError(400, "organization_invalid", "A valid organization ID is required.");
  return parsed;
}

function ssoError(res: Response, error: unknown, next: NextFunction): void {
  if (error instanceof EnterpriseSsoError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  next(error);
}

export function registerEnterpriseSsoRoutes(app: Express): void {
  app.post("/api/client/auth/sso/device/start", async (req, res, next) => {
    try {
      const parsedEmail = typeof req.body?.email === "string" ? req.body.email : "";
      const result = await createEnterpriseSsoDeviceAuthorization(req, parsedEmail);
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json(result);
    } catch (error) {
      ssoError(res, error, next);
    }
  });

  app.post("/api/client/auth/sso/device/poll", async (req, res, next) => {
    try {
      const requestId = typeof req.body?.requestId === "string" ? req.body.requestId : "";
      const verifier = typeof req.body?.verifier === "string" ? req.body.verifier : "";
      if (!requestId || !verifier) throw new EnterpriseSsoError(400, "sso_device_poll_invalid", "Desktop SSO request ID and verifier are required.");
      const result = await pollEnterpriseSsoDeviceAuthorization(req, requestId, verifier);
      res.setHeader("Cache-Control", "no-store");
      if (result.status === "pending") {
        res.status(202).json({ status: "pending" });
        return;
      }
      res.json({ status: "authenticated" });
    } catch (error) {
      ssoError(res, error, next);
    }
  });

  app.get("/api/client/auth/sso/:orgId", async (req, res, next) => {
    try {
      const orgId = organizationId(req.params.orgId);
      const { policy } = await loadSsoPolicy(orgId);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        organizationId: orgId,
        mode: policy.sso.mode,
        ready: policy.sso.status === "ready",
        externalProvisioning: policy.sso.externalProvisioning,
      });
    } catch (error) {
      ssoError(res, error, next);
    }
  });

  app.get("/api/client/auth/sso/:orgId/start", async (req, res, next) => {
    try {
      const orgId = organizationId(req.params.orgId);
      const { policy } = await loadSsoPolicy(orgId);
      const returnTo = safeReturnTo(req.query.returnTo);
      const deviceRequestId = typeof req.query.deviceRequest === "string" ? req.query.deviceRequest : undefined;
      if (deviceRequestId) await requirePendingDeviceRequest(deviceRequestId, orgId);
      const destination = policy.sso.mode === "oidc"
        ? await oidcStart(req, orgId, returnTo, deviceRequestId)
        : await samlStart(req, orgId, returnTo, deviceRequestId);
      res.setHeader("Cache-Control", "no-store");
      res.redirect(302, destination);
    } catch (error) {
      ssoError(res, error, next);
    }
  });

  app.get("/api/client/auth/sso/:orgId/callback", async (req, res, next) => {
    try {
      const orgId = organizationId(req.params.orgId);
      const result = await oidcCallback(req, orgId);
      await establishSession(req, result.user, orgId, "oidc");
      await approveDeviceRequest(result.deviceRequestId, orgId, result.user.id);
      res.redirect(303, result.returnTo);
    } catch (error) {
      ssoError(res, error, next);
    }
  });

  app.post("/api/client/auth/sso/:orgId/saml/acs", async (req, res, next) => {
    try {
      const orgId = organizationId(req.params.orgId);
      const result = await verifySamlResponse(req, orgId);
      await establishSession(req, result.user, orgId, "saml");
      await approveDeviceRequest(result.deviceRequestId, orgId, result.user.id);
      res.redirect(303, result.returnTo);
    } catch (error) {
      ssoError(res, error, next);
    }
  });
}

export async function getEnterpriseSsoRuntimeReadiness(organizationId: number): Promise<{
  organizationId: number;
  mode: "disabled" | "oidc" | "saml";
  policyStatus: "not_configured" | "contract_only" | "ready" | "blocked";
  configured: boolean;
  clientSecretConfigured: boolean;
  samlVerifierConfigured: boolean;
  blockers: string[];
}> {
  const { policy } = await loadSsoPolicyForReadiness(organizationId);
  const blockers: string[] = [];
  const clientSecret = await getOrganizationCredential(organizationId, SSO_CLIENT_SECRET_CREDENTIAL);
  const samlSecret = await getOrganizationCredential(organizationId, SAML_VERIFIER_SECRET_CREDENTIAL);
  if (policy.sso.mode === "disabled") {
    return {
      organizationId,
      mode: "disabled",
      policyStatus: policy.sso.status,
      configured: true,
      clientSecretConfigured: Boolean(clientSecret),
      samlVerifierConfigured: false,
      blockers,
    };
  }
  if (policy.sso.status !== "ready") blockers.push("Enterprise SSO policy is not marked ready.");
  if (!policy.sso.issuer) blockers.push("SSO issuer is not configured.");
  if (!policy.sso.clientId) blockers.push("SSO client/entity ID is not configured.");
  if (policy.sso.mode === "saml") {
    if (!policy.sso.authorizationUrl) blockers.push("SAML SSO URL is not configured.");
    if (!process.env.LIOS_SAML_VERIFIER_URL?.trim()) blockers.push("LIOS_SAML_VERIFIER_URL is not configured.");
    if (!samlSecret || samlSecret.length < 24) blockers.push("Organization SAML verifier secret is not configured.");
  }
  return {
    organizationId,
    mode: policy.sso.mode,
    policyStatus: policy.sso.status,
    configured: blockers.length === 0,
    clientSecretConfigured: Boolean(clientSecret),
    samlVerifierConfigured: policy.sso.mode === "saml" && blockers.length === 0,
    blockers,
  };
}

async function loadSsoPolicyForReadiness(organizationId: number) {
  const record = await getEnterprisePolicy(organizationId);
  if (!record) throw new EnterpriseSsoError(404, "organization_not_found", "Organization not found.");
  return { record, policy: record.policy };
}

export const ENTERPRISE_SSO_CREDENTIALS = Object.freeze({
  oidcClientSecret: SSO_CLIENT_SECRET_CREDENTIAL,
  samlVerifierSecret: SAML_VERIFIER_SECRET_CREDENTIAL,
});
