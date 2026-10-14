# LiOS V4 release readiness

> **Current deployment contract:** Desktop Local / LiOS Home owns `/api/auth/*`, local trial or imported vendor-signed licence verification, and one auth stack/web bundle. No vendor customer runtime, billing provider, control-plane URL or separate client-terminal build is required.

> **Authority:** `AGENTS.md`, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` and `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` govern SI-01–SI-07 and SP-01–SP-07. S0–S10 are validation journeys; CP phases and `V4-*`/`LV4-*` evidence IDs are historical/frozen. Existing GM/TC/CA/P owners remain singular. P7/P10 support qualification and P14 remains final release authority.

## P3 production control-plane controls

Historical heading retained for links; operative controls below concern distribution and user-owned operations, not a vendor control plane.

- Public distribution metadata may describe signed downloads/update feeds; distribution is not a customer intelligence/runtime service.
- Home owns local trial and signed licence verification independently of workspace ownership; billing redirects and provider-backed pricing are not runtime or release prerequisites.
- Retention, deletion, legal hold and export integrity belong to the actual user-owned deployment. No central custody of customer export bytes or mandatory vendor receipt service is required.
- Remote diagnostics remain explicitly opt-in, bounded/redacted and free of raw content/full stacks.
- Optional user-owned operations notifications use deployment-controlled recipients/transport.
- Apply the current user-owned portions of `docs/technical/LIOS_V4_P3_RUNBOOK.md`; its dated hosted evidence is not deployment instruction.

## Local release controls

- Product/channel metadata is explicit and stable/beta channels are separate.
- Signed desktop builds now require a platform-built self-contained Python sidecar; the packaged app no longer relies on a customer-installed Python interpreter for deterministic analytics.
- Packaged customer builds expose a headless `--desktop-self-test` that verifies native secret protection, backend packaging, bundled Python health, updater metadata, and workspace backup/restore recovery.
- macOS and Windows production workflows run the packaged self-test before publication and then hand the published installer to a second clean GitHub-hosted machine for install acceptance.
- macOS production builds use approved self-hosted macOS arm64 infrastructure; clean install uses hosted `macos-15`. Windows release and separate clean install use `windows-latest`. Neither source Linux gate nor an unsigned preview qualifies these targets.
- Preserve strict deep codesign before/after installed self-test and real Python diagnostics, unchanged Python source/cache posture, notarization/stapling/Gatekeeper and no post-launch ad-hoc re-signing. Windows requires valid installer and bundled/installed sidecar Authenticode signatures.
- CI preflight validates runtime support, migration packaging, and signing
  configuration shape without pretending that a key exists.
- Desktop updates require an explicit HTTPS feed, disallow downgrade, and
  install only after a signed update is downloaded.
- Workspace and migration backups are manifest-hashed and restored through a
  staged commit/rollback path.
- Privacy/security/support docs and the rollback plan are versioned in the
  repository. Release-specific notes must be attached to the exact release
  record; no repository changelog is currently maintained.

## Required external evidence before public sign-off

1. Windows signing certificate and signed installer.
2. macOS Developer ID signing, hardened runtime, and notarization ticket.
3. Explicit public HTTPS signed update feed, separate stable/beta artifacts, and real N→N+1 migration plus failed-update rollback/recovery using two signed versions on each public target.
4. Independent macOS arm64 and Windows x64 native secrets, install/pack lifecycle/restore/recovery, VoiceOver/Narrator/keyboard, interactive performance, privacy/security and exact-release rights evidence; website billing deployment is not a prerequisite.
5. Exact-tag/version P7/P14 qualification evidence, real packaged flagship and release-owner approval.

Until those artifacts exist, the readiness API reports a partial release and
the board remains explicit about the remaining gates.

SP-01–SP-07 additionally require real Minimum Shippable Journeys, applicable packaged/target execution, explicit unavailable/denied/error states, accepted-journey regression protection and exact commit/build/tag, environment/topology, checks/outcomes, permissions/provenance/numerical evidence, limitations and truth level. No SP acceptance is inferred here; GM-11 authority must precede privileged interactive `exec.*`.

Recorded source passes and audit snapshots are not fresh scans, independent review or interactive performance measurements. Self-test ceilings (20 s ready, 60 s whole test, 1 GiB main RSS, 512 MiB heap) prove only bounded self-test safety. Current audit flags visual-count disagreement and shared generic evidence/checksum publication names as unexecuted release-path risks; documentation reconciliation does not repair or prove these workflows.
