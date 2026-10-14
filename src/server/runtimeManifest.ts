export interface ManagedRuntimePackage {
  name: string;
  version: string;
  license: string;
  native: boolean;
  /** False for opt-in packs intentionally excluded from the monolithic dev/CI requirements superset. */
  ciSuperset?: boolean;
}

export interface ManagedRuntimePack {
  id: string;
  name: string;
  packages: ManagedRuntimePackage[];
  engines: string[];
}

export interface ManagedRuntimeManifest {
  runtimeId: string;
  manifestVersion: string;
  pythonVersion: string;
  supportedPlatforms: string[];
  packs: ManagedRuntimePack[];
  installPolicy: "signed_allowlist_only";
}

/**
 * Reproducibility manifest for the LiOS-managed Python runtime. Versions
 * are pinned to python-service/requirements.txt. Actual installation and
 * platform-specific wheel hashes are release artifacts, not guessed here.
 */
export const MANAGED_RUNTIME_MANIFEST: ManagedRuntimeManifest = {
  runtimeId: "lios-managed",
  manifestVersion: "1.1.0",
  pythonVersion: ">=3.11,<3.14",
  supportedPlatforms: ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"],
  installPolicy: "signed_allowlist_only",
  packs: [
    {
      id: "core",
      name: "Core Quant",
      packages: [
        { name: "fastapi", version: "0.141.1", license: "MIT", native: false },
        { name: "starlette", version: "1.6.0", license: "BSD-3-Clause", native: false },
        { name: "uvicorn", version: "0.34.0", license: "BSD-3-Clause", native: false },
        { name: "numpy", version: "2.x", license: "BSD-3-Clause", native: true },
        { name: "pandas", version: "<3.0", license: "BSD-3-Clause", native: true },
        { name: "scipy", version: "1.14.1", license: "BSD-3-Clause", native: true },
        { name: "statsmodels", version: "0.14.4", license: "BSD-3-Clause", native: false },
      ],
      engines: ["statistics", "econometrics", "portfolio"],
    },
    {
      id: "fixed-income",
      name: "Fixed Income",
      packages: [{ name: "QuantLib", version: "1.43", license: "QuantLib License", native: true }],
      engines: ["fixed_income"],
    },
    {
      id: "forecasting",
      name: "Forecasting",
      packages: [
        { name: "arch", version: "8.0.0", license: "NCSA", native: false },
        { name: "ruptures", version: "1.1.10", license: "BSD-2-Clause", native: false },
      ],
      engines: ["forecasting"],
    },
    {
      id: "econometrics",
      name: "Econometrics",
      packages: [{ name: "linearmodels", version: "7.0", license: "NCSA", native: false }],
      engines: ["panel", "iv2sls"],
    },
    {
      id: "ml",
      name: "Machine Learning",
      packages: [{ name: "scikit-learn", version: "1.9.0", license: "BSD-3-Clause", native: true }],
      engines: ["ml"],
    },
    {
      id: "optimization",
      name: "Optimization",
      packages: [
        { name: "networkx", version: "3.6.1", license: "BSD-3-Clause", native: false },
        { name: "pymoo", version: "0.6.2", license: "Apache-2.0", native: false },
        { name: "SALib", version: "1.5.2", license: "MIT", native: false },
        { name: "asteval", version: "1.0.9", license: "MIT", native: false },
      ],
      engines: ["optimization", "supply_chain"],
    },
    {
      id: "research-sec",
      name: "SEC Research",
      packages: [{ name: "edgartools", version: "5.51.0", license: "MIT", native: false }],
      engines: ["sec_search"],
    },
    {
      id: "research-docs",
      name: "Local Document Intelligence",
      packages: [{ name: "docling", version: "2.129.0", license: "MIT", native: false, ciSuperset: false }],
      engines: ["document_intelligence"],
    },
    {
      id: "community-yahoo",
      name: "Community Yahoo (opt-in)",
      packages: [{ name: "yfinance", version: "1.5.1", license: "Apache-2.0", native: false }],
      engines: ["market_data"],
    },
  ],
};
