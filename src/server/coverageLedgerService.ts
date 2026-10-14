import { performance } from "node:perf_hooks";
import {
  buildInstrumentSearchIndex,
  searchInstrumentIndexLocal,
  type InstrumentSearchIndex,
} from "@shared/instrumentSearchIndex";
import {
  coverageLedgerSnapshotSchema,
  type CoverageLedgerSnapshot,
} from "@shared/universalDataFabric";
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";
import { buildProviderDepthReport } from "./providerDepthAudit";
import { loadAllPersistedInstrumentCandidates } from "./globalInstrumentMasterStore";
import { loadLegacyTickerCatalog } from "./legacyTickerCatalog";
import { loadProviderIngestedCatalog } from "./providerIngestedCatalog";

export const P5_INDEX_CAPACITY_PROOF_SIZE = 120_000;

function identityKey(candidate: { entityId: string | null; listingId: string | null; symbol?: string | null; exchange?: string | null; name: string; source?: string | null }): string {
  if (candidate.listingId) return `listing:${candidate.listingId}`;
  if (candidate.entityId) return `entity:${candidate.entityId}:${candidate.symbol ?? ""}:${candidate.exchange ?? ""}`;
  return `${candidate.source ?? "local"}:${candidate.symbol ?? ""}:${candidate.exchange ?? ""}:${candidate.name}`;
}

export function measureSearchP95(index: InstrumentSearchIndex, queries: string[]): number | null {
  if (!queries.length) return null;
  for (const query of queries) searchInstrumentIndexLocal(index, query, { limit: 20 });
  const timings: number[] = [];
  for (let round = 0; round < 3; round += 1) {
    for (const query of queries) {
      const started = performance.now();
      searchInstrumentIndexLocal(index, query, { limit: 20 });
      timings.push(performance.now() - started);
    }
  }
  timings.sort((a, b) => a - b);
  return timings[Math.min(timings.length - 1, Math.floor(timings.length * 0.95))] ?? null;
}

export async function buildCoverageLedgerSnapshot(): Promise<CoverageLedgerSnapshot> {
  const [persisted, legacy, ingested] = await Promise.all([
    loadAllPersistedInstrumentCandidates(),
    Promise.resolve(loadLegacyTickerCatalog()),
    Promise.resolve(loadProviderIngestedCatalog()),
  ]);
  const combined = [...persisted, ...legacy, ...ingested];
  const realUnique = [...new Map(combined.map((candidate) => [identityKey(candidate), candidate])).values()];
  const index = buildInstrumentSearchIndex(realUnique);
  const queries = realUnique.slice(0, 80).flatMap((candidate) => (candidate.symbol ? [candidate.symbol] : []));
  const p95 = measureSearchP95(index, queries);
  const depth = buildProviderDepthReport();
  const capabilityFamilies = new Set(BUILT_IN_CONNECTORS.flatMap((connector) => connector.capabilities.map((capability) => capability.contractFamily)));
  const gaps: string[] = [];
  if (realUnique.length < 100_000) {
    gaps.push(`Real local universe currently contains ${realUnique.length} unique candidates; P5 does not relabel capacity or federated reach as bundled local coverage.`);
  }
  if (depth.summary.blockedProviderIds.length) {
    gaps.push(`${depth.summary.blockedProviderIds.length} provider-depth targets are not yet marketing-eligible.`);
  }
  return coverageLedgerSnapshotSchema.parse({
    schemaVersion: "1",
    generatedAt: new Date().toISOString(),
    realUniverseSize: realUnique.length,
    indexedUniverseSize: index.candidates.length,
    capacityProofSize: P5_INDEX_CAPACITY_PROOF_SIZE,
    warmSearchP95Ms: p95,
    providers: depth.summary.providerCount,
    implementedProviders: depth.providers.filter((provider) => provider.adapterImplemented).length,
    capabilityFamilies: capabilityFamilies.size,
    fieldStages: {
      exposed: depth.summary.totalFieldsExposed,
      retrievable: depth.summary.totalFieldsRetrievable,
      mapped: depth.summary.totalFieldsMapped,
      visible: depth.summary.totalFieldsVisible,
      engineIntegrated: depth.summary.totalFieldsEngineIntegrated,
    },
    gaps,
  });
}
