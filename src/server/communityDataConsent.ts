import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "./db";
import { userDataConsents } from "@shared/schema";
import { getRequestIdentity } from "./requestContext";
import { isRetailSoftwareProfile } from "./retailSoftwareProfile";

export type CommunityConsentScope = "yahoo_community" | "public_filler";

export async function hasActiveCommunityConsent(userId: number, scope: CommunityConsentScope): Promise<boolean> {
  const db = getDb();
  const [row] = await db.select().from(userDataConsents).where(and(
    eq(userDataConsents.userId, userId),
    eq(userDataConsents.scope, scope),
    isNull(userDataConsents.revokedAt),
  )).limit(1);
  return Boolean(row);
}

export async function setCommunityConsent(
  userId: number,
  scope: CommunityConsentScope,
  accept: boolean,
  consentVersion: string,
): Promise<{ scope: CommunityConsentScope; active: boolean; consentVersion: string; acceptedAt: string | null }> {
  const db = getDb();
  const now = new Date();
  if (!accept) {
    await db.update(userDataConsents).set({ revokedAt: now }).where(and(
      eq(userDataConsents.userId, userId),
      eq(userDataConsents.scope, scope),
      isNull(userDataConsents.revokedAt),
    ));
    return { scope, active: false, consentVersion, acceptedAt: null };
  }

  const [row] = await db.insert(userDataConsents).values({
    userId,
    scope,
    consentVersion,
    acceptedAt: now,
    revokedAt: null,
  }).onConflictDoUpdate({
    target: [userDataConsents.userId, userDataConsents.scope],
    set: { consentVersion, acceptedAt: now, revokedAt: null },
  }).returning();

  return {
    scope,
    active: true,
    consentVersion: row.consentVersion,
    acceptedAt: row.acceptedAt.toISOString(),
  };
}

export async function listCommunityConsents(userId: number): Promise<Array<{ scope: CommunityConsentScope; active: boolean; consentVersion: string; acceptedAt: string | null }>> {
  const db = getDb();
  const rows = await db.select().from(userDataConsents).where(and(
    eq(userDataConsents.userId, userId),
    isNull(userDataConsents.revokedAt),
  ));
  return rows.map((row) => ({
    scope: row.scope as CommunityConsentScope,
    active: true,
    consentVersion: row.consentVersion,
    acceptedAt: row.acceptedAt.toISOString(),
  }));
}

/** Fail-closed on retail when Yahoo/community paths would be used without opt-in. */
export function communityMarketDataAllowed(identityCommunityYahooConsent?: boolean): boolean {
  if (!isRetailSoftwareProfile()) return true;
  if (identityCommunityYahooConsent === true) return true;
  const identity = getRequestIdentity();
  if (identity?.communityYahooConsent === true) return true;
  return false;
}

export function publicFillerMarketDataAllowed(): boolean {
  if (!isRetailSoftwareProfile()) return true;
  const identity = getRequestIdentity();
  if (identity?.publicFillerConsent === true) return true;
  return false;
}

/**
 * The runtime pack `community-yahoo` (runtimeManifest.ts) installs
 * yfinance, and the connector `yahoo_community` gates Yahoo/yfinance data
 * access -- they were two independently-toggled surfaces over the same
 * real capability, so a user could install the yfinance pack without ever
 * accepting the community-data consent the connector requires. Both now
 * resolve through this one map to the same userDataConsents scope: the
 * pack cannot be installed unless the consent record the connector reads
 * is already active.
 */
const PACK_CONSENT_SCOPES: Record<string, CommunityConsentScope> = {
  "community-yahoo": "yahoo_community",
};

export function consentScopeForRuntimePack(packId: string): CommunityConsentScope | null {
  return PACK_CONSENT_SCOPES[packId] ?? null;
}

/** Which of the requested packs need a consent record this user has not
 * accepted. Empty array means the install may proceed. */
export async function unconsentedRuntimePacks(userId: number, packIds: readonly string[]): Promise<Array<{ packId: string; scope: CommunityConsentScope }>> {
  const blocked: Array<{ packId: string; scope: CommunityConsentScope }> = [];
  for (const packId of packIds) {
    const scope = consentScopeForRuntimePack(packId);
    if (!scope) continue;
    if (!(await hasActiveCommunityConsent(userId, scope))) blocked.push({ packId, scope });
  }
  return blocked;
}
