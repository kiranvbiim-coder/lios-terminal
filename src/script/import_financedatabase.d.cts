export interface LocalFinanceDatabaseImportResult {
  verified: boolean;
  count: number;
  byCategory: Record<string, number>;
  upstreamCommit: string;
  sha256: string;
}
export function run(args: string[]): LocalFinanceDatabaseImportResult;
