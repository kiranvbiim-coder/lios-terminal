export type ColumnarExecutionPath = "duckdb_parquet" | "arrow_optional" | "polars_optional";

export interface ColumnarWorkloadEvidence {
  rowCount: number;
  columnCount: number;
  estimatedBytes: number;
  requiresZeroCopyInterop?: boolean;
  transformComplexity?: "simple" | "moderate" | "heavy";
}

export interface ColumnarRuntimeAvailability {
  arrow: boolean;
  polars: boolean;
}

export interface ColumnarPathDecision {
  path: ColumnarExecutionPath;
  reasons: string[];
  optionalPackRequired: boolean;
}

/**
 * P5-14 keeps DuckDB/Parquet as Core. Arrow/Polars are selected only when
 * measured workload evidence benefits from them and the optional runtime is
 * actually installed. This avoids adding heavy packages merely for feature
 * parity while preserving a stable adapter boundary.
 */
export function chooseColumnarExecutionPath(
  workload: ColumnarWorkloadEvidence,
  availability: ColumnarRuntimeAvailability,
): ColumnarPathDecision {
  if (
    availability.arrow &&
    workload.requiresZeroCopyInterop === true &&
    workload.estimatedBytes >= 64 * 1024 * 1024
  ) {
    return {
      path: "arrow_optional",
      reasons: ["Measured workload is at least 64 MiB and requires zero-copy columnar interchange."],
      optionalPackRequired: true,
    };
  }

  if (
    availability.polars &&
    workload.transformComplexity === "heavy" &&
    (workload.rowCount >= 1_000_000 || workload.estimatedBytes >= 256 * 1024 * 1024)
  ) {
    return {
      path: "polars_optional",
      reasons: ["Measured high-volume heavy transform crosses the optional Polars threshold."],
      optionalPackRequired: true,
    };
  }

  return {
    path: "duckdb_parquet",
    reasons: ["Core DuckDB/Parquet path is sufficient for this measured workload or optional adapters are unavailable."],
    optionalPackRequired: false,
  };
}
