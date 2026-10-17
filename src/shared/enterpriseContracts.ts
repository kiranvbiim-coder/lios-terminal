/**
 * V4-24 Enterprise governance contracts.
 *
 * These contracts deliberately model the controls that can be enforced by
 * LiOS locally. SSO handshakes, hosted provisioning, and private deployment
 * services remain explicit readiness states instead of being represented as
 * if they were live.
 */
import { z } from "zod";

export const ENTERPRISE_CONTRACT_VERSION = "1.0.0" as const;

export const enterprisePermissionSchema = z.enum([
  "manage_organization",
  "manage_users",
  "manage_connectors",
  "manage_ai_policy",
  "manage_workspaces",
  "manage_network",
  "manage_retention",
  "manage_devices",
  "view_audit",
  "export_data",
  "use_ai",
  "use_external_connections",
  "read_decisions",
  "author_decisions",
  "review_decisions",
]);
export type EnterprisePermission = z.infer<typeof enterprisePermissionSchema>;

export const DECISION_PERMISSIONS = ["read_decisions", "author_decisions", "review_decisions"] as const;
export type DecisionPermission = typeof DECISION_PERMISSIONS[number];
export type EnterpriseRole = keyof EnterprisePolicy["roles"]["grants"];

/** Organization grants only narrow these existing security-role ceilings. Personas are not roles. */
export const DECISION_ROLE_CEILINGS: Record<EnterpriseRole, readonly DecisionPermission[]> = {
  internal_admin: DECISION_PERMISSIONS,
  internal_analyst: ["read_decisions", "author_decisions"],
  internal_compliance: ["read_decisions", "review_decisions"],
  client_admin: [],
  client_user: [],
};

const roleGrantSchema = z.object({
  internal_admin: z.array(enterprisePermissionSchema).max(50),
  internal_analyst: z.array(enterprisePermissionSchema).max(50),
  internal_compliance: z.array(enterprisePermissionSchema).max(50),
  client_admin: z.array(enterprisePermissionSchema).max(50),
  client_user: z.array(enterprisePermissionSchema).max(50),
}).strict();

const boundedStringArray = z.array(z.string().trim().min(1).max(160)).max(200);

export const enterprisePolicySchema = z.object({
  version: z.number().int().positive(),
  seats: z.object({
    maxSeats: z.number().int().positive().nullable(),
    allowSelfJoin: z.boolean(),
    requireAdminApproval: z.boolean(),
    allowedEmailDomains: z.array(z.string().trim().min(1).max(160).regex(/^[a-z0-9.-]+$/i)).max(100),
  }).strict(),
  roles: z.object({ grants: roleGrantSchema }).strict(),
  sso: z.object({
    mode: z.enum(["disabled", "oidc", "saml"]),
    status: z.enum(["not_configured", "contract_only", "ready", "blocked"]),
    issuer: z.string().trim().max(500).nullable(),
    clientId: z.string().trim().max(240).nullable(),
    authorizationUrl: z.string().trim().url().max(1_000).nullable(),
    externalProvisioning: z.boolean(),
  }).strict(),
  connectors: z.object({
    allowedConnectorIds: boundedStringArray,
    deniedConnectorIds: boundedStringArray,
    requireAdminApproval: z.boolean(),
    allowPrivateConnections: z.boolean(),
  }).strict(),
  ai: z.object({
    allowedProviders: boundedStringArray,
    allowedModels: boundedStringArray,
    requireApproval: z.boolean(),
    allowExternalData: z.boolean(),
    endpointMode: z.enum(["local_only", "configured_private", "hosted"]),
    endpointUrl: z.string().trim().url().max(1_000).nullable(),
  }).strict(),
  workspaces: z.object({
    defaultVisibility: z.enum(["private", "organization"]),
    allowOrganizationSharing: z.boolean(),
    allowExternalSharing: z.boolean(),
    allowedPrimitives: boundedStringArray,
  }).strict(),
  network: z.object({
    allowPublicProfiles: z.boolean(),
    allowPublicPosts: z.boolean(),
    allowExternalSharing: z.boolean(),
    requireDisclosures: z.boolean(),
  }).strict(),
  retention: z.object({
    workspaceDays: z.number().int().positive().nullable(),
    auditDays: z.number().int().positive().nullable(),
    allowUserExport: z.boolean(),
    allowedExportFormats: z.array(z.enum(["csv", "json", "xlsx", "pdf"])).max(4),
    legalHold: z.boolean(),
  }).strict(),
  devices: z.object({
    requireAuthorization: z.boolean(),
    maxDevicesPerUser: z.number().int().positive().nullable(),
    leaseDays: z.number().int().positive().max(3650),
  }).strict(),
  deployment: z.object({
    mode: z.enum(["local", "hosted", "private_cloud", "isolated"]),
    status: z.enum(["local_ready", "external_setup_required", "ready", "blocked"]),
    privateEndpointUrl: z.string().trim().url().max(1_000).nullable(),
  }).strict(),
}).strict();
export type EnterprisePolicy = z.infer<typeof enterprisePolicySchema>;

const allPermissions = enterprisePermissionSchema.options;
const clientAdminPermissions: EnterprisePermission[] = [
  "manage_users", "manage_workspaces", "manage_network", "manage_devices", "view_audit", "export_data", "use_ai",
];
const clientUserPermissions: EnterprisePermission[] = ["use_ai", "export_data"];

export const DEFAULT_ENTERPRISE_POLICY: EnterprisePolicy = {
  version: 2,
  seats: { maxSeats: null, allowSelfJoin: false, requireAdminApproval: true, allowedEmailDomains: [] },
  roles: {
    grants: {
      internal_admin: [...allPermissions],
      internal_analyst: ["view_audit", "manage_workspaces", "manage_network", "export_data", "use_ai", "use_external_connections", ...DECISION_ROLE_CEILINGS.internal_analyst],
      internal_compliance: ["view_audit", "manage_retention", "manage_network", "export_data", ...DECISION_ROLE_CEILINGS.internal_compliance],
      client_admin: clientAdminPermissions,
      client_user: clientUserPermissions,
    },
  },
  sso: { mode: "disabled", status: "not_configured", issuer: null, clientId: null, authorizationUrl: null, externalProvisioning: false },
  connectors: { allowedConnectorIds: [], deniedConnectorIds: [], requireAdminApproval: true, allowPrivateConnections: false },
  ai: { allowedProviders: [], allowedModels: [], requireApproval: true, allowExternalData: false, endpointMode: "local_only", endpointUrl: null },
  workspaces: { defaultVisibility: "private", allowOrganizationSharing: true, allowExternalSharing: false, allowedPrimitives: ["quote", "chart", "table", "metric", "news", "scenario", "report", "relationship"] },
  network: { allowPublicProfiles: false, allowPublicPosts: false, allowExternalSharing: false, requireDisclosures: true },
  retention: { workspaceDays: null, auditDays: null, allowUserExport: true, allowedExportFormats: ["csv", "json", "xlsx", "pdf"], legalHold: false },
  devices: { requireAuthorization: false, maxDevicesPerUser: null, leaseDays: 365 },
  deployment: { mode: "local", status: "local_ready", privateEndpointUrl: null },
};

function cloneDefault(): EnterprisePolicy {
  return JSON.parse(JSON.stringify(DEFAULT_ENTERPRISE_POLICY)) as EnterprisePolicy;
}

export function normalizeEnterprisePolicy(input: unknown): EnterprisePolicy {
  const parsed = enterprisePolicySchema.safeParse(input);
  if (!parsed.success) return cloneDefault();
  const policy = parsed.data;
  // Version 1 predates Decision grants. Migrate once within the old role ceilings;
  // version 2 explicitly absent grants remain denied, including after persistence.
  if (policy.version < 2) {
    for (const role of Object.keys(DECISION_ROLE_CEILINGS) as EnterpriseRole[]) {
      policy.roles.grants[role] = [...new Set([...policy.roles.grants[role], ...DECISION_ROLE_CEILINGS[role]])];
    }
    policy.version = 2;
  }
  return policy;
}

export interface EnterprisePolicyReadiness {
  localControlsReady: boolean;
  blockers: string[];
  checks: Array<{ id: string; label: string; status: "ready" | "configured" | "external" | "blocked"; detail: string }>;
}

export function assessEnterprisePolicy(policyInput: unknown): EnterprisePolicyReadiness {
  const policy = normalizeEnterprisePolicy(policyInput);
  const blockers: string[] = [];
  const checks: EnterprisePolicyReadiness["checks"] = [
    { id: "organization-seat-admin", label: "Organization and seat administration", status: "ready", detail: "Tenant-scoped seat and approval rules are enforceable locally." },
    { id: "role-policy", label: "Enterprise roles and policy", status: "ready", detail: "Role grants are explicit and fail closed when absent." },
    { id: "sso", label: "SSO architecture", status: policy.sso.mode === "disabled" ? "ready" : policy.sso.status === "ready" ? "configured" : "external", detail: policy.sso.mode === "disabled" ? "Password/session authentication remains the active path." : policy.sso.status === "ready" ? "OIDC/SAML runtime, external provisioning, desktop handoff, and replay controls are wired; dated production IdP evidence remains deployment-bound." : "SSO policy is not yet marked ready." },
    { id: "connector-policy", label: "Connector policy controls", status: "ready", detail: "Allow/deny and approval policy is evaluated before connector use." },
    { id: "ai-policy", label: "AI-provider policy controls", status: policy.ai.endpointMode === "local_only" ? "ready" : "external", detail: policy.ai.endpointMode === "local_only" ? "External data is denied by default." : "Provider credential, endpoint, and enterprise approval remain deployment-bound." },
    { id: "workspace-controls", label: "Shared workspace controls", status: "ready", detail: "Visibility and primitive policy are locally enforced." },
    { id: "network-controls", label: "Network and public-sharing controls", status: "ready", detail: "Public and external sharing are explicit opt-ins." },
    { id: "retention-export", label: "Retention and export controls", status: "ready", detail: "Durable retention/deletion receipts, legal-hold enforcement, and local-only export custody are wired." },
    { id: "device-admin", label: "Device and admin controls", status: "ready", detail: "Existing device authorization and session-control routes are governed by this policy." },
    { id: "private-deployment", label: "Private integration/deployment hooks", status: policy.deployment.mode === "local" ? "ready" : policy.deployment.status === "ready" ? "configured" : "external", detail: policy.deployment.mode === "local" ? "Local-first deployment is ready." : policy.deployment.status === "ready" ? "Authenticated private endpoint challenge/response is wired; dated live deployment evidence remains external." : "Private deployment policy is not yet marked ready." },
  ];
  if (policy.sso.mode !== "disabled" && policy.sso.status !== "ready") blockers.push("SSO provider handshake and external provisioning are not configured.");
  if (policy.ai.endpointMode !== "local_only") blockers.push("AI provider credentials/endpoint approval are required before external AI use.");
  if (policy.deployment.mode !== "local" && policy.deployment.status !== "ready") blockers.push("Private/hosted deployment service is not connected.");
  return { localControlsReady: blockers.length === 0, blockers, checks };
}

export function canUseEnterprisePermission(policyInput: unknown, role: keyof EnterprisePolicy["roles"]["grants"], permission: EnterprisePermission): boolean {
  if ((DECISION_PERMISSIONS as readonly string[]).includes(permission)
    && !DECISION_ROLE_CEILINGS[role]?.includes(permission as DecisionPermission)) return false;
  const policy = normalizeEnterprisePolicy(policyInput);
  return policy.roles.grants[role]?.includes(permission) ?? false;
}

export function evaluateEnterpriseExport(policyInput: unknown, format: string, requestedByRole: keyof EnterprisePolicy["roles"]["grants"]): { allowed: boolean; reason: string } {
  const policy = normalizeEnterprisePolicy(policyInput);
  if (!policy.retention.allowUserExport && requestedByRole.startsWith("client_")) return { allowed: false, reason: "User export is disabled by organization policy." };
  if (!policy.retention.allowedExportFormats.includes(format as EnterprisePolicy["retention"]["allowedExportFormats"][number])) return { allowed: false, reason: `Export format ${format} is not allowed by organization policy.` };
  if (!canUseEnterprisePermission(policy, requestedByRole, "export_data")) return { allowed: false, reason: `Role ${requestedByRole} does not have export permission.` };
  return { allowed: true, reason: "Export is permitted by the current organization policy." };
}

export function evaluateEnterpriseConnector(policyInput: unknown, connectorId: string, isPrivate = false): { allowed: boolean; reason: string } {
  const policy = normalizeEnterprisePolicy(policyInput);
  const id = connectorId.trim();
  if (!id) return { allowed: false, reason: "A connector ID is required." };
  if (policy.connectors.deniedConnectorIds.includes(id)) return { allowed: false, reason: `Connector ${id} is denied by organization policy.` };
  if (!policy.connectors.allowedConnectorIds.includes(id)) return { allowed: false, reason: `Connector ${id} is not on the organization allow-list.` };
  if (isPrivate && !policy.connectors.allowPrivateConnections) return { allowed: false, reason: "Private connections are disabled by organization policy." };
  return { allowed: true, reason: policy.connectors.requireAdminApproval ? "Connector is allowed; admin approval remains required before activation." : "Connector is allowed by organization policy." };
}

export function evaluateEnterpriseAiProvider(policyInput: unknown, providerId: string, modelId: string | null = null): { allowed: boolean; reason: string } {
  const policy = normalizeEnterprisePolicy(policyInput);
  if (!policy.ai.allowedProviders.includes(providerId)) return { allowed: false, reason: `AI provider ${providerId} is not on the organization allow-list.` };
  if (modelId && policy.ai.allowedModels.length > 0 && !policy.ai.allowedModels.includes(modelId)) return { allowed: false, reason: `AI model ${modelId} is not on the organization allow-list.` };
  if (policy.ai.endpointMode === "configured_private" && !policy.ai.endpointUrl) return { allowed: false, reason: "The configured private AI endpoint is not available." };
  return { allowed: true, reason: policy.ai.requireApproval ? "AI use is allowed; per-call approval remains required." : "AI use is allowed by organization policy." };
}

export function evaluateEnterpriseSharing(policyInput: unknown, scope: "organization" | "external" | "public"): { allowed: boolean; reason: string } {
  const policy = normalizeEnterprisePolicy(policyInput);
  if (scope === "organization" && !policy.workspaces.allowOrganizationSharing) return { allowed: false, reason: "Organization workspace sharing is disabled." };
  if (scope === "external" && !policy.workspaces.allowExternalSharing) return { allowed: false, reason: "External workspace sharing is disabled." };
  if (scope === "external" && !policy.network.allowExternalSharing) return { allowed: false, reason: "External network sharing is disabled." };
  if (scope === "public" && (!policy.network.allowPublicProfiles || !policy.network.allowPublicPosts)) return { allowed: false, reason: "Public network visibility is disabled." };
  return { allowed: true, reason: "Sharing is permitted by the current organization policy." };
}
