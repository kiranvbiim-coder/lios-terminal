import { pgTable, text, integer, real, boolean, timestamp, jsonb, uniqueIndex, index, check, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { relations } from "drizzle-orm";
import { z } from "zod";
import { type DataStackPin } from "./dataStackPins";
import type { QuantDatasetInputBinding } from "./quantLab";
import { ENTITY_IDENTITY_STATUSES, ENTITY_LIFECYCLE_STATUSES, LEGAL_ENTITY_KINDS } from "./globalInstrumentMaster";
import {
  userRoleEnum,
  contentTypeEnum,
  contentStatusEnum,
  contentVisibilityEnum,
  assetClassEnum,
  platformPlanTierEnum,
  licenseLifecycleStatusEnum,
  licenseEntitlementTypeEnum,
  billingWebhookEventStatusEnum,
  deviceAuthorizationStatusEnum,
  sessionControlTypeEnum,
  sessionControlScopeEnum,
  tradingSessionTypeEnum,
  exchangeHolidayStatusEnum,
  corporateActionTypeEnum,
  corporateActionLegRoleEnum,
  sourceConnectionTypeEnum,
  sourceConnectionStatusEnum,
  instrumentRelationshipTypeEnum,
  quantWorkspaceEnum,
  quantExperimentStatusEnum,
  quantRunStatusEnum,
  calculationJobStatusEnum,
  researchInvestigationStatusEnum,
  researchEvidenceTypeEnum,
  researchEvidenceKindEnum,
  researchRelationshipTypeEnum,
  consensusMetricEnum,
  consensusSourceTypeEnum,
  consensusBenchmarkKindEnum,
  brainDecisionTypeEnum,
  brainRunStatusEnum,
  brainTaskStatusEnum,
  brainAgentRoleEnum,
  brainApprovalStatusEnum,
  decisionCaseStatusEnum,
  decisionMaterialityEnum,
  decisionApprovalOutcomeEnum,
  decisionMonitorStatusEnum,
  engagementModelEnum,
  engagementStatusEnum,
  engagementAgreementStatusEnum,
  engagementPaymentStatusEnum,
  workstreamStatusEnum,
  deliverableStatusEnum,
  deliverableGateActionEnum,
  meetingStatusEnum,
  decisionRecordStatusEnum,
  requestStatusEnum,
  consultingRequestPackEnum,
  consultingQuoteStatusEnum,
  creditTransactionTypeEnum,
  clientAuditEventTypeEnum,
} from "./schemaEnums";
export * from "./schemaEnums";
import { licensees, organizations, users, projects } from "./schemaCore";
import {
  projectChats,
  projectChatMessages,
  projectResources,
  projectSessions,
  projectLedgerStreamHeads,
  projectLedgerEvents,
  projectArtifacts,
  projectArtifactVersions,
  projectArtifactReferences,
  projectArtifactProposals,
  artifactInteractionReceipts,
} from "./schemaProjects";
export * from "./schemaCore";
export * from "./schemaProjects";

/**
 * Multi-tenant schema for Limuria Intelligence OS.
 *
 * Two audiences share this database:
 *  - internal_* roles: the company's own team, full terminal access
 *  - client_* roles: client-org users, dashboard-only (Phase 3 builds the
 *    dashboard itself; this phase only needs the data model + auth to exist)
 *
 * `licensees` sits above `organizations` so a future white-label business
 * (license the whole stack to other RIAs/funds) doesn't require a schema
 * migration later -- your own direct clients simply have licenseeId = null.
 */






// V4-24: tenant-scoped enterprise governance policy. The JSON document is
// validated by shared/enterpriseContracts.ts; keeping the storage envelope
// additive lets policy vocabulary evolve without coupling the database to
// provider-specific SSO or deployment implementations.
export const organizationEnterprisePolicies = pgTable("organization_enterprise_policies", {
  organizationId: integer("organization_id").primaryKey().references(() => organizations.id, { onDelete: "cascade" }),
  policy: jsonb("policy").$type<Record<string, unknown>>().notNull().default({}),
  revision: integer("revision").notNull().default(1),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OrganizationEnterprisePolicy = typeof organizationEnterprisePolicies.$inferSelect;


// P4 enterprise SSO browser-to-desktop handoff. Only a verifier hash is
// persisted; the one-time verifier itself is returned once to the requesting
// desktop and never stored. Rows are short-lived control-plane auth metadata,
// not customer workspace/data content.
export const enterpriseSsoDeviceAuthorizations = pgTable("enterprise_sso_device_authorizations", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  verifierHash: text("verifier_hash").notNull(),
  status: text("status").notNull().default("pending"), // pending | approved | consumed | expired
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  approvedAt: timestamp("approved_at"),
  consumedAt: timestamp("consumed_at"),
}, (table) => [
  index("enterprise_sso_device_org_idx").on(table.organizationId),
  index("enterprise_sso_device_status_idx").on(table.status),
  index("enterprise_sso_device_expires_idx").on(table.expiresAt),
]);

export type EnterpriseSsoDeviceAuthorization = typeof enterpriseSsoDeviceAuthorizations.$inferSelect;


// P4 SAML request state is persisted independently of the browser session so
// HTTP-POST ACS callbacks remain valid even when SameSite=Lax prevents the
// pre-redirect session cookie from accompanying the IdP POST. RelayState
// carries only a signed request ID/expiry; return paths and desktop linkage
// remain server-side. The processing state provides atomic replay exclusion.
export const enterpriseSamlRequests = pgTable("enterprise_saml_requests", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // pending | processing | consumed | expired
  returnTo: text("return_to").notNull(),
  deviceRequestId: text("device_request_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  claimedAt: timestamp("claimed_at"),
  consumedAt: timestamp("consumed_at"),
}, (table) => [
  index("enterprise_saml_requests_org_idx").on(table.organizationId),
  index("enterprise_saml_requests_status_idx").on(table.status),
  index("enterprise_saml_requests_expires_idx").on(table.expiresAt),
]);

export type EnterpriseSamlRequest = typeof enterpriseSamlRequests.$inferSelect;

// ─── Commercial control plane ──────────────────────────────────────────────
// LiOS is a paid terminal with user-controlled data/providers. These tables
// control access to the terminal, never custody of client data: plans describe
// limits, organization_licenses describe lifecycle/billing/grace/offline lease
// state, entitlements grant features/data/engines/connectors, authorized
// devices bind installs to orgs/users, and session_controls records forced
// logout/reauth actions for audited security operations.
export const platformPlans = pgTable("platform_plans", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  tier: platformPlanTierEnum("tier").notNull(),
  seatLimit: integer("seat_limit"),
  deviceLimit: integer("device_limit"),
  // LV4-03-03: maps a LiOS plan to Paddle's own price catalog entry
  // (Paddle's pri_... IDs) so hosted checkout creation knows what to
  // actually charge. Deliberately provider-specific, not a generic
  // "providerPriceId" -- a Paddle price ID is meaningless to Stripe or
  // Lemon Squeezy, so there is nothing genuinely neutral to abstract
  // here (unlike BillingProvider's own contract in billingProvider.ts,
  // which stays neutral because every method it defines really is
  // shape-identical across providers). Nullable: the "trial" plan
  // (trialAccess.ts) never goes through paid checkout and has no price.
  paddlePriceId: text("paddle_price_id"),
  offlineGraceDays: integer("offline_grace_days").notNull().default(7),
  featureLimits: jsonb("feature_limits").$type<Record<string, unknown>>().notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const organizationLicenses = pgTable("organization_licenses", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  planId: integer("plan_id").references(() => platformPlans.id),
  status: licenseLifecycleStatusEnum("status").notNull().default("active"),
  seatsPurchased: integer("seats_purchased").notNull().default(1),
  billingState: text("billing_state").notNull().default("current"),
  trialEndsAt: timestamp("trial_ends_at"),
  graceEndsAt: timestamp("grace_ends_at"),
  offlineLeaseIssuedAt: timestamp("offline_lease_issued_at"),
  offlineLeaseExpiresAt: timestamp("offline_lease_expires_at"),
  offlineLeasePublicKeyId: text("offline_lease_public_key_id"),
  signedLeaseHash: text("signed_lease_hash"),
  // LV4-03-05: which provider (BillingProviderId -- "paddle", eventually
  // "stripe"/"lemonsqueezy") and customer/subscription this
  // organization's active billing relationship maps to. All three
  // nullable together -- an org on the "trial" plan, or one whose
  // checkout has been created but no webhook has arrived to confirm it
  // yet, has none of them. Set by billingSubscriptionProjection.ts the
  // first time a mapped webhook event resolves to this organization,
  // never by the checkout route itself (createCheckoutSession's own
  // response carries no customer/subscription ID -- only a checkout
  // session ID -- those only become known once a real
  // subscription.activated/transaction.completed webhook arrives).
  // provider is plain text, not a foreign key to BILLING_PROVIDERS or a
  // pgEnum, deliberately mirroring billing_webhook_events.provider's own
  // choice -- the DB schema stays decoupled from billingProvider.ts's
  // own vocabulary rather than importing it, matching that module's own
  // "stays provider/DB-neutral" design.
  provider: text("provider"),
  providerCustomerId: text("provider_customer_id"),
  providerSubscriptionId: text("provider_subscription_id"),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("organization_license_org_unique").on(table.organizationId),
  index("organization_license_status_idx").on(table.status),
]);

// LV4-03-04: webhook replay safety and payment-event idempotency, per the
// master plan's V4-03 requirements. providerEventId is the sole
// idempotency key per BillingWebhookEvent's own doc comment
// (shared/billingProvider.ts) -- the unique index on
// (provider, provider_event_id) below is what actually enforces
// "processed at most once" against a replayed or duplicate-delivered
// webhook, via onConflictDoNothing() at the insert site.
//
// eventType stores the provider's OWN raw event_type string (e.g.
// Paddle's "subscription.past_due"), not the normalized BillingEventType
// -- an unmapped event by definition has no normalized type, and the raw
// value is what a human needs to see to recognize a real code gap.
// normalizedType is populated only once parseWebhookEvent succeeds.
// organizationId (LV4-03-05): resolved by billingSubscriptionProjection.ts
// from the event's own custom_data (set at checkout time) or, failing
// that, a providerCustomerId lookup against organization_licenses --
// recorded here purely for observability/audit (which org a given event
// was attributed to). Null when the event is unmapped (projection never
// runs on those) or when resolution genuinely failed.
//
// projectedAt (LV4-03-05): null until billingSubscriptionProjection.ts
// has actually run for this row, regardless of what it concluded
// (applied a status change, decided none was needed, or failed to
// resolve an organization -- all of those are "projection ran"). This is
// what makes a Paddle retry of an ALREADY-RECORDED event still useful: a
// duplicate delivery whose row exists but was never successfully
// projected (e.g. a transient DB error interrupted the first attempt,
// after the idempotent insert had already committed) gets projection
// retried on the duplicate path in billingWebhookRoutes.ts, instead of
// being acknowledged and permanently skipped.
export const billingWebhookEvents = pgTable("billing_webhook_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  provider: text("provider").notNull(),
  providerEventId: text("provider_event_id").notNull(),
  eventType: text("event_type").notNull(),
  normalizedType: text("normalized_type"),
  status: billingWebhookEventStatusEnum("status").notNull(),
  mappingError: text("mapping_error"),
  organizationId: integer("organization_id").references(() => organizations.id),
  projectedAt: timestamp("projected_at"),
  occurredAt: timestamp("occurred_at").notNull(),
  receivedAt: timestamp("received_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("billing_webhook_event_provider_id_unique").on(table.provider, table.providerEventId),
  index("billing_webhook_event_status_idx").on(table.status),
]);

export const licenseEntitlements = pgTable("license_entitlements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationLicenseId: integer("organization_license_id").notNull().references(() => organizationLicenses.id),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  featureKey: text("feature_key").notNull(),
  entitlementType: licenseEntitlementTypeEnum("entitlement_type").notNull(),
  active: boolean("active").notNull().default(true),
  limitValue: real("limit_value"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: timestamp("expires_at"),
  grantedByUserId: integer("granted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("license_entitlement_org_feature_unique").on(table.organizationId, table.featureKey),
  index("license_entitlement_license_idx").on(table.organizationLicenseId),
]);

export const authorizedDevices = pgTable("authorized_devices", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  userId: integer("user_id").references(() => users.id),
  deviceFingerprintHash: text("device_fingerprint_hash").notNull(),
  deviceLabel: text("device_label").notNull(),
  status: deviceAuthorizationStatusEnum("status").notNull().default("authorized"),
  leaseExpiresAt: timestamp("lease_expires_at"),
  firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at"),
  revokedAt: timestamp("revoked_at"),
  revokedByUserId: integer("revoked_by_user_id").references(() => users.id),
  revokeReason: text("revoke_reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
}, (table) => [
  uniqueIndex("authorized_device_org_fingerprint_unique").on(table.organizationId, table.deviceFingerprintHash),
  index("authorized_device_org_status_idx").on(table.organizationId, table.status),
  index("authorized_device_user_idx").on(table.userId),
]);

export const sessionControls = pgTable("session_controls", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  controlType: sessionControlTypeEnum("control_type").notNull(),
  scope: sessionControlScopeEnum("scope").notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  targetUserId: integer("target_user_id").references(() => users.id),
  sid: text("sid"),
  reason: text("reason").notNull(),
  active: boolean("active").notNull().default(true),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("session_control_scope_idx").on(table.scope, table.active),
  index("session_control_org_idx").on(table.organizationId),
  index("session_control_user_idx").on(table.targetUserId),
  index("session_control_sid_idx").on(table.sid),
]);

export const insertPlatformPlanSchema = z.object({
  code: z.string().trim().min(2).regex(/^[a-z0-9_.-]+$/),
  name: z.string().trim().min(2),
  tier: z.enum(["trial", "starter", "pro", "enterprise"]),
  seatLimit: z.number().int().positive().nullable().optional(),
  deviceLimit: z.number().int().positive().nullable().optional(),
  offlineGraceDays: z.number().int().nonnegative().default(7),
  featureLimits: z.record(z.string(), z.unknown()).default({}),
  active: z.boolean().default(true),
});

export const upsertOrganizationLicenseSchema = z.object({
  planId: z.number().int().positive().nullable().optional(),
  status: z.enum(["active", "grace", "billing_hold", "suspended", "security_locked", "terminated"]),
  seatsPurchased: z.number().int().positive().default(1),
  billingState: z.string().trim().min(1).default("current"),
  trialEndsAt: z.coerce.date().nullable().optional(),
  graceEndsAt: z.coerce.date().nullable().optional(),
  offlineLeaseIssuedAt: z.coerce.date().nullable().optional(),
  offlineLeaseExpiresAt: z.coerce.date().nullable().optional(),
  offlineLeasePublicKeyId: z.string().trim().min(1).nullable().optional(),
  signedLeaseHash: z.string().trim().min(1).nullable().optional(),
});

export const insertLicenseEntitlementSchema = z.object({
  featureKey: z.string().trim().min(1),
  entitlementType: z.enum(["domain", "data_source", "engine", "export", "ai", "connector", "support", "admin"]),
  active: z.boolean().default(true),
  limitValue: z.number().finite().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  expiresAt: z.coerce.date().nullable().optional(),
});

export const updateLicenseEntitlementSchema = insertLicenseEntitlementSchema.partial().extend({
  active: z.boolean().optional(),
});

export const upsertAuthorizedDeviceSchema = z.object({
  userId: z.number().int().positive().nullable().optional(),
  deviceFingerprintHash: z.string().trim().min(16),
  deviceLabel: z.string().trim().min(1),
  status: z.enum(["authorized", "pending", "revoked"]).default("authorized"),
  leaseExpiresAt: z.coerce.date().nullable().optional(),
  revokeReason: z.string().trim().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export const updateAuthorizedDeviceSchema = z.object({
  status: z.enum(["authorized", "pending", "revoked"]).optional(),
  deviceLabel: z.string().trim().min(1).optional(),
  leaseExpiresAt: z.coerce.date().nullable().optional(),
  revokeReason: z.string().trim().nullable().optional(),
});

export const insertSessionControlSchema = z.object({
  controlType: z.enum(["force_logout", "force_reauth"]),
  scope: z.enum(["organization", "user", "session", "global"]),
  organizationId: z.number().int().positive().nullable().optional(),
  targetUserId: z.number().int().positive().nullable().optional(),
  sid: z.string().trim().min(1).nullable().optional(),
  reason: z.string().trim().min(3),
  expiresAt: z.coerce.date().nullable().optional(),
}).superRefine((value, ctx) => {
  if (value.scope === "organization" && !value.organizationId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["organizationId"], message: "organization session controls require organizationId" });
  }
  if (value.scope === "user" && !value.targetUserId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetUserId"], message: "user session controls require targetUserId" });
  }
  if (value.scope === "session" && !value.sid) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sid"], message: "session-scoped controls require sid" });
  }
});

export type InsertPlatformPlan = z.infer<typeof insertPlatformPlanSchema>;
export type PlatformPlan = typeof platformPlans.$inferSelect;
export type OrganizationLicense = typeof organizationLicenses.$inferSelect;
export type InsertLicenseEntitlement = z.infer<typeof insertLicenseEntitlementSchema>;
export type LicenseEntitlement = typeof licenseEntitlements.$inferSelect;
export type AuthorizedDevice = typeof authorizedDevices.$inferSelect;
export type SessionControl = typeof sessionControls.$inferSelect;
// ─── Post-login Data Environment Setup ─────────────────────────────────────
// One environment setup record per signed-in user. The record stores only
// source/runtime selections and completion state; provider secrets remain in
// the encrypted local credential vault and are never copied into this table.
export const environmentSetups = pgTable("environment_setups", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  setupVersion: text("setup_version").notNull().default("v1"),
  selectedConnectorIds: jsonb("selected_connector_ids").$type<string[]>().notNull().default([]),
  pythonRuntimeId: text("python_runtime_id").notNull().default("lios-managed"),
  pythonEnvironmentPath: text("python_environment_path"),
  pythonPackIds: jsonb("python_pack_ids").$type<string[]>().notNull().default(["core"]),
  aiProviderId: text("ai_provider_id"),
  aiModelId: text("ai_model_id"),
  providerStackOrder: jsonb("provider_stack_order").$type<string[]>().notNull().default([]),
  dataStackPins: jsonb("data_stack_pins").$type<DataStackPin[]>().notNull().default([]),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("environment_setup_user_unique").on(table.userId),
  index("environment_setup_org_idx").on(table.organizationId),
]);

export const userDataConsents = pgTable("user_data_consents", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  consentVersion: text("consent_version").notNull(),
  acceptedAt: timestamp("accepted_at").defaultNow().notNull(),
  revokedAt: timestamp("revoked_at"),
}, (table) => [
  uniqueIndex("user_data_consent_user_scope_unique").on(table.userId, table.scope),
]);



// A configured source is metadata plus a reference to a vault credential.
// `config` must never contain passwords, API keys, OAuth tokens, or raw
// private rows. This table is intentionally separate from environmentSetups
// so multiple instances of the same connector can coexist.
export const sourceConnections = pgTable("source_connections", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  connectorId: text("connector_id").notNull(),
  name: text("name").notNull(),
  sourceType: sourceConnectionTypeEnum("source_type").notNull(),
  config: jsonb("config").$type<Record<string, string | number | boolean | null>>().notNull().default({}),
  credentialRef: text("credential_ref"),
  status: sourceConnectionStatusEnum("status").notNull().default("configured"),
  lastTestedAt: timestamp("last_tested_at"),
  lastHealthyAt: timestamp("last_healthy_at"),
  statusDetail: text("status_detail"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("source_connection_user_connector_name_unique").on(table.userId, table.connectorId, table.name),
  index("source_connection_org_idx").on(table.organizationId),
  index("source_connection_connector_idx").on(table.connectorId),
]);
// Hosted credentials are tenant-scoped encrypted records. The ciphertext is
// never returned to callers; local-first deployments continue using the
// machine-local vault until hosted credential storage is configured.
export const organizationCredentials = pgTable("organization_credentials", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  createdByUserId: integer("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  encryptedValue: text("encrypted_value").notNull(),
  label: text("label").notNull().default(""),
  disabledAt: timestamp("disabled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("organization_credential_org_name_unique").on(table.organizationId, table.name),
  index("organization_credential_org_idx").on(table.organizationId),
]);

export type OrganizationCredential = typeof organizationCredentials.$inferSelect;

export const sourceConnectionConfigSchema = z.object({
  id: z.number().int().positive().optional(),
  connectorId: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  sourceType: z.enum(["public_api", "keyed_api", "file", "database", "private_api", "cloud_storage", "sidecar", "local_model", "mcp"]),
  config: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  credentialRef: z.string().trim().max(200).nullable().optional(),
});

export const sourceConnectionTestSchema = z.object({
  connectionId: z.number().int().positive(),
});

export type SourceConnection = typeof sourceConnections.$inferSelect;
export type SourceConnectionConfig = z.infer<typeof sourceConnectionConfigSchema>;

export const updateEnvironmentSetupSchema = z.object({
  selectedConnectorIds: z.array(z.string().trim().min(1)).max(100).default([]),
  providerStackOrder: z.array(z.string().trim().min(1)).max(100).optional(),
  pythonRuntimeId: z.enum(["lios-managed", "system-auto", "external-path", "remote-service"]).default("lios-managed"),
  pythonEnvironmentPath: z.string().trim().max(500).nullable().optional(),
  pythonPackIds: z.array(z.string().trim().min(1)).max(30).default(["core"]),
  aiProviderId: z.string().trim().max(100).nullable().optional(),
  aiModelId: z.string().trim().max(200).nullable().optional(),
  complete: z.boolean().default(false),
});

export const communityDataConsentSchema = z.object({
  scope: z.enum(["yahoo_community", "public_filler"]),
  accept: z.boolean(),
  consentVersion: z.string().trim().min(1).max(40).default("v1"),
});

export type EnvironmentSetup = typeof environmentSetups.$inferSelect;
export type UpdateEnvironmentSetup = z.infer<typeof updateEnvironmentSetupSchema>;
export type User = typeof users.$inferSelect;

export const INTERNAL_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;
export const CLIENT_ROLES = ["client_admin", "client_user"] as const;
export type UserRole = (typeof userRoleEnum.enumValues)[number];

// ─── Portfolios & positions (client holdings, entered by internal team) ───
// LV4-05-01: base currency for valuation/reporting math (P&L, returns, risk
// metrics) across positions that may themselves be listed in other
// currencies. Defaults to USD to backfill existing portfolios created
// before this column existed with a sane, already-established default
// (financialStatementPeriods.reportedCurrency uses the same default).
export const portfolios = pgTable("portfolios", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  baseCurrency: text("base_currency").notNull().default("USD").references(() => currencies.code),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const positions = pgTable("positions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfolios.id),
  symbol: text("symbol").notNull(),
  listingId: integer("listing_id"),
  securityId: integer("security_id"),
  shares: real("shares").notNull(),
  avgCost: real("avg_cost").notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

// ─── Currency Master (LV4-05-01) ──────────────────────────────────────────
// Canonical ISO 4217 currency reference. `code` is the ISO 4217 alpha-3
// code; `minorUnit` is the ISO 4217 exponent (decimal places for the
// currency's minor unit -- 2 for most currencies, 0 for JPY/KRW/VND, 3 for
// a handful of Gulf-region currencies) needed to round/display amounts
// correctly rather than assuming 2 everywhere. Not exhaustive -- adding a
// currency is a data-only INSERT, same convention as countries/exchanges
// below. `numericCode` is the ISO 4217 numeric code where known.
export const currencies = pgTable("currencies", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  numericCode: text("numeric_code"),
  minorUnit: integer("minor_unit").notNull().default(2),
  symbol: text("symbol"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Currency = typeof currencies.$inferSelect;

// ─── Global Market Master: countries and exchanges (LV4-04-03/04) ─────────
// Canonical geography/venue reference LiOS owns and other tables validate
// against, rather than each table (companies, companyListings, ...)
// carrying its own free-text "country"/"exchange" string with no shared
// vocabulary. `code` is ISO 3166-1 alpha-2; `mic` is ISO 10383. Existing
// free-text columns (companyListings.country/mic/exchange) are untouched by
// this table's introduction -- server/globalMarketMasterStore.ts resolves
// between the two so this can land without a data migration on live rows,
// with the resolver becoming authoritative for new writes.
export const countries = pgTable("countries", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  region: text("region").notNull(),
  currencyCode: text("currency_code").notNull().references(() => currencies.code),
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// `operatingMic` is null for an operating MIC itself and set to that
// operating MIC's code for a segment MIC, per ISO 10383's own hierarchy
// (e.g. XNGS "Nasdaq Global Select" segment -> XNAS operating MIC).
export const exchanges = pgTable("exchanges", {
  mic: text("mic").primaryKey(),
  operatingMic: text("operating_mic"),
  name: text("name").notNull(),
  countryCode: text("country_code").notNull().references(() => countries.code),
  currencyCode: text("currency_code").notNull().references(() => currencies.code),
  timezone: text("timezone").notNull(),
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("exchange_country_idx").on(table.countryCode),
  index("exchange_operating_mic_idx").on(table.operatingMic),
]);

export const countriesRelations = relations(countries, ({ many }) => ({
  exchanges: many(exchanges),
}));

export const exchangesRelations = relations(exchanges, ({ one }) => ({
  country: one(countries, { fields: [exchanges.countryCode], references: [countries.code] }),
}));

export type Country = typeof countries.$inferSelect;
export type Exchange = typeof exchanges.$inferSelect;

export const currenciesRelations = relations(currencies, ({ many }) => ({
  countries: many(countries),
  exchanges: many(exchanges),
}));

// ─── FX Rates (LV4-05-02) ──────────────────────────────────────────────────
// Historical daily FX rate observations, keyed so the same pair can carry
// more than one source's quote for the same day without either
// overwriting the other. `rateDate` is the observation's *effective* date
// (a separate fact from `retrievedAt`, when LiOS actually fetched/recorded
// it -- same "don't conflate clocks" discipline as datasetSnapshots'
// effectiveAt/retrievedAt split), so historical, not just current-day,
// conversion is possible. `rate` means "1 baseCurrency = rate
// quoteCurrency" (standard FX quoting convention, e.g.
// EUR/USD 1.10 -> baseCurrency='EUR', quoteCurrency='USD', rate=1.10);
// shared/fxNormalization.ts computes the inverse direction from a single
// stored row rather than requiring both directions to be persisted.
// Provider-agnostic by design -- no data is seeded by this migration, and
// no specific rate-fetching connector is wired yet; `source` records
// whichever provider (or manual entry) supplied a given row once one is.
export const fxRates = pgTable("fx_rates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  baseCurrency: text("base_currency").notNull().references(() => currencies.code),
  quoteCurrency: text("quote_currency").notNull().references(() => currencies.code),
  rateDate: text("rate_date").notNull(),
  rate: real("rate").notNull(),
  source: text("source").notNull(),
  retrievedAt: timestamp("retrieved_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("fx_rate_unique").on(table.baseCurrency, table.quoteCurrency, table.rateDate, table.source),
  index("fx_rate_pair_date_idx").on(table.baseCurrency, table.quoteCurrency, table.rateDate),
  check("fx_rates_base_quote_distinct", sql`${table.baseCurrency} <> ${table.quoteCurrency}`),
  check("fx_rates_positive_rate", sql`${table.rate} > 0`),
]);

export type FxRate = typeof fxRates.$inferSelect;

// ─── Trading Calendar: sessions and holidays (LV4-05-03) ──────────────────
// Session/holiday master keyed off exchanges.mic (LV4-04-03/04) and
// interpreted against that exchange's own exchanges.timezone -- this
// table does not duplicate timezone, which already lives there. All
// times are local wall-clock "HH:MM" for the exchange, matching how every
// primary source (exchange operator websites) actually publishes hours;
// converting to UTC/a specific instant is a query-time concern for
// LV4-05-04's market-status service, not something baked into storage
// here (the same UTC offset would otherwise silently go stale across a
// DST transition).
//
// Session hours below were verified live against each exchange's own
// site or an equivalent primary source (not guessed), same discipline as
// currencyMaster's FX_SERIES_CATALOG (LV4-05-02). Not exhaustive --
// adding an exchange's sessions/holidays is a data-only INSERT, same
// convention as countries/exchanges/currencies.
export const exchangeTradingSessions = pgTable("exchange_trading_sessions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  exchangeMic: text("exchange_mic").notNull().references(() => exchanges.mic),
  sessionType: tradingSessionTypeEnum("session_type").notNull(),
  // 0 for a single continuous session; 0 then 1 for a split
  // morning/afternoon session (see the enum's own doc comment above).
  sequence: integer("sequence").notNull().default(0),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("exchange_trading_session_unique").on(table.exchangeMic, table.sessionType, table.sequence),
  index("exchange_trading_session_mic_idx").on(table.exchangeMic),
  check("exchange_trading_session_time_order", sql`${table.startTime} < ${table.endTime}`),
]);

export type ExchangeTradingSession = typeof exchangeTradingSessions.$inferSelect;

// A full closure never carries an early-close time; an early-close day
// always does -- the CHECK constraint enforces this shape at the
// database level rather than trusting every future writer to get it
// right, same discipline as instrument_relationships' shape CHECK.
export const exchangeHolidays = pgTable("exchange_holidays", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  exchangeMic: text("exchange_mic").notNull().references(() => exchanges.mic),
  holidayDate: text("holiday_date").notNull(),
  name: text("name").notNull(),
  status: exchangeHolidayStatusEnum("status").notNull().default("closed"),
  earlyCloseTime: text("early_close_time"),
  source: text("source").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("exchange_holiday_unique").on(table.exchangeMic, table.holidayDate),
  index("exchange_holiday_mic_idx").on(table.exchangeMic),
  check(
    "exchange_holiday_early_close_shape",
    sql`(${table.status} = 'early_close' AND ${table.earlyCloseTime} IS NOT NULL) OR (${table.status} = 'closed' AND ${table.earlyCloseTime} IS NULL)`,
  ),
]);

export type ExchangeHoliday = typeof exchangeHolidays.$inferSelect;

// ─── Companies / Securities (canonical entity master) ─────────────────────
// The stable entity every ticker resolves to -- and, since CA-03, an entity
// that has no ticker at all: a private company, a fund manager, a delisted
// issuer or a provisional entity named in conversation is a first-class row
// with zero securities and zero listings. The hierarchy stays
// entity -> security -> listing; a ticker is a property of a listing, never
// a precondition of an entity. `symbol` below is only the legacy display
// symbol of listed entities and may be NULL.
// Provider-agnostic: connectors upsert into the same rows (by CIK / registry
// identifier / legacy symbol) rather than each keeping a siloed identity.
// Filings and persisted financial statements key off `companyId` so they
// survive independently of any single provider's cache lifetime, and future
// work (digital twin, knowledge graph) has a stable node to hang off.
export const companies = pgTable("companies", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  // Legacy display symbol of a listed entity. NULL for an entity without a
  // listing (Postgres UNIQUE permits any number of NULLs). Never an empty
  // string: companies_symbol_not_blank rejects the "" sentinel.
  symbol: text("symbol").unique(),
  name: text("name").notNull(),
  // true when `name` is the ticker/slug an ingestion provider supplied
  // because it had no legal name. A placeholder never overwrites a real name
  // and is overwritten by the first real one (companyStore.upsertCompany).
  nameIsPlaceholder: boolean("name_is_placeholder").notNull().default(false),
  // Legal domicile / registration jurisdiction (ISO 3166-1 alpha-2, or
  // 3166-2 such as US-DE). Distinct from `country` (listing/home market).
  // NULL = not known; never derived from the name or a ticker suffix.
  jurisdiction: text("jurisdiction"),
  // Coarse legal-entity kind and the jurisdiction-specific legal form
  // (e.g. GmbH, Ltd, a GLEIF ELF code). NULL = not known.
  legalEntityKind: text("legal_entity_kind"),
  legalForm: text("legal_form"),
  // Lifecycle and identity confidence are separate attributes. 'unknown' is
  // the honest default: an entity is not inferred active, private or dead
  // from its name or from having no ticker. 'provisional' means the row has
  // not been confirmed against an authoritative registry.
  lifecycleStatus: text("lifecycle_status").notNull().default("unknown"),
  identityStatus: text("identity_status").notNull().default("provisional"),
  // SEC CIK, 10-digit zero-padded. One CIK identifies one legal issuer, so
  // non-null values are a durable cross-listing issuer key (GOOGL/GOOG,
  // different venues, etc.); a partial unique index below makes concurrent
  // ingestion unable to split that issuer into multiple companies. Null
  // remains legal and repeatable for non-US issuers / unknown CIKs.
  cik: text("cik"),
  exchange: text("exchange"),
  country: text("country"),
  sector: text("sector"),
  industry: text("industry"),
  assetClass: assetClassEnum("asset_class").notNull().default("equity"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("company_cik_unique")
    .on(table.cik)
    .where(sql`${table.cik} IS NOT NULL`),
  check("companies_symbol_not_blank", sql`${table.symbol} IS NULL OR length(btrim(${table.symbol})) > 0`),
  check("companies_legal_entity_kind_valid", sql`${table.legalEntityKind} IS NULL OR ${table.legalEntityKind} IN (${sql.raw(LEGAL_ENTITY_KINDS.map((value) => `'${value}'`).join(", "))})`),
  check("companies_lifecycle_status_valid", sql`${table.lifecycleStatus} IN (${sql.raw(ENTITY_LIFECYCLE_STATUSES.map((value) => `'${value}'`).join(", "))})`),
  check("companies_identity_status_valid", sql`${table.identityStatus} IN (${sql.raw(ENTITY_IDENTITY_STATUSES.map((value) => `'${value}'`).join(", "))})`),
]);

// ─── Securities (LV4-04-01/02: the missing entity -> security layer) ──────
// A security is one class of security one entity issues -- GOOGL Class A
// common stock and GOOG Class C common stock are two *securities* of the
// same entity, not two listings of one security. This is the real-world
// three-level hierarchy every reference-data vendor (OpenFIGI, Bloomberg)
// actually uses: entity -> security (global share class) -> listing
// (venue-specific instance). Before this table, share class lived only as
// free text on company_listings (LV4-04-06), which conflated "which class"
// with "which venue" -- a security's identity should not depend on how
// many venues it happens to trade on.
//
// `instrumentId` on InstrumentMasterCandidate (shared/globalInstrumentMaster.ts)
// stays permanently null/reserved -- this migration does not introduce a
// fourth "instrument" table. Nothing in this codebase (no derivatives, no
// non-listing tradable contracts) needs that layer yet; inventing it now
// would be schema debt for a concept nothing consumes. The durable identity
// model is entity → security → listing; add another layer only when a real
// non-listing tradable instrument requires it.
export const securities = pgTable("securities", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Null means "this entity's one undifferentiated security" (the common
  // case -- most companies have exactly one class of common stock and
  // nothing else tracked here yet). Non-null distinguishes classes of the
  // same entity (e.g. "A" / "C").
  shareClass: text("share_class"),
  assetClass: assetClassEnum("asset_class").notNull().default("equity"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  // Postgres treats every NULL as distinct in a plain UNIQUE index, so a
  // single index on (companyId, shareClass, assetClass) would silently
  // allow duplicate "no class" rows for the same company+assetClass -- the
  // exact common case this constraint most needs to cover. Two partial
  // indexes instead: one for real share classes, one for the null case.
  uniqueIndex("security_company_class_asset_unique")
    .on(table.companyId, table.shareClass, table.assetClass)
    .where(sql`${table.shareClass} IS NOT NULL`),
  uniqueIndex("security_company_asset_no_class_unique")
    .on(table.companyId, table.assetClass)
    .where(sql`${table.shareClass} IS NULL`),
  // Redundant with id's primary key for lookups, but required as the
  // referenced non-partial unique key for companyListings' composite FK.
  // That FK enforces that a listing's entity and assetClass agree with its
  // security instead of merely pointing at any existing security row.
  uniqueIndex("security_id_company_asset_unique").on(table.id, table.companyId, table.assetClass),
  index("security_company_idx").on(table.companyId),
]);

export type Security = typeof securities.$inferSelect;

// A company can have many exchange listings and durable external identifiers.
// `companies.symbol` remains the backwards-compatible primary display symbol
// of a listed entity (NULL for an entity without a listing); new code must
// resolve an input through these records before treating it as an entity
// identity. A bare ticker is deliberately scoped by exchange because
// the same ticker can exist on multiple venues.
export const companyListings = pgTable("company_listings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  // LV4-04-01/02: every listing belongs to exactly one security (which
  // itself carries shareClass) -- this replaced company_listings' own
  // share_class column (LV4-04-06), which had no real writer (grep-
  // confirmed before removing it: only test fixtures ever set it) and
  // risked drifting from securities.shareClass as a second copy of the
  // same fact. materializeInstrumentMasterCandidates now reads shareClass
  // from the joined security row instead.
  securityId: integer("security_id").notNull().references(() => securities.id, { onDelete: "cascade" }),
  symbol: text("symbol").notNull(),
  exchange: text("exchange").notNull().default("UNKNOWN"),
  mic: text("mic"),
  currency: text("currency"),
  country: text("country"),
  assetClass: assetClassEnum("asset_class").notNull().default("equity"),
  isPrimary: boolean("is_primary").notNull().default(false),
  source: text("source").notNull().default("limuria"),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("company_listing_symbol_exchange_unique").on(table.symbol, table.exchange),
  index("company_listing_company_idx").on(table.companyId),
  index("company_listing_security_idx").on(table.securityId),
  // FKs on companyId and securityId individually only prove each target
  // exists. This composite FK prevents a listing of entity A (or asset
  // class A) from pointing at a security owned by entity B / asset class B.
  foreignKey({
    name: "company_listings_security_company_asset_fk",
    columns: [table.securityId, table.companyId, table.assetClass],
    foreignColumns: [securities.id, securities.companyId, securities.assetClass],
  }).onDelete("cascade"),
]);

// ─── Corporate actions (LV4-05-05) ──────────────────────────────────────────
// One event row carries canonical dates/source/type; one or more legs carry
// the affected security/listing and its role in the event. This keeps
// mergers, acquisitions, spin-offs, and replacements multi-instrument
// without forcing them into a split/dividend-shaped single row. The same
// canonical event can therefore feed chart/history adjustment, portfolio
// entitlement, backtest, and valuation workflows without each consumer
// parsing a provider-specific payload.
export const corporateActions = pgTable("corporate_actions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  actionType: corporateActionTypeEnum("action_type").notNull(),
  issuerCompanyId: integer("issuer_company_id").references(() => companies.id),
  announcementDate: text("announcement_date"),
  exDate: text("ex_date"),
  recordDate: text("record_date"),
  payableDate: text("payable_date"),
  effectiveDate: text("effective_date"),
  source: text("source").notNull(),
  providerEventId: text("provider_event_id"),
  sourceUrl: text("source_url"),
  terms: jsonb("terms").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("corporate_action_type_idx").on(table.actionType),
  index("corporate_action_effective_date_idx").on(table.effectiveDate),
  index("corporate_action_issuer_company_idx").on(table.issuerCompanyId),
  uniqueIndex("corporate_action_provider_event_unique")
    .on(table.source, table.providerEventId)
    .where(sql`${table.providerEventId} IS NOT NULL`),
]);

export const corporateActionLegs = pgTable("corporate_action_legs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  actionId: integer("action_id").notNull().references(() => corporateActions.id, { onDelete: "cascade" }),
  securityId: integer("security_id").references(() => securities.id),
  listingId: integer("listing_id").references(() => companyListings.id),
  role: corporateActionLegRoleEnum("role").notNull(),
  ratioNumerator: real("ratio_numerator"),
  ratioDenominator: real("ratio_denominator"),
  cashAmount: real("cash_amount"),
  cashCurrency: text("cash_currency").references(() => currencies.code),
  newSymbol: text("new_symbol"),
  newExchangeMic: text("new_exchange_mic").references(() => exchanges.mic),
}, (table) => [
  index("corporate_action_leg_action_idx").on(table.actionId),
  index("corporate_action_leg_security_idx").on(table.securityId),
  index("corporate_action_leg_listing_idx").on(table.listingId),
  check(
    "corporate_action_leg_one_instrument",
    sql`((${table.securityId} IS NOT NULL)::int + (${table.listingId} IS NOT NULL)::int) = 1`,
  ),
  check(
    "corporate_action_leg_ratio_shape",
    sql`((${table.ratioNumerator} IS NULL) = (${table.ratioDenominator} IS NULL)) AND (${table.ratioNumerator} IS NULL OR ((${table.ratioNumerator} > 0 AND ${table.ratioDenominator} > 0) AND ${table.ratioNumerator} NOT IN ('NaN'::real, 'Infinity'::real, '-Infinity'::real) AND ${table.ratioDenominator} NOT IN ('NaN'::real, 'Infinity'::real, '-Infinity'::real)))`,
  ),
  check(
    "corporate_action_leg_cash_nonnegative",
    sql`${table.cashAmount} IS NULL OR (${table.cashAmount} >= 0 AND ${table.cashAmount} NOT IN ('NaN'::real, 'Infinity'::real, '-Infinity'::real))`,
  ),
]);

export type CorporateAction = typeof corporateActions.$inferSelect;
export type CorporateActionLeg = typeof corporateActionLegs.$inferSelect;

export const companyIdentifiers = pgTable("company_identifiers", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  identifierType: text("identifier_type").notNull(), // cik | isin | figi | lei | provider | registry_id
  identifier: text("identifier").notNull(),
  // Namespace of a registry-scoped identifier (identifier_type 'registry_id'):
  // the issuing registry (e.g. 'uk_companies_house', 'opencorporates') plus the
  // jurisdiction it covers. A company number is only unique inside its
  // registry+jurisdiction, so the namespace is part of the identity instead
  // of a closed per-country type list. '' = the identifier type is globally
  // unique on its own (cik, isin, figi, lei, provider). '' rather than NULL
  // keeps the unique index and ON CONFLICT target free of NULL-distinct rows.
  registry: text("registry").notNull().default(""),
  jurisdiction: text("jurisdiction").notNull().default(""),
  source: text("source").notNull().default("limuria"),
  isPrimary: boolean("is_primary").notNull().default(false),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("company_identifier_namespace_value_unique").on(table.identifierType, table.registry, table.jurisdiction, table.identifier),
  index("company_identifier_company_idx").on(table.companyId),
  check("company_identifiers_registry_namespace_shape", sql`(${table.identifierType} = 'registry_id') = (${table.registry} <> '') AND (${table.jurisdiction} = '' OR ${table.registry} <> '')`),
]);

// ─── Instrument relationships (LV4-04-06/LV4-04-07) ───────────────────────
// A typed edge between two identity rows. "succession" describes two whole
// entities (predecessor company -> successor company); "adr_gdr" and
// "related_instrument" describe two specific securities (listing ->
// listing). The CHECK constraint below (mirrored in
// migrations/0047_instrument_relationships.sql) enforces that a row never
// mixes the two shapes -- see that migration's header comment for the full
// rationale.

export const instrumentRelationships = pgTable("instrument_relationships", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  relationshipType: instrumentRelationshipTypeEnum("relationship_type").notNull(),
  sourceListingId: integer("source_listing_id").references(() => companyListings.id, { onDelete: "cascade" }),
  targetListingId: integer("target_listing_id").references(() => companyListings.id, { onDelete: "cascade" }),
  sourceCompanyId: integer("source_company_id").references(() => companies.id, { onDelete: "cascade" }),
  targetCompanyId: integer("target_company_id").references(() => companies.id, { onDelete: "cascade" }),
  // ADR/GDR conversion ratio (e.g. "1:2"). Kept as text, not numeric --
  // real ratios are not always a clean machine-representable fraction and
  // this is descriptive metadata, not a value fed into a calculation.
  ratio: text("ratio"),
  note: text("note"),
  source: text("source").notNull().default("limuria"),
  validFrom: text("valid_from"),
  validTo: text("valid_to"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("instrument_relationship_unique").on(
    table.relationshipType,
    table.sourceListingId,
    table.targetListingId,
    table.sourceCompanyId,
    table.targetCompanyId,
  ),
  index("instrument_relationship_type_idx").on(table.relationshipType),
  index("instrument_relationship_source_listing_idx").on(table.sourceListingId),
  index("instrument_relationship_target_listing_idx").on(table.targetListingId),
  index("instrument_relationship_source_company_idx").on(table.sourceCompanyId),
  index("instrument_relationship_target_company_idx").on(table.targetCompanyId),
  check(
    "instrument_relationships_listing_or_company_shape",
    sql`
      (${table.relationshipType} = 'succession'
        AND ${table.sourceCompanyId} IS NOT NULL AND ${table.targetCompanyId} IS NOT NULL
        AND ${table.sourceListingId} IS NULL AND ${table.targetListingId} IS NULL)
      OR
      (${table.relationshipType} <> 'succession'
        AND ${table.sourceListingId} IS NOT NULL AND ${table.targetListingId} IS NOT NULL
        AND ${table.sourceCompanyId} IS NULL AND ${table.targetCompanyId} IS NULL)
    `,
  ),
]);

// ─── SEC filings (metadata only -- the documents themselves stay in EDGAR's
// disk cache in secEdgarData.ts; this table is what lets the UI/reasoning
// layer query "what has this company filed" without re-hitting SEC's API).
export const secFilings = pgTable("sec_filings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  formType: text("form_type").notNull(), // 10-K, 10-Q, 8-K, 4, DEF 14A, ...
  accessionNumber: text("accession_number").notNull(),
  filedDate: text("filed_date").notNull(), // ISO date, as EDGAR reports it
  filingUrl: text("filing_url").notNull(),
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("sec_filings_accession_unique").on(table.accessionNumber),
]);

// ─── Persisted financial-statement periods ────────────────────────────────
// Same row shape as LseFinancialReport (server/lseData.ts) so any provider
// in the financialDataProviders.ts waterfall can write through here --
// today only SEC EDGAR does. `data` mirrors what was previously only a
// disk-cached JSON blob; persisting it means historical statements survive
// independently of the file cache and can be queried/joined by companyId.
export const financialStatementPeriods = pgTable("financial_statement_periods", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  companyId: integer("company_id").notNull().references(() => companies.id),
  reportType: text("report_type").notNull(), // income | balance | cashflow
  periodEnd: text("period_end").notNull(), // ISO date
  fiscalYear: text("fiscal_year").notNull(),
  period: text("period").notNull().default("FY"), // FY | Q1 | Q2 | Q3 | Q4
  reportedCurrency: text("reported_currency").notNull().default("USD"),
  data: jsonb("data").notNull().$type<Record<string, number>>(),
  filingDate: text("filing_date"),
  source: text("source").notNull().default("sec_edgar"), // provider id, matches financialDataProviders.ts
  fetchedAt: timestamp("fetched_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("fin_stmt_period_unique").on(table.companyId, table.reportType, table.periodEnd, table.period, table.source),
]);
// ─── Tenant-scoped finance overrides ──────────────────────────────────────
// Manual/imported metric observations are durable user inputs, not browser
// preferences. The API scopes reads and writes by ownerUserId and, when
// present, organizationId so one analyst or client cannot read another's data.
export const financialMetricOverrides = pgTable("financial_metric_overrides", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  symbol: text("symbol").notNull(),
  metricId: text("metric_id").notNull(),
  value: real("value"),
  status: text("status").notNull().default("manual"),
  period: text("period").notNull().default("CURRENT"),
  scenarioId: text("scenario_id"),
  asOf: text("as_of").notNull(),
  publishedAt: text("published_at"),
  source: text("source").notNull(),
  sourceUrl: text("source_url"),
  currency: text("currency"),
  note: text("note"),
  confidence: real("confidence"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("finance_metric_override_owner_symbol_idx").on(table.ownerUserId, table.symbol),
  index("finance_metric_override_org_symbol_idx").on(table.organizationId, table.symbol),
  uniqueIndex("finance_metric_override_scope_key").on(table.ownerUserId, table.symbol, table.metricId, table.period, table.scenarioId),
]);

export type FinancialMetricOverride = typeof financialMetricOverrides.$inferSelect;
export const financialCustomMetrics = pgTable("financial_custom_metrics", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  label: text("label").notNull(),
  unit: text("unit").notNull(),
  formula: text("formula").notNull(),
  dependencies: jsonb("dependencies").notNull().$type<string[]>().default([]),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("finance_custom_metric_owner_idx").on(table.ownerUserId),
  index("finance_custom_metric_org_idx").on(table.organizationId),
]);

export type FinancialCustomMetric = typeof financialCustomMetrics.$inferSelect;

// Analyst-owned "reported vs normalized" adjustment sets (add-backs,
// exclusions, reclassifications). Adjustments are real child rows, not a
// JSONB blob, so they stay queryable/joinable/auditable like every other
// tenant-scoped table in this file. One policy per (owner, symbol) -- see
// src/shared/financialNormalization.ts for the pure calculation this feeds.
export const financialNormalizationPolicies = pgTable("financial_normalization_policies", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  symbol: text("symbol").notNull(),
  label: text("label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("finance_normalization_policy_owner_symbol_idx").on(table.ownerUserId, table.symbol),
  index("finance_normalization_policy_org_symbol_idx").on(table.organizationId, table.symbol),
  uniqueIndex("finance_normalization_policy_owner_symbol_key").on(table.ownerUserId, table.symbol),
]);

export type FinancialNormalizationPolicyRow = typeof financialNormalizationPolicies.$inferSelect;

export const financialNormalizationAdjustments = pgTable("financial_normalization_adjustments", {
  id: text("id").primaryKey(),
  policyId: text("policy_id").notNull().references(() => financialNormalizationPolicies.id, { onDelete: "cascade" }),
  metricId: text("metric_id").notNull(),
  kind: text("kind").notNull(),
  amount: real("amount").notNull(),
  period: text("period").notNull(),
  label: text("label").notNull(),
  rationale: text("rationale"),
  source: text("source"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("finance_normalization_adjustment_policy_idx").on(table.policyId),
]);

export type FinancialNormalizationAdjustmentRow = typeof financialNormalizationAdjustments.$inferSelect;

// A dataset always points to one exact rights assessment. Policies are
// append-only versions: a later legal or commercial review creates a new row
// instead of silently changing what an older model run was allowed to use.
export const dataEntitlementPolicies = pgTable("data_entitlement_policies", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  dataClass: text("data_class").notNull(),
  licenseType: text("license_type").notNull(),
  accessScope: text("access_scope").notNull(),
  redistribution: text("redistribution").notNull(),
  permittedUses: jsonb("permitted_uses").notNull().$type<string[]>().default([]),
  attribution: text("attribution"),
  termsUrl: text("terms_url"),
  effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
  effectiveTo: timestamp("effective_to", { withTimezone: true }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByUserId: integer("reviewed_by_user_id").references(() => users.id),
  contentHash: text("content_hash").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("data_entitlement_policy_hash_unique").on(table.contentHash),
  index("data_entitlement_policy_lookup_idx").on(table.provider, table.dataClass, table.effectiveFrom),
]);

// Immutable, content-addressed analytical snapshots. The five clocks are
// deliberately separate: period/effective time, publication time, retrieval
// time, available-to-model time, and physical creation time are not
// interchangeable in point-in-time research.
export const datasetSnapshots = pgTable("dataset_snapshots", {
  id: text("id").primaryKey(),
  datasetKey: text("dataset_key").notNull(),
  entityKey: text("entity_key").notNull(),
  dataClass: text("data_class").notNull(),
  schemaVersion: text("schema_version").notNull(),
  source: text("source").notNull(),
  provider: text("provider").notNull(),
  frequency: text("frequency").notNull(),
  currency: text("currency"),
  timezone: text("timezone").notNull().default("UTC"),
  observationStart: text("observation_start"),
  observationEnd: text("observation_end"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull(),
  contentHash: text("content_hash").notNull(),
  parentSnapshotId: text("parent_snapshot_id"),
  quality: jsonb("quality").notNull().$type<Record<string, unknown>>(),
  lineage: jsonb("lineage").notNull().$type<Record<string, unknown>>(),
  payload: jsonb("payload").notNull().$type<Record<string, unknown>>(),
  entitlementPolicyId: text("entitlement_policy_id").references(() => dataEntitlementPolicies.id),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  // Null for point-in-time source facts (financial statements, etc.), which
  // never go stale by themselves. Set only by data classes whose snapshot
  // is a *computed* result that can legitimately go stale and needs
  // pruning -- e.g. factor-risk snapshots (see factorRiskSnapshotStore.ts).
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("dataset_snapshot_content_unique").on(table.datasetKey, table.contentHash),
  index("dataset_snapshot_asof_idx").on(table.datasetKey, table.entityKey, table.availableAt),
  index("dataset_snapshot_entity_created_idx").on(table.entityKey, table.createdAt),
  index("dataset_snapshot_expiry_idx").on(table.dataClass, table.expiresAt),
]);

export type DatasetSnapshot = typeof datasetSnapshots.$inferSelect;
export type DataEntitlementPolicy = typeof dataEntitlementPolicies.$inferSelect;

// Parquet files are rebuildable analytical projections of immutable source
// snapshots. Metadata stays transactional; the columnar payload stays local.
export const columnarArtifacts = pgTable("columnar_artifacts", {
  id: text("id").primaryKey(),
  datasetSnapshotId: text("dataset_snapshot_id").notNull().references(() => datasetSnapshots.id, { onDelete: "cascade" }),
  format: text("format").notNull().default("parquet"),
  relativePath: text("relative_path").notNull(),
  contentHash: text("content_hash").notNull(),
  rowCount: integer("row_count").notNull(),
  schema: jsonb("schema").notNull().$type<Array<{ name: string; type: string }>>(),
  compression: text("compression").notNull().default("zstd"),
  accessScope: text("access_scope").notNull().default("internal_only"),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("columnar_artifact_snapshot_hash_unique").on(table.datasetSnapshotId, table.contentHash),
  index("columnar_artifact_snapshot_idx").on(table.datasetSnapshotId, table.createdAt),
]);

export type ColumnarArtifact = typeof columnarArtifacts.$inferSelect;

// Append-only deterministic model receipts used for later forecast-versus-
// actual measurement. A changed assumption set creates a new run.
export const financialModelRuns = pgTable("financial_model_runs", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  listingId: integer("listing_id"),
  securityId: integer("security_id"),
  datasetSnapshotId: text("dataset_snapshot_id").notNull().references(() => datasetSnapshots.id),
  modelVersion: text("model_version").notNull(),
  assumptions: jsonb("assumptions").notNull().$type<Record<string, unknown>>(),
  result: jsonb("result").notNull().$type<Record<string, unknown>>(),
  resultHash: text("result_hash").notNull(),
  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("financial_model_run_hash_unique").on(table.datasetSnapshotId, table.resultHash),
  index("financial_model_run_symbol_created_idx").on(table.symbol, table.createdAt),
]);

export type FinancialModelRun = typeof financialModelRuns.$inferSelect;

// ─── Quant Lab and asynchronous compute runtime ──────────────────────────

export const quantExperiments = pgTable("quant_experiments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  workspace: quantWorkspaceEnum("workspace").notNull(),
  status: quantExperimentStatusEnum("status").notNull().default("active"),
  modelId: text("model_id").notNull(),
  modelVersion: text("model_version").notNull(),
  parameters: jsonb("parameters").notNull().$type<Record<string, unknown>>().default({}),
  datasetSnapshotIds: jsonb("dataset_snapshot_ids").notNull().$type<string[]>().default([]),
  datasetInputBindings: jsonb("dataset_input_bindings").notNull().$type<QuantDatasetInputBinding[]>().default([]),
  seed: integer("seed"),
  timeoutMs: integer("timeout_ms").notNull().default(30000),
  investigationId: integer("investigation_id").references(() => researchInvestigations.id, { onDelete: "set null" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  parentExperimentId: text("parent_experiment_id"),
  nextRunSequence: integer("next_run_sequence").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("quant_experiment_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
  index("quant_experiment_investigation_idx").on(table.investigationId),
  index("quant_experiment_workspace_idx").on(table.workspace, table.status),
]);

export const quantRuns = pgTable("quant_runs", {
  id: text("id").primaryKey(),
  experimentId: text("experiment_id").notNull().references(() => quantExperiments.id, { onDelete: "cascade" }),
  sequence: integer("sequence").notNull(),
  status: quantRunStatusEnum("status").notNull().default("queued"),
  progressPct: integer("progress_pct").notNull().default(0),
  modelId: text("model_id").notNull(),
  modelVersion: text("model_version").notNull(),
  engine: text("engine").notNull(),
  engineEndpoint: text("engine_endpoint").notNull(),
  parameters: jsonb("parameters").notNull().$type<Record<string, unknown>>(),
  datasetSnapshotIds: jsonb("dataset_snapshot_ids").notNull().$type<string[]>().default([]),
  datasetSnapshotHashes: jsonb("dataset_snapshot_hashes").notNull().$type<Record<string, string>>().default({}),
  datasetInputBindings: jsonb("dataset_input_bindings").notNull().$type<QuantDatasetInputBinding[]>().default([]),
  seed: integer("seed"),
  timeoutMs: integer("timeout_ms").notNull(),
  inputHash: text("input_hash").notNull(),
  cacheKey: text("cache_key").notNull(),
  cachedFromRunId: text("cached_from_run_id"),
  environment: jsonb("environment").notNull().$type<Record<string, unknown>>(),
  environmentHash: text("environment_hash").notNull(),
  libraryVersions: jsonb("library_versions").notNull().$type<Record<string, string>>(),
  output: jsonb("output").$type<unknown>(),
  outputHash: text("output_hash"),
  diagnostics: jsonb("diagnostics").notNull().$type<Record<string, unknown>>().default({}),
  warnings: jsonb("warnings").notNull().$type<string[]>().default([]),
  error: text("error"),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
}, (table) => [
  uniqueIndex("quant_run_experiment_sequence_unique").on(table.experimentId, table.sequence),
  index("quant_run_owner_status_idx").on(table.ownerUserId, table.status, table.queuedAt),
  index("quant_run_cache_idx").on(table.ownerUserId, table.cacheKey, table.status),
]);

export type QuantExperiment = typeof quantExperiments.$inferSelect;
export type QuantRun = typeof quantRuns.$inferSelect;


// Durable, restart-safe calculation job queue -- replaces in-process-only
// job tracking that a server restart would silently drop. A `kind` string
// selects which registered runner (see server/calculationJobService.ts)
// executes `input`; the queue itself has no domain knowledge.
// `leaseOwner`/`leaseExpiresAt` model a single worker holding the job so
// recovery on restart can tell a genuinely orphaned "running" row (owning
// process died) from one legitimately in flight.

export const calculationJobs = pgTable("calculation_jobs", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  input: jsonb("input").notNull().$type<Record<string, unknown>>(),
  status: calculationJobStatusEnum("status").notNull().default("queued"),
  progressPct: integer("progress_pct").notNull().default(0),
  cancellationRequested: boolean("cancellation_requested").notNull().default(false),
  result: jsonb("result").$type<unknown>(),
  error: text("error"),
  // Set only by restart recovery, distinct from `error` (a runner's own
  // failure message) -- explains *why* recovery requeued or failed a row
  // that was orphaned mid-execution, for audit/debugging.
  recoveryReason: text("recovery_reason"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(2),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  leaseOwner: text("lease_owner"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  queuedAt: timestamp("queued_at", { withTimezone: true }).defaultNow().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("calculation_job_owner_status_idx").on(table.ownerUserId, table.status, table.queuedAt),
  index("calculation_job_org_status_idx").on(table.organizationId, table.status),
  index("calculation_job_lease_idx").on(table.status, table.leaseExpiresAt),
]);

export type CalculationJob = typeof calculationJobs.$inferSelect;

// ─── Domains (verticals): Finance, Economics & Public Policy, etc. ────────
// One platform, many verticals -- an organization subscribes to whichever
// domains it's paying for, and a single client login can switch between
// them if it has more than one. `active` distinguishes verticals that have
// real panels/data behind them (finance, economics_policy) from ones that
// are seeded as placeholders for a future build-out (supply_chain, etc).
export const domains = pgTable("domains", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"), // lucide-react icon name, used identically by terminal + dashboard
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Many-to-many: which domains each org can see. A client with only a
// "finance" row here never sees the domain switcher at all; one with
// "finance" + "economics_policy" gets one login with a switcher between them.
export const organizationDomains = pgTable("organization_domains", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  domainId: integer("domain_id").notNull().references(() => domains.id),
  grantedAt: timestamp("granted_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("org_domain_unique").on(table.organizationId, table.domainId),
]);

// ─── Research Intelligence ────────────────────────────────────────────────
// Investigations are the durable container for Limuria's evidence-to-decision
// workflow. They are internal-owned in Phase 1, but can optionally carry an
// organization context so client work stays attributable and can later flow
// through Quality Gate and Decision Receipts without a schema redesign.

export const researchInvestigations = pgTable("research_investigations", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: text("title").notNull(),
  question: text("question").notNull(),
  thesis: text("thesis"),
  status: researchInvestigationStatusEnum("status").notNull().default("draft"),
  primarySymbol: text("primary_symbol"),
  subjectLabel: text("subject_label"),
  tags: jsonb("tags").notNull().$type<string[]>().default([]),
  scope: jsonb("scope").notNull().$type<Record<string, unknown>>().default({}),
  companyId: integer("company_id").references(() => companies.id),
  domainId: integer("domain_id").references(() => domains.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("research_investigations_owner_status_idx").on(table.ownerUserId, table.status),
  index("research_investigations_org_idx").on(table.organizationId),
  index("research_investigations_company_idx").on(table.companyId),
]);



export type ResearchSourceQuality = {
  authority: number;
  directness: number;
  recency: number;
  corroboration: number;
  extractionConfidence: number;
};

export const researchEvidence = pgTable("research_evidence", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  investigationId: integer("investigation_id").notNull().references(() => researchInvestigations.id, { onDelete: "cascade" }),
  evidenceType: researchEvidenceTypeEnum("evidence_type").notNull(),
  evidenceKind: researchEvidenceKindEnum("evidence_kind").notNull().default("unknown"),
  title: text("title").notNull(),
  excerpt: text("excerpt"),
  annotation: text("annotation"),
  sourceName: text("source_name").notNull(),
  provider: text("provider").notNull(),
  sourceUrl: text("source_url"),
  sourceExternalId: text("source_external_id"),
  contentFingerprint: text("content_fingerprint").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  effectiveAt: timestamp("effective_at", { withTimezone: true }),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).defaultNow().notNull(),
  sourceQuality: jsonb("source_quality").notNull().$type<ResearchSourceQuality>(),
  relevanceScore: real("relevance_score"),
  metadata: jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
  addedByUserId: integer("added_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("research_evidence_investigation_fingerprint_unique").on(table.investigationId, table.contentFingerprint),
  index("research_evidence_investigation_created_idx").on(table.investigationId, table.createdAt),
  index("research_evidence_external_id_idx").on(table.provider, table.sourceExternalId),
]);


export const researchEvidenceRelationships = pgTable("research_evidence_relationships", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  investigationId: integer("investigation_id").notNull().references(() => researchInvestigations.id, { onDelete: "cascade" }),
  fromEvidenceId: integer("from_evidence_id").notNull().references(() => researchEvidence.id, { onDelete: "cascade" }),
  toEvidenceId: integer("to_evidence_id").notNull().references(() => researchEvidence.id, { onDelete: "cascade" }),
  relationshipType: researchRelationshipTypeEnum("relationship_type").notNull(),
  note: text("note"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("research_evidence_relationship_unique").on(
    table.investigationId,
    table.fromEvidenceId,
    table.toEvidenceId,
    table.relationshipType,
  ),
  index("research_evidence_relationship_investigation_idx").on(table.investigationId),
]);

export type ResearchSearchFilters = {
  entity?: string;
  sourceClasses?: string[];
  documentTypes?: string[];
  dateFrom?: string;
  dateTo?: string;
  domainId?: number;
  freshnessDays?: number;
};

export const researchSavedSearches = pgTable("research_saved_searches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  investigationId: integer("investigation_id").references(() => researchInvestigations.id, { onDelete: "cascade" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  query: text("query").notNull(),
  filters: jsonb("filters").notNull().$type<ResearchSearchFilters>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("research_saved_search_owner_idx").on(table.ownerUserId, table.updatedAt),
  index("research_saved_search_investigation_idx").on(table.investigationId),
]);

export type ResearchEvidenceSnapshot = {
  id: number;
  evidenceType: string;
  evidenceKind: string;
  title: string;
  excerpt: string | null;
  annotation: string | null;
  sourceName: string;
  provider: string;
  sourceUrl: string | null;
  sourceExternalId: string | null;
  contentFingerprint: string;
  publishedAt: string | null;
  effectiveAt: string | null;
  retrievedAt: string;
  sourceQuality: ResearchSourceQuality;
  relevanceScore: number | null;
  metadata: Record<string, unknown>;
};

export type ResearchCitationSnapshot = {
  label: string;
  evidenceId: number;
  title: string;
  sourceName: string;
  provider: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  issues: string[];
};

export const researchBriefs = pgTable("research_briefs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  investigationId: integer("investigation_id").notNull().references(() => researchInvestigations.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  markdown: text("markdown").notNull(),
  evidenceSnapshot: jsonb("evidence_snapshot").notNull().$type<ResearchEvidenceSnapshot[]>(),
  snapshotHash: text("snapshot_hash").notNull(),
  citations: jsonb("citations").notNull().$type<ResearchCitationSnapshot[]>().default([]),
  generatedByUserId: integer("generated_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("research_briefs_investigation_created_idx").on(table.investigationId, table.createdAt),
]);

export type ResearchInvestigation = typeof researchInvestigations.$inferSelect;
export type ResearchEvidence = typeof researchEvidence.$inferSelect;
export type ResearchEvidenceRelationship = typeof researchEvidenceRelationships.$inferSelect;
export type ResearchSavedSearch = typeof researchSavedSearches.$inferSelect;
export type ResearchBrief = typeof researchBriefs.$inferSelect;

// ─── Consensus and Variant Perception ─────────────────────────────────────
// A snapshot is an immutable, source-attributed view of market expectations
// at one point in time. Licensed aggregates and user-supplied observations
// share this contract; unavailable coverage is represented by no row, never 0.



export type ConsensusAssumptionRef = {
  label: string;
  value?: number | string | null;
  evidenceId?: number;
};

export const consensusSnapshots = pgTable("consensus_snapshots", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: text("symbol").notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  investigationId: integer("investigation_id").references(() => researchInvestigations.id, { onDelete: "set null" }),
  metric: consensusMetricEnum("metric").notNull(),
  fiscalPeriod: text("fiscal_period").notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  currency: text("currency"),
  unit: text("unit").notNull(),
  mean: real("mean"),
  median: real("median"),
  high: real("high"),
  low: real("low"),
  contributorCount: integer("contributor_count"),
  standardDeviation: real("standard_deviation"),
  upwardRevisionCount: integer("upward_revision_count"),
  downwardRevisionCount: integer("downward_revision_count"),
  unchangedRevisionCount: integer("unchanged_revision_count"),
  estimateAsOf: timestamp("estimate_as_of", { withTimezone: true }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  sourceType: consensusSourceTypeEnum("source_type").notNull(),
  provider: text("provider").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  methodology: text("methodology"),
  snapshotHash: text("snapshot_hash").notNull(),
  metadata: jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("consensus_snapshot_hash_unique").on(table.snapshotHash),
  index("consensus_snapshot_symbol_period_idx").on(table.symbol, table.metric, table.fiscalPeriod, table.estimateAsOf),
  index("consensus_snapshot_asof_idx").on(table.symbol, table.metric, table.fiscalPeriod, table.availableAt),
  index("consensus_snapshot_org_idx").on(table.organizationId),
]);

export const consensusBenchmarks = pgTable("consensus_benchmarks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  symbol: text("symbol").notNull(),
  organizationId: integer("organization_id").references(() => organizations.id),
  investigationId: integer("investigation_id").references(() => researchInvestigations.id, { onDelete: "set null" }),
  metric: consensusMetricEnum("metric").notNull(),
  fiscalPeriod: text("fiscal_period").notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  currency: text("currency"),
  unit: text("unit").notNull(),
  benchmarkKind: consensusBenchmarkKindEnum("benchmark_kind").notNull(),
  value: real("value"),
  low: real("low"),
  high: real("high"),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
  provider: text("provider").notNull(),
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url"),
  modelName: text("model_name"),
  modelVersion: text("model_version"),
  evidenceIds: jsonb("evidence_ids").notNull().$type<number[]>().default([]),
  assumptionRefs: jsonb("assumption_refs").notNull().$type<ConsensusAssumptionRef[]>().default([]),
  metadata: jsonb("metadata").notNull().$type<Record<string, unknown>>().default({}),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("consensus_benchmark_symbol_period_idx").on(table.symbol, table.metric, table.fiscalPeriod, table.effectiveAt),
  index("consensus_benchmark_org_idx").on(table.organizationId),
]);

export const consensusAlertRules = pgTable("consensus_alert_rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  organizationId: integer("organization_id").references(() => organizations.id),
  symbol: text("symbol").notNull(),
  metric: consensusMetricEnum("metric"),
  revisionThresholdPct: real("revision_threshold_pct").notNull().default(5),
  dispersionThresholdPct: real("dispersion_threshold_pct").notNull().default(20),
  divergenceThresholdPct: real("divergence_threshold_pct").notNull().default(10),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("consensus_alert_owner_symbol_metric_unique").on(table.ownerUserId, table.organizationId, table.symbol, table.metric),
  index("consensus_alert_owner_idx").on(table.ownerUserId, table.enabled),
]);

export type ConsensusSnapshot = typeof consensusSnapshots.$inferSelect;
export type ConsensusBenchmark = typeof consensusBenchmarks.$inferSelect;
export type ConsensusAlertRule = typeof consensusAlertRules.$inferSelect;

// ─── Limuria Brain and Agentic Investigation ─────────────────────────────

export const brainRuns = pgTable("brain_runs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: text("title").notNull(),
  question: text("question").notNull(),
  decisionType: brainDecisionTypeEnum("decision_type").notNull(),
  status: brainRunStatusEnum("status").notNull().default("planned"),
  organizationId: integer("organization_id").references(() => organizations.id),
  investigationId: integer("investigation_id").references(() => researchInvestigations.id, { onDelete: "set null" }),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  intent: jsonb("intent").notNull().$type<Record<string, unknown>>(),
  requiredOutputs: jsonb("required_outputs").notNull().$type<string[]>().default([]),
  policies: jsonb("policies").notNull().$type<Record<string, unknown>>().default({}),
  synthesis: text("synthesis"),
  completionSummary: jsonb("completion_summary").notNull().$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("brain_run_owner_created_idx").on(table.ownerUserId, table.createdAt),
  index("brain_run_org_idx").on(table.organizationId),
  index("brain_run_investigation_idx").on(table.investigationId),
]);

export const brainTasks = pgTable("brain_tasks", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  runId: integer("run_id").notNull().references(() => brainRuns.id, { onDelete: "cascade" }),
  taskKey: text("task_key").notNull(),
  label: text("label").notNull(),
  agentRole: brainAgentRoleEnum("agent_role").notNull(),
  toolId: text("tool_id"),
  dependencies: jsonb("dependencies").notNull().$type<string[]>().default([]),
  expectedEvidence: jsonb("expected_evidence").notNull().$type<string[]>().default([]),
  completionCriteria: text("completion_criteria").notNull(),
  status: brainTaskStatusEnum("status").notNull().default("pending"),
  input: jsonb("input").notNull().$type<Record<string, unknown>>().default({}),
  output: jsonb("output").$type<Record<string, unknown>>(),
  provenance: jsonb("provenance").notNull().$type<Array<Record<string, unknown>>>().default([]),
  deterministicRefs: jsonb("deterministic_refs").notNull().$type<string[]>().default([]),
  attemptCount: integer("attempt_count").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("brain_task_run_key_unique").on(table.runId, table.taskKey),
  index("brain_task_run_status_idx").on(table.runId, table.status),
]);

export const brainToolCalls = pgTable("brain_tool_calls", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  runId: integer("run_id").notNull().references(() => brainRuns.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => brainTasks.id, { onDelete: "cascade" }),
  toolId: text("tool_id").notNull(),
  agentRole: brainAgentRoleEnum("agent_role").notNull(),
  status: brainTaskStatusEnum("status").notNull(),
  input: jsonb("input").notNull().$type<Record<string, unknown>>().default({}),
  output: jsonb("output").$type<Record<string, unknown>>(),
  provenance: jsonb("provenance").notNull().$type<Array<Record<string, unknown>>>().default([]),
  deterministicRefs: jsonb("deterministic_refs").notNull().$type<string[]>().default([]),
  provider: text("provider"),
  modelId: text("model_id"),
  error: text("error"),
  latencyMs: integer("latency_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  index("brain_tool_call_run_created_idx").on(table.runId, table.createdAt),
  index("brain_tool_call_task_idx").on(table.taskId),
]);

export const brainApprovals = pgTable("brain_approvals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  runId: integer("run_id").notNull().references(() => brainRuns.id, { onDelete: "cascade" }),
  taskId: integer("task_id").notNull().references(() => brainTasks.id, { onDelete: "cascade" }),
  status: brainApprovalStatusEnum("status").notNull().default("pending"),
  requestedByUserId: integer("requested_by_user_id").notNull().references(() => users.id),
  decidedByUserId: integer("decided_by_user_id").references(() => users.id),
  note: text("note"),
  snapshotHash: text("snapshot_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (table) => [
  index("brain_approval_run_idx").on(table.runId, table.createdAt),
  uniqueIndex("brain_approval_task_snapshot_unique").on(table.taskId, table.snapshotHash),
]);

export type BrainRun = typeof brainRuns.$inferSelect;
export type BrainTask = typeof brainTasks.$inferSelect;
export type BrainToolCall = typeof brainToolCalls.$inferSelect;
export type BrainApproval = typeof brainApprovals.$inferSelect;

// ─── Decision Engine ──────────────────────────────────────────────────────
// A decision is a durable case; every receipt is an immutable versioned
// snapshot. Approvals point to one exact receipt hash so editing a decision
// can never silently preserve an earlier approval. Structured arrays stay in
// JSONB because assumptions, scenarios, models, and trigger conditions are
// heterogeneous artifacts whose complete value is captured in the hash.

export const decisionCases = pgTable("decision_cases", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  title: text("title").notNull(),
  question: text("question").notNull(),
  decisionType: text("decision_type").notNull().default("investment"),
  materiality: decisionMaterialityEnum("materiality").notNull().default("material"),
  status: decisionCaseStatusEnum("status").notNull().default("draft"),
  symbol: text("symbol"),
  investigationId: integer("investigation_id").references(() => researchInvestigations.id, { onDelete: "set null" }),
  brainRunId: integer("brain_run_id").references(() => brainRuns.id, { onDelete: "set null" }),
  organizationId: integer("organization_id").references(() => organizations.id),
  ownerUserId: integer("owner_user_id").notNull().references(() => users.id),
  finalDecision: text("final_decision"),
  decisionRationale: text("decision_rationale"),
  reviewDate: timestamp("review_date", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  approvedReceiptVersionId: integer("approved_receipt_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("decision_case_owner_updated_idx").on(table.ownerUserId, table.updatedAt),
  index("decision_case_investigation_idx").on(table.investigationId),
  index("decision_case_org_idx").on(table.organizationId),
]);

export const decisionReceiptVersions = pgTable("decision_receipt_versions", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  decisionId: integer("decision_id").notNull().references(() => decisionCases.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  question: text("question").notNull(),
  recommendation: text("recommendation").notNull(),
  interpretation: text("interpretation").notNull(),
  evidence: jsonb("evidence").notNull().$type<Array<Record<string, unknown>>>().default([]),
  sources: jsonb("sources").notNull().$type<Array<Record<string, unknown>>>().default([]),
  assumptions: jsonb("assumptions").notNull().$type<Array<Record<string, unknown>>>().default([]),
  calculations: jsonb("calculations").notNull().$type<Array<Record<string, unknown>>>().default([]),
  models: jsonb("models").notNull().$type<Array<Record<string, unknown>>>().default([]),
  scenarios: jsonb("scenarios").notNull().$type<Array<Record<string, unknown>>>().default([]),
  alternatives: jsonb("alternatives").notNull().$type<Array<Record<string, unknown>>>().default([]),
  counterarguments: jsonb("counterarguments").notNull().$type<Array<Record<string, unknown>>>().default([]),
  contradictions: jsonb("contradictions").notNull().$type<Array<Record<string, unknown>>>().default([]),
  confidence: jsonb("confidence").notNull().$type<Record<string, unknown>>(),
  monitoringTriggers: jsonb("monitoring_triggers").notNull().$type<Array<Record<string, unknown>>>().default([]),
  provenance: jsonb("provenance").notNull().$type<Array<Record<string, unknown>>>().default([]),
  requiredEvidenceCount: integer("required_evidence_count").notNull().default(3),
  completeness: jsonb("completeness").notNull().$type<Record<string, unknown>>(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("decision_receipt_version_unique").on(table.decisionId, table.version),
  uniqueIndex("decision_receipt_hash_unique").on(table.snapshotHash),
  index("decision_receipt_decision_created_idx").on(table.decisionId, table.createdAt),
]);

export const decisionApprovals = pgTable("decision_approvals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  decisionId: integer("decision_id").notNull().references(() => decisionCases.id, { onDelete: "cascade" }),
  receiptVersionId: integer("receipt_version_id").notNull().references(() => decisionReceiptVersions.id, { onDelete: "cascade" }),
  outcome: decisionApprovalOutcomeEnum("outcome").notNull(),
  snapshotHash: text("snapshot_hash").notNull(),
  note: text("note"),
  waiverReason: text("waiver_reason"),
  reviewerUserId: integer("reviewer_user_id").notNull().references(() => users.id),
  reviewRequestId: text("review_request_id"),
  reviewRequestHash: text("review_request_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("decision_approval_decision_idx").on(table.decisionId, table.createdAt),
  uniqueIndex("decision_approval_reviewer_receipt_unique").on(table.receiptVersionId, table.reviewerUserId),
  uniqueIndex("decision_approval_reviewer_request_unique").on(table.reviewerUserId, table.reviewRequestId),
]);

export const decisionMonitoringRules = pgTable("decision_monitoring_rules", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  decisionId: integer("decision_id").notNull().references(() => decisionCases.id, { onDelete: "cascade" }),
  receiptVersionId: integer("receipt_version_id").notNull().references(() => decisionReceiptVersions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  indicator: text("indicator").notNull(),
  operator: text("operator").notNull(),
  threshold: real("threshold").notNull(),
  unit: text("unit").notNull(),
  action: text("action").notNull(),
  status: decisionMonitorStatusEnum("status").notNull().default("active"),
  currentValue: real("current_value"),
  sourceUrl: text("source_url"),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
  breachedAt: timestamp("breached_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("decision_monitor_decision_status_idx").on(table.decisionId, table.status),
]);

export const decisionReplays = pgTable("decision_replays", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  decisionId: integer("decision_id").notNull().references(() => decisionCases.id, { onDelete: "cascade" }),
  receiptVersionId: integer("receipt_version_id").notNull().references(() => decisionReceiptVersions.id, { onDelete: "cascade" }),
  originalSnapshotHash: text("original_snapshot_hash").notNull(),
  replaySnapshotHash: text("replay_snapshot_hash").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  inputs: jsonb("inputs").notNull().$type<Record<string, unknown>>(),
  result: jsonb("result").notNull().$type<Record<string, unknown>>(),
  changed: boolean("changed").notNull(),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("decision_replay_decision_created_idx").on(table.decisionId, table.createdAt),
]);

export type DecisionCase = typeof decisionCases.$inferSelect;
export type DecisionReceiptVersion = typeof decisionReceiptVersions.$inferSelect;
export type DecisionApproval = typeof decisionApprovals.$inferSelect;
export type DecisionMonitoringRule = typeof decisionMonitoringRules.$inferSelect;
export type DecisionReplay = typeof decisionReplays.$inferSelect;

// ─── Engagements (LIOS ecosystem: the client-relationship shape) ──────────
// Orthogonal to `domains` above -- a domain is *what subject* an engagement
// is about (finance, economics_policy, ...); an engagement model is *what
// commercial shape* the relationship takes. An org can hold multiple
// engagements, possibly concurrently (e.g. a Vantage partnership alongside
// a standalone Strategy project), so this is deliberately its own entity
// rather than a column on `organizations` -- putting it there would make
// engagement history and concurrent engagements unrepresentable.

// Mirrors the per-request quote lifecycle one level up: an engagement can
// be tracked from first proposal through delivery in one place rather than
// only starting this row once a deal is already signed. Engagements that
// begin from an already-signed deal (e.g. backfilled/legacy data) can be
// created directly at "active".

export const engagements = pgTable("engagements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  engagementModel: engagementModelEnum("engagement_model").notNull(),
  domainId: integer("domain_id").notNull().references(() => domains.id),
  title: text("title").notNull(),
  status: engagementStatusEnum("status").notNull().default("proposed"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"), // nullable -- One/Vantage are open-ended
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertEngagementSchema = z.object({
  organizationId: z.number().int().positive(),
  engagementModel: z.enum(["strategy", "one", "vantage"]),
  domainId: z.number().int().positive(),
  title: z.string().trim().min(3),
});

export type InsertEngagement = z.infer<typeof insertEngagementSchema>;
export type Engagement = typeof engagements.$inferSelect;

// ─── Engagement agreements (Trial-to-Contract Phase D) ────────────────────
// The e-signature vendor is not yet chosen (see BUILD_PLAN decision #2) --
// this table's shape is vendor-agnostic on purpose: vendorReference is
// whatever opaque envelope/session id that vendor gives us, not a
// vendor-specific column set, so picking a vendor later doesn't need a
// schema change here.

export const engagementAgreements = pgTable("engagement_agreements", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  engagementId: integer("engagement_id").notNull().references(() => engagements.id),
  status: engagementAgreementStatusEnum("status").notNull().default("draft"),
  vendorReference: text("vendor_reference"),
  signedByUserId: integer("signed_by_user_id").references(() => users.id),
  signedAt: timestamp("signed_at"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type EngagementAgreement = typeof engagementAgreements.$inferSelect;

// ─── Engagement payments (Trial-to-Contract Phase E) ───────────────────────
// Deliberately a separate table from creditLedgerEntries: credits are usage
// currency (metered terminal actions), this is real money (the engagement
// fee itself) -- they must never share a table or a ledger. idempotencyKey
// is unique so a retried webhook or a double-click checkout can never create
// two payment rows for the same attempt; the payment processor is not yet
// chosen (see BUILD_PLAN decision #1), so `provider` is a plain string
// rather than an enum until that's settled.

export const engagementPayments = pgTable("engagement_payments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  engagementId: integer("engagement_id").notNull().references(() => engagements.id),
  provider: text("provider").notNull(),
  providerSessionId: text("provider_session_id"),
  providerPaymentId: text("provider_payment_id"),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("INR"),
  status: engagementPaymentStatusEnum("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reconciledAt: timestamp("reconciled_at"),
}, (table) => [
  uniqueIndex("engagement_payments_idempotency_unique").on(table.idempotencyKey),
]);

export type EngagementPayment = typeof engagementPayments.$inferSelect;

// ─── Workstreams (sub-tracks of work within one engagement) ───────────────
// An engagement is the commercial container (the "project"); a Strategy
// engagement in particular is rarely one undifferentiated block of work --
// it has phases ("Discovery", "Implementation") that need their own owner
// and timeline. Modeled as a child of engagements rather than a status field
// on the engagement itself so a project can have several running (or
// sequential) at once, matching how the consulting team actually staffs work.

export const workstreams = pgTable("workstreams", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  engagementId: integer("engagement_id").notNull().references(() => engagements.id),
  title: text("title").notNull(),
  description: text("description"),
  status: workstreamStatusEnum("status").notNull().default("not_started"),
  ownerAdminId: integer("owner_admin_id").references(() => users.id),
  // Display order within the engagement (e.g. Phase 1, Phase 2) -- not a
  // timeline dependency, just how the client-facing view lists them.
  sequence: integer("sequence").notNull().default(0),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWorkstreamSchema = z.object({
  engagementId: z.number().int().positive(),
  title: z.string().trim().min(2),
  description: z.string().trim().optional(),
  ownerAdminId: z.number().int().positive().optional(),
  sequence: z.number().int().nonnegative().default(0),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export type InsertWorkstream = z.infer<typeof insertWorkstreamSchema>;
export type Workstream = typeof workstreams.$inferSelect;

// ─── Deliverables (files/outputs produced within a workstream) ────────────
// Quality Gate (Major Bet, Roadmap Rev.3 §10): "make the deliverable/
// approval flow explicit" -- the old 4-stage enum (draft -> in_review ->
// delivered -> approved) had never been reachable from any route or UI (the
// table was empty in every environment), so there's no migration-safety
// concern replacing it wholesale with the roadmap's own named sequence
// rather than layering on top of a stage nobody ever actually used.
// DELIVERABLE_GATE_SEQUENCE is the single source of truth for stage order --
// both the advance/reject routes (server/adminRoutes.ts) and the gate
// progress UI (QualityGatePanel.tsx) read this instead of hardcoding it
// twice.

export const DELIVERABLE_GATE_SEQUENCE = deliverableStatusEnum.enumValues;

// Decision Room (Major Bet, Roadmap Rev.3): "a premium Deliverable subtype
// for major decisions in one artifact." Realizes the same structure the
// AI-validator mechanism table (§03) calls a Decision Receipt -- question,
// data used, model used, assumptions, risks, scenarios, recommendation,
// decision owner -- as real, filled-in columns on a Deliverable rather than
// a separate concept. isDecisionRoom=false leaves every field below null and
// the deliverable renders exactly as it did before this existed; the
// structured fields only ever populate through QualityGatePanel.tsx's
// Decision Room toggle at creation time.
export const deliverables = pgTable("deliverables", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  workstreamId: integer("workstream_id").notNull().references(() => workstreams.id),
  title: text("title").notNull(),
  description: text("description"),
  fileUrl: text("file_url"),
  status: deliverableStatusEnum("status").notNull().default("draft"),
  submittedByAdminId: integer("submitted_by_admin_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at"),
  isDecisionRoom: boolean("is_decision_room").notNull().default(false),
  decisionQuestion: text("decision_question"),
  dataUsed: text("data_used"),
  modelUsed: text("model_used"),
  keyAssumptions: text("key_assumptions"),
  keyRisks: text("key_risks"),
  scenarios: text("scenarios"),
  recommendation: text("recommendation"),
  decisionOwner: text("decision_owner"),
});

export const insertDeliverableSchema = z.object({
  workstreamId: z.number().int().positive(),
  title: z.string().trim().min(2),
  description: z.string().trim().optional(),
  fileUrl: z.string().trim().url().optional(),
  isDecisionRoom: z.boolean().optional(),
  decisionQuestion: z.string().trim().optional(),
  dataUsed: z.string().trim().optional(),
  modelUsed: z.string().trim().optional(),
  keyAssumptions: z.string().trim().optional(),
  keyRisks: z.string().trim().optional(),
  scenarios: z.string().trim().optional(),
  recommendation: z.string().trim().optional(),
  decisionOwner: z.string().trim().optional(),
});

export type InsertDeliverable = z.infer<typeof insertDeliverableSchema>;
export type Deliverable = typeof deliverables.$inferSelect;

// Every gate transition is logged, not just the bare current status -- the
// "formalized" part of "Quality Gate, formalized" is that a rejection always
// carries a reason and every advance is attributable to a specific person,
// not just a status column that silently changed. senior_review ->
// approved_for_delivery is the one transition server/adminRoutes.ts actually
// enforces as internal_admin-only (see its advance route) -- the stage name
// means something beyond a label.

export const deliverableGateEvents = pgTable("deliverable_gate_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  deliverableId: integer("deliverable_id").notNull().references(() => deliverables.id),
  action: deliverableGateActionEnum("action").notNull(),
  fromStatus: deliverableStatusEnum("from_status").notNull(),
  toStatus: deliverableStatusEnum("to_status").notNull(),
  performedByUserId: integer("performed_by_user_id").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Meetings (scheduled against an engagement, optionally one workstream) ─

export const meetings = pgTable("meetings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  engagementId: integer("engagement_id").notNull().references(() => engagements.id),
  // Null = engagement-level (kickoff, steering committee); set = scoped to
  // one phase of work, same optionality as consultingRequests.workstreamId.
  workstreamId: integer("workstream_id").references(() => workstreams.id),
  title: text("title").notNull(),
  scheduledAt: timestamp("scheduled_at").notNull(),
  durationMinutes: integer("duration_minutes"),
  // Filled in after the meeting happens -- null beforehand, not an empty string.
  notes: text("notes"),
  status: meetingStatusEnum("status").notNull().default("scheduled"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMeetingSchema = z.object({
  engagementId: z.number().int().positive(),
  workstreamId: z.number().int().positive().optional(),
  title: z.string().trim().min(2),
  scheduledAt: z.coerce.date(),
  durationMinutes: z.number().int().positive().optional(),
});

export type InsertMeeting = z.infer<typeof insertMeetingSchema>;
export type Meeting = typeof meetings.$inferSelect;

// ─── Workstream comments (client<->consultant thread, same shape as
// consultingComments below but scoped to a workstream rather than a single
// advisory request -- covers day-to-day project chatter that isn't a formal
// support query) ────────────────────────────────────────────────────────
export const workstreamComments = pgTable("workstream_comments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  workstreamId: integer("workstream_id").notNull().references(() => workstreams.id),
  authorUserId: integer("author_user_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  isInternalNote: boolean("is_internal_note").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWorkstreamCommentSchema = z.object({
  workstreamId: z.number().int().positive(),
  message: z.string().trim().min(1),
});

export type InsertWorkstreamComment = z.infer<typeof insertWorkstreamCommentSchema>;
export type WorkstreamComment = typeof workstreamComments.$inferSelect;

// ─── Published content (research notes/briefs/trade ideas -> dashboard) ───
export const publishedContent = pgTable("published_content", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  authorUserId: integer("author_user_id").notNull().references(() => users.id),
  // Nullable at the DB level only so the migration doesn't have to touch
  // pre-existing rows immediately -- the seed/backfill step sets every
  // existing row to the finance domain right after migrating, and every
  // new row from here on always sets it explicitly.
  domainId: integer("domain_id").references(() => domains.id),
  title: text("title").notNull(),
  body: text("body").notNull(),
  contentType: contentTypeEnum("content_type").notNull(),
  visibility: contentVisibilityEnum("visibility").notNull().default("specific_orgs"),
  status: contentStatusEnum("status").notNull().default("draft"),
  // AI kill-switch fields: any AI-authored content is flagged so a single
  // platform-wide suppress (see platformSettings) can pull it all back
  // instantly, regardless of individual approval status.
  isAiGenerated: boolean("is_ai_generated").notNull().default(false),
  suppressedAt: timestamp("suppressed_at"),
  suppressedByUserId: integer("suppressed_by_user_id").references(() => users.id),
  approvedByUserId: integer("approved_by_user_id").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  publishedAt: timestamp("published_at"),
});

// Many-to-many: which orgs see a piece of content when visibility = specific_orgs
export const contentOrganizationLinks = pgTable("content_organization_links", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  contentId: integer("content_id").notNull().references(() => publishedContent.id),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
}, (table) => [
  uniqueIndex("content_org_unique").on(table.contentId, table.organizationId),
]);

// ─── Client-facing watchlists & alerts (curated by internal team) ─────────
// `symbol` is domain-typed by convention rather than by a separate column:
// for the finance domain it's a ticker; for economics_policy it's a FRED
// series id (e.g. "CPIAUCSL"). Each domain's own connector knows how to
// resolve its own symbol format -- the table itself doesn't need to care.
export const dashboardWatchlistItems = pgTable("dashboard_watchlist_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  domainId: integer("domain_id").references(() => domains.id),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  addedByUserId: integer("added_by_user_id").notNull().references(() => users.id),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export const clientAlerts = pgTable("client_alerts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  domainId: integer("domain_id").references(() => domains.id),
  symbol: text("symbol").notNull(),
  condition: text("condition").notNull(), // above | below
  price: real("price").notNull(),
  triggered: boolean("triggered").notNull().default(false),
  triggerPrice: real("trigger_price"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  triggeredAt: timestamp("triggered_at"),
});

// ─── Decision Memory (Major Bet, Roadmap Rev.3 -- "start early, compounds
// in value the longer it's been running"). A client logs a real decision
// with its forecast at the time; later, someone on their team comes back
// and records what actually happened. Deliberately zero AI anywhere in this
// table or its routes -- pure record-keeping, no interpretation needed to
// be useful, which keeps it trivially compliant with "AI validates, never
// calculates" by simply not touching the doctrine's boundary at all. The
// moat is accumulation: this is worthless in month one and hard to leave
// once years of an org's own predicted-vs-actual history live here.

export const decisionRecords = pgTable("decision_records", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  question: text("question").notNull(),
  assumptions: text("assumptions").notNull(),
  forecast: text("forecast").notNull(),
  // Optional structured fields, additive to the free-text `forecast`/
  // `actualOutcome` above (kept exactly as-is for backward compatibility).
  // Populating all three of metric/forecastValue/actualValue on a row makes
  // it eligible for the Accuracy Scorecard (computeForecastAccountability
  // in decisionReceiptEngine.ts) -- rows left null are simply excluded.
  metric: text("metric"),
  forecastValue: real("forecast_value"),
  targetDate: timestamp("target_date").notNull(),
  status: decisionRecordStatusEnum("status").notNull().default("open"),
  actualOutcome: text("actual_outcome"),
  actualValue: real("actual_value"),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  resolvedByUserId: integer("resolved_by_user_id").references(() => users.id),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const decisionRecordsRelations = relations(decisionRecords, ({ one }) => ({
  organization: one(organizations, { fields: [decisionRecords.organizationId], references: [organizations.id] }),
  createdBy: one(users, { fields: [decisionRecords.createdByUserId], references: [users.id] }),
  resolvedBy: one(users, { fields: [decisionRecords.resolvedByUserId], references: [users.id] }),
}));

// ─── Audit trail ────────────────────────────────────────────────────────────
export const auditEvents = pgTable("audit_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").references(() => users.id),
  eventType: text("event_type").notNull(), // login, publish, view, suppress, ...
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Sessions (durable, so an app restart doesn't force everyone to log
// back in -- this is a desktop app people quit and reopen constantly) ─────
export const sessions = pgTable("sessions", {
  sid: text("sid").primaryKey(),
  sessionData: jsonb("session_data").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

// ─── Platform-wide settings (the AI kill switch lives here) ───────────────
export const platformSettings = pgTable("platform_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id),
});

export const PLATFORM_SETTING_AI_SUPPRESSED = "ai_content_globally_suppressed";

// ─── P3 production services / hosted control-plane operations ───────────────
// These tables hold control-plane metadata only. They never custody raw BYOD
// files, exported report bytes, prompts, notes, provider credentials, or full
// crash stacks. Export custody stores hashes/size/format; diagnostics are a
// redacted allow-listed envelope.
export const productionRetentionPolicies = pgTable("production_retention_policies", {
  scope: text("scope").primaryKey(),
  telemetryDays: integer("telemetry_days").notNull().default(30),
  deletionReceiptDays: integer("deletion_receipt_days").notNull().default(365),
  exportReceiptDays: integer("export_receipt_days").notNull().default(90),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedByUserId: integer("updated_by_user_id").references(() => users.id, { onDelete: "set null" }),
});

export const diagnosticEvents = pgTable("diagnostic_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  category: text("category").notNull(),
  eventName: text("event_name").notNull(),
  severity: text("severity").notNull(),
  appVersion: text("app_version"),
  platform: text("platform"),
  arch: text("arch"),
  fingerprint: text("fingerprint"),
  details: jsonb("details").notNull().$type<Record<string, string | number | boolean | null>>().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  index("diagnostic_events_created_idx").on(table.createdAt),
  index("diagnostic_events_expires_idx").on(table.expiresAt),
  index("diagnostic_events_org_idx").on(table.organizationId),
]);

export const dataDeletionReceipts = pgTable("data_deletion_receipts", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  requestedByUserId: integer("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  scope: text("scope").notNull(),
  status: text("status").notNull(),
  reason: text("reason"),
  counts: jsonb("counts").notNull().$type<Record<string, number>>().default({}),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at").notNull(),
}, (table) => [
  index("data_deletion_receipts_org_idx").on(table.organizationId),
  index("data_deletion_receipts_expires_idx").on(table.expiresAt),
]);

export const exportCustodyReceipts = pgTable("export_custody_receipts", {
  id: text("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  format: text("format").notNull(),
  artifactNameHash: text("artifact_name_hash").notNull(),
  sha256: text("sha256").notNull(),
  byteSize: integer("byte_size").notNull(),
  custody: text("custody").notNull().default("local_only"),
  generatedAt: timestamp("generated_at").notNull(),
  registeredAt: timestamp("registered_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  deletedAt: timestamp("deleted_at"),
}, (table) => [
  index("export_custody_receipts_org_idx").on(table.organizationId),
  index("export_custody_receipts_expires_idx").on(table.expiresAt),
]);

// ─── BYOD -- Bring Your Own Data (Major Bet, Roadmap Rev.3 §05) ────────────
// "Client data never gets raw, unrestricted AI access. It flows through the
// Data Layer, gets validated and normalized... reaches the client only
// through the consultant or an approved Terminal workflow." Reuses the
// exact same deterministic column profiler already built for internal UIDE
// uploads (server/uideEngine/profiler.ts's ingestAndProfile) -- that's the
// "Intelligence Engine" step the roadmap's own diagram names, not a second,
// parallel parser. Only the profile (column names/types/stats/samples) is
// stored, never the raw row data -- the same privacy principle
// uideEngine/fixtureBank.ts already documents for its regression corpus
// ("to avoid quietly accumulating client data... beyond what's needed").
// organizationId-scoping here is the same Private Data Environment
// guarantee every other table in this schema already has -- the roadmap
// itself says BYOD "just extends the same guarantee to uploaded data."
// `profile`'s real shape is uideEngine/profiler.ts's WorkbookProfile,
// deliberately left untyped here so this file (bundled into the client)
// never imports server-only, XLSX-dependent code.
export const clientDatasets = pgTable("client_datasets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  uploadedByUserId: integer("uploaded_by_user_id").notNull().references(() => users.id),
  fileName: text("file_name").notNull(),
  fileExt: text("file_ext").notNull(),
  sheetCount: integer("sheet_count").notNull(),
  totalRows: integer("total_rows").notNull(),
  profile: jsonb("profile").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ClientDataset = typeof clientDatasets.$inferSelect;
// ─── Professional persona preferences (experience only) ───────────────────
// Persona metadata is canonical in shared/personaRegistry.ts. These fields
// deliberately remain text/JSON rather than database enums so the registry
// can evolve without a schema migration; service/API validation is the
// authority for accepted IDs. Security roles and entitlements are independent
// and remain authoritative for access.
export const userPersonaPreferences = pgTable("user_persona_preferences", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  primaryPersona: text("primary_persona").notNull().default("general"),
  secondaryPersonas: jsonb("secondary_personas").$type<string[]>().notNull().default([]),
  activeDomainSlug: text("active_domain_slug").notNull().default("finance"),
  activeContext: jsonb("active_context").$type<Record<string, unknown>>().notNull().default({}),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  preferences: jsonb("preferences").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  check(
    "user_persona_preferences_secondary_personas_shape",
    sql`CASE WHEN jsonb_typeof(${table.secondaryPersonas}) = 'array' THEN jsonb_array_length(${table.secondaryPersonas}) <= 8 ELSE false END`,
  ),
  check(
    "user_persona_preferences_active_context_shape",
    sql`jsonb_typeof(${table.activeContext}) = 'object' AND pg_column_size(${table.activeContext}) <= 65536`,
  ),
  check(
    "user_persona_preferences_preferences_shape",
    sql`jsonb_typeof(${table.preferences}) = 'object' AND pg_column_size(${table.preferences}) <= 65536`,
  ),
  index("user_persona_preferences_org_idx").on(table.organizationId),
  index("user_persona_preferences_primary_persona_idx").on(table.primaryPersona),
]);

export type UserPersonaPreferences = typeof userPersonaPreferences.$inferSelect;
export type InsertUserPersonaPreferences = typeof userPersonaPreferences.$inferInsert;


// ─── Personal terminal state (per internal user, not client-facing) ───────
export const watchlistItems = pgTable("watchlist_items", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

export const insertWatchlistItemSchema = z.object({
  symbol: z.string().trim().min(1),
  name: z.string().trim().min(1),
});

export type InsertWatchlistItem = z.infer<typeof insertWatchlistItemSchema>;
export type WatchlistItem = typeof watchlistItems.$inferSelect;

export const alerts = pgTable("alerts", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id),
  symbol: text("symbol").notNull(),
  condition: text("condition").notNull(),
  price: real("price").notNull(),
  triggered: boolean("triggered").default(false).notNull(),
  triggerPrice: real("trigger_price"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  triggeredAt: timestamp("triggered_at"),
});

export const insertAlertSchema = z.object({
  symbol: z.string().trim().min(1),
  condition: z.string().regex(/^(above|below|price:(above|below)|trailingPE:(above|below)|forwardPE:(above|below)|priceToBook:(above|below)|beta:(above|below)|debtToEquity:(above|below)|returnOnEquity:(above|below)|dividendYield:(above|below))$/),
  price: z.number().finite().positive(),
});

export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alerts.$inferSelect;

export const chatMessages = pgTable("chat_messages", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1),
});

export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Pricing is deliberately not a client-facing tier -- a consultant scopes
// and prices each request based on actual need (see consultingQuotes below).
// "quoted" = a consultant has proposed a price, waiting on the client;
// "accepted" = client agreed, work hasn't started yet.

// ─── Admin Domains Junction Table (Which admins own which domains) ─────────
export const adminDomains = pgTable("admin_domains", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: integer("user_id").notNull().references(() => users.id),
  domainId: integer("domain_id").notNull().references(() => domains.id),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("admin_domain_unique").on(table.userId, table.domainId),
]);

// Decision/Project Packs (Major Bet, Roadmap Rev.3): "pre-packaged workflow
// templates... instead of a blank request every time." Purely a client-side
// pre-fill convenience at submission time (see AdvisoryPanel.tsx) -- this
// column exists so the pack that was used stays attributable afterward
// (triage, reporting) rather than being lost once the description text is
// edited. Null means a plain custom request, same as before this existed.

// ─── Consulting Requests (Queries submitted by client users) ────────────────
export const consultingRequests = pgTable("consulting_requests", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  packType: consultingRequestPackEnum("pack_type"),
  // Nullable at the DB level only, same convention as publishedContent.domainId
  // above -- pre-engagement-schema rows get backfilled to a default "legacy"
  // engagement per org, every new row sets it explicitly from here on.
  engagementId: integer("engagement_id").references(() => engagements.id),
  // Optional finer scoping under the engagement -- introduced alongside
  // workstreams (Wave 1) so an advisory request can be tied to the specific
  // phase of work it's about, without forcing every request to have one
  // (a lot of ad-hoc queries won't map to a workstream at all).
  workstreamId: integer("workstream_id").references(() => workstreams.id),
  domainId: integer("domain_id").notNull().references(() => domains.id),
  submittedByUserId: integer("submitted_by_user_id").notNull().references(() => users.id),
  assignedAdminId: integer("assigned_admin_id").references(() => users.id),
  title: text("title").notNull(),
  description: text("description").notNull(),
  // Populated once the client accepts a quote (see consultingQuotes) --
  // not known at submission time, since there's no fixed pricing tier.
  slaHours: integer("sla_hours"),
  slaDeadline: timestamp("sla_deadline"),
  status: requestStatusEnum("status").notNull().default("pending"),
  attachedFiles: jsonb("attached_files").$type<Array<{ name: string; url: string; size?: number }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertConsultingRequestSchema = z.object({
  engagementId: z.number().int().positive().optional(),
  workstreamId: z.number().int().positive().optional(),
  domainId: z.number().int().positive(),
  title: z.string().trim().min(3),
  description: z.string().trim().min(5),
  packType: z.enum(["investment_decision", "market_entry", "ma_intelligence"]).optional(),
  attachedFiles: z.array(z.object({ name: z.string(), url: z.string(), size: z.number().optional() })).optional(),
});

export type InsertConsultingRequest = z.infer<typeof insertConsultingRequestSchema>;
export type ConsultingRequest = typeof consultingRequests.$inferSelect;

// ─── Consulting Quotes (consultant-proposed price/timeline per request) ───
// Multiple rows per request rather than fields on the request itself, so a
// negotiation round (client wants a different scope) adds a new "proposed"
// quote and marks the prior one "superseded" -- full history stays intact.

export const consultingQuotes = pgTable("consulting_quotes", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  requestId: integer("request_id").notNull().references(() => consultingRequests.id),
  proposedByAdminId: integer("proposed_by_admin_id").notNull().references(() => users.id),
  // Nullable: covers "included in subscription, no separate charge" for a
  // One-model engagement, distinct from "not priced yet".
  amount: real("amount"),
  currency: text("currency").notNull().default("INR"),
  proposedTimelineDays: integer("proposed_timeline_days"),
  notes: text("notes").notNull(), // consultant's scoping rationale, shown to the client
  status: consultingQuoteStatusEnum("status").notNull().default("proposed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  respondedAt: timestamp("responded_at"),
  respondedByUserId: integer("responded_by_user_id").references(() => users.id),
});

export const insertConsultingQuoteSchema = z.object({
  amount: z.number().positive().optional(),
  currency: z.string().trim().default("INR"),
  proposedTimelineDays: z.number().int().positive().optional(),
  notes: z.string().trim().min(3),
});

export type InsertConsultingQuote = z.infer<typeof insertConsultingQuoteSchema>;
export type ConsultingQuote = typeof consultingQuotes.$inferSelect;

// ─── Consulting Approvals / Solutions (Submitted by Admins) ────────────────
export const consultingApprovals = pgTable("consulting_approvals", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  requestId: integer("request_id").notNull().references(() => consultingRequests.id),
  submittedByAdminId: integer("submitted_by_admin_id").notNull().references(() => users.id),
  solutionBody: text("solution_body").notNull(),
  status: text("status").notNull().default("delivered"), // delivered | clarification_requested | resolved
  attachedFiles: jsonb("attached_files").$type<Array<{ name: string; url: string }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Consulting Communication (Client messaging & internal admin notes) ────
export const consultingComments = pgTable("consulting_comments", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  requestId: integer("request_id").notNull().references(() => consultingRequests.id),
  authorUserId: integer("author_user_id").notNull().references(() => users.id),
  message: text("message").notNull(),
  isInternalNote: boolean("is_internal_note").notNull().default(false), // true = hidden from clients
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─── Consulting Solution Templates (Pre-built responses per domain) ────────
export const consultingTemplates = pgTable("consulting_templates", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  domainId: integer("domain_id").notNull().references(() => domains.id),
  createdByUserId: integer("created_by_user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  category: text("category"),
  templateBody: text("template_body").notNull(),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertConsultingTemplateSchema = z.object({
  domainId: z.number().int().positive(),
  title: z.string().trim().min(2),
  category: z.string().trim().optional(),
  templateBody: z.string().trim().min(5),
});

export type InsertConsultingTemplate = z.infer<typeof insertConsultingTemplateSchema>;
export type ConsultingTemplate = typeof consultingTemplates.$inferSelect;

// ─── LIOS Credits (terminal usage economy) ─────────────────────────────────
// Deliberately separate from engagements/consultingQuotes above: those are
// consulting FEES (project/subscription pricing), this is metered usage of
// the terminal itself (AI agent queries, data pulls, etc.) inside a client's
// existing subscription. One wallet per organization -- not per engagement
// or per user -- because terminal access is granted at the org level and the
// whole org draws down the same pool. The ledger is append-only and carries
// a running `balanceAfter` snapshot per row so the wallet's `balance` column
// is always reconstructable/auditable from history, not just trusted as-is.

export const creditWallets = pgTable("credit_wallets", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  balance: real("balance").notNull().default(0),
  // Null = no low-balance alerting configured for this org yet.
  lowBalanceThreshold: real("low_balance_threshold"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  uniqueIndex("credit_wallet_org_unique").on(table.organizationId),
]);

export const creditLedgerEntries = pgTable("credit_ledger_entries", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  walletId: integer("wallet_id").notNull().references(() => creditWallets.id),
  type: creditTransactionTypeEnum("type").notNull(),
  // Signed: positive for grant/refund, negative for debit/most adjustments --
  // lets the wallet balance be a plain running sum rather than needing a
  // type-based sign flip at every read site.
  amount: real("amount").notNull(),
  balanceAfter: real("balance_after").notNull(),
  description: text("description").notNull(),
  // Loose polymorphic link to whatever billable action produced this entry
  // (e.g. "consulting_request" / consultingRequests.id, "terminal_feature" /
  // a feature key) -- deliberately not a real FK since the set of billable
  // action types will grow across Wave 4 without needing a schema change here.
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: integer("related_entity_id"),
  // Null for system-automated debits (metered usage); set for admin grants
  // and manual adjustments so those are always attributable to a person.
  performedByUserId: integer("performed_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCreditLedgerEntrySchema = z.object({
  walletId: z.number().int().positive(),
  type: z.enum(["grant", "debit", "adjustment", "refund"]),
  amount: z.number().finite(),
  description: z.string().trim().min(2),
  relatedEntityType: z.string().trim().optional(),
  relatedEntityId: z.number().int().positive().optional(),
});

export type InsertCreditLedgerEntry = z.infer<typeof insertCreditLedgerEntrySchema>;
export type CreditLedgerEntry = typeof creditLedgerEntries.$inferSelect;
export type CreditWallet = typeof creditWallets.$inferSelect;

// ─── Relations (for drizzle query API convenience) ─────────────────────────
export const usersRelations = relations(users, ({ one, many }) => ({
  organization: one(organizations, { fields: [users.organizationId], references: [organizations.id] }),
  personaPreferences: one(userPersonaPreferences, { fields: [users.id], references: [userPersonaPreferences.userId] }),
  adminDomains: many(adminDomains),
  grantedEntitlements: many(licenseEntitlements),
  authorizedDevices: many(authorizedDevices),
  environmentSetups: many(environmentSetups),
  sourceConnections: many(sourceConnections),
}));

export const userPersonaPreferencesRelations = relations(userPersonaPreferences, ({ one }) => ({
  user: one(users, { fields: [userPersonaPreferences.userId], references: [users.id] }),
  organization: one(organizations, { fields: [userPersonaPreferences.organizationId], references: [organizations.id] }),
}));

export const sourceConnectionsRelations = relations(sourceConnections, ({ one }) => ({
  user: one(users, { fields: [sourceConnections.userId], references: [users.id] }),
  organization: one(organizations, { fields: [sourceConnections.organizationId], references: [organizations.id] }),
}));

export const platformPlansRelations = relations(platformPlans, ({ many }) => ({
  organizationLicenses: many(organizationLicenses),
}));

export const organizationLicensesRelations = relations(organizationLicenses, ({ one, many }) => ({
  organization: one(organizations, { fields: [organizationLicenses.organizationId], references: [organizations.id] }),
  plan: one(platformPlans, { fields: [organizationLicenses.planId], references: [platformPlans.id] }),
  updatedBy: one(users, { fields: [organizationLicenses.updatedByUserId], references: [users.id] }),
  entitlements: many(licenseEntitlements),
}));

export const licenseEntitlementsRelations = relations(licenseEntitlements, ({ one }) => ({
  license: one(organizationLicenses, { fields: [licenseEntitlements.organizationLicenseId], references: [organizationLicenses.id] }),
  organization: one(organizations, { fields: [licenseEntitlements.organizationId], references: [organizations.id] }),
  grantedBy: one(users, { fields: [licenseEntitlements.grantedByUserId], references: [users.id] }),
}));

export const authorizedDevicesRelations = relations(authorizedDevices, ({ one }) => ({
  organization: one(organizations, { fields: [authorizedDevices.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [authorizedDevices.userId], references: [users.id] }),
  revokedBy: one(users, { fields: [authorizedDevices.revokedByUserId], references: [users.id] }),
}));

export const sessionControlsRelations = relations(sessionControls, ({ one }) => ({
  organization: one(organizations, { fields: [sessionControls.organizationId], references: [organizations.id] }),
  targetUser: one(users, { fields: [sessionControls.targetUserId], references: [users.id] }),
  createdBy: one(users, { fields: [sessionControls.createdByUserId], references: [users.id] }),
}));

export const consultingRequestsRelations = relations(consultingRequests, ({ one, many }) => ({
  organization: one(organizations, { fields: [consultingRequests.organizationId], references: [organizations.id] }),
  engagement: one(engagements, { fields: [consultingRequests.engagementId], references: [engagements.id] }),
  workstream: one(workstreams, { fields: [consultingRequests.workstreamId], references: [workstreams.id] }),
  domain: one(domains, { fields: [consultingRequests.domainId], references: [domains.id] }),
  submittedBy: one(users, { fields: [consultingRequests.submittedByUserId], references: [users.id] }),
  assignedAdmin: one(users, { fields: [consultingRequests.assignedAdminId], references: [users.id] }),
  approvals: many(consultingApprovals),
  comments: many(consultingComments),
  quotes: many(consultingQuotes),
}));

export const consultingQuotesRelations = relations(consultingQuotes, ({ one }) => ({
  request: one(consultingRequests, { fields: [consultingQuotes.requestId], references: [consultingRequests.id] }),
  proposedBy: one(users, { fields: [consultingQuotes.proposedByAdminId], references: [users.id] }),
  respondedBy: one(users, { fields: [consultingQuotes.respondedByUserId], references: [users.id] }),
}));

export const engagementsRelations = relations(engagements, ({ one, many }) => ({
  organization: one(organizations, { fields: [engagements.organizationId], references: [organizations.id] }),
  domain: one(domains, { fields: [engagements.domainId], references: [domains.id] }),
  requests: many(consultingRequests),
  workstreams: many(workstreams),
  agreements: many(engagementAgreements),
  payments: many(engagementPayments),
}));

export const engagementAgreementsRelations = relations(engagementAgreements, ({ one }) => ({
  engagement: one(engagements, { fields: [engagementAgreements.engagementId], references: [engagements.id] }),
  signedBy: one(users, { fields: [engagementAgreements.signedByUserId], references: [users.id] }),
}));

export const engagementPaymentsRelations = relations(engagementPayments, ({ one }) => ({
  engagement: one(engagements, { fields: [engagementPayments.engagementId], references: [engagements.id] }),
}));

export const workstreamsRelations = relations(workstreams, ({ one, many }) => ({
  engagement: one(engagements, { fields: [workstreams.engagementId], references: [engagements.id] }),
  ownerAdmin: one(users, { fields: [workstreams.ownerAdminId], references: [users.id] }),
  deliverables: many(deliverables),
  meetings: many(meetings),
  comments: many(workstreamComments),
  requests: many(consultingRequests),
}));

export const deliverablesRelations = relations(deliverables, ({ one }) => ({
  workstream: one(workstreams, { fields: [deliverables.workstreamId], references: [workstreams.id] }),
  submittedByAdmin: one(users, { fields: [deliverables.submittedByAdminId], references: [users.id] }),
}));

export const meetingsRelations = relations(meetings, ({ one }) => ({
  engagement: one(engagements, { fields: [meetings.engagementId], references: [engagements.id] }),
  workstream: one(workstreams, { fields: [meetings.workstreamId], references: [workstreams.id] }),
  createdBy: one(users, { fields: [meetings.createdByUserId], references: [users.id] }),
}));

export const workstreamCommentsRelations = relations(workstreamComments, ({ one }) => ({
  workstream: one(workstreams, { fields: [workstreamComments.workstreamId], references: [workstreams.id] }),
  author: one(users, { fields: [workstreamComments.authorUserId], references: [users.id] }),
}));

// ─── Leads (LIOS Experience Center: public, pre-signup lead capture) ──────
// Deliberately unauthenticated at the route level (see server/publicRoutes.ts)
// -- a prospect filling this out has no account yet, that's the entire point
// of the Experience Center. `source` distinguishes this from any future
// public capture surface without needing a schema change.
export const leads = pgTable("leads", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  message: text("message"),
  source: text("source").notNull().default("experience_center"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertLeadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email(),
  company: z.string().trim().max(200).optional(),
  message: z.string().trim().max(2000).optional(),
});

export type InsertLead = z.infer<typeof insertLeadSchema>;
export type Lead = typeof leads.$inferSelect;

// ─── Client-facing audit trail (Wave 5) ────────────────────────────────────
// Deliberately a separate table from `auditEvents` above, not a reuse of it:
// that table is internal-only (no organizationId column at all, and its
// eventType vocabulary -- login, publish, view, suppress -- is internal-admin
// activity). Exposing it to clients, even filtered, isn't safe since it was
// never designed to be org-scoped in the first place. This table exists
// specifically so a client_admin can see "who on my team did what" --
// compliance-relevant for the consulting-firm audience this product targets
// (see project_economics_terminal_consulting_firm memory).

export const clientAuditEvents = pgTable("client_audit_events", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  organizationId: integer("organization_id").notNull().references(() => organizations.id),
  userId: integer("user_id").references(() => users.id),
  eventType: clientAuditEventTypeEnum("event_type").notNull(),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ClientAuditEvent = typeof clientAuditEvents.$inferSelect;

export const clientAuditEventsRelations = relations(clientAuditEvents, ({ one }) => ({
  organization: one(organizations, { fields: [clientAuditEvents.organizationId], references: [organizations.id] }),
  user: one(users, { fields: [clientAuditEvents.userId], references: [users.id] }),
}));

export const creditWalletsRelations = relations(creditWallets, ({ one, many }) => ({
  organization: one(organizations, { fields: [creditWallets.organizationId], references: [organizations.id] }),
  entries: many(creditLedgerEntries),
}));

export const organizationCredentialsRelations = relations(organizationCredentials, ({ one }) => ({
  organization: one(organizations, { fields: [organizationCredentials.organizationId], references: [organizations.id] }),
  createdByUser: one(users, { fields: [organizationCredentials.createdByUserId], references: [users.id] }),
}));

export const creditLedgerEntriesRelations = relations(creditLedgerEntries, ({ one }) => ({
  wallet: one(creditWallets, { fields: [creditLedgerEntries.walletId], references: [creditWallets.id] }),
  performedBy: one(users, { fields: [creditLedgerEntries.performedByUserId], references: [users.id] }),
}));

export const organizationsRelations = relations(organizations, ({ one, many }) => ({
  licensee: one(licensees, { fields: [organizations.licenseeId], references: [licensees.id] }),
  enterprisePolicy: one(organizationEnterprisePolicies, { fields: [organizations.id], references: [organizationEnterprisePolicies.organizationId] }),
  users: many(users),
  personaPreferences: many(userPersonaPreferences),
  portfolios: many(portfolios),
  engagements: many(engagements),
  creditWallet: one(creditWallets, { fields: [organizations.id], references: [creditWallets.organizationId] }),
  license: one(organizationLicenses, { fields: [organizations.id], references: [organizationLicenses.organizationId] }),
  entitlements: many(licenseEntitlements),
  authorizedDevices: many(authorizedDevices),
  sessionControls: many(sessionControls),
  environmentSetups: many(environmentSetups),
  sourceConnections: many(sourceConnections),
  organizationCredentials: many(organizationCredentials),
}));

export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
  organization: one(organizations, { fields: [portfolios.organizationId], references: [organizations.id] }),
  positions: many(positions),
}));

export const companiesRelations = relations(companies, ({ many }) => ({
  filings: many(secFilings),
  financialStatementPeriods: many(financialStatementPeriods),
  researchInvestigations: many(researchInvestigations),
}));

export const researchInvestigationsRelations = relations(researchInvestigations, ({ one, many }) => ({
  company: one(companies, { fields: [researchInvestigations.companyId], references: [companies.id] }),
  domain: one(domains, { fields: [researchInvestigations.domainId], references: [domains.id] }),
  organization: one(organizations, { fields: [researchInvestigations.organizationId], references: [organizations.id] }),
  owner: one(users, { fields: [researchInvestigations.ownerUserId], references: [users.id] }),
  evidence: many(researchEvidence),
  relationships: many(researchEvidenceRelationships),
  savedSearches: many(researchSavedSearches),
  briefs: many(researchBriefs),
  consensusSnapshots: many(consensusSnapshots),
  consensusBenchmarks: many(consensusBenchmarks),
}));

export const researchEvidenceRelations = relations(researchEvidence, ({ one }) => ({
  investigation: one(researchInvestigations, { fields: [researchEvidence.investigationId], references: [researchInvestigations.id] }),
  addedBy: one(users, { fields: [researchEvidence.addedByUserId], references: [users.id] }),
}));

export const researchEvidenceRelationshipsRelations = relations(researchEvidenceRelationships, ({ one }) => ({
  investigation: one(researchInvestigations, { fields: [researchEvidenceRelationships.investigationId], references: [researchInvestigations.id] }),
  fromEvidence: one(researchEvidence, { fields: [researchEvidenceRelationships.fromEvidenceId], references: [researchEvidence.id], relationName: "researchRelationshipFrom" }),
  toEvidence: one(researchEvidence, { fields: [researchEvidenceRelationships.toEvidenceId], references: [researchEvidence.id], relationName: "researchRelationshipTo" }),
  createdBy: one(users, { fields: [researchEvidenceRelationships.createdByUserId], references: [users.id] }),
}));

export const researchSavedSearchesRelations = relations(researchSavedSearches, ({ one }) => ({
  investigation: one(researchInvestigations, { fields: [researchSavedSearches.investigationId], references: [researchInvestigations.id] }),
  owner: one(users, { fields: [researchSavedSearches.ownerUserId], references: [users.id] }),
}));

export const researchBriefsRelations = relations(researchBriefs, ({ one }) => ({
  investigation: one(researchInvestigations, { fields: [researchBriefs.investigationId], references: [researchInvestigations.id] }),
  generatedBy: one(users, { fields: [researchBriefs.generatedByUserId], references: [users.id] }),
}));

export const consensusSnapshotsRelations = relations(consensusSnapshots, ({ one }) => ({
  organization: one(organizations, { fields: [consensusSnapshots.organizationId], references: [organizations.id] }),
  investigation: one(researchInvestigations, { fields: [consensusSnapshots.investigationId], references: [researchInvestigations.id] }),
  createdBy: one(users, { fields: [consensusSnapshots.createdByUserId], references: [users.id] }),
}));

export const consensusBenchmarksRelations = relations(consensusBenchmarks, ({ one }) => ({
  organization: one(organizations, { fields: [consensusBenchmarks.organizationId], references: [organizations.id] }),
  investigation: one(researchInvestigations, { fields: [consensusBenchmarks.investigationId], references: [researchInvestigations.id] }),
  createdBy: one(users, { fields: [consensusBenchmarks.createdByUserId], references: [users.id] }),
}));

export const consensusAlertRulesRelations = relations(consensusAlertRules, ({ one }) => ({
  owner: one(users, { fields: [consensusAlertRules.ownerUserId], references: [users.id] }),
  organization: one(organizations, { fields: [consensusAlertRules.organizationId], references: [organizations.id] }),
}));

export const brainRunsRelations = relations(brainRuns, ({ one, many }) => ({
  organization: one(organizations, { fields: [brainRuns.organizationId], references: [organizations.id] }),
  investigation: one(researchInvestigations, { fields: [brainRuns.investigationId], references: [researchInvestigations.id] }),
  owner: one(users, { fields: [brainRuns.ownerUserId], references: [users.id] }),
  tasks: many(brainTasks),
  toolCalls: many(brainToolCalls),
  approvals: many(brainApprovals),
}));

export const brainTasksRelations = relations(brainTasks, ({ one, many }) => ({
  run: one(brainRuns, { fields: [brainTasks.runId], references: [brainRuns.id] }),
  toolCalls: many(brainToolCalls),
  approvals: many(brainApprovals),
}));

export const brainToolCallsRelations = relations(brainToolCalls, ({ one }) => ({
  run: one(brainRuns, { fields: [brainToolCalls.runId], references: [brainRuns.id] }),
  task: one(brainTasks, { fields: [brainToolCalls.taskId], references: [brainTasks.id] }),
}));

export const brainApprovalsRelations = relations(brainApprovals, ({ one }) => ({
  run: one(brainRuns, { fields: [brainApprovals.runId], references: [brainRuns.id] }),
  task: one(brainTasks, { fields: [brainApprovals.taskId], references: [brainTasks.id] }),
  requestedBy: one(users, { fields: [brainApprovals.requestedByUserId], references: [users.id], relationName: "brainApprovalRequester" }),
  decidedBy: one(users, { fields: [brainApprovals.decidedByUserId], references: [users.id], relationName: "brainApprovalDecider" }),
}));

export const secFilingsRelations = relations(secFilings, ({ one }) => ({
  company: one(companies, { fields: [secFilings.companyId], references: [companies.id] }),
}));

export const financialStatementPeriodsRelations = relations(financialStatementPeriods, ({ one }) => ({
  company: one(companies, { fields: [financialStatementPeriods.companyId], references: [companies.id] }),
}));
export * from "./schemaDataFabric";
export * from "./schemaProjectIntelligence";
export * from "./schemaAutomation";
export * from "./schemaDevices";
export * from "./schemaConversationGrants";
export * from "./schemaMemory";
