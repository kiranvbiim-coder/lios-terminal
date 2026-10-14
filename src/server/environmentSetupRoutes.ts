import type { Express } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "./auth";
import { auditActor, recordAuditEvent } from "./auditEvents";
import {
  getEnvironmentSetupStatus,
  getEnvironmentSetupForUser,
  normalizeSetupAiProviderId,
  requiresInitialAiVerification,
  updateEnvironmentSetup,
} from "./environmentSetupService";
import {
  inspectPythonRuntime,
  PYTHON_ENGINE_PACKS,
  PYTHON_RUNTIME_PROFILES,
  type PythonRuntimeId,
} from "./pythonRuntime";
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";
import { AIProviderError, AI_PROVIDERS, getProviderSetupOptions } from "./byoaiRouter";
import { verifyAIProviderConnection } from "./aiProviderVerification";
import { communityDataConsentSchema, updateEnvironmentSetupSchema } from "@shared/schema";
import { listCommunityConsents, setCommunityConsent, unconsentedRuntimePacks } from "./communityDataConsent";
import { deleteVaultCredential, listVaultCredentials, setVaultCredential } from "./credentialVault";
import {
  deleteOrganizationCredential,
  listOrganizationCredentials,
  organizationCredentialStoreEnabled,
  setOrganizationCredential,
} from "./organizationCredentialVault";
import { installManagedRuntime, ManagedRuntimeVerificationError, managedRuntimePythonPath, readManagedRuntimeState, rollbackManagedRuntime } from "./pythonRuntimeManager";
import { ManagedRuntimeProvisioningError, reconcileManagedRuntime } from "./managedRuntimeReconciler";
import { evaluateManagedRuntimeReadiness } from "./provisioningReadiness";
import { SP01_DEPENDENCY_INVENTORY } from "./sp01DependencyInventory";
import { P10_OPTIONAL_MANAGED_ADDON_IDS, P10_RUNTIME_PACK_IDS, P10_RUNTIME_PACKS, expandP10RuntimePacks } from "./p10RuntimePacks";
import { inspectSandboxImageReadiness, repairSandboxImage } from "./sandboxImageProvisioning";

const CREDENTIAL_NAMES = new Set([
  ...BUILT_IN_CONNECTORS.filter((connector) => connector.vaultKey).map((connector) => connector.vaultKey!),
  ...AI_PROVIDERS.map((provider) => provider.vaultKey),
]);
const CUSTOM_CREDENTIAL_NAME = /^[a-z0-9][a-z0-9_-]{1,100}$/;
const credentialSchema = z.object({
  value: z.string().trim().min(1).max(10_000),
  label: z.string().trim().min(1).max(200).optional(),
});

const aiVerificationSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200).nullable().optional(),
}).strict();

function aiVerificationStatus(error: AIProviderError): number {
  if (error.code === "invalid_provider" || error.code === "invalid_request") return 400;
  if (error.code === "policy_denied") return 403;
  if (error.code === "not_configured") return 409;
  if (error.code === "rate_limited") return 429;
  if (error.code === "timeout") return 504;
  return 502;
}

export function registerEnvironmentSetupRoutes(app: Express): void {
  app.get("/api/setup/sandbox-image", requireAuth, async (_req, res, next) => {
    try {
      res.json(await inspectSandboxImageReadiness());
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/setup/sandbox-image/repair", requireRole("internal_admin", "client_admin"), async (req, res, next) => {
    try {
      const readiness = await repairSandboxImage();
      await recordAuditEvent(req.user!.id, readiness.ready ? "sandbox_image_imported" : "sandbox_image_repair_blocked", {
        state: readiness.state,
        image: readiness.image,
        ...auditActor(req.user!),
      });
      res.json(readiness);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/setup/community-data-consent", requireAuth, async (req, res, next) => {
    try {
      res.json({ consents: await listCommunityConsents(req.user!.id) });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/setup/community-data-consent", requireAuth, async (req, res, next) => {
    const parsed = communityDataConsentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const result = await setCommunityConsent(
        req.user!.id,
        parsed.data.scope,
        parsed.data.accept,
        parsed.data.consentVersion,
      );
      await recordAuditEvent(req.user!.id, parsed.data.accept ? "community_data_consent_granted" : "community_data_consent_revoked", {
        scope: parsed.data.scope,
        consentVersion: parsed.data.consentVersion,
        ...auditActor(req.user!),
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/setup/status", requireAuth, async (req, res, next) => {
    try {
      const status = await getEnvironmentSetupStatus(req.user!.id);
      res.json({ ...status, aiProviders: getProviderSetupOptions() });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/setup/status", requireAuth, async (req, res, next) => {
    const parsed = updateEnvironmentSetupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const existing = await getEnvironmentSetupForUser(req.user!.id);
      if (requiresInitialAiVerification(existing, parsed.data)) {
        const provider = normalizeSetupAiProviderId(parsed.data.aiProviderId);
        if (!provider) {
          res.status(400).json({ error: { code: "invalid_request", message: "Choose a valid AI provider before completing setup." } });
          return;
        }
        try {
          const verification = await verifyAIProviderConnection({
            provider,
            model: parsed.data.aiModelId ?? null,
          });
          await recordAuditEvent(req.user!.id, "ai_provider_live_verified", {
            provider: verification.provider,
            model: verification.model,
            latencyMs: verification.latencyMs,
            reason: "initial_environment_setup_completion",
            ...auditActor(req.user!),
          });
        } catch (error) {
          const providerError = error instanceof AIProviderError
            ? error
            : new AIProviderError("unavailable", error instanceof Error ? error.message : "AI provider verification failed.");
          await recordAuditEvent(req.user!.id, "ai_provider_live_verification_failed", {
            provider,
            model: parsed.data.aiModelId ?? null,
            code: providerError.code,
            reason: "initial_environment_setup_completion",
            ...auditActor(req.user!),
          });
          res.status(aiVerificationStatus(providerError)).json({
            ok: false,
            error: providerError.toJSON(),
          });
          return;
        }
      }

      const setup = await updateEnvironmentSetup(
        req.user!.id,
        req.user!.organizationId ?? null,
        parsed.data,
        req.user!,
      );
      res.json({ setup, setupNeeded: !setup.completedAt });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/setup/ai/test", requireAuth, async (req, res) => {
    const parsed = aiVerificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: { code: "invalid_request", message: "Choose a valid AI provider and model." } });
      return;
    }

    try {
      const result = await verifyAIProviderConnection(parsed.data);
      await recordAuditEvent(req.user!.id, "ai_provider_live_verified", {
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        ...auditActor(req.user!),
      });
      res.json(result);
    } catch (error) {
      const providerError = error instanceof AIProviderError
        ? error
        : new AIProviderError("unavailable", error instanceof Error ? error.message : "AI provider verification failed.");
      await recordAuditEvent(req.user!.id, "ai_provider_live_verification_failed", {
        provider: parsed.data.provider,
        model: parsed.data.model ?? null,
        code: providerError.code,
        ...auditActor(req.user!),
      });
      res.status(aiVerificationStatus(providerError)).json({
        ok: false,
        error: providerError.toJSON(),
      });
    }
  });

  app.get("/api/setup/python-runtime", requireAuth, async (req, res, next) => {
    try {
      const setup = await getEnvironmentSetupForUser(req.user!.id);
      const runtimeId = PYTHON_RUNTIME_PROFILES.some((profile) => profile.id === setup?.pythonRuntimeId)
        ? setup?.pythonRuntimeId as PythonRuntimeId
        : undefined;
      const status = await inspectPythonRuntime({
        runtimeId,
        environmentPath: setup?.pythonEnvironmentPath,
      });
      const managedState = readManagedRuntimeState();
      res.json({
        profiles: PYTHON_RUNTIME_PROFILES,
        packs: PYTHON_ENGINE_PACKS,
        releasePacks: P10_RUNTIME_PACKS,
        managedState,
        managedRuntimeReadiness: evaluateManagedRuntimeReadiness({
          state: managedState,
          pythonAvailable: Boolean(managedRuntimePythonPath()),
          requiredPackIds: ["core"],
        }),
        sp01Dependencies: SP01_DEPENDENCY_INVENTORY,
        status,
      });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/setup/python-runtime/install", requireRole("internal_admin", "client_admin"), async (req, res, next) => {
    const parsed = z.object({
      reconcile: z.boolean().optional(),
      packIds: z.array(z.string().trim().min(1)).max(20).optional(),
      releasePackIds: z.array(z.enum(P10_RUNTIME_PACK_IDS)).max(P10_RUNTIME_PACK_IDS.length).optional(),
      additionalPackIds: z.array(z.enum(P10_OPTIONAL_MANAGED_ADDON_IDS)).max(P10_OPTIONAL_MANAGED_ADDON_IDS.length).optional(),
    }).superRefine((value, issue) => {
      if (value.packIds?.length && (value.releasePackIds?.length || value.additionalPackIds?.length)) {
        issue.addIssue({ code: z.ZodIssueCode.custom, message: "Choose legacy low-level packIds or releasePackIds/additionalPackIds, not both." });
      }
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      const releasePackIds = parsed.data.releasePackIds ?? [];
      const additionalPackIds = parsed.data.additionalPackIds ?? [];
      const managedPackIds = releasePackIds.length || additionalPackIds.length
        ? [...new Set([...expandP10RuntimePacks(releasePackIds), ...additionalPackIds])]
        : (parsed.data.packIds?.length ? parsed.data.packIds : ["core"]);
      // P0.5: the community-yahoo pack installs yfinance, which is the same
      // real capability the yahoo_community connector consent governs.
      // Installing it without that consent record would be a second,
      // ungated door to the same data -- refuse rather than silently
      // installing it.
      const blocked = await unconsentedRuntimePacks(req.user!.id, parsed.data.reconcile
        ? [...new Set([...managedPackIds, ...(readManagedRuntimeState()?.selectedPackIds ?? [])])]
        : managedPackIds);
      if (blocked.length) {
        res.status(403).json({
          error: "A selected runtime pack requires community-data consent that has not been accepted.",
          blockedPacks: blocked,
        });
        return;
      }
      if (parsed.data.reconcile) {
        try {
          const reconciled = await reconcileManagedRuntime({
            requiredPackIds: managedPackIds,
            ...(parsed.data.releasePackIds ? { selectedReleasePackIds: releasePackIds } : {}),
          });
          await recordAuditEvent(req.user!.id, "python_runtime_reconciled", {
            action: reconciled.action,
            before: reconciled.before.state,
            after: reconciled.after.state,
            packIds: reconciled.state?.selectedPackIds ?? [],
            hashVerified: reconciled.state?.hashVerified ?? false,
            ...auditActor(req.user!),
          });
          res.json({ releasePackIds, additionalPackIds, result: reconciled, state: readManagedRuntimeState() });
        } catch (error) {
          const readiness = error instanceof ManagedRuntimeProvisioningError
            ? error.readiness
            : evaluateManagedRuntimeReadiness({
                state: readManagedRuntimeState(),
                pythonAvailable: Boolean(managedRuntimePythonPath()),
                requiredPackIds: managedPackIds,
              });
          const diskFull = (error as NodeJS.ErrnoException)?.code === "ENOSPC";
          const code = error instanceof ManagedRuntimeProvisioningError || error instanceof ManagedRuntimeVerificationError
            ? error.code
            : diskFull ? "insufficient_disk" : "install_failed";
          await recordAuditEvent(req.user!.id, "python_runtime_reconciliation_failed", {
            code,
            readiness: readiness.state,
            rollbackApplied: error instanceof ManagedRuntimeProvisioningError && error.rollbackApplied,
            ...auditActor(req.user!),
          });
          res.status(code === "unsupported" ? 400 : diskFull ? 507 : 409).json({
            ok: false,
            error: { code, message: error instanceof ManagedRuntimeProvisioningError || error instanceof ManagedRuntimeVerificationError
              ? error.message
              : diskFull
                ? "Insufficient disk space to stage the managed runtime."
                : "Managed runtime installation failed; check interpreter and download availability, then retry." },
            readiness,
            rollbackApplied: error instanceof ManagedRuntimeProvisioningError && error.rollbackApplied,
          });
        }
        return;
      }
      const result = await installManagedRuntime(managedPackIds, releasePackIds);
      await recordAuditEvent(req.user!.id, "python_runtime_installed", {
        releasePackIds,
        additionalPackIds,
        packIds: result.state.selectedPackIds,
        manifestVersion: result.state.manifestVersion,
        hashVerified: result.state.hashVerified,
        verificationWarnings: result.state.verificationWarnings,
        ...auditActor(req.user!),
      });
      res.json({ releasePackIds, additionalPackIds, result, state: readManagedRuntimeState() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/setup/python-runtime/rollback", requireRole("internal_admin", "client_admin"), async (req, res, next) => {
    try {
      const result = await rollbackManagedRuntime();
      await recordAuditEvent(req.user!.id, "python_runtime_rolled_back", {
        manifestVersion: result.state.manifestVersion,
        ...auditActor(req.user!),
      });
      res.json({ result, state: readManagedRuntimeState() });
    } catch (error) {
      next(error);
    }
  });
  app.get("/api/setup/credentials", requireAuth, async (req, res, next) => {
    try {
      if (organizationCredentialStoreEnabled() && req.user!.organizationId != null) {
        res.json(await listOrganizationCredentials(req.user!.organizationId));
        return;
      }
      res.json(listVaultCredentials());
    } catch (error) {
      next(error);
    }
  });
  app.delete("/api/setup/credentials/:name", requireAuth, async (req, res, next) => {
    const name = String(req.params.name);
    if (!CREDENTIAL_NAMES.has(name) && !CUSTOM_CREDENTIAL_NAME.test(name)) {
      res.status(404).json({ error: "Credential name is not supported by the connector registry." });
      return;
    }
    try {
      const deleted = organizationCredentialStoreEnabled() && req.user!.organizationId != null
        ? await deleteOrganizationCredential(req.user!.organizationId, name)
        : deleteVaultCredential(name);
      if (!deleted) {
        res.status(404).json({ error: "Credential not found." });
        return;
      }
      await recordAuditEvent(req.user!.id, "setup_credential_deleted", {
        credentialName: name,
        storageScope: organizationCredentialStoreEnabled() && req.user!.organizationId != null ? "organization" : "local",
        ...auditActor(req.user!),
      });
      res.json({ ok: true, name });
    } catch (error) {
      next(error);
    }
  });


  app.put("/api/setup/credentials/:name", requireAuth, async (req, res, next) => {
    const name = String(req.params.name);
    if (!CREDENTIAL_NAMES.has(name) && !CUSTOM_CREDENTIAL_NAME.test(name)) {
      res.status(404).json({ error: "Credential name is not supported by the connector registry." });
      return;
    }
    const parsed = credentialSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    try {
      if (organizationCredentialStoreEnabled() && req.user!.organizationId !== null && req.user!.organizationId !== undefined) {
        await setOrganizationCredential(
          req.user!.organizationId,
          name,
          parsed.data.value,
          parsed.data.label,
          req.user!.id,
        );
      } else {
        setVaultCredential(name, parsed.data.value, parsed.data.label);
      }
      await recordAuditEvent(req.user!.id, "setup_credential_saved", {
        credentialName: name,
        storageScope: organizationCredentialStoreEnabled() && req.user!.organizationId != null ? "organization" : "local",
        ...auditActor(req.user!),
      });
      res.json({ ok: true, name });
    } catch (error) {
      next(error);
    }
  });
}