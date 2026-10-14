# LiOS V4 — P2 Accessibility & Keyboard Acceptance Runbook

> **Authority:** `AGENTS.md`, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` and `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` govern SI-01–SI-07 and SP-01–SP-07. S0–S10 are validation journeys; CP phases are historical. P7/P10 support qualification and P14 remains final release authority. GM/TC/CA/P owners remain singular; `V4-*`/`LV4-*` are frozen legacy evidence IDs, not new task numbering.

This runbook captures the target-platform evidence that source tests cannot honestly provide. Run it against the exact signed release artifact being qualified.

## Evidence rules

For each platform record:
- release tag and commit SHA;
- installer filename + SHA-256;
- OS version and architecture;
- assistive technology used;
- test start/end time;
- pass/fail for every row below;
- screenshots or short screen recordings for any failure;
- defect/issue reference for every failure.

Do not mark the P2 accessibility row verified from source code, browser-only testing, or an unsigned development build.

Qualify macOS arm64 and Windows x64 independently on the single LiOS Home runtime, local trial/signed licence and mandatory signed managed Python sidecar baseline. Do not require a vendor URL, billing flow or second client auth/bundle. Additional runtime architectures do not inherit public qualification.

For SP acceptance, this walkthrough contributes a real MSJ but does not replace the five mandatory gates: real journey, target execution, no fake success, regression protection and exact evidence. Record package version, target/topology, journey, source-artifact hashes, limitations and truth level alongside the fields above. No accepted SP status is inferred from a timestamp or source accessibility pass.

## macOS — VoiceOver + keyboard

Target: signed/notarized Apple Silicon customer application installed from the qualified DMG.

- [ ] Launch from Finder without Terminal/developer environment.
- [ ] VoiceOver announces the LiOS application/window meaningfully.
- [ ] Tab/Shift+Tab exposes visible focus throughout the primary terminal chrome.
- [ ] Open Omnibox by keyboard and verify VoiceOver announces it as a dialog.
- [ ] Type a query, move through results using keyboard, activate one result, close the dialog without pointer input.
- [ ] Traverse terminal tabs; current/linked toggle state is announced where applicable.
- [ ] Traverse workspace pane controls; Close/Maximize/Restore actions are announced with meaningful names.
- [ ] Traverse the active-object analysis dock; icon-only controls have useful spoken names.
- [ ] Open the keyboard map and close it without pointer input.
- [ ] Verify no keyboard trap in overlays, menus, workspace panes, or dialogs.
- [ ] Verify visible focus remains perceivable in the terminal theme.
- [ ] Enable Reduce Motion in macOS and confirm major terminal animation is suppressed/reduced.
- [ ] Verify critical error/startup dialogs are announced and actionable by keyboard.
- [ ] Complete one representative research/analysis workflow with keyboard + VoiceOver only.

When complete, record the evidence timestamp in the release/deployment environment as `LIOS_P2_MAC_ACCESSIBILITY_EVIDENCE_AT`.

## Windows — Narrator + keyboard

Target: Authenticode-signed x64 customer application installed from the qualified installer.

- [ ] Launch from Start menu without PowerShell/developer environment.
- [ ] Narrator announces the LiOS application/window meaningfully.
- [ ] Tab/Shift+Tab exposes visible focus throughout the primary terminal chrome.
- [ ] Open Omnibox by keyboard and verify Narrator announces it as a dialog.
- [ ] Type a query, move through results using keyboard, activate one result, close the dialog without pointer input.
- [ ] Traverse terminal tabs; current/linked toggle state is announced where applicable.
- [ ] Traverse workspace pane controls; Close/Maximize/Restore actions are announced with meaningful names.
- [ ] Traverse the active-object analysis dock; icon-only controls have useful spoken names.
- [ ] Open the keyboard map and close it without pointer input.
- [ ] Verify no keyboard trap in overlays, menus, workspace panes, or dialogs.
- [ ] Verify visible focus remains perceivable in the terminal theme.
- [ ] Enable Windows animation reduction and confirm major terminal animation is suppressed/reduced.
- [ ] Verify critical error/startup dialogs are announced and actionable by keyboard.
- [ ] Complete one representative research/analysis workflow with keyboard + Narrator only.

When complete, record the evidence timestamp in the release/deployment environment as `LIOS_P2_WINDOWS_ACCESSIBILITY_EVIDENCE_AT`.

## Source/CI baseline

The automated `npm run acceptance:accessibility` contract protects only the minimum source baseline:
- focus-visible treatment for buttons and form controls;
- reduced-motion media handling;
- Omnibox dialog semantics and keyboard handler;
- ARIA names on core dock/workspace/tab/shortcut controls;
- exposed pressed/toggle state where used.

Passing that contract is necessary but not sufficient for the platform rows above.
