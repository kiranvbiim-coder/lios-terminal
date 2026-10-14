export interface HighVolumeInteropDecision {
  rowCount: number;
  estimatedBytes: number;
  primary: "inline_json" | "duckdb_parquet";
  arrowIpc: "not_required" | "runtime_pack_candidate";
  polars: "not_required" | "runtime_pack_candidate";
  reasons: string[];
}

/**
 * P5 keeps the base desktop on the already-bundled DuckDB/Parquet path.
 * Arrow IPC/Polars become runtime-pack candidates only after workload size
 * makes row-object transfer the bottleneck. This avoids adding heavy packages
 * without evidence while preserving an explicit upgrade boundary.
 */
export function chooseHighVolumeInterop(input: {
  rowCount: number;
  estimatedBytes: number;
  repeatedCrossProcessTransfer?: boolean;
  dataframeTransforms?: boolean;
}): HighVolumeInteropDecision {
  const large = input.rowCount >= 50_000 || input.estimatedBytes >= 25 * 1024 * 1024;
  const primary = large ? "duckdb_parquet" : "inline_json";
  const arrowNeeded = large && input.repeatedCrossProcessTransfer === true;
  const polarsNeeded = large && input.dataframeTransforms === true;
  const reasons = [
    large ? "Workload exceeds inline threshold; use DuckDB/Parquet." : "Workload remains below the columnar threshold.",
    arrowNeeded ? "Repeated cross-process transfer makes Arrow IPC a measured runtime-pack candidate." : "No measured Arrow IPC requirement for this workload.",
    polarsNeeded ? "DataFrame-heavy transforms make Polars a measured runtime-pack candidate." : "DuckDB SQL remains sufficient; Polars is not required.",
  ];
  return {
    rowCount: input.rowCount,
    estimatedBytes: input.estimatedBytes,
    primary,
    arrowIpc: arrowNeeded ? "runtime_pack_candidate" : "not_required",
    polars: polarsNeeded ? "runtime_pack_candidate" : "not_required",
    reasons,
  };
}
