import type { DataArtifactContent } from "@shared/artifactBridgeTypes";
import { dataArtifactContentSchema } from "@shared/artifactContracts";
import { scanColumnarArtifact } from "./columnarArtifactStore";
import type { TenantContext } from "./tenantContext";

export async function queryDataArtifact(raw: unknown, input: {
  metric?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}, ctx?: TenantContext) {
  const content: DataArtifactContent = dataArtifactContentSchema.parse(raw);
  const requestedLimit = input.limit === undefined ? 100 : input.limit;
  const offset = input.offset === undefined ? 0 : input.offset;
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) throw new Error("Limit must be a positive safe integer.");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Offset must be a nonnegative safe integer.");
  const limit = Math.min(requestedLimit, 500);
  if (content.columnarArtifactId) {
    const result = await scanColumnarArtifact(content.columnarArtifactId, {
      metric: input.metric,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      limit,
      offset,
    }, ctx);
    if (!result) throw new Error("Linked columnar artifact is unavailable.");
    return { mode: "duckdb", ...result };
  }
  const sample = content.previewRows.slice(offset, offset + limit);
  const availableRowCount = content.previewRows.length;
  return {
    mode: "inline",
    rowCount: content.rowCount,
    availableRowCount,
    offset,
    limit,
    nextOffset: sample.length > 0 && offset + sample.length < availableRowCount ? offset + sample.length : null,
    columns: content.columns,
    sample,
  };
}
