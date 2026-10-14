import type { CanonicalDataRequest, ProviderEntitlementDecision } from "@shared/universalDataFabric";
import type { LiOSDataProviderAdapter, ProviderAdapterResult } from "./providerSdk";
import { fetchText } from "./providerUtils";

export const OECD_SDMX_API_BASE = "https://sdmx.oecd.org/public/rest/data";

type OecdTextFetcher = (url: string) => Promise<string>;

export interface OecdDataTarget {
  agency: string;
  dataset: string;
  version: string | null;
  selection: string;
}

export interface OecdObservation {
  timePeriod: string;
  value: number;
  dimensions: Record<string, string>;
}

function stringParameter(request: CanonicalDataRequest, key: string): string | null {
  const value = request.parameters[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validAgency(value: string): boolean {
  return /^[A-Za-z0-9_.-]{2,120}$/.test(value);
}

function validDataset(value: string): boolean {
  return /^[A-Za-z0-9_.@-]{2,160}$/.test(value);
}

function validVersion(value: string): boolean {
  return /^[A-Za-z0-9_.-]{1,32}$/.test(value);
}

function validSelection(value: string): boolean {
  return value.length > 0
    && value.length <= 400
    && value.toLowerCase() !== "all"
    && /^[A-Za-z0-9._+~-]+$/.test(value);
}

function validPeriod(value: string): boolean {
  return /^[A-Za-z0-9-]{1,32}$/.test(value);
}

export function resolveOecdDataTarget(request: CanonicalDataRequest): OecdDataTarget | null {
  let agency = stringParameter(request, "agency") ?? request.entity.identifiers.oecdAgency ?? null;
  let dataset = stringParameter(request, "dataset") ?? request.entity.identifiers.oecdDataset ?? null;
  let version = stringParameter(request, "version") ?? request.entity.identifiers.oecdVersion ?? null;
  let selection = stringParameter(request, "selection")
    ?? stringParameter(request, "dataSelection")
    ?? request.entity.identifiers.oecdSelection
    ?? null;

  if (request.entity.ref.startsWith("OECD:")) {
    const [, refAgency, refDataset, refSelection] = request.entity.ref.split(":");
    if (!agency && refAgency) agency = refAgency;
    if (!dataset && refDataset) dataset = refDataset;
    if (!selection && refSelection) selection = refSelection;
  }

  if (!agency || !dataset || !selection) return null;
  if (!validAgency(agency) || !validDataset(dataset) || !validSelection(selection)) return null;
  if (version && !validVersion(version)) return null;

  return { agency, dataset, version, selection };
}

export function buildOecdDataUrl(request: CanonicalDataRequest): string | null {
  const target = resolveOecdDataTarget(request);
  if (!target) return null;

  const query = new URLSearchParams();
  query.set("dimensionAtObservation", "AllDimensions");
  query.set("format", "csvfilewithlabels");

  const startPeriod = stringParameter(request, "startPeriod");
  const endPeriod = stringParameter(request, "endPeriod");
  if (startPeriod && validPeriod(startPeriod)) query.set("startPeriod", startPeriod);
  if (endPeriod && validPeriod(endPeriod)) query.set("endPeriod", endPeriod);

  const datasetRef = `${target.agency},${target.dataset},${target.version ?? ""}`;
  return `${OECD_SDMX_API_BASE}/${datasetRef}/${target.selection}?${query.toString()}`;
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

export function parseOecdCsv(csv: string): OecdObservation[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  if (!headers.includes("TIME_PERIOD") || !headers.includes("OBS_VALUE")) return [];

  const observations: OecdObservation[] = [];
  for (const line of lines.slice(1)) {
    if (observations.length >= 2_000) break;
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};

    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index];
      if (!header) continue;
      row[header] = cells[index] ?? "";
    }

    const timePeriod = row.TIME_PERIOD?.trim() ?? "";
    const rawValue = row.OBS_VALUE?.trim() ?? "";
    if (!timePeriod || !rawValue) continue;

    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;

    const dimensions = Object.fromEntries(
      Object.entries(row).filter(([key]) => key !== "TIME_PERIOD" && key !== "OBS_VALUE"),
    );

    observations.push({ timePeriod, value, dimensions });
  }

  return observations;
}

const publicOecdEntitlement = (): ProviderEntitlementDecision => ({
  decision: "unknown",
  policyId: null,
  permittedUses: [],
  reasons: ["OECD API access is public and free of charge, but use remains subject to OECD terms and downstream redistribution/product-use rights must be reviewed for the intended output."],
});

export function createOecdDataProviderAdapter(fetcher: OecdTextFetcher = fetchText): LiOSDataProviderAdapter {
  return {
    id: "oecd",
    label: "OECD Data Explorer",
    priority: 20,
    capabilities: ["macro"],
    pointInTimeModes: ["latest"],
    async fetch(request): Promise<ProviderAdapterResult | null> {
      const target = resolveOecdDataTarget(request);
      const url = buildOecdDataUrl(request);
      if (!target || !url) return null;

      const csv = await fetcher(url);
      const observations = parseOecdCsv(csv);
      if (!observations.length) return null;

      return {
        providerId: "oecd",
        data: {
          provider: "oecd",
          agency: target.agency,
          dataset: target.dataset,
          version: target.version,
          selection: target.selection,
          observations,
        },
        sourceRefs: [url],
        entitlement: publicOecdEntitlement(),
        normalized: true,
        warnings: observations.length >= 2_000
          ? ["OECD response was capped at 2,000 observations; narrow the data selection or time period for complete coverage."]
          : [],
      };
    },
  };
}
