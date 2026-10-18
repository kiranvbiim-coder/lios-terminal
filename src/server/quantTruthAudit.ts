import fs from "fs";
import path from "path";
import { quantModelRegistryEntrySchema } from "@shared/quantModelRegistry";
import { ADVANCED_QUANT_PATHS } from "./advancedQuantRoutes";
import {
  KNOWN_STOCHASTIC_OR_SYNTHETIC_SOURCES,
  QUANT_ANALYTICAL_SURFACES,
  QUANT_COMPUTE_ENDPOINTS,
  QUANT_DATA_PROVIDER_SOURCES,
  QUANT_MODEL_REGISTRY,
} from "./quantModelRegistry";

const MODEL_SOURCE_FILES = [
  "client/src/lib/quantModels.ts",
  "client/src/lib/statistics.ts",
  "client/src/lib/valuationModels.ts",
  "client/src/lib/templates/apv.ts",
  "client/src/lib/templates/creditAnalysis.ts",
  "client/src/lib/templates/epv.ts",
  "client/src/lib/templates/lboDebtPaydown.ts",
  "client/src/lib/templates/nav.ts",
  "client/src/lib/templates/projectFinance.ts",
  "client/src/lib/templates/saasMetrics.ts",
  "client/src/lib/templates/sotp.ts",
  "client/src/lib/templates/transactionComps.ts",
  "shared/integratedFinancialModel.ts",
];

function duplicates(values: string[]) {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return Array.from(repeated).sort();
}

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(absolute) : [absolute];
  });
}

function discoverPythonEndpoints(root: string, declaration: "BASE_ROUTES" | "ADVANCED_ROUTES"): string[] {
  const source = fs.readFileSync(path.join(root, "python-service/engine_routes.py"), "utf8");
  const block = source.split(`${declaration} = (`)[1]?.split("\n)")[0] ?? "";
  const paths = Array.from(block.matchAll(/EngineRoute\(['"](\/[^'"]+)['"]/g)).map((match) => match[1]);
  return declaration === "ADVANCED_ROUTES" ? paths.map((routePath) => `/advanced${routePath}`) : paths;
}

export type QuantTruthAuditResult = ReturnType<typeof runQuantTruthAudit>;

/** Dataset paths (relative to the app root) that the source-only distribution manifest declares as withheld. */
export function withheldDatasetPaths(root: string): Set<string> {
  const manifestPath = path.join(root, "..", "third_party", "source-distribution.json");
  if (!fs.existsSync(manifestPath)) return new Set();
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { withheldDatasets?: unknown };
  const entries = Array.isArray(manifest.withheldDatasets) ? manifest.withheldDatasets : [];
  return new Set(entries.filter((entry): entry is string => typeof entry === "string" && entry.startsWith("src/")).map((entry) => entry.slice(4)));
}

export function runQuantTruthAudit(root = process.cwd()) {
  const issues: string[] = [];
  const ids = QUANT_MODEL_REGISTRY.map((entry) => entry.id);
  const apiEndpoints = QUANT_MODEL_REGISTRY.flatMap((entry) => entry.apiEndpoint ? [entry.apiEndpoint] : []);
  const engineEndpoints = QUANT_MODEL_REGISTRY.flatMap((entry) => entry.engineEndpoint ? [entry.engineEndpoint] : []);

  for (const id of duplicates(ids)) issues.push(`Duplicate model id: ${id}`);
  for (const endpoint of duplicates(apiEndpoints)) issues.push(`Duplicate API endpoint classification: ${endpoint}`);
  for (const endpoint of duplicates(engineEndpoints)) issues.push(`Duplicate engine endpoint classification: ${endpoint}`);

  QUANT_MODEL_REGISTRY.forEach((entry, index) => {
    const parsed = quantModelRegistryEntrySchema.safeParse(entry);
    if (!parsed.success) issues.push(`Invalid registry entry at ${index}: ${parsed.error.issues[0]?.message}`);
  });

  const registeredComputeEndpoints = new Set(
    QUANT_MODEL_REGISTRY.filter((entry) => entry.engine === "python_sidecar").flatMap((entry) => entry.apiEndpoint ? [entry.apiEndpoint] : []),
  );
  for (const endpoint of QUANT_COMPUTE_ENDPOINTS) {
    if (!registeredComputeEndpoints.has(endpoint)) issues.push(`Unclassified quant API endpoint: ${endpoint}`);
  }
  for (const endpoint of Array.from(registeredComputeEndpoints)) {
    if (!QUANT_COMPUTE_ENDPOINTS.includes(endpoint)) {
      issues.push(`Registry endpoint is not mounted by quantRoutes: ${endpoint}`);
    }
  }

  const quantRoutesSource = fs.readFileSync(path.join(root, "server/quantRoutes.ts"), "utf8");
  const advancedRoutesSource = fs.readFileSync(path.join(root, "server/advancedQuantRoutes.ts"), "utf8");
  const advancedApiEndpoints = new Set(ADVANCED_QUANT_PATHS.map((routePath) => `/api/quant/advanced/${routePath}`));
  const advancedWildcardMounted = advancedRoutesSource.includes('app.post("/api/quant/advanced/:family/:model"');
  if (advancedApiEndpoints.size > 0 && !advancedWildcardMounted) {
    issues.push("Advanced quant manifest exists but wildcard route is not mounted.");
  }
  for (const endpoint of QUANT_COMPUTE_ENDPOINTS) {
    if (advancedApiEndpoints.has(endpoint)) {
      if (!advancedWildcardMounted) issues.push(`Registry endpoint has no route definition: ${endpoint}`);
      continue;
    }
    const pathName = endpoint.split("/").at(-1);
    const directlyMounted = quantRoutesSource.includes(`app.post("${endpoint}"`);
    const mountedByGroup = Boolean(pathName && quantRoutesSource.includes(`path: "${pathName}"`));
    if (!directlyMounted && !mountedByGroup) issues.push(`Registry endpoint has no route definition: ${endpoint}`);
  }

  const pythonMain = fs.readFileSync(path.join(root, "python-service/main.py"), "utf8");
  const directPythonEndpoints = discoverPythonEndpoints(root, "BASE_ROUTES");
  const advancedPythonEndpoints = discoverPythonEndpoints(root, "ADVANCED_ROUTES");
  const advancedRouterMounted = pythonMain.includes("app.include_router(advanced_router)");
  if (advancedPythonEndpoints.length > 0 && !advancedRouterMounted) {
    issues.push("Advanced Python manifest exists but advanced_router is not mounted.");
  }
  const expectedAdvancedPythonEndpoints = ADVANCED_QUANT_PATHS.map((routePath) => `/advanced/${routePath}`).sort();
  const actualAdvancedPythonEndpoints = [...advancedPythonEndpoints].sort();
  if (JSON.stringify(actualAdvancedPythonEndpoints) !== JSON.stringify(expectedAdvancedPythonEndpoints)) {
    const expected = new Set(expectedAdvancedPythonEndpoints);
    const actual = new Set(actualAdvancedPythonEndpoints);
    for (const endpoint of expectedAdvancedPythonEndpoints) {
      if (!actual.has(endpoint)) issues.push(`Advanced Python manifest missing endpoint: ${endpoint}`);
    }
    for (const endpoint of actualAdvancedPythonEndpoints) {
      if (!expected.has(endpoint)) issues.push(`Advanced Python manifest has unclassified endpoint: ${endpoint}`);
    }
  }
  const discoveredPythonEndpoints = Array.from(new Set([...directPythonEndpoints, ...advancedPythonEndpoints])).sort();
  const registeredPythonEndpoints = new Set(engineEndpoints);
  for (const endpoint of discoveredPythonEndpoints) {
    if (!registeredPythonEndpoints.has(endpoint)) issues.push(`Unclassified Python endpoint: ${endpoint}`);
  }
  for (const endpoint of Array.from(registeredPythonEndpoints)) {
    if (!discoveredPythonEndpoints.includes(endpoint)) issues.push(`Registry Python endpoint does not exist: ${endpoint}`);
  }

  const registeredComponents = new Set(QUANT_MODEL_REGISTRY.flatMap((entry) => entry.components));
  const exportedFunctions = MODEL_SOURCE_FILES.flatMap((relative) => {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    return Array.from(source.matchAll(/^export function ([A-Za-z0-9_]+)/gm)).map((match) => ({ name: match[1], source: relative }));
  });
  for (const item of exportedFunctions) {
    if (!registeredComponents.has(item.name)) issues.push(`Unclassified exported model function: ${item.name} (${item.source})`);
  }

  const clientRoot = path.join(root, "client/src");
  const randomSources = walk(clientRoot)
    .filter((file) => /\.(ts|tsx)$/.test(file) && fs.readFileSync(file, "utf8").includes("Math.random"))
    // Registry keys are POSIX-style repository paths; path.relative yields backslashes on Windows.
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .sort();
  for (const source of randomSources) {
    if (!KNOWN_STOCHASTIC_OR_SYNTHETIC_SOURCES[source]) issues.push(`Unclassified stochastic or synthetic source: ${source}`);
  }

  for (const [surface, relative] of Object.entries(QUANT_ANALYTICAL_SURFACES)) {
    if (!fs.existsSync(path.join(root, relative))) issues.push(`Registered analytical surface is missing: ${surface} (${relative})`);
  }

  const providerSourceFiles = Object.values(QUANT_DATA_PROVIDER_SOURCES).flat();
  const withheld = withheldDatasetPaths(root);
  for (const [provider, sources] of Object.entries(QUANT_DATA_PROVIDER_SOURCES)) {
    if (sources.length === 0) issues.push(`Provider has no registered source: ${provider}`);
    for (const relative of sources) {
      if (fs.existsSync(path.join(root, relative))) continue;
      // A dataset the source-only distribution declares as withheld is an explicit NOT_RUN, never a silent pass.
      if (withheld.has(relative)) continue;
      issues.push(`Registered provider source is missing: ${provider} (${relative})`);
    }
  }

  const classifiedQuantSupportEndpoints = new Set(
    QUANT_MODEL_REGISTRY.filter((entry) => entry.engine !== "python_sidecar").flatMap((entry) => entry.apiEndpoint ? [entry.apiEndpoint] : []),
  );
  const requiredQuantSupportEndpoints = [
    "/api/quant/consensus-note",
    "/api/quant/challenge-assumption",
    "/api/quant/damodaran/industries",
    "/api/quant/damodaran/industries/:industry",
  ];
  for (const endpoint of requiredQuantSupportEndpoints) {
    if (!classifiedQuantSupportEndpoints.has(endpoint)) issues.push(`Unclassified quant support endpoint: ${endpoint}`);
    if (!quantRoutesSource.includes(`app.${endpoint.includes("damodaran") ? "get" : "post"}("${endpoint}"`)) {
      issues.push(`Quant support endpoint has no route definition: ${endpoint}`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    counts: {
      registryEntries: QUANT_MODEL_REGISTRY.length,
      quantComputeEndpoints: QUANT_COMPUTE_ENDPOINTS.length,
      pythonEndpoints: discoveredPythonEndpoints.length,
      exportedModelFunctions: exportedFunctions.length,
      stochasticOrSyntheticSources: randomSources.length,
      analyticalSurfaces: Object.keys(QUANT_ANALYTICAL_SURFACES).length,
      dataProviders: Object.keys(QUANT_DATA_PROVIDER_SOURCES).length,
      providerSourceFiles: new Set(providerSourceFiles).size,
    },
    stochasticOrSyntheticSources: randomSources.map((source) => ({ source, classification: KNOWN_STOCHASTIC_OR_SYNTHETIC_SOURCES[source] })),
  };
}
