import type { ArtifactContent } from "./artifactContracts";

export type ChartArtifactContent = Extract<ArtifactContent, { kind: "chart" }>;
export type DataArtifactContent = Extract<ArtifactContent, { kind: "data" }>;
export type ReportArtifactContent = Extract<ArtifactContent, { kind: "report" }>;
export type ResearchArtifactContent = Extract<ArtifactContent, { kind: "research" }>;
export type SpreadsheetArtifactContent = Extract<ArtifactContent, { kind: "spreadsheet" }>;
