# WS-33 — Research history, notes and pinning (2026-10-24)

**Canonical owner:** [PR #110](https://github.com/kiranvbiim-coder/lios-terminal/pull/110) · [TC/UX plan #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119) · [master #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

## Code audit and why no duplicate PR

Existing `ResearchTray.tsx` in #110 already implements device-local research history, pinned analysis, labelled search, new-note Save/Cancel, explicit editing of notes/tags/groups, inline confirm to remove a pin, and a separate confirmation before clearing history. It reuses the established `terminalResearchTray` / `terminalResearchThread` storage and `onOpen(view, current|tab|split-right)` actions. Earlier *original-head* GitHub source CI had passed on macOS, Linux and Windows. This increment changes that exact owner PR, not a new tray, P7 research database or persisted Artifact authority.

## Remaining gaps found in code

- `saveResearchTray` already used `.filter` before sorting (so caller-array mutation was not observed); the defensive clone and regression make that invariant explicit. The actual gap was a silent no-op when `window` was unavailable. A blocked `localStorage.setItem` must never publish a false saved state or modify the input.
- Device-local `storage` changes from a second tab were not observed: edits and deletions appeared stale until a refresh. Malformed events must not empty the live view.
- Pinning a *new* context at the `MAX_ITEMS=120` cap silently evicted an earlier pin because `pinResearchContext` slices to the cap. New-note saves could similarly exceed the cap and be truncated without user consent.
- When a second tab changes an annotation while the first tab's edit form is open, Save must not blindly overwrite it. A rejected write must retain the person's draft. Errors and successes should use appropriate distinct accessibility announcements.

## Changes on the existing #110 branch

1. The existing device-local research tray/history helpers now accept `storage` events for their **own keys only**, preserve their same-window subscription events, and ignore corrupted external JSON. They detach listeners on unmount; `StorageEvent.key === null` reloads the current key after a broad local-storage clear.
2. Pinned-item writes clone before sorting, publish only after successful local storage writes, and throw when storage is absent. Research history has the same explicit unavailable-storage behavior. No raw sensitive data is added to the wire.
3. The Research Tray prevents adding an item when doing so would silently evict an older pin at 120 items, and blocks any over-limit new-note array while keeping the draft in place. Existing pin updates remain permitted and do not consume a second slot.
4. Annotation editing snapshots the original item; at Save it compares original ID, timestamp, title, note, group and tags against current subscribed data. Concurrent edits are **not overwritten**, the unsaved draft stays visible, and the user is told to cancel/reopen to inspect the newer version. If another tab actually removes the edited item, a separate visible alert preserves the draft and offers to stage it as a **new note for explicit Save**, rather than silently dropping the user’s text. Obsolete selected group filters automatically reset when the group disappears in a second tab.
5. Save failures, history-write failures and capacity/conflict errors are announced with `role=alert`; successful operations use `role=status`. Remove pin and clear-history operations retain their separate inline confirmation and cancellation.

## Tests

Commands from `src/`:

```sh
node --import tsx --test client/src/lib/researchTrayStorage.test.ts client/src/lib/terminalResearchTray.test.ts client/src/lib/terminalResearchThread.test.ts client/src/components/terminal/researchTrayUxContract.test.ts
npm run check
npm run test:ux
npm run acceptance:ux
```

New storage regressions simulate blocked/quota `localStorage` writes, absence of false success notifications, no caller array mutation, cross-tab updates, corrupt external storage payloads, unsubscribe behavior, cleared history independent of pinned items and explicit bounded capacity. Updated existing UX contract assertions cover draft conflict checks, explicit save and error announcement. These are **authored tests** until exact-head CI completes; earlier green CI does not certify these commits.

## Shipping/rights limitations

- **Not a cloud account research-history sync**: research tray/thread are browser/Electron localStorage. They can be lost when local app data is cleared; user should not assume cloud backup, cross-device sync, tenant-strong confidentiality or regulated data retention from this work.
- Cross-tab storage event synchronization is best-effort; no transactional multi-window compare-and-swap or cloud conflict resolution is claimed. Browser storage must still be available for new writes.
- No new server database, source-rights grants, agent research continuation, P4 Artifact storage, external provider calls or background sync. No automatically inferred research insights.
- **Before merging:** updated-head Windows/macOS/Linux hosted typecheck and tests, keyboard/screen-reader live note/edit/focus/confirmation/failed-quota checks, 320–1440px and 200% zoom, native installed Mac/Windows smoke, independent review and P14 shipping acceptance are pending.
