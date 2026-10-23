import type { Express } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "./auth";
import { auditActor, recordAuditEvent } from "./auditEvents";
import {
  getEnvironmentSetupStatus,
  getEnvironmentSetupForUser,
  normalizeSetupAiProviderId,
  updateEnvironmentSetup,
} from "./environmentSetupService";
import {
  inspectPythonRuntime,
  PYTHON_ENGINE_PACKS,
  PYTHON_RUNTIME_PROFILES,
  type PythonRuntimeId,
} from "./pythonRuntime";
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";
import { AIProviderError, AI_PROVIDERS, getProviderSetupOptions, normalizeProviderId } from "./byoaiRouter";
import { verifyAIProviderConnection } from "./aiProviderVerification";
import { discoverLocalAIModels, resolveLocalProviderChatEndpoint } from "./byoaiTransport";
import { beginAIChatVerification, invalidateAIChatVerification, recordConnectorVerification } from "./connectorVerification";
import { personaUserFromRequest, turnMasterAiOff } from "./masterAiGate";
import { communityDataConsentSchema, updateEnvironmentSetupSchema } from "@shared/schema";
import { listCommunityConsents, setCommunityConsent } from "./communityDataConsent";
import { deleteVaultCredential, listVaultCredentials, setVaultCredential } from "./credentialVault";
import {
  deleteOrganizationCredential,
  listOrganizationCredentials,
  organizationCredentialStoreEnabled,
  setOrganizationCredential,
} from "./organizationCredentialVault";
import { managedRuntimePythonPath, readManagedRuntimeState } from "./pythonRuntimeManager";
import { evaluateManagedRuntimeReadiness } from "./provisioningReadiness";
import { planManagedRuntimeRepair } from "./doctorRepairPlan";
import { SP01_DEPENDENCY_INVENTORY } from "./sp01DependencyInventory";
import { P10_RUNTIME_PACKS } from "./p10RuntimePacks";
import { inspectSandboxImageReadiness, repairSandboxImage } from "./sandboxImageProvisioning";
import { runtimeLifecycleRequestSchema } from "@shared/runtimeLifecycle";
import { applyRuntimeLifecycle, previewRuntimeLifecycle, RuntimeLifecycleRefusal, type RuntimeLifecycleDependencies } from "./runtimeLifecycle";

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
  endpoint: z.string().trim().min(1).max(2_000).optional(),
}).strict();

function aiVerificationStatus(error: AIProviderError): number {
  if (error.code === "invalid_provider" || error.code === "invalid_request") return 400;
  if (error.code === "policy_denied") return 403;
  if (error.code === "not_configured") return 409;
  if (error.code === "rate_limited") return 429;
  if (error.code === "timeout") return 504;
  return 502;
}

export function registerEnvironmentSetupRoutes(app: Express, lifecycleDependencies: RuntimeLifecycleDependencies = {}): void {
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
      const provider = normalizeSetupAiProviderId(parsed.data.aiProviderId);
      const selectionChanged = (existing?.aiProviderId ?? null) !== provider || (existing?.aiModelId ?? null) !== (parsed.data.aiModelId ?? null);
      if (selectionChanged) {
        if (existing?.aiProviderId) invalidateAIChatVerification(existing.aiProviderId, req.user!.organizationId ?? null, req.user!.id);
        if (provider) invalidateAIChatVerification(provider, req.user!.organizationId ?? null, req.user!.id);
        await turnMasterAiOff(personaUserFromRequest(req));
        if (existing?.aiProviderId) recordConnectorVerification(existing.aiProviderId, false, "The selected AI identity changed; explicit chat verification is required.");
        if (provider) recordConnectorVerification(provider, false, "The selected AI identity changed; explicit chat verification is required.");
      }
      const setup = await updateEnvironmentSetup(
        req.user!.id,
        req.user!.organizationId ?? null,
        parsed.data,
        req.user!,
      );
      if (selectionChanged) {
        if (existing?.aiProviderId) invalidateAIChatVerification(existing.aiProviderId, req.user!.organizationId ?? null, req.user!.id);
        if (provider) invalidateAIChatVerification(provider, req.user!.organizationId ?? null, req.user!.id);
      }
      res.json({ setup, setupNeeded: !setup.completedAt });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/setup/ai/models", requireAuth, async (req, res) => {
    const parsed = aiVerificationSchema.pick({ provider: true }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Choose a local AI provider." });
      return;
    }
    try {
      res.json(await discoverLocalAIModels(parsed.data.provider));
    } catch (error) {
      const providerError = error instanceof AIProviderError
        ? error
        : new AIProviderError("unavailable", "The selected local model server could not list its models.");
      res.status(aiVerificationStatus(providerError)).json({ ok: false, error: providerError.toJSON() });
    }
  });
  app.post("/api/setup/ai/test", requireAuth, async (req, res) => {
    const parsed = aiVerificationSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: { code: "invalid_request", message: "Choose a valid AI provider and model." } });
      return;
    }

    try {
      const provider = normalizeProviderId(parsed.data.provider);
      const attempt = provider ? beginAIChatVerification({ provider, credentialName: AI_PROVIDERS.find(item => item.id === provider)?.vaultKey, userId: req.user!.id, organizationId: req.user!.organizationId ?? null }) : undefined;
      if (provider) recordConnectorVerification(provider, false, "Explicit chat verification is in progress.");
      await turnMasterAiOff(personaUserFromRequest(req));
      const result = await verifyAIProviderConnection(parsed.data, undefined, { userId: req.user!.id, attempt });
      await recordAuditEvent(req.user!.id, "ai_provider_live_verified", {
        provider: result.provider,
        model: result.model,
        latencyMs: result.latencyMs,
        ...auditActor(req.user!),
      });
      res.json(result);
    } catch (error) {
      const provider = normalizeProviderId(parsed.data.provider);
      if (provider) recordConnectorVerification(provider, false, "The explicit chat probe failed; chat remains unverified.");
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
      const managedRuntimeReadiness = evaluateManagedRuntimeReadiness({
        state: managedState,
        pythonAvailable: Boolean(managedRuntimePythonPath()),
        requiredPackIds: ["core"],
      });
      res.json({
        profiles: PYTHON_RUNTIME_PROFILES,
        packs: PYTHON_ENGINE_PACKS,
        releasePacks: P10_RUNTIME_PACKS,
        managedState,
        managedRuntimeReadiness,
        doctorRepairPlan: planManagedRuntimeRepair(managedRuntimeReadiness, {
          isolationMode: "strict", strictProvisioningAuthorityAvailable: Boolean(lifecycleDependencies.strictProvisioningAuthority),
        }),
        sp01Dependencies: SP01_DEPENDENCY_INVENTORY,
        status,
      });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/setup/python-runtime/lifecycle/preview", requireRole("internal_admin", "client_admin"), async (req, res, next) => {
    const parsed = runtimeLifecycleRequestSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    try {
      const preview = await previewRuntimeLifecycle(req.user!, parsed.data, lifecycleDependencies);
      await recordAuditEvent(req.user!.id, "python_runtime_lifecycle_previewed", {
        operation: preview.request.operation, operationHash: preview.operationHash,
        blockers: preview.blockers, sourceStateHash: preview.sourceStateHash,
        targetManifestHash: preview.targetManifestHash, ...auditActor(req.user!),
      });
      res.json(preview);
    } catch (error) {
      if (error instanceof RuntimeLifecycleRefusal) { res.status(403).json({ error: error.message, code: error.code }); return; }
      next(error);
    }
  });
  app.post("/api/setup/python-runtime/lifecycle/apply", requireRole("internal_admin", "client_admin"), async (req, res, next) => {
    const parsed = z.object({
      request: runtimeLifecycleRequestSchema, confirmed: z.literal(true),
      operationHash: z.string().regex(/^[a-f0-9]{64}$/),
      confirmationToken: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().int(),
    }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.flatten() }); return; }
    try {
      const outcome = await applyRuntimeLifecycle(req.user!, parsed.data, lifecycleDependencies);
      await recordAuditEvent(req.user!.id, "python_runtime_lifecycle_applied", {
        operation: parsed.data.request.operation, operationHash: outcome.operationHash,
        readiness: outcome.readiness.state, ...auditActor(req.user!),
      });
      res.json(outcome);
    } catch (error) {
      if (error instanceof RuntimeLifecycleRefusal) {
        await recordAuditEvent(req.user!.id, "python_runtime_lifecycle_refused", { operation: parsed.data.request.operation, code: error.code, ...auditActor(req.user!) });
        res.status(error.code === "current_administrator_required" ? 403 : 409).json({ error: error.message, code: error.code, blockers: error.blockers });
        return;
      }
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
      const configuredAiProvider = AI_PROVIDERS.find((provider) => provider.vaultKey === name);
      if (configuredAiProvider) {
        invalidateAIChatVerification(configuredAiProvider.id, organizationCredentialStoreEnabled() ? req.user!.organizationId ?? null : undefined);
        await turnMasterAiOff(personaUserFromRequest(req));
      }
      const deleted = organizationCredentialStoreEnabled() && req.user!.organizationId != null
        ? await deleteOrganizationCredential(req.user!.organizationId, name)
        : deleteVaultCredential(name);
      if (!deleted) {
        res.status(404).json({ error: "Credential not found." });
        return;
      }
      const aiProvider = AI_PROVIDERS.find((provider) => provider.vaultKey === name);
      if (aiProvider) {
        invalidateAIChatVerification(aiProvider.id, organizationCredentialStoreEnabled() ? req.user!.organizationId ?? null : undefined);
        recordConnectorVerification(aiProvider.id, false, "Provider configuration was revoked; chat verification is no longer valid.");
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
      const localProvider = AI_PROVIDERS.find((provider) => provider.isLocal && provider.vaultKey === name);
      if (localProvider?.id === "ollama" || localProvider?.id === "lm_studio") {
        const chosen = resolveLocalProviderChatEndpoint(localProvider.id, parsed.data.value);
        const managed = process.env[localProvider.envKey]?.trim();
        if (managed && resolveLocalProviderChatEndpoint(localProvider.id, managed) !== chosen) {
          res.status(409).json({ error: "An operator-managed environment endpoint overrides this provider. Remove or change that environment setting before choosing a different endpoint." });
          return;
        }
      }
      const configuredAiProvider = AI_PROVIDERS.find((provider) => provider.vaultKey === name);
      if (configuredAiProvider) {
        invalidateAIChatVerification(configuredAiProvider.id, organizationCredentialStoreEnabled() ? req.user!.organizationId ?? null : undefined);
        await turnMasterAiOff(personaUserFromRequest(req));
      }
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
      const aiProvider = AI_PROVIDERS.find((provider) => provider.vaultKey === name);
      if (aiProvider) {
        invalidateAIChatVerification(aiProvider.id, organizationCredentialStoreEnabled() ? req.user!.organizationId ?? null : undefined);
        recordConnectorVerification(aiProvider.id, false, "Provider configuration changed; explicit chat verification is required.");
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