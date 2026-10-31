export interface LocalFinanceDatabaseImportResult {
  verified: boolean;
  count: number;
  byCategory: Record<string, number>;
  upstreamCommit: string;
  sha256: string;
}
export function run(args: string[]): LocalFinanceDatabaseImportResult;
export interface FinanceDatabaseImportStage {
  stage: "read" | "write" | "check";
  category?: string;
  rows?: number;
}
export function runAsync(args: string[], onStage?: (stage: FinanceDatabaseImportStage) => void): Promise<LocalFinanceDatabaseImportResult>;
export function assertFreeSpace(directory: string, requiredBytes: number): void;
