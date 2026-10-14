import {
  BUILT_IN_CONNECTORS,
  getConnectorLicenseCaveat,
  type ConnectorDefinition,
  type ConnectorRuntimeReport,
} from "@shared/connectorRegistry";
import {
  calculateProviderDepthLoss,
  evaluateProviderMarketingEligibility,
  maturityFromStageCounts,
  providerDepthAuditSchema,
  providerDepthReportSchema,
  providerFieldKey,
  type ProviderDepthAudit,
  type ProviderDepthField,
  type ProviderDepthReport,
  type ProviderDepthStageCounts,
} from "@shared/providerDepth";

export interface ProviderDepthEvidence {
  /** Relative source files reviewed for this provider's stage evidence. */
  evidenceFiles: string[];
  /** Used by audit targets which are not yet ConnectorDefinition entries. */
  exposedFields?: string[];
  retrievableFields?: string[];
  mappedFields?: string[];
  visibleFields?: string[];
  engineIntegratedFields?: string[];
  notes?: string[];
  redistribution?: "unknown" | "restricted" | "permitted";
}

interface ProviderAuditTarget {
  providerId: string;
  providerName: string;
  category: string;
  sourceType: string;
  custodyMode: string;
  adapterImplemented: boolean;
  exposedFields: string[];
  runtimeState: string | null;
  evidence: ProviderDepthEvidence;
}

/**
 * Evidence is intentionally explicit instead of inferred from a provider's
 * name or credential. A new adapter must add its fields and source files here
 * before the audit can call them retrieved or integrated.
 */
export const PROVIDER_DEPTH_EVIDENCE: Readonly<Record<string, ProviderDepthEvidence>> = {
  rbi: {
    evidenceFiles: ["src/shared/connectorRegistry.ts", "src/client/src/lib/providerCatalog.ts"],
    retrievableFields: [],
    mappedFields: [],
    visibleFields: [],
    engineIntegratedFields: [],
    notes: ["RBI DBIE provides a public query/download portal, but this build does not claim a stable documented RBI machine API or live adapter. Use DBIE exports through LiOS import paths until a supported API contract is published."],
    redistribution: "unknown",
  },
  imf: {
    evidenceFiles: ["src/server/imfDataProvider.ts", "src/server/providerSdk.ts", "src/shared/connectorRegistry.ts"],
    retrievableFields: ["macro.gdp", "macro.inflation", "macro.unemployment", "macro.current_account", "macro.fiscal_balance"],
    mappedFields: ["macro.gdp", "macro.inflation", "macro.unemployment", "macro.current_account", "macro.fiscal_balance"],
    visibleFields: ["macro.gdp", "macro.inflation", "macro.unemployment", "macro.current_account", "macro.fiscal_balance"],
    engineIntegratedFields: ["macro.gdp", "macro.inflation", "macro.unemployment", "macro.current_account", "macro.fiscal_balance"],
    notes: ["IMF DataMapper v2 is available through an explicit indicator + entity-code macro adapter. Coverage depends on the requested DataMapper series; no availability is fabricated when the IMF endpoint fails or omits a value."],
    redistribution: "unknown",
  },
  lse: {
    evidenceFiles: ["src/server/lseData.ts", "src/server/lseRoutes.ts", "src/client/src/lib/lseDatasetBrowser.ts"],
    retrievableFields: [
      "market_data.quote", "market_data.candles", "market_data.corporate_actions",
      "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow",
      "company.profile", "company.officers", "company.shareholders",
      "ownership.institutional_ownership", "ownership.insider_ownership", "derivatives.options_chain",
      "price_history.ohlcv", "price_history.adjusted_close",
    ],
    mappedFields: [
      "market_data.quote", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow",
      "price_history.ohlcv", "price_history.adjusted_close", "derivatives.options_chain",
    ],
    visibleFields: [
      "market_data.quote", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow",
      "price_history.ohlcv", "derivatives.options_chain", "ownership.institutional_ownership", "ownership.insider_ownership",
    ],
    engineIntegratedFields: [
      "market_data.quote", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow",
      "price_history.ohlcv", "derivatives.options_chain",
    ],
    notes: ["Licensed provider: live depth still depends on the customer's LSE entitlement and the runtime credential."],
    redistribution: "restricted",
  },
  fred: {
    evidenceFiles: ["src/server/fredData.ts", "src/server/economicDatasetStore.ts", "src/server/economicsData.ts"],
    retrievableFields: ["macro.gdp", "macro.cpi", "macro.unemployment", "macro.rates", "macro.yield_curve", "price_history.economic_series"],
    mappedFields: ["macro.gdp", "macro.cpi", "macro.unemployment", "macro.rates", "macro.yield_curve"],
    visibleFields: ["macro.gdp", "macro.cpi", "macro.unemployment", "macro.rates", "macro.yield_curve"],
    engineIntegratedFields: ["macro.gdp", "macro.cpi", "macro.unemployment", "macro.rates", "macro.yield_curve"],
    notes: ["FRED fields are available only after a user-scoped API key is configured; no live call is made by this audit."],
    redistribution: "unknown",
  },
  oecd: {
    evidenceFiles: ["src/server/oecdDataProvider.ts", "src/server/providerSdk.ts", "src/shared/connectorRegistry.ts"],
    retrievableFields: ["macro.gdp", "macro.trade", "macro.employment"],
    mappedFields: [],
    visibleFields: [],
    engineIntegratedFields: [],
    notes: ["OECD Data Explorer retrieval is executable through an explicit provider-native agency, dataset and bounded data selection. Semantic field mapping into canonical LiOS GDP/trade/employment contracts remains a separate step; this audit does not claim it yet."],
    redistribution: "unknown",
  },
  finnhub: {
    evidenceFiles: ["src/server/finnhubFinancials.ts", "src/server/keyedQuoteAdapters.ts", "src/server/marketData.ts"],
    retrievableFields: ["market_data.quote", "market_data.trades", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow", "price_history.ohlcv", "filings.sec_filings"],
    mappedFields: ["market_data.quote", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow", "price_history.ohlcv", "filings.sec_filings"],
    visibleFields: ["market_data.quote", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow", "price_history.ohlcv", "filings.sec_filings"],
    engineIntegratedFields: ["market_data.quote", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow", "price_history.ohlcv"],
    notes: ["Finnhub adapter evidence covers the implemented quote, filing, price, and statement paths; provider plan limits are not inferred."],
    redistribution: "unknown",
  },
  fmp: {
    evidenceFiles: ["src/server/fmpData.ts", "src/server/alternativeDatasetStore.ts", "src/server/dataFabricRoutes.ts"],
    retrievableFields: ["estimates.revenue", "estimates.eps", "estimates.ebitda"],
    mappedFields: ["estimates.revenue", "estimates.eps", "estimates.ebitda"],
    visibleFields: ["estimates.revenue", "estimates.eps", "estimates.ebitda"],
    engineIntegratedFields: ["estimates.revenue", "estimates.eps", "estimates.ebitda"],
    notes: ["FMP statement and quote capabilities remain cataloged but are not counted as retrieved by this audit because fmpData.ts currently implements estimates and segmentation only."],
    redistribution: "unknown",
  },
  openfigi: {
    evidenceFiles: ["src/server/openFigiConnector.ts", "src/server/instrumentSearchIndexStore.ts", "src/server/providerSdk.ts"],
    retrievableFields: ["instrument_identity.figi", "instrument_identity.composite_figi", "instrument_identity.share_class_figi", "instrument_identity.ticker", "instrument_identity.name", "instrument_identity.exchange", "instrument_identity.security_type"],
    mappedFields: ["instrument_identity.figi", "instrument_identity.composite_figi", "instrument_identity.share_class_figi", "instrument_identity.ticker", "instrument_identity.name", "instrument_identity.exchange", "instrument_identity.security_type"],
    visibleFields: ["instrument_identity.figi", "instrument_identity.composite_figi", "instrument_identity.share_class_figi", "instrument_identity.ticker", "instrument_identity.name", "instrument_identity.exchange", "instrument_identity.security_type"],
    engineIntegratedFields: ["instrument_identity.figi", "instrument_identity.composite_figi", "instrument_identity.share_class_figi", "instrument_identity.ticker"],
    notes: ["OpenFIGI is identity enrichment only. Provider results remain non-canonical until linked to LiOS entity/security/listing state."],
    redistribution: "unknown",
  },
  sec_edgar: {
    evidenceFiles: ["src/server/secEdgarFinancials.ts", "src/server/secEdgarRoutes.ts", "src/server/financialStatementsBroker.ts"],
    retrievableFields: ["filings.10-K", "filings.10-Q", "filings.8-K", "filings.DEF14A", "financial_statements.xbrl_income", "financial_statements.xbrl_balance", "financial_statements.xbrl_cashflow"],
    mappedFields: ["filings.10-K", "filings.10-Q", "filings.8-K", "financial_statements.xbrl_income", "financial_statements.xbrl_balance", "financial_statements.xbrl_cashflow"],
    visibleFields: ["filings.10-K", "filings.10-Q", "filings.8-K", "filings.DEF14A", "financial_statements.xbrl_income", "financial_statements.xbrl_balance", "financial_statements.xbrl_cashflow"],
    engineIntegratedFields: ["financial_statements.xbrl_income", "financial_statements.xbrl_balance", "financial_statements.xbrl_cashflow"],
    notes: ["Coverage is constrained by issuer filing availability and XBRL taxonomy completeness; the audit does not turn a missing filing into a synthetic value."],
    redistribution: "unknown",
  },
  world_bank: {
    evidenceFiles: ["src/server/worldBankData.ts", "src/server/worldBankRoutes.ts"],
    retrievableFields: ["macro.gdp", "macro.population", "macro.trade", "macro.poverty"],
    mappedFields: ["macro.gdp", "macro.population", "macro.trade", "macro.poverty"],
    visibleFields: ["macro.gdp", "macro.population", "macro.trade", "macro.poverty"],
    engineIntegratedFields: ["macro.gdp", "macro.population", "macro.trade", "macro.poverty"],
    notes: ["World Bank observations are annual and may be stale or missing for a country/year; freshness remains part of each returned data object."],
    redistribution: "unknown",
  },
  file_upload: {
    evidenceFiles: ["src/client/src/lib/fileImportPipeline.ts", "src/client/src/components/DataImportWizard.tsx"],
    retrievableFields: ["financial_statements", "portfolio", "fixed_income", "derivatives", "operations", "assumptions"],
    mappedFields: ["financial_statements", "portfolio", "fixed_income", "derivatives", "operations", "assumptions"],
    visibleFields: ["financial_statements", "portfolio", "fixed_income", "derivatives", "operations", "assumptions"],
    engineIntegratedFields: ["financial_statements", "portfolio", "fixed_income", "derivatives"],
    notes: ["File sources are local-only; imported field depth depends on the uploaded file schema and explicit user mapping."],
    redistribution: "permitted",
  },
  database: {
    evidenceFiles: ["src/server/databaseDiscovery.ts", "src/client/src/components/connections/DatabaseDiscoveryBrowser.tsx", "src/server/sourceConnectionService.ts"],
    retrievableFields: ["financial_statements", "portfolio", "operations", "assumptions"],
    mappedFields: ["financial_statements", "portfolio", "operations", "assumptions"],
    visibleFields: ["financial_statements", "portfolio", "operations", "assumptions"],
    engineIntegratedFields: ["financial_statements", "portfolio", "assumptions"],
    notes: ["Database sources are organization-scoped and read-only by contract; table/column depth is discovered per saved connection."],
    redistribution: "permitted",
  },
  cloud_storage: {
    evidenceFiles: ["src/server/cloudStorageConnector.ts", "src/server/sourceConnectionProviderAdapter.ts", "src/server/sourceConnectionService.ts"],
    retrievableFields: ["provider_extension.json", "provider_extension.csv", "provider_extension.text", "provider_extension.object"],
    mappedFields: [],
    visibleFields: ["provider_extension.json", "provider_extension.csv", "provider_extension.text", "provider_extension.object"],
    engineIntegratedFields: [],
    notes: ["Cloud/object storage is user-owned BYOD. Concrete mapping and downstream engine integration depend on the connected object's schema and confirmed mapping."],
    redistribution: "restricted",
  },
  mcp_source: {
    evidenceFiles: ["src/server/externalMcpClient.ts", "src/server/sourceConnectionProviderAdapter.ts", "src/shared/universalDataFabric.ts"],
    retrievableFields: ["provider_extension.tools", "provider_extension.resources"],
    mappedFields: [],
    visibleFields: ["provider_extension.tools", "provider_extension.resources"],
    engineIntegratedFields: [],
    notes: ["MCP access is Project-scoped, allow-listed and approval-gated. External tool/resource rights inherit the connected server and upstream source terms."],
    redistribution: "restricted",
  },
  private_api: {
    evidenceFiles: ["src/server/apiConnector.ts", "src/server/sourceDiscoveryService.ts", "src/client/src/components/connections/AddAnyDataProviderWizard.tsx"],
    retrievableFields: ["financial_statements", "market_data", "portfolio", "operations"],
    mappedFields: [],
    visibleFields: ["financial_statements", "market_data", "portfolio", "operations"],
    engineIntegratedFields: [],
    notes: ["A private API's concrete field mapping is intentionally unknown until schema discovery and user confirmation complete."],
    redistribution: "restricted",
  },
};

/** Non-catalog targets required by the V4-08 audit board. Empty exposure is a blocker, not a claim of support. */
export const PROVIDER_DEPTH_AUDIT_TARGETS: readonly ProviderAuditTarget[] = [
  {
    providerId: "eurostat", providerName: "Eurostat", category: "macro", sourceType: "public_api", custodyMode: "public",
    adapterImplemented: false, exposedFields: [], runtimeState: "catalog_only",
    evidence: { evidenceFiles: [], notes: ["No Eurostat adapter or provider catalog entry is present in this build."], redistribution: "unknown" },
  },
  {
    providerId: "ons", providerName: "UK Office for National Statistics", category: "macro", sourceType: "public_api", custodyMode: "public",
    adapterImplemented: false, exposedFields: [], runtimeState: "catalog_only",
    evidence: { evidenceFiles: [], notes: ["No ONS adapter or provider catalog entry is present in this build."], redistribution: "unknown" },
  },
  {
    providerId: "nse", providerName: "India · NSE", category: "market", sourceType: "public_api", custodyMode: "public",
    adapterImplemented: true,
    exposedFields: ["market_data.quote", "price_history.ohlcv", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow"],
    runtimeState: null,
    evidence: {
      evidenceFiles: ["src/server/marketData.ts", "src/server/screenerIndia.ts"],
      retrievableFields: ["market_data.quote", "price_history.ohlcv", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow"],
      mappedFields: ["market_data.quote", "price_history.ohlcv", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow"],
      visibleFields: ["market_data.quote", "price_history.ohlcv", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow"],
      engineIntegratedFields: ["market_data.quote", "price_history.ohlcv", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow"],
      notes: ["NSE routing is implemented through the shared quote/history pipeline and the India financial-statement adapter; entitlement is not inferred."],
      redistribution: "unknown",
    },
  },
  {
    providerId: "bse", providerName: "India · BSE", category: "market", sourceType: "public_api", custodyMode: "public",
    adapterImplemented: true,
    exposedFields: ["market_data.quote", "price_history.ohlcv", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow"],
    runtimeState: null,
    evidence: {
      evidenceFiles: ["src/server/bseIndiaQuote.ts", "src/server/bseBhavcopy.ts", "src/server/bseCorporateActions.ts", "src/server/bseIndia.ts"],
      retrievableFields: ["market_data.quote", "price_history.ohlcv", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow"],
      mappedFields: ["market_data.quote", "price_history.ohlcv", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow"],
      visibleFields: ["market_data.quote", "price_history.ohlcv", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow"],
      engineIntegratedFields: ["market_data.quote", "price_history.ohlcv", "financial_statements.income_statement", "financial_statements.balance_sheet", "financial_statements.cash_flow"],
      notes: ["BSE quote, bhavcopy history, corporate actions, and statement paths are implemented; live availability still depends on the official endpoint."],
      redistribution: "unknown",
    },
  },
];

function evidenceSet(values: readonly string[] | undefined): Set<string> {
  return new Set((values ?? []).map((value) => value.trim()).filter(Boolean));
}

function connectorFieldKeys(connector: ConnectorDefinition): string[] {
  return [...new Set(connector.capabilities.flatMap((capability) => {
    const fields = capability.fields?.filter(Boolean) ?? [];
    return fields.length
      ? fields.map((field) => providerFieldKey(capability.contractFamily, field))
      : [capability.contractFamily];
  }))];
}

function buildFields(exposedFields: readonly string[], evidence: ProviderDepthEvidence): ProviderDepthField[] {
  const exposed = new Set(exposedFields);
  const retrievable = evidenceSet(evidence.retrievableFields);
  const mapped = evidenceSet(evidence.mappedFields);
  const visible = evidenceSet(evidence.visibleFields);
  const integrated = evidenceSet(evidence.engineIntegratedFields);
  return [...exposed].sort().map((fieldKey) => {
    const isRetrievable = retrievable.has(fieldKey);
    const isMapped = isRetrievable && mapped.has(fieldKey);
    const isVisible = isMapped && visible.has(fieldKey);
    const isIntegrated = isVisible && integrated.has(fieldKey);
    const gaps: string[] = [];
    if (!isRetrievable) gaps.push("No adapter retrieval evidence recorded.");
    else if (!isMapped) gaps.push("Retrieved field has no confirmed deterministic mapping.");
    else if (!isVisible) gaps.push("Mapped field is not exposed on a user-facing data surface.");
    else if (!isIntegrated) gaps.push("Visible field is not connected to a deterministic engine path.");
    return {
      fieldKey,
      exposed: true,
      retrievable: isRetrievable,
      mapped: isMapped,
      visible: isVisible,
      engineIntegrated: isIntegrated,
      evidence: evidence.evidenceFiles,
      gaps,
    } satisfies ProviderDepthField;
  });
}

function countsFor(fields: readonly ProviderDepthField[]): ProviderDepthStageCounts {
  return fields.reduce((counts, field) => {
    counts.exposed += Number(field.exposed);
    counts.retrievable += Number(field.retrievable);
    counts.mapped += Number(field.mapped);
    counts.visible += Number(field.visible);
    counts.engineIntegrated += Number(field.engineIntegrated);
    return counts;
  }, { exposed: 0, retrievable: 0, mapped: 0, visible: 0, engineIntegrated: 0 });
}

function buildAudit(input: {
  providerId: string;
  providerName: string;
  connectorId: string | null;
  category: string;
  sourceType: string;
  custodyMode: string;
  adapterImplemented: boolean;
  runtimeState: string | null;
  exposedFields: string[];
  evidence: ProviderDepthEvidence;
  licenseCaveat?: string | null;
}): ProviderDepthAudit {
  const fields = buildFields(input.exposedFields, input.evidence);
  const stageCounts = countsFor(fields);
  const maturityLevel = maturityFromStageCounts(stageCounts);
  const notes = [...(input.evidence.notes ?? [])];
  if (input.evidence.evidenceFiles.length === 0) notes.push("No source-file evidence is registered for this provider target.");
  const licenseCaveat = input.licenseCaveat ?? null;
  if (licenseCaveat) notes.push(licenseCaveat);
  const marketing = evaluateProviderMarketingEligibility({
    maturityLevel,
    adapterImplemented: input.adapterImplemented,
    redistribution: input.evidence.redistribution ?? (input.custodyMode === "user_licensed" ? "restricted" : "unknown"),
    runtimeState: input.runtimeState,
  });
  return providerDepthAuditSchema.parse({
    schemaVersion: "1",
    providerId: input.providerId,
    providerName: input.providerName,
    connectorId: input.connectorId,
    category: input.category,
    sourceType: input.sourceType,
    custodyMode: input.custodyMode,
    adapterImplemented: input.adapterImplemented,
    runtimeState: input.runtimeState,
    maturityLevel,
    stageCounts,
    loss: calculateProviderDepthLoss(stageCounts),
    fields,
    evidenceFiles: input.evidence.evidenceFiles,
    notes,
    marketing,
  });
}

export function buildProviderDepthAudit(
  connector: ConnectorDefinition,
  runtimeState: ConnectorRuntimeReport["state"] | null = null,
  evidence: ProviderDepthEvidence = PROVIDER_DEPTH_EVIDENCE[connector.id] ?? {
    evidenceFiles: [],
    notes: ["Connector is present in the catalog but has no V4-08 stage evidence registered yet."],
    redistribution: connector.custodyMode === "user_licensed" ? "restricted" : "unknown",
  },
): ProviderDepthAudit {
  return buildAudit({
    providerId: connector.id,
    providerName: connector.name,
    connectorId: connector.id,
    category: connector.category,
    sourceType: connector.sourceType,
    custodyMode: connector.custodyMode,
    adapterImplemented: connector.adapterImplemented,
    runtimeState,
    exposedFields: connectorFieldKeys(connector),
    evidence,
    licenseCaveat: getConnectorLicenseCaveat(connector),
  });
}

export function buildProviderDepthReport(input: {
  connectors?: readonly ConnectorDefinition[];
  health?: readonly ConnectorRuntimeReport[];
  includeAuditTargets?: boolean;
} = {}): ProviderDepthReport {
  const connectors = input.connectors ?? BUILT_IN_CONNECTORS;
  const healthById = new Map((input.health ?? []).map((health) => [health.connectorId, health]));
  const audits = connectors.map((connector) => buildProviderDepthAudit(connector, healthById.get(connector.id)?.state ?? null));
  if (input.includeAuditTargets !== false) {
    const existing = new Set(audits.map((audit) => audit.providerId));
    for (const target of PROVIDER_DEPTH_AUDIT_TARGETS) {
      if (existing.has(target.providerId)) continue;
      audits.push(buildAudit({
        providerId: target.providerId,
        providerName: target.providerName,
        connectorId: null,
        category: target.category,
        sourceType: target.sourceType,
        custodyMode: target.custodyMode,
        adapterImplemented: target.adapterImplemented,
        runtimeState: target.runtimeState,
        exposedFields: target.exposedFields,
        evidence: target.evidence,
      }));
    }
  }
  audits.sort((left, right) => left.providerId.localeCompare(right.providerId));
  const total = audits.reduce((summary, audit) => {
    summary.totalFieldsExposed += audit.stageCounts.exposed;
    summary.totalFieldsRetrievable += audit.stageCounts.retrievable;
    summary.totalFieldsMapped += audit.stageCounts.mapped;
    summary.totalFieldsVisible += audit.stageCounts.visible;
    summary.totalFieldsEngineIntegrated += audit.stageCounts.engineIntegrated;
    return summary;
  }, {
    providerCount: audits.length,
    totalFieldsExposed: 0,
    totalFieldsRetrievable: 0,
    totalFieldsMapped: 0,
    totalFieldsVisible: 0,
    totalFieldsEngineIntegrated: 0,
    marketingEligibleProviderIds: [] as string[],
    blockedProviderIds: [] as string[],
  });
  total.marketingEligibleProviderIds = audits.filter((audit) => audit.marketing.eligible).map((audit) => audit.providerId);
  total.blockedProviderIds = audits.filter((audit) => !audit.marketing.eligible).map((audit) => audit.providerId);
  return providerDepthReportSchema.parse({
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    evidencePolicy: "static-code-evidence",
    providers: audits,
    summary: total,
  });
}

export function getProviderDepthAudit(providerId: string, input: Parameters<typeof buildProviderDepthReport>[0] = {}): ProviderDepthAudit | null {
  return buildProviderDepthReport(input).providers.find((audit) => audit.providerId === providerId) ?? null;
}
