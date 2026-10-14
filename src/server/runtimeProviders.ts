import {
  runtimeComponentDescriptorSchema,
  type RuntimeAdapter,
  type RuntimeComponentDescriptor,
  type RuntimeExecutionScope,
  type RuntimeHealthReport,
} from "@shared/runtimeContracts";
import {
  HOME_PROVIDER_SLOTS,
  PROVIDER_OPERATOR_USER,
  PROVIDER_OPERATOR_VENDOR,
  evaluateHomeProfile,
  homeProfileProviderIds,
  homeProfileSchema,
  providerModeCapability,
  type HomeConformanceReport,
  type HomeProfile,
  type HomeProviderSlot,
  type RuntimeMode,
} from "@shared/runtimeProviderContracts";
import { getVaultProtection } from "./credentialVault";
import { organizationCredentialStoreEnabled } from "./organizationCredentialVault";
import { resolveRuntimeMode } from "./runtimeMode";
import { configuredStorageKind } from "./storageRuntime";
import { describeEgress, parseEgressPolicy, type EgressMode } from "./egressPolicy";

/**
 * GM-02: projects the infrastructure the product ALREADY uses into the existing RuntimeRegistry.
 *
 * Nothing here replaces or re-implements a provider. `db.ts`, `credentialVault.ts`,
 * `projectAttachmentStore.ts`, `listenConfig.ts`, `licenseLease.ts` etc. remain the implementations;
 * this module only describes them (secret-free) and reports which ones the current process actually
 * uses. Providers that depend on a LiOS-operated service are registered too, tagged `operator:vendor`,
 * so the inventory and the zero-server conformance check stay honest about what the code still needs.
 */

type ProviderSpec = {
  id: string;
  slot: HomeProviderSlot;
  name: string;
  lifecycle: RuntimeComponentDescriptor["lifecycle"];
  scopes: RuntimeExecutionScope[];
  modes: RuntimeMode[];
  operator: "user" | "vendor";
  /** Neutral capability tags describing what the provider offers. */
  offers: string[];
  /** Sentence shown when this provider is the active one. Never include secrets, paths or URLs. */
  activeDetail: string;
};

const BOTH: RuntimeMode[] = ["desktop_local", "user_home_server"];

export const HOME_PROVIDER_SPECS: readonly ProviderSpec[] = [
  { id: "lios.database.pglite", slot: "database", name: "Embedded PGlite database", lifecycle: "builtin", scopes: ["local_api"], modes: BOTH, operator: "user", offers: ["database.sql", "database.embedded"], activeDetail: "Embedded PGlite is the system database." },
  { id: "lios.database.postgres", slot: "database", name: "User-managed PostgreSQL", lifecycle: "external", scopes: ["remote_api"], modes: BOTH, operator: "user", offers: ["database.sql", "database.networked"], activeDetail: "A user-managed PostgreSQL server is the system database." },
  { id: "lios.storage.local-fs", slot: "storage", name: "Local filesystem storage", lifecycle: "builtin", scopes: ["local_api"], modes: BOTH, operator: "user", offers: ["storage.blob", "storage.filesystem"], activeDetail: "Attachments and files are stored on the local filesystem." },
  { id: "lios.storage.s3", slot: "storage", name: "S3-compatible object storage", lifecycle: "builtin", scopes: ["local_api"], modes: BOTH, operator: "user", offers: ["storage.blob", "storage.s3", "storage.client-side-encryption"], activeDetail: "Attachments are encrypted by LiOS and stored in an S3-compatible bucket you own." },
  { id: "lios.secrets.env", slot: "secrets", name: "Environment secrets", lifecycle: "builtin", scopes: ["local_api"], modes: BOTH, operator: "user", offers: ["secrets.read"], activeDetail: "Operator-supplied environment variables are consulted first." },
  { id: "lios.secrets.local-vault", slot: "secrets", name: "Encrypted local credential vault", lifecycle: "builtin", scopes: ["local_api"], modes: BOTH, operator: "user", offers: ["secrets.read", "secrets.write"], activeDetail: "Credentials are stored in the encrypted local vault." },
  { id: "lios.secrets.organization-vault", slot: "secrets", name: "Database-backed organization vault", lifecycle: "managed", scopes: ["local_api"], modes: BOTH, operator: "user", offers: ["secrets.read", "secrets.write"], activeDetail: "Credentials are resolved from the organization vault in the configured database." },
  { id: "lios.execution.local", slot: "execution", name: "Local execution", lifecycle: "builtin", scopes: ["node_worker", "python_sidecar", "external_process"], modes: BOTH, operator: "user", offers: ["execution.node", "execution.python"], activeDetail: "Work runs on this machine." },
  { id: "lios.identity.local-session", slot: "identity", name: "Local session identity", lifecycle: "builtin", scopes: ["local_api"], modes: BOTH, operator: "user", offers: ["identity.session"], activeDetail: "Accounts and sessions are held in the local database." },
  { id: "lios.license.signed-offline-lease", slot: "license", name: "Signed offline licence lease", lifecycle: "builtin", scopes: ["local_api"], modes: BOTH, operator: "user", offers: ["license.verify", "license.offline"], activeDetail: "Entitlement is verified locally from a signed licence lease." },
  { id: "lios.network.loopback", slot: "network", name: "Loopback-only network", lifecycle: "builtin", scopes: ["local_api"], modes: ["desktop_local"], operator: "user", offers: ["network.loopback"], activeDetail: "The server listens on the loopback interface only." },
  { id: "lios.network.user-bind", slot: "network", name: "User-selected bind address", lifecycle: "builtin", scopes: ["local_api"], modes: ["user_home_server"], operator: "user", offers: ["network.bind"], activeDetail: "The server listens on an address the operator chose." },
  { id: "lios.backup.workspace-archive", slot: "backup", name: "Workspace archive backup", lifecycle: "builtin", scopes: ["electron_main"], modes: ["desktop_local"], operator: "user", offers: ["backup.archive"], activeDetail: "The desktop can archive and restore the workspace folder." },
  { id: "lios.backup.portable-archive", slot: "backup", name: "Portable verified archive", lifecycle: "builtin", scopes: ["local_api"], modes: BOTH, operator: "user", offers: ["backup.archive", "backup.encrypted", "backup.verify", "backup.restore", "backup.retention"], activeDetail: "npm run backup:create/verify/restore writes a verified tar.gz or passphrase-encrypted archive of the database and data root to a destination you choose." },
  { id: "lios.backup.pglite-snapshot", slot: "backup", name: "PGlite pre-migration snapshot", lifecycle: "builtin", scopes: ["local_api"], modes: BOTH, operator: "user", offers: ["backup.snapshot"], activeDetail: "The PGlite directory is snapshotted before schema migrations." },
  { id: "lios.browser.playwright-optional", slot: "browser", name: "Isolated Playwright Browser Runtime Pack", lifecycle: "optional", scopes: ["external_process"], modes: BOTH, operator: "user", offers: ["browser.automation"], activeDetail: "Governed browser automation runs only through the strict deny-network sandbox and P13 host broker when an immutable image provisions the Browser Runtime Pack; otherwise it reports unavailable." },
];

function descriptorFor(spec: ProviderSpec): RuntimeComponentDescriptor {
  return runtimeComponentDescriptorSchema.parse({
    contractVersion: "1",
    id: spec.id,
    kind: HOME_PROVIDER_SLOTS[spec.slot],
    name: spec.name,
    version: "1",
    lifecycle: spec.lifecycle,
    executionScopes: spec.scopes,
    capabilities: [
      ...spec.offers,
      spec.operator === "vendor" ? PROVIDER_OPERATOR_VENDOR : PROVIDER_OPERATOR_USER,
      ...spec.modes.map(providerModeCapability),
    ],
    permissions: [],
    runtimePackId: null,
    replaceable: true,
    source: { origin: "lios", importedPaths: [], modified: false },
  });
}

/**
 * The profile the CURRENT process actually runs, derived from its environment. This reports reality;
 * it is not the target. Identity is the local session and the licence is the signed file (GM-07), so
 * no shipped profile depends on a vendor service; `evaluateHomeProfile` still flags any that would.
 */
export function resolveActiveHomeProfile(env: NodeJS.ProcessEnv = process.env): HomeProfile {
  const mode = resolveRuntimeMode(env);
  const pglite = !env.DATABASE_URL?.trim();
  return homeProfileSchema.parse({
    mode,
    database: pglite ? "lios.database.pglite" : "lios.database.postgres",
    storage: configuredStorageKind(env) === "s3" ? "lios.storage.s3" : "lios.storage.local-fs",
    // Mirrors resolveCredential(): env first; a database-backed organization store replaces the
    // machine-local vault rather than falling back to it.
    secrets: ["lios.secrets.env", organizationCredentialStoreEnabled(env) ? "lios.secrets.organization-vault" : "lios.secrets.local-vault"],
    execution: "lios.execution.local",
    identity: "lios.identity.local-session",
    license: "lios.license.signed-offline-lease",
    network: mode === "desktop_local" ? "lios.network.loopback" : "lios.network.user-bind",
    // Only what exists today. The portable archive (GM-06) works for both engines and both modes.
    backup: ["lios.backup.portable-archive", ...(mode === "desktop_local" ? ["lios.backup.workspace-archive"] : []), ...(pglite ? ["lios.backup.pglite-snapshot"] : [])],
    // No notification provider ships yet (GM-18).
    notification: null,
    browser: "lios.browser.playwright-optional",
  });
}

function healthFor(spec: ProviderSpec, env: NodeJS.ProcessEnv): RuntimeHealthReport {
  const active = homeProfileProviderIds(resolveActiveHomeProfile(env)).some((entry) => entry.providerId === spec.id);
  const checkedAt = new Date().toISOString();
  if (!active) {
    return { componentId: spec.id, state: "configurable", detail: "Available but not selected in this runtime.", checkedAt };
  }
  if (spec.operator === "vendor") {
    return { componentId: spec.id, state: "degraded", detail: spec.activeDetail, checkedAt };
  }
  if (spec.id === "lios.secrets.local-vault") {
    // Both modes are healthy; the detail tells the user which protection is in force (no key material).
    const detail = getVaultProtection() === "configured_secret"
      ? "Credentials are encrypted under a key supplied by the OS-protected desktop secret or the operator."
      : "Credentials are encrypted under a random key stored beside the vault (file permissions only; not OS-protected).";
    return { componentId: spec.id, state: "available", detail, checkedAt };
  }
  return { componentId: spec.id, state: "available", detail: spec.activeDetail, checkedAt };
}

export function createHomeProviderAdapters(env: NodeJS.ProcessEnv = process.env): RuntimeAdapter[] {
  return HOME_PROVIDER_SPECS.map((spec) => ({
    descriptor: descriptorFor(spec),
    health: () => healthFor(spec, env),
  }));
}

export function homeProviderDescriptors(): RuntimeComponentDescriptor[] {
  return HOME_PROVIDER_SPECS.map(descriptorFor);
}

export interface HomeRuntimeSnapshot {
  mode: RuntimeMode;
  /** Outbound-network policy of this Home (GM-07d); no host names are exposed. */
  egress: { mode: EgressMode; ruleCount: number };
  profile: HomeProfile;
  conformance: HomeConformanceReport;
}

/** Secret-free description of the Home this process is, and whether it satisfies the zero-LiOS-server rule. */
export function createHomeRuntimeSnapshot(env: NodeJS.ProcessEnv = process.env): HomeRuntimeSnapshot {
  const profile = resolveActiveHomeProfile(env);
  return {
    mode: profile.mode,
    egress: describeEgress(parseEgressPolicy(env)),
    profile,
    conformance: evaluateHomeProfile(profile, homeProviderDescriptors()),
  };
}
