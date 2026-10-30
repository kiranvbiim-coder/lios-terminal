# Sprint E — source CI recovery and packaged sidecar diagnostic safety

**Status:** source changes in stacked draft PR #311, built on Sprint D #310 → Sprint C #308 → Sprint B #307 → Sprint A #304. No ancestor merged or released.

## Verified failures from previous exact PR heads

- Sprint D PR #310 hosted Linux Source / Linux (job 122173333712): `npm run check` failed with `ProvenanceDrawer.tsx` TS2657 and TS1005. Inspection confirmed the source evidence filter `{tab === "sources" && <div>` was not closed by a `}` after the matching `</div>`.
- Same job offline test `workspaceShellConvergence.test.ts` failed because Sprint C introduced an extra global CSS entry import, violating its exact canonical shell owner import list. The CI source URL remains the truth for the failure. Earlier build/size jobs failed as well; they must be checked independently on Sprint E, not assumed fixed.

## Source changes

1. **Close real JSX**, retaining all existing evidence source, filtered search, published receipt and no-data states. Sprint D's existing TypeScript `transpileModule` TSX parser regression catches this exact error.
2. **Converge the visual CSS owner.** Keep unchanged `terminalStyles.ts` canonical list. `terminal-ux-phase1.css` now imports the separate scoped `sprint-c-intelligence-visuals.css` at its beginning, before the authoritative `terminal-shell.css`. Sprint C's integration contract verifies the import and shell order. No second global shell layer.
3. **Package-sidecar confidentiality and backpressure.** `desktopPythonSidecar.cjs` now drains child stdout/stderr but never stores arbitrary worker output. Errors report safe, bounded classes, including failing HTTP codes, **without raw stdout/stderr, Python tracebacks, host paths or server error bodies**. The existing reverse-DCF fixture, authenticated token, 401 enforcement, deterministic numerical verification, route allowlist and fail-closed requirements remain unchanged. New Node tests exercise HTTP 502 sanitization and forbidden traceback text.

## Verification commands

From `src/` at **exact PR head**:
```sh
npm run check
node --import tsx --test client/src/lib/sprintDIntegrationAcceptance.test.ts client/src/lib/workspaceShellConvergence.test.ts
node --test desktopPythonSidecar.test.cjs
npm run test:offline
npm run test:desktop
npm run build
npm run audit:oss
npm run audit:licenses
npm run release:preflight:ci
```

Inspect completed **all three** `LiOS Hosted Source Validation` Linux/Windows/macOS jobs. A job marked pending, in_progress or cancelled is not a passing validation. Repeat checks after updating this branch and on the final base/head merge ref.

### Installed acceptance still mandatory

- Install signed/notarized candidate Windows/macOS app and collect exact build hash evidence; run `npm run python:sidecar:verify` against **packaged** resources (not a developer `python-service`) with legitimate worker/token/finance route. The reverse-DCF probe must produce expected numerical result, not just 200/health.
- Reproduce and resolve the previously observed **packaged valuation HTTP 502**, including required native packages and real route import. A sanitized HTTP code or source unit-test pass cannot be treated as route repair.
- SP-01/P14 full installed journeys (credential custody, source entitlement, approval/revocation, project/artifact continuity, source attribution, accessible focus, narrow windows, low-resource rendering), native performance and signed evidence remain release blockers.
- Never add secrets, raw sidecar stderr, request bodies, live credentials, or local paths to shared/public CI logs. Retain any authorized private diagnostic investigation outside public release assets and according to the team's operational privacy controls.

**Do not merge or deploy independently.** The CI recovery source branch is not a release acceptance or shipping point.
