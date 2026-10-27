# LiOS four-phase release-candidate QA closure (27 Oct 2026)

**One integrated review PR:** #253 (`integrate/lios-four-phase-closure-20261027`) → current protected `main`. Includes Phase 1–4 stacked functionality, the existing main #216 directory-catalog security fix, and offline beta integrity/acceptance gates. Older stacked PRs are source donors, **not additional merge steps** if #253 is eventually accepted.

## Actual discovered defects and changes

Read completed previous Phase 3 source CI **run 40459641761, Linux job 122040941455**. Its typecheck failed because `ConversationRuntimeTrace.tsx:396` accessed nonexistent `tool_result.outcome` twice; the closure branch now derives completion from canonical tool-result/status event types only. Offline tests showed **18 failures** across two batches: 16 Node SSR JSX `React is not defined` errors, one workstation test expecting pre-Perspectives Research menu, and one outdated Visual Search test looking for `activeQuery` after the already-made `searchReady` refactor. The closure branch adds explicit React runtime imports to the eight source components implicated, updates the real workstation contract and adapts the search guard expectation. These are **source edits**, not evidence that a new check has passed.

## Now executable in the actual project

```bash
cd src
npm ci --no-audit --no-fund
npm run check
npm run test:phase-closure
npm run beta:manifest:test
npm run beta:acceptance:test
npm run test:offline
npm run test:desktop
npm run release:preflight:ci
npm run build
```

The existing public standard Linux source runner now runs `test:phase-closure`, `beta:manifest:test`, `beta:acceptance:test` and `release:preflight:ci` as one named Phase 1–4 gate, in addition to existing Windows/macOS/Linux typecheck, offline suites and builds. No paid runner, production credential, signing key, release output or network provider is added.

## $0 beta acceptance — independently blocked until genuine native evidence

Actual target-platform packaging already exists: `npm run app:beta:mac` on macOS arm64, `npm run app:beta:win` on Windows x64. Both require the actual native Python sidecar, sandbox image, platform build resources and declared `LIOS_BETA_VERSION`; the builder refuses incompatible hosts/resources and never publishes. `beta:manifest` is an explicit offline signer/verifier, using a private signing key outside the repository and independent public trust.

The new `npm run beta:acceptance -- [eight explicit flags]` is a **fail-closed evidence gate**, not an installer. It requires three exact Ed25519-manifest-verified Mac DMG/ZIP and Windows NSIS installer hashes, packaged self-test JSON on **both actual target OS/architecture** (native OS key storage round trip, saved workspace reopen, deterministic Python route, zero packaged bytecode writes, updater metadata, timing) and matching user-received binary SHA-256 in two human-accepted UX evidence reports. Their required true checks cover sign-in, source access, Project briefing/save, exact P4 version reopen, offline/reconnect, keyboard, screen reader, 200% zoom, Reduced Motion, protected secrets, and OS warning disclosure. The UX reports require local screenshot/log paths and a human reviewer. **The acceptance code now also opens the actual local evidence files relative to each UX report, rejects missing files, symlinks, escaping paths, spoofed image extensions and oversized captures, and reports content SHA-256 values.** This file existence/signature check does not replace visual inspection or make the screenshots cryptographically attested evidence. Even a successful evidence gate reports `releasePublished: false`, `productionQualified: false` and `independentHumanAcceptanceStillRequired: true`.

Example report structure (one file for each actual `mac-arm64-dmg` or `win-x64-nsis`):

```json
{
  "schema": 1,
  "channel": "beta",
  "target": "mac-arm64-dmg",
  "assetSha256": "<exact installer SHA-256 from signed beta manifest>",
  "capturedAt": "<actual ISO-8601 test date>",
  "osWarningDisclosure": true,
  "checks": {
    "signedIn": true,
    "sourceAccess": true,
    "briefingSavedAndReopened": true,
    "artifactVersionReopened": true,
    "offlineAndReconnect": true,
    "keyboardOnly": true,
    "screenReader": true,
    "zoom200": true,
    "reducedMotion": true,
    "nativeSecretCustody": true
  },
  "evidencePaths": ["<actual local screenshot path>", "<actual native log path>"],
  "reviewer": "<actual tester>"
}
```

Never fill `true` from source tests, synthetic screenshots or assumed OS success. Recording expected fields is not authenticating human reports. The owner separately reviews those captures before any publication. Native OS trust warnings must be stated: $0 ad-hoc macOS signing is **not notarization**, unsigned Windows NSIS is **not Authenticode**. P14 production release gate remains unchanged; no Gatekeeper/SmartScreen bypass is endorsed.

## Release decision truth

| Check | State at source handoff |
| --- | --- |
| Single branch containing all four phases + latest protected main delta | **Committed / reviewable** |
| Historic Phase 3 source TypeScript/SSR defects | **Repaired in source, new run not yet accepted** |
| One named source CI + fail-closed beta acceptance tests | **Written; fresh pass required** |
| P10 native self-tests on actual macOS arm64 / Windows x64 and UX captures | **Not observed in this environment** |
| Installer assets and owner key/manifest signed against exact reviewed commit | **Not produced or verified here** |
| Package publication on owned free channels | **Not performed; owner decision required** |
| Full native MapLibre, server-approved generalized visual answers, P11 Scenario→P4 full native proof and licensed audiovisual content | **Separate unfinished product gates** |

**Release blocker policy:** Do not merge protected `main`, distribute binaries, claim product launch, or incur additional cash expense because a source branch or manifest script exists. Do not relax signed P14 qualification to make a zero-cost beta appear production certified.
