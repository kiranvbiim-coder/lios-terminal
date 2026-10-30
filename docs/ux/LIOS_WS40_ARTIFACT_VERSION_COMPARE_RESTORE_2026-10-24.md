# WS-40 — Exact Artifact versions, comparison and safe restore

**2026-10-24** · [TC/UX plan #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119) · [tracking #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91) · canonical parent [P4/Chat #98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98).

## Existing code audit: reuse P4

- P4 already stores immutable `ProjectArtifactVersionRecord` objects. Server `GET /api/artifacts/:id?version=X` and `GET /api/artifacts/:id/versions` are tenant/owner-bound. `compareArtifactVersions` returns left/right ID/version/content hashes and an exact semantic diff. `restoreArtifactRevision` copies the chosen historical content AND version lineage/source/trust/refresh posture to a **new version**, requiring `baseVersion` optimistic concurrency. No rewrite of history or second Artifact authority.
- Client `ArtifactPane` had a History tab, but versions displayed as static lines. `COMPARE FROM` only used the current head, and metadata comparison could use `data.version` from a different requested revision. The fetched asynchronous comparison was written into state without checking whether a different Artifact, revision or selection was now active.
- Client `useArtifact` supplied a previous same-ID response as placeholder when a different exact version was selected; `ArtifactPaneWorkspace` rendered `detail.data` directly. The existing outer `ArtifactPane` intentionally disallowed locally selecting a version smaller than the original prop, blocking the desired historical browsing.
- Restore had an immediately-active button (no explicit confirmation) and lacked dirty-draft, active-model and pending-save guards. Header Undo also wrote immediately. Neither made a clear distinction between viewing a saved revision and actively restoring it.

## Implementation

1. `client/src/lib/artifactHistorySafety.ts` provides pure fail-closed guards. Display requires exact Artifact ID, saved version or current head, matching content kind, and selected Project/owning Chat scope; comparisons require returned exact left/right IDs/versions AND hashes matching authorized historical versions and the displayed revision; restore eligibility requires current displayed head, a real older saved revision of the same Artifact, clean local draft and no active action.
2. `useArtifact` no longer substitutes `placeholderData` from a prior saved revision. `ArtifactPane` additionally rejects mismatched P4 response identity and version. A historical exact version can now be selected even if its number is lower than the originally opened version; loading/unavailable states are explicit rather than displaying the wrong content.
3. The existing History tab lists real saved versions with recorded hashes, provides **View exact vN** and **Open current head**, compares a selected version against the exact **displayed** revision, checks the server response's ID/hash/version and suppresses results for out-of-date UI choices. Metadata diffs use both correct historical version records. History text has a revision-scoped status and does not overwrite newer selections.
4. **Restore is now a two-step, reversible UI decision**: select an earlier version, click Prepare restore, read exact source/target hashes and new-version number, then explicitly Confirm or Cancel. Header Undo routes into the **same confirmation**, not an immediate server write. During restore and comparison buttons are disabled against duplicate submissions, and all revision switches are blocked while local edits or P4 model/save actions are unresolved. On confirm the original server `restoreArtifactRevision(artifactId, capturedHead, target)` enforces optimistic concurrency; a mismatched returned Artifact ID or version is rejected, and late responses cannot silently redirect another selection. No cloud/local draft is discarded by a revision switch.
5. New `artifactHistorySafety.test.ts` covers exact Project and Quick Chat scope, ID/kind/version/head mismatch, stale placeholders, version/hash response mismatch, dirty/in-flight restore refusal, historical browsing and two-step UI contracts. No external provider calls or invented revisions.

## Tests and review

From `src/`:

```sh
node --import tsx --test client/src/lib/artifactHistorySafety.test.ts client/src/lib/p4ArtifactWorkspace.test.ts client/src/lib/artifactWorkbenchHandoff.test.ts client/src/lib/useArtifacts.test.ts
npm run check
npm run test:p4
npm run test:ux
npm run validate:visual-environments
```

**Still pending:** exact-head GitHub Actions on Linux/Windows/macOS; signed-in exact historical Project/Quick access and cross-user denial tests, interrupted request/late-response browser races, native packaged history/undo and dirty-draft keyboard/screen-reader 200%-zoom tests, PR review and P14/SP release signoff. Authored test files are not the same as passed CI.

**Merge/dependency:** This PR is intentionally stacked on #98. Integrate only after #98 and reconcile sibling #163/#167/#171/#172/#173/#174 and WS-08 responsive CSS as needed; never overwrite sibling work with a parallel implementation.
