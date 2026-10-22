export interface NativeDraftGrantScope {
  owner: string;
  artifactId: string;
  baseVersion: number;
  contentHash: string;
}
export function issueNativeDraftGrant(secret: string, scope: NativeDraftGrantScope, now?: number): string;
export function verifyNativeDraftGrant(secret: string, grant: string, scope: NativeDraftGrantScope, now?: number): NativeDraftGrantScope;
export const MAX_LIFETIME_MS: number;
