/**
 * Process-local provider credential/configuration mutation marker.
 * The execution cache uses this as a key component: an old observation
 * must never become a hit after credentials rotate or are removed.
 * The marker has no secret material and is not a replacement for the vault.
 */
let revision = 0;

export function providerCredentialRevision(): number {
  return revision;
}

export function noteProviderCredentialMutation(): void {
  revision += 1;
}
