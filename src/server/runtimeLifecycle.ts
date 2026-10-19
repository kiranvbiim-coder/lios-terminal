import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { users } from "@shared/schema";
import { runtimeLifecycleRequestSchema, type RuntimeLifecycleRequest, type RuntimeLifecyclePreview } from "@shared/runtimeLifecycle";
import { getDb } from "./db";
import { unconsentedRuntimePacks } from "./communityDataConsent";
import { inspectManagedRuntimeCustody, installManagedRuntime, managedRuntimePythonPath, readManagedRuntimeState, rollbackManagedRuntime, type StrictProvisioningAuthority } from "./pythonRuntimeManager";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";
import { expandP10RuntimePacks, p10RuntimePackForCapability } from "./p10RuntimePacks";
import { evaluateManagedRuntimeReadiness } from "./provisioningReadiness";
import { executeManagedRuntimeRepair } from "./doctorRepairExecutor";
import { ensureLazyCapability } from "./lazyCapabilityInstaller";
import { upgradeManagedRuntimeSafely } from "./safeManagedRuntimeUpgrade";

export interface RuntimeLifecycleActor { id: number; role: string; organizationId: number | null }
export class RuntimeLifecycleRefusal extends Error {
  constructor(readonly code: string, readonly blockers: string[] = []) {
    super(`Runtime operation refused: ${code}${blockers.length ? ` (${blockers.join(", ")})` : ""}.`);
    this.name = "RuntimeLifecycleRefusal";
  }
}

/** Trusted server injection only. HTTP requests cannot supply runners, paths, packages or authorities. */
export interface RuntimeLifecycleDependencies {
  strictProvisioningAuthority?: StrictProvisioningAuthority;
  provisioningBlocker?: "native_runtime_bundle_invalid";
  readActor?: (id: number) => Promise<(RuntimeLifecycleActor & { active: boolean; mustChangePassword: boolean; lockedUntil: Date | null }) | null>;
  readState?: typeof readManagedRuntimeState;
  inspectCustody?: typeof inspectManagedRuntimeCustody;
  pythonAvailable?: () => boolean;
  unconsentedPacks?: typeof unconsentedRuntimePacks;
  install?: typeof installManagedRuntime;
  repair?: typeof executeManagedRuntimeRepair;
  lazyInstall?: typeof ensureLazyCapability;
  upgrade?: typeof upgradeManagedRuntimeSafely;
  rollback?: typeof rollbackManagedRuntime;
  now?: () => number;
}

const confirmationKey = randomBytes(32);
const PREVIEW_TTL_MS = 5 * 60_000;

async function currentAdministrator(actor: RuntimeLifecycleActor, dependencies: RuntimeLifecycleDependencies): Promise<void> {
  const current = dependencies.readActor
    ? await dependencies.readActor(actor.id)
    : (await getDb().select().from(users).where(eq(users.id, actor.id)).limit(1))[0];
  if (!current?.active || current.mustChangePassword || (current.lockedUntil && current.lockedUntil.getTime() > (dependencies.now ?? Date.now)())
    || current.role !== actor.role || current.organizationId !== actor.organizationId
    || !["internal_admin", "client_admin"].includes(current.role)) {
    throw new RuntimeLifecycleRefusal("current_administrator_required");
  }
}

/** Compose canonical owners into a read-only, exact-target approval preview. */
export async function previewRuntimeLifecycle(
  actor: RuntimeLifecycleActor,
  input: RuntimeLifecycleRequest,
  dependencies: RuntimeLifecycleDependencies = {},
  expiresAt = (dependencies.now ?? Date.now)() + PREVIEW_TTL_MS,
): Promise<RuntimeLifecyclePreview> {
  await currentAdministrator(actor, dependencies);
  const request = runtimeLifecycleRequestSchema.parse(input);
  const state = (dependencies.readState ?? readManagedRuntimeState)();
  let targetPackIds = [...(state?.selectedPackIds ?? ["core"])];
  let selectedReleasePackIds = [...(state?.selectedReleasePackIds ?? [])];
  const blockers: string[] = [];
  if (request.operation === "install") {
    targetPackIds = [...new Set([...expandP10RuntimePacks(request.releasePackIds), ...request.additionalPackIds])];
    selectedReleasePackIds = [...new Set(request.releasePackIds)];
    if (request.releasePackIds.includes("local-ai")) blockers.push("local_ai_requires_user_supplied_runtime_and_model");
  } else if (request.operation === "lazy_install") {
    const pack = p10RuntimePackForCapability(request.capability);
    if (!pack) blockers.push("capability_not_managed");
    else if (pack.lazyInstallPolicy === "external") blockers.push("local_ai_requires_user_supplied_runtime_and_model");
    else {
      targetPackIds = [...new Set([...targetPackIds, ...expandP10RuntimePacks([pack.id])])];
      selectedReleasePackIds = [...new Set([...selectedReleasePackIds, pack.id])];
    }
  }
  targetPackIds = [...new Set(["core", ...targetPackIds])].sort();
  selectedReleasePackIds.sort();
  const custody = (dependencies.inspectCustody ?? inspectManagedRuntimeCustody)(targetPackIds);
  const readiness = evaluateManagedRuntimeReadiness({ state, requiredPackIds: state?.selectedPackIds.length ? state.selectedPackIds : ["core"], pythonAvailable: (dependencies.pythonAvailable ?? (() => managedRuntimePythonPath() !== null))() });
  if (request.operation === "rollback") {
    if (!custody.rollbackAvailable) blockers.push("rollback_snapshot_unavailable");
  } else {
    if (!custody.supportedPlatform) blockers.push("unsupported_platform");
    if (!dependencies.strictProvisioningAuthority) blockers.push("strict_provisioning_authority_missing:configure_a_trusted_governed_runner");
    if (dependencies.provisioningBlocker) blockers.push(dependencies.provisioningBlocker);
    if (custody.releaseLocks.some((lock) => lock.sha256 === null)) blockers.push("unverified_release_hashes:install_platform_release_wheel_hash_locks");
    const unconsented = await (dependencies.unconsentedPacks ?? unconsentedRuntimePacks)(actor.id, targetPackIds);
    if (unconsented.length) blockers.push("community_data_consent_required");
    if (request.operation === "upgrade" && !state) blockers.push("runtime_not_installed");
    if (request.operation === "upgrade" && state?.manifestVersion === MANAGED_RUNTIME_MANIFEST.manifestVersion) blockers.push("already_current:no_upgrade_needed");
    if (request.operation === "repair" && readiness.ready) blockers.push("no_repair_required");
    if (request.operation === "lazy_install" && state && !readiness.ready) blockers.push("runtime_not_ready:review_doctor_before_expansion");
  }
  const operationHash = createHash("sha256").update(JSON.stringify({ actor, request, expiresAt, custody, targetPackIds, selectedReleasePackIds, blockers })).digest("hex");
  const confirmationToken = createHmac("sha256", confirmationKey).update(operationHash).digest("hex");
  return {
    request, operationHash, confirmationToken, expiresAt,
    sourceStateHash: custody.sourceStateHash, targetManifestHash: custody.targetManifestHash, custodyHash: custody.custodyHash,
    targetManifestVersion: MANAGED_RUNTIME_MANIFEST.manifestVersion, targetPackIds, selectedReleasePackIds,
    releaseLocks: custody.releaseLocks, rollbackAvailable: custody.rollbackAvailable, blockers,
    summary: `${request.operation}: ${targetPackIds.join(", ")}. ${blockers.length ? "Blocked; no installation or repair was attempted." : "Explicit administrator confirmation is required."} Rollback ${custody.rollbackAvailable ? "snapshot is currently retained" : "is not currently available"}; recovery is never assumed successful.`,
  };
}

/** Mutation dispatch only: installation, repair and rollback remain owned by existing authorities. */
export async function applyRuntimeLifecycle(
  actor: RuntimeLifecycleActor,
  approval: { request: RuntimeLifecycleRequest; operationHash: string; confirmationToken: string; expiresAt: number; confirmed: boolean },
  dependencies: RuntimeLifecycleDependencies = {},
) {
  if (approval.confirmed !== true) throw new RuntimeLifecycleRefusal("confirmation_required");
  const now = (dependencies.now ?? Date.now)();
  if (!Number.isSafeInteger(approval.expiresAt) || approval.expiresAt <= now || approval.expiresAt > now + PREVIEW_TTL_MS) throw new RuntimeLifecycleRefusal("preview_expired");
  const preview = await previewRuntimeLifecycle(actor, approval.request, dependencies, approval.expiresAt);
  const expected = Buffer.from(preview.confirmationToken, "hex");
  const actual = /^[a-f0-9]{64}$/.test(approval.confirmationToken) ? Buffer.from(approval.confirmationToken, "hex") : Buffer.alloc(0);
  if (preview.operationHash !== approval.operationHash || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new RuntimeLifecycleRefusal("preview_stale");
  if (preview.blockers.length) throw new RuntimeLifecycleRefusal("prerequisites_blocked", preview.blockers);
  const expectedCustodyHash = preview.custodyHash;
  // The installer rechecks this exact custody while holding its canonical writer lock.
  const state = (dependencies.readState ?? readManagedRuntimeState)();
  await currentAdministrator(actor, dependencies);
  const options = { isolationMode: "strict" as const, requireVerified: true, strictProvisioningAuthority: dependencies.strictProvisioningAuthority, expectedCustodyHash };
  let result: { detail: string };
  switch (preview.request.operation) {
    case "install": result = await (dependencies.install ?? installManagedRuntime)(preview.targetPackIds, preview.selectedReleasePackIds, options); break;
    case "repair": result = (await (dependencies.repair ?? executeManagedRuntimeRepair)({ confirmed: true, isolationMode: "strict", strictProvisioningAuthority: dependencies.strictProvisioningAuthority, expectedCustodyHash })).operation; break;
    case "lazy_install": {
      const lazy = await (dependencies.lazyInstall ?? ensureLazyCapability)(preview.request.capability, { consentToHeavyweight: true, runtimeInstallOptions: options });
      if (lazy.status !== "installed" && lazy.status !== "already_available") throw new RuntimeLifecycleRefusal(lazy.status);
      result = lazy; break;
    }
    case "upgrade": result = await (dependencies.upgrade ?? upgradeManagedRuntimeSafely)({ strictProvisioningAuthority: dependencies.strictProvisioningAuthority, expectedCustodyHash }); break;
    case "rollback": result = await (dependencies.rollback ?? rollbackManagedRuntime)({ expectedCustodyHash, packIds: preview.targetPackIds }); break;
  }
  const after = (dependencies.readState ?? readManagedRuntimeState)();
  const readiness = evaluateManagedRuntimeReadiness({ state: after, requiredPackIds: after?.selectedPackIds ?? ["core"], pythonAvailable: (dependencies.pythonAvailable ?? (() => managedRuntimePythonPath() !== null))() });
  return { result, state: after, readiness, operationHash: preview.operationHash, previousManifestVersion: state?.manifestVersion ?? null, mutationAttempted: true as const };
}
