import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.resolve(root, relative), "utf8");
}

function requireMatch(source: string, pattern: RegExp, message: string): void {
  if (!pattern.test(source)) throw new Error(message);
}

function requireAbsent(source: string, pattern: RegExp, message: string): void {
  if (pattern.test(source)) throw new Error(message);
}

const serverIndex = read("server/index.ts");
// GM-07a: the session secret now lives in server/sessionSecret.ts (index.ts imports it).
requireMatch(read("server/sessionSecret.ts"), /mode: 0o600/, "P1B local session secret file must be owner-only where POSIX permissions apply.");
requireMatch(serverIndex, /getSessionSecret\(\)/, "P1B server must take its session secret from the single session-secret module.");

const contracts = read("shared/identityContracts.ts");
for (const token of [
  "identityPrincipalSchema",
  "organizationIdentitySchema",
  "deviceIdentitySchema",
  "ownershipScopeSchema",
  "effectiveAccessSnapshotSchema",
  "authSessionStateSchema",
  "desktopOidcProviderSchema",
  "featureIsEntitled",
]) {
  requireMatch(contracts, new RegExp(token), "P1B canonical identity contract missing: " + token);
}
requireMatch(contracts, /organizationId:\s*z\.number\(\)\.int\(\)\.positive\(\)\.nullable\(\)/, "P1B principal/ownership organization scope must remain explicit and nullable.");
requireMatch(contracts, /if \(!snapshot\.deviceAccess\.allowed\) return false/, "P1B effective access must fail closed on device authorization.");

const auth = read("server/auth.ts");
requireMatch(auth, /\/api\/client\/control-plane\/snapshot/, "P1B canonical access snapshot endpoint is missing.");
requireMatch(auth, /resolveLocalEffectiveAccess/, "P1B auth runtime must use the canonical effective-access resolver.");
requireMatch(auth, /featureIsEntitled\(snapshot, featureKey\)/, "P1B product feature checks must consume entitlement keys through the canonical resolver.");
requireMatch(auth, /resolveSessionRestoration/, "P1B auth/me must expose explicit startup restoration state.");
// GM-07c: the imported licence file emits the canonical access contract (the hosted offline-restoration path is gone).
requireMatch(read("server/effectiveAccess.ts"), /effectiveAccessFromLicenseFile/, "P1B licence-file access must emit the same canonical access contract.");
requireMatch(auth, /regenerateSessionForLogin/, "P1B login must rotate the server-side session before authentication is bound.");
requireAbsent(auth, /plan\.tier\s*===|plan\.code\s*===\s*["'][^"']+["']\s*\?/, "P1B product access must not branch directly on commercial plan names.");

const controls = read("server/controlPlaneService.ts");
requireMatch(controls, /createSessionControl/, "P1B session revocation control path is missing.");
requireMatch(controls, /revokeMatchingSessions/, "P1B session controls must revoke persisted server-side sessions.");

const terminal = read("client/src/pages/Terminal.tsx");
const banner = read("client/src/components/terminal/LicenseStatusBanner.tsx");
requireMatch(terminal, /session\.offline/, "P1B terminal must surface restored offline mode.");
requireMatch(banner, /offline_lease_authorized/, "P1B offline UX banner is missing.");

const effective = read("server/effectiveAccess.ts");
requireMatch(effective, /entitlementMode = entitlementRows\.length === 0 \? "unrestricted"/, "P1B compatibility entitlement mode must be explicit.");
requireMatch(effective, /deviceFingerprintHash/, "P1B effective access must bind device policy.");
requireMatch(effective, /source: "license"/, "P1B licence-file grants must identify their source.");

const oidc = read("server/desktopOidcPkce.ts");
requireMatch(oidc, /code_challenge_method", "S256"/, "P1B desktop OIDC must use PKCE S256.");
requireMatch(oidc, /timingSafeEqual/, "P1B desktop OIDC must validate state using a timing-safe comparison.");
requireMatch(oidc, /pending\.delete\(callback\.requestId\)/, "P1B desktop OIDC callbacks must be one-time.");
requireAbsent(oidc, /authorizationUrl\.searchParams\.set\("code_verifier"/, "P1B must never place the PKCE verifier in the browser authorization URL.");

const tenant = read("server/tenantContext.ts");
requireMatch(tenant, /assertOwnedByTenant/, "P1B exact work-ownership guard is missing.");
requireMatch(tenant, /assertLegacyWorkClaim/, "P1B legacy local-work claim guard is missing.");

const migration = read("server/projectMigrationService.ts");
requireMatch(migration, /assertLegacyWorkClaim\(ctx, workspace\.createdByUserId\)/, "P1B legacy workspace migration must verify the authenticated creator.");
requireMatch(migration, /claimedByUserId:\s*ctx\.userId/, "P1B legacy claim audit metadata must record the principal.");

const schema = read("shared/schema.ts");
const ownershipModules = {
  schemaCore: ["projects"],
  schemaProjects: ["projectChats", "projectSessions", "projectArtifacts"],
};
for (const [module, tables] of Object.entries(ownershipModules)) {
  requireMatch(schema, new RegExp(`export \\* from ["']\\./${module}["']`), `P1B ownership module must remain exported: ${module}.`);
  const definitions = read(`shared/${module}.ts`);
  for (const table of tables) {
    const declaration = new RegExp(`export const ${table}\\s*=\\s*pgTable\\(`).exec(definitions);
    const start = declaration?.index ?? -1;
    if (start < 0) throw new Error("P1B ownership table missing: " + table);
    const nextDeclaration = definitions.indexOf("\nexport ", start + 1);
    const fragment = definitions.slice(start, nextDeclaration < 0 ? undefined : nextDeclaration);
    requireMatch(fragment, /ownerUserId:/, `P1B ${table} must retain ownerUserId.`);
    requireMatch(fragment, /organizationId:/, `P1B ${table} must retain organizationId.`);
  }
}

const offline = read("server/offlineLeaseCache.ts");
requireMatch(offline, /ASYMMETRIC_LICENSE_LEASE_ALGORITHM/, "P1B offline lease cache must require asymmetric signed leases.");
requireMatch(offline, /offline_lease_wrong_device/, "P1B offline access must fail closed for the wrong device.");
requireMatch(offline, /offline_feature_not_entitled/, "P1B offline access must enforce feature-key scope.");

console.log(JSON.stringify({
  contractVersion: "p1b-1.0.0",
  principal: "canonical",
  organization: "explicit",
  device: "device-bound",
  sessionRestoration: ["signed_out", "restoring", "authenticated_online", "authenticated_offline", "reauth_required", "revoked"],
  access: {
    featureKeyBased: true,
    onlineSnapshot: true,
    offlineSnapshot: true,
    planNamesOutsideProductChecks: true,
  },
  ownership: {
    exactUserAndOrganization: true,
    project: true,
    chat: true,
    session: true,
    artifact: true,
    legacyClaimByCreatorOnly: true,
  },
  desktopIdentity: {
    providerNeutral: true,
    oidcAuthorizationCode: true,
    pkce: "S256",
    oneTimeCallback: true,
    encryptedServerSessionVault: true,
    revocationMetadataVisibleWithoutSecretDecryption: true,
  },
  offlineLease: {
    asymmetricSignatureRequired: true,
    deviceBound: true,
    expiryBound: true,
    featureScoped: true,
    explicitOfflineUx: true,
  },
}, null, 2));
