import { runCommand } from "./exec/run-command";
import { pythonRuntimeEnvOverlay } from "./exec/env";
import { getPythonServiceEnvironment } from "./pythonService";
import { MANAGED_RUNTIME_MANIFEST, type ManagedRuntimeManifest } from "./runtimeManifest";
import { sandboxIsolationMode } from "./exec/sandbox-runtime-profile";

export type PythonRuntimeId = "lios-managed" | "system-auto" | "external-path" | "remote-service";

export interface PythonRuntimeProfile {
  id: PythonRuntimeId;
  name: string;
  description: string;
  supported: boolean;
  recommended: boolean;
  requiresPath: boolean;
  requiresNetwork: boolean;
}

export const PYTHON_RUNTIME_PROFILES: PythonRuntimeProfile[] = [
  { id: "lios-managed", name: "LiOS Managed Runtime", description: "Version-controlled Python runtime with validated LiOS engine libraries.", supported: true, recommended: true, requiresPath: false, requiresNetwork: false },
  { id: "system-auto", name: "Detected Local Python", description: "Use the best compatible Python installation detected on this machine.", supported: true, recommended: false, requiresPath: false, requiresNetwork: false },
  { id: "external-path", name: "Your Python Environment", description: "Use your own venv, uv, Conda, or enterprise-managed environment with your installed libraries.", supported: true, recommended: false, requiresPath: true, requiresNetwork: false },
  { id: "remote-service", name: "Your Remote Python Service", description: "Use your own authenticated Python service over HTTPS.", supported: true, recommended: false, requiresPath: true, requiresNetwork: true },
];

export interface PythonEnginePack {
  id: string;
  name: string;
  description: string;
  packages: string[];
  engines: string[];
  installed: boolean;
}

export const PYTHON_ENGINE_PACKS: PythonEnginePack[] = [
  { id: "core", name: "Core Quant", description: "Numerical, statistical, and API runtime foundation.", packages: ["numpy", "pandas", "scipy", "statsmodels", "fastapi", "uvicorn"], engines: ["statistics", "econometrics", "portfolio"], installed: false },
  { id: "fixed-income", name: "Fixed Income", description: "QuantLib bond pricing and curve analytics.", packages: ["QuantLib"], engines: ["fixed_income"], installed: false },
  { id: "forecasting", name: "Forecasting", description: "GARCH, EGARCH, and changepoint forecasting.", packages: ["arch", "ruptures"], engines: ["forecasting"], installed: false },
  { id: "econometrics", name: "Econometrics", description: "Panel models and instrumental-variable estimators.", packages: ["linearmodels"], engines: ["panel", "iv2sls"], installed: false },
  { id: "ml", name: "Machine Learning", description: "Classification, regression, clustering, and anomaly detection.", packages: ["scikit-learn"], engines: ["ml"], installed: false },
  { id: "optimization", name: "Optimization", description: "Multi-objective, sensitivity, and constrained optimization.", packages: ["pymoo", "SALib", "asteval", "networkx"], engines: ["optimization", "supply_chain"], installed: false },
  { id: "research-sec", name: "SEC Research", description: "SEC EDGAR filing search (calls sec.gov).", packages: ["edgartools"], engines: ["sec_search"], installed: false },
  { id: "community-yahoo", name: "Community Yahoo", description: "Optional yfinance access — requires explicit consent on retail LiOS.", packages: ["yfinance"], engines: ["market_data"], installed: false },
];

export interface PythonRuntimeStatus {
  state: "ready" | "partial" | "unavailable";
  runtimeId: PythonRuntimeId;
  pythonVersion: string | null;
  packages: Record<string, string>;
  installedPacks: string[];
  missingPackages: string[];
  detail: string;
  manifest: ManagedRuntimeManifest;
}

export interface PythonRuntimeInspectionOptions {
  runtimeId?: PythonRuntimeId;
  environmentPath?: string | null;
}

async function inspectExternalEnvironment(environmentPath: string): Promise<{ python: string; packages: Record<string, string> }> {
  if (sandboxIsolationMode() === "strict") {
    throw new Error("Strict isolation does not permit host Python environment inspection. Use the verified isolated runtime; no external interpreter was started.");
  }
  const executable = process.platform === "win32" ? `${environmentPath}\\Scripts\\python.exe` : `${environmentPath}/bin/python`;
  const result = await runCommand({
    argv: [executable, "-c", "import json,sys,importlib.metadata as m; print(json.dumps({'python':sys.version.split()[0],'packages':{d.metadata['Name']:d.version for d in m.distributions()} }))"],
    timeoutMs: 10_000,
    maxOutputChars: 2_000_000,
    env: pythonRuntimeEnvOverlay({ PYTHONDONTWRITEBYTECODE: "1" }),
    envProfile: "python-runtime",
  });
  const parsed = JSON.parse(result.stdout) as { python?: string; packages?: Record<string, string> };
  return { python: parsed.python ?? "unknown", packages: parsed.packages ?? {} };
}

export async function inspectPythonRuntime(options: PythonRuntimeInspectionOptions = {}): Promise<PythonRuntimeStatus> {
  try {
    if (options.runtimeId === "external-path") {
      if (!options.environmentPath?.trim()) throw new Error("Select the path to your Python environment.");
      const environment = await inspectExternalEnvironment(options.environmentPath.trim());
      const packages = environment.packages;
      const requiredCore = PYTHON_ENGINE_PACKS.find((pack) => pack.id === "core")?.packages ?? [];
      const missingPackages = requiredCore.filter((pkg) => !packages[pkg] && !packages[pkg.toLowerCase()]);
      const installedPacks = PYTHON_ENGINE_PACKS.filter((pack) => pack.packages.every((pkg) => packages[pkg] || packages[pkg.toLowerCase()])).map((pack) => pack.id);
      return {
        state: missingPackages.length === 0 ? "ready" : "partial",
        runtimeId: "external-path",
        pythonVersion: environment.python,
        packages,
        installedPacks,
        missingPackages,
        detail: missingPackages.length === 0 ? "Your Python environment is ready." : `Your Python environment is missing: ${missingPackages.join(", ")}.`,
        manifest: MANAGED_RUNTIME_MANIFEST,
      };
    }
    if (options.runtimeId === "remote-service") {
      return {
        state: "unavailable", runtimeId: "remote-service", pythonVersion: null, packages: {}, installedPacks: [],
        missingPackages: [], detail: "Remote runtime is selected. Configure its HTTPS endpoint and token in the runtime environment.", manifest: MANAGED_RUNTIME_MANIFEST,
      };
    }
    const environment = await getPythonServiceEnvironment();
    const packages = environment.packages;
    const requiredCore = PYTHON_ENGINE_PACKS.find((pack) => pack.id === "core")?.packages ?? [];
    const missingPackages = requiredCore.filter((pkg) => !packages[pkg] || packages[pkg] === "unavailable");
    const installedPacks = PYTHON_ENGINE_PACKS.filter((pack) => pack.packages.every((pkg) => packages[pkg] && packages[pkg] !== "unavailable")).map((pack) => pack.id);
    return {
      state: missingPackages.length === 0 ? "ready" : "partial",
      runtimeId: "lios-managed",
      pythonVersion: environment.python,
      packages,
      installedPacks,
      missingPackages,
      detail: missingPackages.length === 0 ? "Python sidecar and core packages are ready." : `Python sidecar is reachable; missing core packages: ${missingPackages.join(", ")}.`,
      manifest: MANAGED_RUNTIME_MANIFEST,
    };
  } catch (error) {
    return {
      state: "unavailable", runtimeId: options.runtimeId ?? "lios-managed", pythonVersion: null, packages: {}, installedPacks: [],
      missingPackages: PYTHON_ENGINE_PACKS.find((pack) => pack.id === "core")?.packages ?? [],
      detail: error instanceof Error ? error.message : "Python runtime is unavailable.",
      manifest: MANAGED_RUNTIME_MANIFEST,
    };
  }
}
