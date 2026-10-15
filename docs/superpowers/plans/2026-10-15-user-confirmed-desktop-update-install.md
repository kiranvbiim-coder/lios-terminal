# SI-07.10 — User-confirmed Desktop Update Install

## Scope

This tranche completes the explicit install-confirmation boundary for the existing packaged desktop updater. It reuses `src/desktopUpdater.cjs`, `electron-updater`, the packaged `app-update.yml` feed authority and the existing signed distribution path. It does not create another updater, release feed, signer, installer or rollback subsystem.

## Trust decision

A downloaded desktop update must not install merely because the user quits LiOS. `autoInstallOnAppQuit` is therefore disabled once the explicit-confirmation path exists.

The confirmation UI is owned by the Electron main process through a native `dialog.showMessageBox()` prompt. Renderer code never receives direct access to `quitAndInstall()`. This intentionally avoids adding a new renderer IPC capability when native main-process UI is sufficient for the required confirmation boundary.

The native prompt offers:

- **Later** — keep LiOS running and do not install on ordinary quit;
- **Install and restart** — call the existing updater's `quitAndInstall(false, true)` exactly after approval.

## Safety properties

- packaged `app-update.yml` remains the sole runtime feed authority;
- prerelease updates and downgrades remain disabled;
- automatic download remains enabled;
- ordinary quit cannot bypass user approval;
- only bounded version text reaches confirmation/logging;
- raw updater, provider, network and dialog error text is not logged;
- duplicate/in-flight install confirmation is guarded;
- a thrown install request resets the controller rather than claiming success.

## TDD evidence

RED was observed for each new behavior before implementation:

1. the existing updater still had `autoInstallOnAppQuit = true`;
2. no explicit-confirmation install controller existed;
3. no downloaded-update handler existed;
4. approval/decline did not control `quitAndInstall()`;
5. the canonical `update-downloaded` event did not route through confirmation.

The focused updater suite is locally GREEN **8/8** after implementation.

## Acceptance boundary

Hosted source validation can prove the updater contracts, syntax and build integration. It does not prove a signed/notarized production update can be downloaded, installed and restarted on a customer macOS or Windows machine. Native packaged update journeys remain SP-07/P14 evidence work.

## Dependency / merge order

PR #29 → PR #35 → PR #38 → PR #40 → this tranche.
