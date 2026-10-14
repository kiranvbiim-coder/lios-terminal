import crypto from "node:crypto";
import {
  desktopOidcCallbackSchema,
  desktopOidcProviderSchema,
  desktopOidcStartResultSchema,
  type DesktopOidcCallback,
  type DesktopOidcProvider,
  type DesktopOidcStartResult,
  type IdentityPrincipal,
} from "@shared/identityContracts";

const DEFAULT_TTL_MS = 10 * 60 * 1000;

interface PendingOidcRequest {
  provider: DesktopOidcProvider;
  state: string;
  codeVerifier: string;
  expiresAt: number;
}

export interface DesktopOidcExchangeInput {
  provider: DesktopOidcProvider;
  code: string;
  codeVerifier: string;
}

export interface DesktopIdentityProviderAdapter {
  exchangeAuthorizationCode(input: DesktopOidcExchangeInput): Promise<IdentityPrincipal>;
}

const pending = new Map<string, PendingOidcRequest>();

function base64url(bytes: Buffer): string {
  return bytes.toString("base64url");
}

export function pkceChallenge(codeVerifier: string): string {
  return base64url(crypto.createHash("sha256").update(codeVerifier).digest());
}

function prune(now: number): void {
  for (const [requestId, value] of pending) {
    if (value.expiresAt < now) pending.delete(requestId);
  }
}

export function beginDesktopOidc(
  rawProvider: DesktopOidcProvider,
  now = new Date(),
  ttlMs = DEFAULT_TTL_MS,
): DesktopOidcStartResult {
  const provider = desktopOidcProviderSchema.parse(rawProvider);
  if (!Number.isFinite(ttlMs) || ttlMs < 60_000 || ttlMs > DEFAULT_TTL_MS) {
    throw new Error("Desktop OIDC request TTL must be between 1 and 10 minutes.");
  }

  const nowMs = now.getTime();
  prune(nowMs);
  const requestId = crypto.randomUUID();
  const state = base64url(crypto.randomBytes(32));
  const codeVerifier = base64url(crypto.randomBytes(48));
  const expiresAt = nowMs + ttlMs;

  pending.set(requestId, { provider, state, codeVerifier, expiresAt });

  const authorizationUrl = new URL(provider.authorizationEndpoint);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", provider.clientId);
  authorizationUrl.searchParams.set("redirect_uri", provider.redirectUri);
  authorizationUrl.searchParams.set("scope", provider.scopes.join(" "));
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", pkceChallenge(codeVerifier));
  authorizationUrl.searchParams.set("code_challenge_method", "S256");

  return desktopOidcStartResultSchema.parse({
    requestId,
    providerId: provider.id,
    authorizationUrl: authorizationUrl.toString(),
    expiresAt: new Date(expiresAt).toISOString(),
  });
}

export async function completeDesktopOidc(
  rawCallback: DesktopOidcCallback,
  adapter: DesktopIdentityProviderAdapter,
  now = new Date(),
): Promise<IdentityPrincipal> {
  const callback = desktopOidcCallbackSchema.parse(rawCallback);
  const item = pending.get(callback.requestId);
  if (!item) throw new Error("Desktop OIDC request is missing or already consumed.");

  // Consume before token exchange so replaying the callback cannot exchange twice,
  // even if the provider rejects the first attempt.
  pending.delete(callback.requestId);

  if (item.expiresAt < now.getTime()) throw new Error("Desktop OIDC request expired.");
  const expected = Buffer.from(item.state);
  const actual = Buffer.from(callback.state);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error("Desktop OIDC state validation failed.");
  }

  return adapter.exchangeAuthorizationCode({
    provider: item.provider,
    code: callback.code,
    codeVerifier: item.codeVerifier,
  });
}

export function clearPendingDesktopOidcForTests(): void {
  pending.clear();
}
