# SI-07.10 — Governed Desktop Application Updates

## Scope

This tranche hardens the existing desktop application update path. It does not create a second updater, installer, signer, release feed authority, Doctor path, or rollback subsystem.

Canonical owners reused:

- `src/desktopUpdater.cjs` — packaged desktop update runtime policy.
- `electron-updater` — packaged update check/download/install mechanism.
- electron-builder `publish` metadata — build-time source for packaged `app-update.yml`.
- `src/script/desktop_build.cjs` — signed desktop distribution build owner.
- `src/script/release_preflight.ts` — release signing, notarization, update-feed and production-preflight authority.

## Runtime trust boundary

A signed distribution build embeds its selected generic update provider into packaged `app-update.yml`. Once the application is installed, runtime process environment is not permitted to replace that packaged feed through `LIOS_UPDATE_URL`.

`LIOS_UPDATE_URL` remains a build/release-time input to electron-builder and release preflight. `desktopUpdater.cjs` ignores any runtime value rather than calling `setFeedURL()`.

The runtime updater explicitly locks:

- automatic download enabled;
- stable-channel behavior with `allowPrerelease = false`;
- downgrade refusal with `allowDowngrade = false`;
- packaged `app-update.yml` as the sole runtime feed authority.

## Install continuity

`autoInstallOnAppQuit` intentionally remains enabled in this bounded tranche. `main.cjs` currently consumes only the updater status and does not retain a trusted controller/UI surface that can ask the user to confirm and invoke `quitAndInstall()`.

Disabling install-on-quit here would create a broken state in which updates download but users have no supported way to install them. Explicit confirmation before install/restart therefore belongs to a separate SI-07.10 tranche that wires the existing updater through trusted desktop IPC/native UI without creating another updater authority.

## Privacy and diagnostics

Updater/network/provider error objects are external diagnostic input and may contain URLs, credentials, query strings or provider details. Runtime updater logs therefore emit stable generic failure messages and never interpolate the raw error or message.

Version strings and progress values used in success/status logging are bounded before interpolation.

## Signing and release integrity

This tranche reuses the existing distribution gates rather than duplicating them:

- macOS distribution builds force code signing and notarization;
- Windows distribution builds force code signing;
- desktop release preflight requires HTTPS update hosting and target-platform signing evidence;
- the packaged updater continues to rely on the integrity/signature behavior of the installed electron-builder/electron-updater stack.

The current project uses electron-builder 26.x / electron-updater 6.x. This tranche does **not** claim a newer signed-update-manifest mechanism that is not established by the installed toolchain. Any migration to a newer signed-manifest protocol must be its own evidenced release-toolchain change.

## Rollback truth boundary

There is no proven cross-platform previous-application-version rollback authority in the current desktop updater path. This tranche therefore makes no automatic desktop rollback claim.

A bad released desktop version must be recovered through a separately qualified correction/reinstall/rollback mechanism. Runtime managed-Python rollback remains owned by the separate managed-runtime upgrade workstream and must not be conflated with desktop application rollback.

## Tests

`src/desktopUpdater.test.cjs` locks the following source-level contracts:

1. unpackaged development does not enable desktop updates;
2. packaged applications use embedded `app-update.yml` authority;
3. runtime `LIOS_UPDATE_URL` cannot replace the packaged feed;
4. prerelease updates and downgrades are explicitly disabled;
5. current install-on-normal-quit continuity remains available;
6. raw external updater errors are never logged.

## Deferred follow-ons

Separate bounded work remains for:

- trusted UI/IPC confirmation before install and restart;
- native packaged signed-update journeys on macOS and Windows;
- any migration to newer signed update-manifest tooling;
- a real desktop previous-version rollback/recovery mechanism;
- stricter centralized build-time update-feed network policy if required beyond the existing HTTPS/local-reserved-host release preflight.

## Acceptance boundary

Hosted source CI may prove source contracts, syntax, typecheck and build integration. It does not prove a signed/notarized production update can be downloaded, installed, restarted, recovered or rolled back on a customer machine. Those remain SP-07/P14 packaged-target evidence requirements.
