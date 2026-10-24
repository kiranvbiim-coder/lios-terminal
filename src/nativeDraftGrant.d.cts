export interface NativeDraftGrantScope {
  owner: string;
  artifactId: string;
  baseVersion: number;
  contentHash: string;
  sessionBinding?: string;
}
export function issueNativeDraftGrant(secret: string, scope: NativeDraftGrantScope, now?: number): string;
export function verifyNativeDraftGrant(secret: string, grant: string, scope: NativeDraftGrantScope, now?: number): NativeDraftGrantScope;
export function authorizeNativeDraftGrant(secret: string, input: NativeDraftGrantScope & { grant: string }, fetchCurrentGrant: (scope: Pick<NativeDraftGrantScope, "artifactId" | "baseVersion" | "contentHash">) => Promise<{ grant: string }>): Promise<NativeDraftGrantScope>;
export const MAX_LIFETIME_MS: number;
