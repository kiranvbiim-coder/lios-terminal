import type { ProviderEntitlementDecision } from "@shared/universalDataFabric";
import type { CanonicalDataRequest } from "@shared/universalDataFabric";
import type { LiOSDataProviderAdapter, ProviderAdapterResult } from "./providerSdk";
import { fetchText } from "./providerUtils";

export const IMF_DATAMAPPER_API_BASE = "https://www.imf.org/external/datamapper/api/v2";

type ImfTextFetcher = (url: string) => Promise<string>;

export interface ImfDataMapperTarget {
  indicator: string;
  entities: string[];
}

export interface ImfDataMapperObservation {
  entityCode: string;
  year: string;
  value: number;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringParameter(request: CanonicalDataRequest, key: string): string | null {
  const value = request.parameters[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function listParameter(request: CanonicalDataRequest, ...keys: string[]): string[] {
  for (const key of keys) {
    const value = request.parameters[key];
    if (Array.isArray(value)) {
      const items = value.map((item) => String(item).trim()).filter(Boolean);
      if (items.length) return items;
    }
    if (typeof value === "string" && value.trim()) {
      const items = value.split(",").map((item) => item.trim()).filter(Boolean);
      if (items.length) return items;
    }
  }
  return [];
}

function validIndicator(value: string): boolean {
  return /^[A-Za-z0-9_@.-]{2,80}$/.test(value);
}

function validEntity(value: string): boolean {
  return /^[A-Za-z0-9_.-]{2,24}$/.test(value);
}

export function resolveImfDataMapperTarget(request: CanonicalDataRequest): ImfDataMapperTarget | null {
  let indicator = stringParameter(request, "indicator")
    ?? stringParameter(request, "seriesId")
    ?? request.entity.identifiers.imfIndicator
    ?? null;
  let entities = listParameter(request, "countries", "entities", "country");

  const identifierEntity = request.entity.identifiers.imfCountry;
  if (!entities.length && identifierEntity) entities = [identifierEntity];

  if (request.entity.ref.startsWith("IMF:")) {
    const [, refIndicator, refEntities] = request.entity.ref.split(":");
    if (!indicator && refIndicator) indicator = refIndicator;
    if (!entities.length && refEntities) {
      entities = refEntities.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }

  if (!indicator || !validIndicator(indicator)) return null;
  const normalizedEntities = Array.from(new Set(entities.map((item) => item.toUpperCase())));
  if (!normalizedEntities.length || normalizedEntities.length > 20 || normalizedEntities.some((item) => !validEntity(item))) return null;

  return { indicator, entities: normalizedEntities };
}

function requestedPeriods(request: CanonicalDataRequest): string[] {
  const explicit = listParameter(request, "periods", "years")
    .filter((period) => /^\d{4}$/.test(period));
  if (explicit.length) return Array.from(new Set(explicit)).slice(0, 100);

  const start = stringParameter(request, "startYear");
  const end = stringParameter(request, "endYear");
  if (!start || !end || !/^\d{4}$/.test(start) || !/^\d{4}$/.test(end)) return [];
  const first = Number(start);
  const last = Number(end);
  if (!Number.isInteger(first) || !Number.isInteger(last) || last < first || last - first > 99) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => String(first + index));
}

export function buildImfDataMapperUrl(request: CanonicalDataRequest): string | null {
  const target = resolveImfDataMapperTarget(request);
  if (!target) return null;

  const path = [target.indicator, ...target.entities].map((item) => encodeURIComponent(item)).join("/");
  const periods = requestedPeriods(request);
  if (!periods.length) return `${IMF_DATAMAPPER_API_BASE}/${path}`;

  const query = new URLSearchParams();
  query.set("periods", periods.join(","));
  return `${IMF_DATAMAPPER_API_BASE}/${path}?${query.toString()}`;
}

export function parseImfDataMapperJson(body: string, target: ImfDataMapperTarget): ImfDataMapperObservation[] {
  const parsed: unknown = JSON.parse(body);
  if (!record(parsed) || !record(parsed.values)) return [];
  const indicatorValues = parsed.values[target.indicator];
  if (!record(indicatorValues)) return [];

  const observations: ImfDataMapperObservation[] = [];
  for (const entityCode of target.entities) {
    const series = indicatorValues[entityCode];
    if (!record(series)) continue;
    for (const [year, raw] of Object.entries(series)) {
      if (!/^\d{4}$/.test(year)) continue;
      if (raw === null || raw === undefined || raw === "") continue;
      const value = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(value)) continue;
      observations.push({ entityCode, year, value });
    }
  }

  return observations.sort((left, right) =>
    left.entityCode.localeCompare(right.entityCode) || left.year.localeCompare(right.year));
}

const publicImfEntitlement = (): ProviderEntitlementDecision => ({
  decision: "unknown",
  policyId: null,
  permittedUses: [],
  reasons: ["IMF DataMapper access is public; downstream redistribution and product-use rights must still be reviewed for the intended output."],
});

export function createImfDataProviderAdapter(fetcher: ImfTextFetcher = fetchText): LiOSDataProviderAdapter {
  return {
    id: "imf",
    label: "International Monetary Fund DataMapper",
    priority: 19,
    capabilities: ["macro"],
    pointInTimeModes: ["latest"],
    async fetch(request): Promise<ProviderAdapterResult | null> {
      const target = resolveImfDataMapperTarget(request);
      const url = buildImfDataMapperUrl(request);
      if (!target || !url) return null;

      const body = await fetcher(url);
      const observations = parseImfDataMapperJson(body, target);
      if (!observations.length) return null;

      return {
        providerId: "imf",
        data: {
          provider: "imf",
          apiVersion: "v2",
          indicator: target.indicator,
          entities: target.entities,
          observations,
        },
        sourceRefs: [url],
        entitlement: publicImfEntitlement(),
        normalized: true,
      };
    },
  };
}
