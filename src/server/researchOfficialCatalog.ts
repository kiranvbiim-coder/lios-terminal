import type { ResearchSearchFilters } from "@shared/schema";
import { INDICATOR_CATALOG } from "./fredData";
import { WB_INDICATOR_CATALOG } from "./worldBankData";
import {
  createEvidenceFingerprint,
  defaultSourceQuality,
  type NormalizedResearchResult,
} from "./researchService";

interface OfficialCatalogSearchRequest {
  query: string;
  filters: ResearchSearchFilters;
  limit: number;
}

export function searchOfficialData(request: OfficialCatalogSearchRequest): NormalizedResearchResult[] {
  // Catalog records identify datasets, not dated observations. Excluding them
  // under date filters prevents an undated profile from masquerading as data.
  if (request.filters.dateFrom || request.filters.dateTo || request.filters.freshnessDays) return [];

  const retrievedAt = new Date().toISOString();
  const query = (request.query || request.filters.entity || "").trim().toLowerCase();
  const matches = (value: string) => !query || value.toLowerCase().includes(query);
  const resultId = (provider: string, externalId: string, sourceUrl: string, title: string) =>
    createEvidenceFingerprint({ provider, sourceExternalId: externalId, sourceUrl, title, publishedAt: null });

  const fred = INDICATOR_CATALOG.filter((profile) => matches(`${profile.seriesId} ${profile.name} ${profile.category} ${profile.domain}`))
    .map((profile): NormalizedResearchResult => {
      const sourceUrl = `https://fred.stlouisfed.org/series/${profile.seriesId}`;
      const title = `${profile.name} (${profile.seriesId})`;
      return {
        resultId: resultId("FRED", profile.seriesId, sourceUrl, title),
        evidenceType: "official_data",
        evidenceKind: "fact",
        title,
        excerpt: `${profile.category}; unit: ${profile.unit}. Save an observation or model output separately when a value is used in analysis.`,
        sourceName: "Federal Reserve Bank of St. Louis",
        provider: "FRED",
        sourceUrl,
        sourceExternalId: profile.seriesId,
        publishedAt: null,
        effectiveAt: null,
        retrievedAt,
        sourceQuality: defaultSourceQuality("official_data", "FRED", true),
        relevanceScore: null,
        metadata: { datasetProfile: profile, dataState: "catalog_metadata" },
      };
    });
  const worldBank = WB_INDICATOR_CATALOG.filter((profile) => matches(`${profile.code} ${profile.name} ${profile.category} ${profile.domain}`))
    .map((profile): NormalizedResearchResult => {
      const sourceUrl = `https://data.worldbank.org/indicator/${profile.code}`;
      const title = `${profile.name} (${profile.code})`;
      return {
        resultId: resultId("World Bank Open Data", profile.code, sourceUrl, title),
        evidenceType: "official_data",
        evidenceKind: "fact",
        title,
        excerpt: `${profile.category}; unit: ${profile.unit}. Country and observation year must be recorded when a value is used.`,
        sourceName: "World Bank Open Data",
        provider: "World Bank",
        sourceUrl,
        sourceExternalId: profile.code,
        publishedAt: null,
        effectiveAt: null,
        retrievedAt,
        sourceQuality: defaultSourceQuality("official_data", "World Bank", true),
        relevanceScore: null,
        metadata: { datasetProfile: profile, dataState: "catalog_metadata" },
      };
    });

  return [...fred, ...worldBank].slice(0, request.limit);
}
