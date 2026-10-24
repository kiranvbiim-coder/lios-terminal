# WS-42 — P4 recovery, failure and source continuity

**Date:** 2026-10-24 · [TC/UX plan PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91) · **Canonical P4 parent:** [#98](https://github.com/kiranvbiim-coder/lios-terminal/pull/98) · **Native and universal Chat ownership:** [#102](https://github.com/kiranvbiim-coder/lios-terminal/pull/102). Avoid duplicate recovery stores, fabricated Chat/Project identity or browser plaintext fallbacks.

## Audited original authority

- Canonical P4 versions remain immutable and owner/organization/Chat scoped. The server's native draft grant route authenticates exactly the saved P4 version and content hash; Electron main uses a live session-bound MAC grant for each IPC read/write/delete. `desktopArtifactDraftRecovery.cjs` is an OS-protected encrypted, atomic file swap; plaintext/unknown Linux key-store backends refuse the operation. No checkpoint is a canonical P4 save or permission to reuse a source.
- The client `useNativeArtifactDraftRecovery` already queues writes by owner/Artifact identity, epochs away stale timer callbacks, validates content kind and exact base version/hash before restore, and offers Recover, Discard, Retry and Continue without encrypted recovery. P4 editors retain dirty content and block edit/save while recovery is unresolved.
- Existing #102 and #98 source tests cover encrypted crash reopen, Linux OS-secret denial, Quick/Project ownership, model/worksheet formulas, session-bound grants, concurrent tenant/Chat authority, and intentional version conflicts. This work is incremental and does **not** restart a new P4 recovery engine.

## Real gaps fixed

1. `clearNativeArtifactDraft` previously ignored the native store's `{ removed: false }` result. If another editor replaced the encrypted checkpoint, Discard falsely displayed success and unblocked the current editor, even though the updated file was **still on disk**.
2. Two concurrent windows editing the **same** immutable P4 base version shared `baseVersion + contentHash`. The old OS-protected file store could silently overwrite another window's new unsaved contents, and the old cleanup API could remove a newer writer's file despite both drafts sharing that same saved base.
3. The stored checkpoint now has a native-generated `checkpointId` (random UUID per encrypted write). Native **write** requires compare-and-swap against that actual prior generation when a file exists; a second writer without the generation is refused. Native **clear** also requires the exact ID of a modern checkpoint, including for automatic cleanup after successful P4 save. Legacy already-encrypted files without an ID remain readable; their cleanup is matched by their saved baseline only.
4. The renderer records the generation returned by its own successful OS-protected write, or the ID of an explicitly recovered snapshot, and supplies it on subsequent writes and cleanup. Reads and destructive actions remain authorized by the original fresh server-side session MAC. A conflict does **not** elevate the candidate, discard the local draft, mutate P4 or invent source rights: the user must reopen/retry and explicitly review which encrypted snapshot remains.
5. Discard now checks the native removal acknowledgment. A false result or exception switches into a blocked error state with an actionable **Retry protected recovery** and truthful saved-Artifact-unchanged message. Continue without crash recovery remains an explicit user-controlled opt-out, not a silent loss.
6. Expanded the original `desktopArtifactDraftRecovery.test.cjs` executable negative cases: real encrypted native checkpoint write/read, no plaintext leakage, wrong-owner isolation, failed wrong-key read, older-version cleanup failure, **same-version two-window write/clear collisions**, and exact-generation successful deletion. Extended the real authenticated `nativeDraftGrantRoutes.test.ts` to verify a trashed P4 Artifact or its owning Chat no longer issues the required grant, and explicit owner restore only restores its own permission. New `ws42RecoveryCustody.test.ts` asserts real UI wiring and current P4 identity boundaries.

## Tests (from `src/`)

```sh
node --test desktopArtifactDraftRecovery.test.cjs nativeDraftGrant.test.cjs
node --import tsx --test server/nativeDraftGrantRoutes.test.ts client/src/lib/ws42RecoveryCustody.test.ts
npm run check
npm run test:p4
npm run test:ux
npm run acceptance:ux
```

**Qualification:** Tests are committed, but until observed, do **not** label them passed. Exact-head hosted Linux/macOS/Windows TypeScript/source gates; signed-in packaged Windows/macOS crash, edit in two windows, OS keychain unavailable/locked, revocation after P4/Chat trash, stale version/conflict, source provider rights drift, 320px+200% zoom screen reader, new/old installed package interoperability, independent review, SP/P14 approval and merge to protected `main` remain pending. The native encrypted checkpoint is an intentionally best-effort recovery copy: a crash during the 250ms write debounce can lose the latest keystrokes, so canonical P4 Save remains explicit and authoritative.

**Merge:** Stacked on #98, coordinate #102 native recovery ownership and sister #171/#172/#173/#175 Artifact editing/version conflict workstreams. Rebase, run cross-stack tests and review before merging. No simulated test pass or claim of installed package validation.
