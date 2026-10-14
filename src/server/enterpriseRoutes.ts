import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "./auth";
import {
  assessEnterprisePolicy,
  enterprisePolicySchema,
  evaluateEnterpriseAiProvider,
  evaluateEnterpriseConnector,
  evaluateEnterpriseExport,
  evaluateEnterpriseSharing,
} from "@shared/enterpriseContracts";
import {
  getEnterpriseOrganizationOverview,
  getEnterprisePolicy,
  listEnterpriseOrganizations,
  saveEnterprisePolicy,
} from "./enterprisePolicyService";
import { setOrganizationCredential } from "./organizationCredentialVault";
import { recordSecurityAuditEvent, auditActor } from "./auditEvents";
import { ENTERPRISE_SSO_CREDENTIALS, getEnterpriseSsoRuntimeReadiness } from "./enterpriseSso";
import {
  ENTERPRISE_PRIVATE_DEPLOYMENT_CREDENTIAL,
  getEnterpriseDeploymentReadiness,
  verifyEnterpriseDeploymentEndpoint,
} from "./enterpriseDeployment";

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;

function organizationIdFromRequest(value: string): number | null {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerEnterpriseRoutes(app: Express): void {
  app.get("/api/enterprise/organizations", requireRole(...READ_ROLES), async (_req, res) => {
    res.json(await listEnterpriseOrganizations());
  });

  app.get("/api/enterprise/organizations/:orgId", requireRole(...READ_ROLES), async (req, res) => {
    const organizationId = organizationIdFromRequest(String(req.params.orgId));
    if (organizationId === null) return res.status(400).json({ error: "A valid organization ID is required." });
    const overview = await getEnterpriseOrganizationOverview(organizationId);
    if (!overview) return res.status(404).json({ error: "Organization not found." });
    res.json(overview);
  });

  app.get("/api/enterprise/organizations/:orgId/policy", requireRole(...READ_ROLES), async (req, res) => {
    const organizationId = organizationIdFromRequest(String(req.params.orgId));
    if (organizationId === null) return res.status(400).json({ error: "A valid organization ID is required." });
    const record = await getEnterprisePolicy(organizationId);
    if (!record) return res.status(404).json({ error: "Organization not found." });
    res.json({ ...record, readiness: assessEnterprisePolicy(record.policy) });
  });

  app.put("/api/enterprise/organizations/:orgId/policy", requireRole("internal_admin"), async (req, res) => {
    const organizationId = organizationIdFromRequest(String(req.params.orgId));
    if (organizationId === null) return res.status(400).json({ error: "A valid organization ID is required." });
    const parsed = enterprisePolicySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const record = await saveEnterprisePolicy(organizationId, parsed.data, req.user!);
      res.json({ ...record, readiness: assessEnterprisePolicy(record.policy) });
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "Could not save enterprise policy." });
    }
  });


  app.get("/api/enterprise/organizations/:orgId/sso/runtime", requireRole(...READ_ROLES), async (req, res) => {
    const organizationId = organizationIdFromRequest(String(req.params.orgId));
    if (organizationId === null) return res.status(400).json({ error: "A valid organization ID is required." });
    try {
      res.json(await getEnterpriseSsoRuntimeReadiness(organizationId));
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "Could not inspect enterprise SSO runtime." });
    }
  });

  app.put("/api/enterprise/organizations/:orgId/sso/credentials", requireRole("internal_admin"), async (req, res) => {
    const organizationId = organizationIdFromRequest(String(req.params.orgId));
    if (organizationId === null) return res.status(400).json({ error: "A valid organization ID is required." });
    const parsed = z.object({
      clientSecret: z.string().min(8).max(10_000).optional(),
      samlVerifierSecret: z.string().min(24).max(10_000).optional(),
    }).refine((value) => Boolean(value.clientSecret || value.samlVerifierSecret), {
      message: "At least one enterprise SSO credential is required.",
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      if (parsed.data.clientSecret) {
        await setOrganizationCredential(
          organizationId,
          ENTERPRISE_SSO_CREDENTIALS.oidcClientSecret,
          parsed.data.clientSecret,
          "Enterprise OIDC client secret",
          req.user!.id,
        );
      }
      if (parsed.data.samlVerifierSecret) {
        await setOrganizationCredential(
          organizationId,
          ENTERPRISE_SSO_CREDENTIALS.samlVerifierSecret,
          parsed.data.samlVerifierSecret,
          "Enterprise SAML verifier HMAC secret",
          req.user!.id,
        );
      }
      await recordSecurityAuditEvent(req.user!.id, "enterprise_sso_credentials_updated", {
        organizationId,
        oidcClientSecretUpdated: Boolean(parsed.data.clientSecret),
        samlVerifierSecretUpdated: Boolean(parsed.data.samlVerifierSecret),
        ...auditActor(req.user!),
      });
      res.json(await getEnterpriseSsoRuntimeReadiness(organizationId));
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Could not store enterprise SSO credentials." });
    }
  });

  app.get("/api/enterprise/organizations/:orgId/deployment/runtime", requireRole(...READ_ROLES), async (req, res) => {
    const organizationId = organizationIdFromRequest(String(req.params.orgId));
    if (organizationId === null) return res.status(400).json({ error: "A valid organization ID is required." });
    try {
      res.json(await getEnterpriseDeploymentReadiness(organizationId));
    } catch (error) {
      res.status(404).json({ error: error instanceof Error ? error.message : "Could not inspect private deployment runtime." });
    }
  });

  app.put("/api/enterprise/organizations/:orgId/deployment/credential", requireRole("internal_admin"), async (req, res) => {
    const organizationId = organizationIdFromRequest(String(req.params.orgId));
    if (organizationId === null) return res.status(400).json({ error: "A valid organization ID is required." });
    const parsed = z.object({ token: z.string().min(24).max(10_000) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      await setOrganizationCredential(
        organizationId,
        ENTERPRISE_PRIVATE_DEPLOYMENT_CREDENTIAL,
        parsed.data.token,
        "Enterprise private deployment verification token",
        req.user!.id,
      );
      await recordSecurityAuditEvent(req.user!.id, "enterprise_private_deployment_credential_updated", {
        organizationId,
        ...auditActor(req.user!),
      });
      res.json(await getEnterpriseDeploymentReadiness(organizationId));
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Could not store private deployment credential." });
    }
  });

  app.post("/api/enterprise/organizations/:orgId/deployment/verify", requireRole("internal_admin"), async (req, res) => {
    const organizationId = organizationIdFromRequest(String(req.params.orgId));
    if (organizationId === null) return res.status(400).json({ error: "A valid organization ID is required." });
    try {
      const verification = await verifyEnterpriseDeploymentEndpoint(organizationId);
      await recordSecurityAuditEvent(req.user!.id, "enterprise_private_deployment_verified", {
        organizationId,
        mode: verification.mode,
        verified: verification.verified,
        statusCode: verification.statusCode,
        challengeMatched: verification.challengeMatched,
        ...auditActor(req.user!),
      });
      res.status(verification.verified ? 200 : 409).json(verification);
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : "Private deployment verification failed." });
    }
  });

  // Policy decisions are read-only and are intentionally exposed as a single
  // deterministic evaluator so every future connector, AI, export, and share
  // surface can use the same enterprise gate.
  app.post("/api/enterprise/organizations/:orgId/policy/check", requireRole(...READ_ROLES), async (req, res) => {
    const organizationId = organizationIdFromRequest(String(req.params.orgId));
    if (organizationId === null) return res.status(400).json({ error: "A valid organization ID is required." });
    const parsed = z.object({
      kind: z.enum(["connector", "ai", "export", "sharing"]),
      identifier: z.string().trim().min(1).max(240),
      secondary: z.string().trim().max(240).nullable().optional(),
      private: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const record = await getEnterprisePolicy(organizationId);
    if (!record) return res.status(404).json({ error: "Organization not found." });
    const { kind, identifier, secondary, private: isPrivate = false } = parsed.data;
    const decision = kind === "connector"
      ? evaluateEnterpriseConnector(record.policy, identifier, isPrivate)
      : kind === "ai"
        ? evaluateEnterpriseAiProvider(record.policy, identifier, secondary)
        : kind === "export"
          ? evaluateEnterpriseExport(record.policy, identifier, req.user!.role)
          : evaluateEnterpriseSharing(record.policy, identifier as "organization" | "external" | "public");
    res.json({ organizationId, kind, identifier, ...decision });
  });
}
