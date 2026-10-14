/**
 * Licence trust anchors (GM-07b). The public keys the app accepts for signed licence files and offline leases are
 * pinned here, in the code that ships, never taken from the file being verified: a lease that carries its own
 * public key proves nothing. Rotate by adding a second entry (new key id) before retiring the first.
 *
 * The matching private key is held by the vendor outside this repository and used only by `npm run license:issue`.
 * Key id = first 16 hex characters of SHA-256 over the exact PEM text below.
 */
export const LICENSE_TRUST_ANCHORS: Readonly<Record<string, string>> = {
  "9cd9a99c75e6afd2": "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAWac5kX7PAcIctn6hxoSOKgFcYWRBF0JNPWfCeliV5Jg=\n-----END PUBLIC KEY-----\n",
};
