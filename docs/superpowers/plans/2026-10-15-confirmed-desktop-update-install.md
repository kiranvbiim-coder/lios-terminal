# SI-07.10 — Confirmed Desktop Update Install / Restart

## Scope

This tranche adds explicit user confirmation before a downloaded LiOS desktop application update can restart and install. It extends the existing `src/desktopUpdater.cjs` authority from PR #40; it does not create a second updater, installer, release feed, signer, renderer IPC channel, or rollback subsystem.

## Canonical owners reused

- `src/desktopUpdater.cjs` — packaged desktop update runtime policy and main-process consent boundary.
- `electron-updater` — update check, download, signature/integrity handling and `quitAndInstall(...)`.
- electron-builder packaged `app-update.yml` — runtime update-feed authority established by PR #40.
- `src/main.cjs` — existing Electron main process; no new renderer update authority is added.

## Consent boundary

The updater continues to download an eligible signed release automatically, but `autoInstallOnAppQuit` is disabled. A normal application quit therefore cannot silently install the downloaded update.

After `update-downloaded`, `desktopUpdater.cjs` requests explicit confirmation. Production confirmation is a native Electron `dialog.showMessageBox(...)` created from the trusted main process. No install/restart method is exposed through `preload.cjs`, renderer JavaScript, HTTP routes, or local IPC.

The prompt uses:

- `Later` as button 0, default action and cancel action;
- `Restart and install` as the explicit affirmative action;
- only the already-bounded update version in user-visible copy;
- no release-note HTML, provider error, URL, credential, query string, or other external text.

Only response `1` authorizes installation.

## Installation behavior

When the user explicitly confirms, the existing updater calls:

`quitAndInstall(false, true)`

This matches the project's installed electron-updater 6.x / electron-builder 26.x API: non-silent installer, then force-run LiOS after installation.

When the user chooses `Later`, the downloaded update remains uninstalled and the current application continues running. Automatic install-on-normal-quit remains disabled.

## Concurrency and failure policy

Only one confirmation may be active at a time. Duplicate `update-downloaded` events while a prompt is pending do not create additional prompts or repeated install calls.

Confirmation errors fail closed. Raw prompt/provider/network error text is not logged; the updater emits stable generic diagnostic messages instead. A failed or unavailable confirmation never calls `quitAndInstall(...)`.

## TDD evidence

RED was observed against the PR #40 updater because `autoInstallOnAppQuit` was still `true` and no confirmation path existed.

Focused GREEN coverage in `src/desktopUpdater.test.cjs` now locks:

1. packaged update feed authority remains embedded-only;
2. automatic download remains enabled;
3. automatic install-on-quit is disabled;
4. prerelease updates and downgrades remain disabled;
5. confirmed download calls `quitAndInstall(false, true)` exactly once;
6. decline does not install;
7. prompt failure fails closed without raw diagnostic leakage;
8. duplicate download events cannot create concurrent prompts;
9. updater/network errors remain sanitized;
10. production owns a native main-process prompt with `Later` as default/cancel.

## Truth boundary

This tranche proves the source-level consent and installation policy. It does **not** prove that a signed/notarized production artifact successfully downloads, restarts, installs, recovers, or rolls back on every target machine.

Cross-platform previous-version desktop rollback is still not implemented or claimed. Native packaged update/restart/recovery evidence remains an SP-07/P14 qualification requirement.

## Dependency / merge order

PR #29 → PR #35 → PR #38 → PR #40 → confirmed desktop update install/restart.

Because this work is stacked, any parent-head change requires reconciliation and exact-head revalidation before merge.
