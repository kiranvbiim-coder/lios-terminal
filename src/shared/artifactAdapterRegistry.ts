import { artifactAdapterManifestSchema, type ArtifactAdapterManifest, type ArtifactKind } from "./artifactContracts";

export const ARTIFACT_ADAPTER_REGISTRY: ArtifactAdapterManifest[] = [
  { id: "lios.chart.lightweight", kinds: ["chart"], renderer: "lightweight_charts", lifecycle: "builtin", packageName: "lightweight-charts", capabilities: ["view", "advanced_visualization", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: "lios.chart.recharts" },
  { id: "lios.chart.recharts", kinds: ["chart"], renderer: "recharts", lifecycle: "builtin", packageName: "recharts", capabilities: ["view", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: null },
  { id: "lios.chart.echarts", kinds: ["chart"], renderer: "echarts", lifecycle: "optional", packageName: "echarts", capabilities: ["view", "advanced_visualization", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: "lios.chart.recharts" },
  { id: "lios.table.native", kinds: ["table"], renderer: "builtin", lifecycle: "builtin", packageName: null, capabilities: ["view", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: null },
  { id: "lios.screen.native", kinds: ["screen"], renderer: "builtin", lifecycle: "builtin", packageName: null, capabilities: ["view", "edit"], canonicalStateOwner: "LiOS", fallbackAdapterId: null },
  { id: "lios.finance.native", kinds: ["valuation", "portfolio", "backtest", "strategy", "decision", "timeline"], renderer: "builtin", lifecycle: "builtin", packageName: null, capabilities: ["view", "edit", "diff", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: null },
  { id: "lios.thesis.native", kinds: ["thesis"], renderer: "builtin", lifecycle: "builtin", packageName: null, capabilities: ["view", "edit", "diff", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: null },
  { id: "lios.document.native", kinds: ["research", "report"], renderer: "builtin", lifecycle: "builtin", packageName: null, capabilities: ["view", "edit", "diff", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: null },
  { id: "lios.document.tiptap", kinds: ["research", "report"], renderer: "tiptap", lifecycle: "optional", packageName: "@tiptap/react", capabilities: ["view", "edit", "diff", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: "lios.document.native" },
  { id: "lios.spreadsheet.native", kinds: ["spreadsheet"], renderer: "builtin", lifecycle: "builtin", packageName: null, capabilities: ["view", "edit", "diff", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: null },
  { id: "lios.spreadsheet.univer", kinds: ["spreadsheet"], renderer: "univer", lifecycle: "optional", packageName: "@univerjs/presets", capabilities: ["view", "edit", "diff", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: "lios.spreadsheet.native" },
  { id: "lios.data.duckdb", kinds: ["data"], renderer: "duckdb", lifecycle: "builtin", packageName: "@duckdb/node-api", capabilities: ["query", "large_data", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: "lios.data.virtual" },
  { id: "lios.data.virtual", kinds: ["data"], renderer: "virtual_table", lifecycle: "builtin", packageName: null, capabilities: ["view", "large_data", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: null },
  { id: "lios.data.perspective", kinds: ["data"], renderer: "perspective", lifecycle: "optional", packageName: "@finos/perspective", capabilities: ["view", "query", "large_data", "advanced_visualization", "export"], canonicalStateOwner: "LiOS", fallbackAdapterId: "lios.data.virtual" },
].map((manifest) => artifactAdapterManifestSchema.parse(manifest));

export function artifactAdaptersForKind(kind: ArtifactKind): ArtifactAdapterManifest[] {
  return ARTIFACT_ADAPTER_REGISTRY.filter((adapter) => adapter.kinds.includes(kind));
}

export function defaultArtifactAdapterId(kind: ArtifactKind): string {
  const builtin = artifactAdaptersForKind(kind).find((adapter) => adapter.lifecycle === "builtin");
  if (!builtin) throw new Error(`No built-in Artifact adapter registered for ${kind}.`);
  return builtin.id;
}

export function resolveArtifactAdapter(input: {
  kind: ArtifactKind;
  preferredAdapterId?: string | null;
  availablePackages?: ReadonlySet<string>;
}): ArtifactAdapterManifest {
  const candidates = artifactAdaptersForKind(input.kind);
  const preferred = input.preferredAdapterId ? candidates.find((adapter) => adapter.id === input.preferredAdapterId) : null;
  const available = (adapter: ArtifactAdapterManifest) =>
    adapter.lifecycle === "builtin" || (adapter.packageName !== null && input.availablePackages?.has(adapter.packageName));
  if (preferred && available(preferred)) return preferred;
  if (preferred?.fallbackAdapterId) {
    const fallback = candidates.find((adapter) => adapter.id === preferred.fallbackAdapterId);
    if (fallback && available(fallback)) return fallback;
  }
  const builtin = candidates.find((adapter) => adapter.lifecycle === "builtin" && available(adapter));
  if (!builtin) throw new Error(`No available Artifact adapter for ${input.kind}.`);
  return builtin;
}
