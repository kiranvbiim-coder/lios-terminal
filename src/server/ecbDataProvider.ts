import type { ProviderEntitlementDecision } from "@shared/universalDataFabric";
import type { CanonicalDataRequest } from "@shared/universalDataFabric";
import type { LiOSDataProviderAdapter, ProviderAdapterResult } from "./providerSdk";
import { fetchText } from "./providerUtils";

export const ECB_DATA_API_BASE = "https://data-api.ecb.europa.eu/service/data";

type EcbTextFetcher = (url: string) => Promise<string>;

interface EcbSeriesTarget {
  flowRef: string;
  seriesKey: string;
}

function stringParameter(request: CanonicalDataRequest, key: string): string | null {
  const value = request.parameters[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boundedObservationCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 250;
  return Math.min(Math.max(Math.floor(value), 1), 1_000);
}

function validFlowRef(value: string): boolean {
  return /^[A-Za-z0-9_.-]+(?:,[A-Za-z0-9_.-]+){0,2}$/.test(value);
}

function validSeriesKey(value: string): boolean {
  return /^[A-Za-z0-9._+\-]+$/.test(value);
}

export function resolveEcbSeriesTarget(request: CanonicalDataRequest): EcbSeriesTarget | null {
  const explicitFlow = stringParameter(request, "dataflow")
    ?? stringParameter(request, "flowRef")
    ?? request.entity.identifiers.ecbDataflow
    ?? null;
  const explicitKey = stringParameter(request, "seriesKey")
    ?? request.entity.identifiers.ecbSeriesKey
    ?? null;

  if (explicitFlow && explicitKey && validFlowRef(explicitFlow) && validSeriesKey(explicitKey)) {
    return { flowRef: explicitFlow, seriesKey: explicitKey };
  }

  if (request.entity.ref.startsWith("ECB:")) {
    const [, flowRef, ...rest] = request.entity.ref.split(":");
    const seriesKey = rest.join(":");
    if (flowRef && seriesKey && validFlowRef(flowRef) && validSeriesKey(seriesKey)) {
      return { flowRef, seriesKey };
    }
  }

  return null;
}

export function buildEcbDataUrl(request: CanonicalDataRequest): string | null {
  const target = resolveEcbSeriesTarget(request);
  if (!target) return null;

  const query = new URLSearchParams();
  query.set("format", "csvdata");
  query.set("detail", "dataonly");

  const startPeriod = stringParameter(request, "startPeriod");
  const endPeriod = stringParameter(request, "endPeriod");
  if (startPeriod) query.set("startPeriod", startPeriod);
  if (endPeriod) query.set("endPeriod", endPeriod);

  query.set("lastNObservations", String(boundedObservationCount(request.parameters.lastNObservations)));

  return `${ECB_DATA_API_BASE}/${target.flowRef}/${target.seriesKey}?${query.toString()}`;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export interface EcbObservation {
  timePeriod: string | null;
  value: number | null;
  dimensions: Record<string, string>;
}

export function parseEcbCsv(csv: string): EcbObservation[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const observations: EcbObservation[] = [];

  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    if (!cells.length) continue;

    const row: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      if (!headers[index]) continue;
      row[headers[index]] = cells[index] ?? "";
    }

    const rawValue = row.OBS_VALUE?.trim() ?? "";
    const numericValue = rawValue === "" ? null : Number(rawValue);
    const dimensions = Object.fromEntries(
      Object.entries(row).filter(([key]) => key !== "OBS_VALUE" && key !== "TIME_PERIOD"),
    );

    observations.push({
      timePeriod: row.TIME_PERIOD?.trim() || null,
      value: numericValue !== null && Number.isFinite(numericValue) ? numericValue : null,
      dimensions,
    });
  }

  return observations;
}

const publicEcbEntitlement = (): ProviderEntitlementDecision => ({
  decision: "unknown",
  policyId: null,
  permittedUses: [],
  reasons: ["ECB Data Portal access is public; downstream redistribution and product-use rights must still be reviewed for the intended output."],
});

export function createEcbDataProviderAdapter(fetcher: EcbTextFetcher = fetchText): LiOSDataProviderAdapter {
  return {
    id: "ecb",
    label: "European Central Bank Data Portal",
    priority: 18,
    capabilities: ["macro"],
    pointInTimeModes: ["latest"],
    async fetch(request): Promise<ProviderAdapterResult | null> {
      const url = buildEcbDataUrl(request);
      if (!url) return null;

      const csv = await fetcher(url);
      const observations = parseEcbCsv(csv);
      if (!observations.length) return null;

      const target = resolveEcbSeriesTarget(request);
      if (!target) return null;

      return {
        providerId: "ecb",
        data: {
          provider: "ecb",
          flowRef: target.flowRef,
          seriesKey: target.seriesKey,
          observations,
        },
        sourceRefs: [url],
        entitlement: publicEcbEntitlement(),
        normalized: true,
        warnings: observations.some((observation) => observation.value === null)
          ? ["One or more ECB observations did not contain a finite numeric OBS_VALUE."]
          : [],
      };
    },
  };
}
