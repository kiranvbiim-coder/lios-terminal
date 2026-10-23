# WS-10 — Truthful Loading, Empty, Denied and Recovery States

**Date:** 2026-10-23. **Owner:** TC/UX. **Authority:** [65-workstream UX plan PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). This workstream is source-level implementation and testing, not a claim of browser/native acceptance or a release.

## Observed code gaps and boundaries

- **Artifacts:** `ArtifactPane.tsx` previously rendered the identical `Artifact unavailable` fallback for a 401 session, 403 permission denial, 404/410 missing revision, ordinary 5xx/network error, or a response with no data. `useArtifact` discarded the HTTP status and threw the generic `Failed to load Artifact.`. That erased essential trust and recovery differences.
- **Connections:** `DataConnectionCenter.tsx` had a loading indicator, but after a failed `/api/setup/status` initial query it fell into the main UI with `setupQuery.data ?? []` and zero connected providers. A failed credential/setup read could be mistaken for a legitimately empty provider inventory. On a failed refresh where cached data existed, the same stale inventory risk remained.
- **Chat:** `ProjectExperienceShell.tsx` already has a thoughtful `shellLoadState` loading/retry/Temporary Chat screen. Duplicating it would be wasteful. However its error screen echoed raw `shellError.message` from fetch responses, which may contain untrusted/error payload text; and `retryShell` recorded `shell_recovered` after `Promise.all(refetch())` even if refetch returned query errors.

## Actual implementation

1. **Shared taxonomy:** `src/client/src/lib/asyncSurfaceState.ts` classifies only first-party query booleans and numeric HTTP statuses: `ready`, `loading`, `signed_out` (401), `denied` (403), `missing` (404/410/no response), `failed` (ordinary 5xx/network). It prioritizes already-held Artifact data to avoid evicting visible saved revisions or draft state during revalidation. Error bodies never appear in display copy.
2. **Shared bounded notice:** `src/client/src/components/terminal/AsyncSurfaceNotice.tsx` supplies safe per-surface titles, a `role=status` during loading and `role=alert` on failure, deliberate Retry/Close/Sign out actions, and a disabled Retrying action while refetching. Denied users are **not** offered an in-place permission bypass. This is a visual state boundary, not a new workflow engine or API.
3. **Artifact:** the existing hook now passes the HTTP **status code only** in its read failure; ArtifactPane renders specific safe notices and `detail.refetch()` rather than a false empty object. Close retains existing dirty-draft/ownership protections in the caller; no mutation or revision reset is introduced.
4. **Connections:** setup status must be truly available before the main provider catalog and Continue controls render. Even an error during cached query refetch blocks that catalog until a successful retry. Existing logout is the only exit offered; no provider creation, test, authorization or entitlement is fabricated. **No credentials are logged, echoed or reset.**
5. **Chat:** existing UI keeps its state machine and Temporary Chat option for ordinary restoration failures. An HTTP 401/403 surfaces sanitized sign-in/access-restricted guidance and Sign out instead of an inappropriate fallback action. The raw backend error body is never directly rendered. `shell_recovered` is emitted only after every attempted query reports success.

## Source tests and remaining acceptance

- Nine **executable pure-state tests**: `src/client/src/lib/asyncSurfaceState.test.ts`.
- Eight **feature wiring/source contract tests**: `src/script/validate_ws10_recovery_contract.test.mjs`.
- The project-owned test discovery script includes `.test.ts` and `.test.mjs` files. Run on the exact PR head:

```bash
cd src
node --import tsx --test client/src/lib/asyncSurfaceState.test.ts script/validate_ws10_recovery_contract.test.mjs
npm run test:ux
npm run acceptance:ux
```

| Evidence | Status |
| --- | --- |
| Source implementation and seventeen regression tests in draft PR | IN_PR |
| Exact-head hosted CI and Node regression commands | PENDING |
| Actual 401/403/404/5xx/API-offline responses in authenticated browser | NOT_RUN |
| Initial and cached-refetch setup failure, provider count and permission safety | NOT_RUN |
| Actual offline/online Artifact retry + retained local draft | NOT_RUN |
| 200% zoom, keyboard-only Tab/retry/exit controls | NOT_RUN |
| VoiceOver, Narrator, installed Windows/macOS builds | NOT_RUN |
| Independent merge, signed product release and P14/SP acceptance | NOT_RUN |

## Merge coordination

Source overlap is real and acknowledged: existing [PR #98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98) edits `useArtifacts.ts`, `ArtifactPane.tsx` and Chat; [PR #102](https://github.com/kiranvbiim-coder/lios-terminal/pull/102) edits ArtifactPane and Chat; [PR #105](https://github.com/kiranvbiim-coder/lios-terminal/pull/105) edits `DataConnectionCenter.tsx`; [PR #115](https://github.com/kiranvbiim-coder/lios-terminal/pull/115) edits Chat. These other PRs own donor/fork integration, saved Artifact flow, first-run credentials and message actions respectively. **Do not merge this draft without a conflict and behavior reconciliation** against each current head. The new helper and notice are self-contained and do not introduce dependencies; integrate the small call sites into the final reviewed source once feature PRs settle. [WS-09 PR #129](https://github.com/kiranvbiim-coder/lios-terminal/pull/129) changes shared UI wrappers, not this recovery taxonomy.

Real target evidence must verify that 401/403 never unlocks privileged operations, 404 does not leak existence or ownership, failed setup does not claim no providers, retries do not claim success on errors, and active draft/revision custody is unchanged. Link exact SHA, OS, screenshots and test logs to #91 before marking WS-10 accepted.
