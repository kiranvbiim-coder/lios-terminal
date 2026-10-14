import { z } from "zod";
import type { ConnectorDefinition, ConnectorRuntimeState } from "./connectorRegistry";

export const DATA_FABRIC_SCHEMA_VERSION = "1" as const;
export const CAPABILITY_MANIFEST_VERSION = "2" as const;

const identifierSchema = z.string().trim().min(1).max(240).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/);
const looseIdentifierSchema = z.string().trim().min(1).max(240);
const isoDateOrDateTimeSchema = z.union([z.string().date(), z.string().datetime({ offset: true })]);
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const fieldTypeSchema = z.enum([
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "timestamp",
  "currency_amount",
  "percentage",
  "ratio",
  "array",
  "object",
]);

const unsafeCredentialPattern = /(?:^|[?&\s])(?:api[_-]?key|apikey|token|secret|password|authorization)\s*[=:]\s*(?!\[REDACTED\](?:$|[&#\s]))[^&#\s]+/i;

export function isCredentialSafeReference(value: string): boolean {
  return !unsafeCredentialPattern.test(value);
}

const safeReferenceSchema = z.string().trim().min(1).max(2_000).refine(isCredentialSafeReference, "References must not contain credentials");

export const dataFabricOperationSchema = z.enum([
  "read",
  "preview",
  "schema_discovery",
  "import",
  "stream",
  "export",
]);
export type DataFabricOperation = z.infer<typeof dataFabricOperationSchema>;

export const manifestCapabilitySchema = z.object({
  contractFamily: identifierSchema,
  datasets: z.array(identifierSchema).max(200).default([]),
  fields: z.array(looseIdentifierSchema).max(2_000).default([]),
  geographies: z.array(looseIdentifierSchema).max(100).default([]),
  exchanges: z.array(looseIdentifierSchema).max(200).default([]),
  assetClasses: z.array(looseIdentifierSchema).max(100).default([]),
  historicalDepth: z.object({
    earliestDate: z.string().date().nullable().default(null),
    maxDays: z.number().int().positive().nullable().default(null),
  }).strict().nullable().default(null),
  frequencies: z.array(looseIdentifierSchema).max(100).default([]),
  operations: z.array(dataFabricOperationSchema).min(1).max(6),
  coverageNotes: z.string().trim().max(1_000).nullable().default(null),
}).strict();
export type ManifestCapability = z.infer<typeof manifestCapabilitySchema>;

export const capabilityManifestV2Schema = z.object({
  schemaVersion: z.literal(CAPABILITY_MANIFEST_VERSION),
  connectorId: identifierSchema,
  providerName: z.string().trim().min(1).max(240),
  category: z.string().trim().min(1).max(80),
  sourceType: z.string().trim().min(1).max(80),
  custodyMode: z.string().trim().min(1).max(80),
  builtIn: z.boolean(),
  capabilities: z.array(manifestCapabilitySchema).min(1),
  entitlements: z.object({
    credentialRequired: z.boolean(),
    userLicenseRequired: z.boolean(),
    redistribution: z.enum(["unknown", "restricted", "permitted"]),
  }).strict(),
  availability: z.object({
    adapterImplemented: z.boolean(),
    runtimeState: z.enum([
      "catalog_only",
      "adapter_available",
      "credential_configured",
      "live_verified",
      "degraded",
      "rate_limited",
      "disabled",
    ]).nullable(),
  }).strict(),
}).strict();
export type CapabilityManifestV2 = z.infer<typeof capabilityManifestV2Schema>;

function normalizeCoverage(coverage: string | undefined): string[] {
  const value = coverage?.trim();
  if (!value) return [];
  if (value.toLowerCase() === "global") return ["global"];
  return [value];
}

function defaultOperations(connector: ConnectorDefinition): DataFabricOperation[] {
  if (!connector.adapterImplemented) return ["schema_discovery"];
  const operations: DataFabricOperation[] = ["read", "preview", "schema_discovery"];
  if (["file", "database", "private_api", "cloud_storage"].includes(connector.sourceType)) operations.push("import");
  if (connector.category === "market" && connector.sourceType !== "file") operations.push("stream");
  return [...new Set(operations)];
}

/**
 * Project the existing connector registry into the richer V4 capability
 * manifest without exposing env/vault key names or inventing unsupported
 * coverage. Provider-specific enrichments can be added to the connector
 * definition later; this projection remains backwards compatible.
 */
export function buildCapabilityManifestV2(
  connector: ConnectorDefinition,
  runtimeState: ConnectorRuntimeState | null = null,
): CapabilityManifestV2 {
  return capabilityManifestV2Schema.parse({
    schemaVersion: CAPABILITY_MANIFEST_VERSION,
    connectorId: connector.id,
    providerName: connector.name,
    category: connector.category,
    sourceType: connector.sourceType,
    custodyMode: connector.custodyMode,
    builtIn: connector.builtIn,
    capabilities: connector.capabilities.map((capability) => ({
      contractFamily: capability.contractFamily,
      datasets: [capability.contractFamily],
      fields: capability.fields ?? [],
      geographies: normalizeCoverage(capability.coverage),
      exchanges: [],
      assetClasses: [],
      historicalDepth: null,
      frequencies: [],
      operations: defaultOperations(connector),
      coverageNotes: capability.coverage ?? null,
    })),
    entitlements: {
      credentialRequired: connector.authMode !== "none" && connector.authMode !== "local",
      userLicenseRequired: connector.custodyMode === "user_licensed",
      redistribution: connector.licenseNotes || connector.custodyMode === "user_licensed" ? "restricted" : "unknown",
    },
    availability: {
      adapterImplemented: connector.adapterImplemented,
      runtimeState,
    },
  });
}

export const universalFieldRefSchema = z.object({
  id: looseIdentifierSchema,
  kind: z.enum(["canonical", "extended"]),
  providerField: z.string().trim().min(1).max(500).nullable().optional().default(null),
  type: fieldTypeSchema.optional(),
  unit: z.string().trim().min(1).max(120).nullable().optional().default(null),
}).strict();
export type UniversalFieldRef = z.infer<typeof universalFieldRefSchema>;

export const dataFreshnessEvidenceSchema = z.object({
  state: z.enum(["current", "delayed", "daily", "reference", "feed", "schedule", "snapshot", "manual", "ai_generated"]),
  degraded: z.boolean(),
  reasons: z.array(z.string().trim().min(1).max(500)).max(50),
}).strict().superRefine((value, ctx) => {
  if (value.degraded && value.reasons.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reasons"], message: "Degraded data must include at least one reason" });
  }
});
export type DataFreshnessEvidence = z.infer<typeof dataFreshnessEvidenceSchema>;

export const dataEntitlementEvidenceSchema = z.object({
  decision: z.enum(["allowed", "denied", "unknown"]),
  policyId: z.string().trim().min(1).max(240).nullable().default(null),
  reasons: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.decision === "denied" && value.reasons.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reasons"], message: "Denied data must explain the entitlement decision" });
  }
});
export type DataEntitlementEvidence = z.infer<typeof dataEntitlementEvidenceSchema>;

export const universalDataObjectSchema = z.object({
  schemaVersion: z.literal(DATA_FABRIC_SCHEMA_VERSION),
  objectId: identifierSchema,
  type: identifierSchema,
  source: z.object({
    provider: identifierSchema,
    connectorId: identifierSchema,
    connectionId: looseIdentifierSchema.nullable().default(null),
  }).strict(),
  entity: z.object({
    kind: looseIdentifierSchema,
    primaryId: looseIdentifierSchema,
    identifiers: z.record(z.string().trim().max(500)).default({}),
  }).strict(),
  clocks: z.object({
    asOf: isoDateOrDateTimeSchema.nullable(),
    retrievedAt: z.string().datetime({ offset: true }),
    periodStart: z.string().date().nullable(),
    periodEnd: z.string().date().nullable(),
  }).strict().superRefine((value, ctx) => {
    if (value.periodStart && value.periodEnd && value.periodStart > value.periodEnd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["periodEnd"], message: "periodEnd must be on or after periodStart" });
    }
  }),
  currency: z.string().trim().regex(/^[A-Z]{3}$/).nullable(),
  unit: z.string().trim().min(1).max(120).nullable(),
  frequency: z.string().trim().min(1).max(80).nullable(),
  fields: z.array(universalFieldRefSchema).min(1).max(2_000),
  transforms: z.array(z.string().trim().min(1).max(240)).max(200),
  freshness: dataFreshnessEvidenceSchema,
  entitlement: dataEntitlementEvidenceSchema,
  lineage: z.object({
    snapshotId: looseIdentifierSchema.nullable(),
    contentHash: contentHashSchema,
    sourceReference: safeReferenceSchema,
  }).strict(),
  payload: z.object({
    kind: z.enum(["dataset_page", "snapshot", "columnar_artifact", "external_reference"]),
    reference: safeReferenceSchema,
  }).strict(),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  value.fields.forEach((field, index) => {
    if (ids.has(field.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fields", index, "id"], message: "Universal field ids must be unique" });
    }
    ids.add(field.id);
  });
});
export type UniversalDataObject = z.infer<typeof universalDataObjectSchema>;

export function parseUniversalDataObject(input: unknown): UniversalDataObject | null {
  const parsed = universalDataObjectSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export const addMetricRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  fieldId: looseIdentifierSchema,
  datasetKey: identifierSchema,
  aggregation: z.enum(["last", "first", "sum", "average", "min", "max", "count"]).default("last"),
  unit: z.string().trim().min(1).max(120).nullable().optional().default(null),
}).strict();
export type AddMetricRequest = z.infer<typeof addMetricRequestSchema>;

export const addSeriesRequestSchema = z.object({
  name: z.string().trim().min(1).max(160),
  fieldId: looseIdentifierSchema,
  datasetKey: identifierSchema,
  frequency: z.string().trim().min(1).max(80),
  transform: z.enum(["none", "pct_change", "log_return", "difference", "index_100", "yoy", "qoq"]).default("none"),
  unit: z.string().trim().min(1).max(120).nullable().optional().default(null),
}).strict();
export type AddSeriesRequest = z.infer<typeof addSeriesRequestSchema>;
