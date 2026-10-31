# Packaged Flagship Release Acceptance

This is the release proof for **LIOS-P14-12** and the Product Hardening flagship journey. It is intentionally stricter than service smoke, source acceptance, visual smoke, or a mocked browser fixture.

A release is not flagship-qualified until the **exact client release candidate** completes the required user journey on both supported desktop platforms and the resulting report passes `npm run acceptance:flagship:packaged`.

This journey contributes to `SI-07 / SP-07` under the [Shipping Point contract](SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md); P14 remains final release authority. Earlier `SP-01`–`SP-06` require their own bounded Minimum Shippable Journeys (MSJs), not a wait for this final flagship. `S0`–`S10` provide validation coverage only.

For every SP, require a real user journey, packaged/target execution where applicable, no fake success, regression protection and exact evidence. For SP-07, the release owner defines the MSJ including cross-capability output, automation/device continuation and backup/restore as required by that contract. The 19-checkpoint desktop flagship below is required P14-12 proof, not proof by itself of every SP-07 obligation or all 14 P14 categories. Accepted earlier journeys must remain protected; a regression requires reproduction, a canonical repair owner and evidence before acceptance can be retained.

## Required inputs

Use:

- the exact signed release tag;
- the exact client package produced for that tag;
- a clean LiOS profile on each platform;
- a real user-controlled AI provider credential;
- a real user-controlled data source/entitlement used by the chosen finance workflow;
- no fixture/mock market or financial observations.

Never place API keys, OAuth tokens, passwords, cookies, raw credential values, or private dataset contents in the report, screenshots, logs, issue comments, or release assets.

## Required journey on macOS and Windows

Perform the same product-level sequence on each platform:

1. Verify installer/package signature; macOS must also verify notarization/Gatekeeper.
2. Launch with a clean profile.
3. Sign in through the normal product flow.
4. Create or open a Project.
5. Add a real BYOAI credential through LiOS credential custody.
6. Verify the selected provider/model from the product.
7. Authorize a real user-controlled data source.
8. Ask a serious finance question in Project Chat.
9. Confirm deterministic LiOS computation/data execution occurred.
10. Confirm AI synthesis used only the approved provider/model and transmission policy.
11. Inspect execution receipt and provenance/methodology.
12. Keep the result as an Artifact.
13. Make a reviewable Artifact change and apply the revision.
14. Export a supported real file and open it outside LiOS.
15. Quit LiOS normally.
16. Relaunch the same packaged build/profile.
17. Reopen the Project, Chat and Artifact and verify continuity.
18. Revoke the exercised connector or provider permission.
19. Retry the affected access and confirm LiOS fails closed or requests renewed authorization instead of using stale private access.

A developer editing local state, bypassing UI authorization, injecting a fixture, manually repairing the database, or substituting a service-only request invalidates the run.

## Evidence

For each platform retain at least three sanitized, hashed references such as:

- screen recording or timestamped screenshots covering the normal UI journey;
- sanitized execution/provenance trace showing deterministic and AI attribution;
- exported artifact file;
- provider/connector verification receipt with secrets removed;
- relaunch continuity capture;
- revocation/fail-closed capture.

The report itself stores hashes and labels only. Sensitive source material stays outside the release asset unless it is safe and intentionally included.

Record the exact commit/build/release, OS/architecture and topology, MSJ exercised, checks and outcomes, packaged proof, permission/provenance/numerical evidence, limitations, truth level and remaining gaps/next dependency. Preserve per-platform installer, checksum, sidecar and native self-test evidence for that same release. Both signed workflows currently publish shared raw evidence names with `--clobber`; the source-derived overwrite risk is unmeasured and unfixed by this report. The release owner must resolve publication integrity with the P10 packaging owner and show both platform consumers receive their own exact evidence; see [P14 unresolved release-path evidence gaps](P14_DESKTOP_LAUNCH_QUALIFICATION.md#unresolved-release-path-evidence-gaps).

## Produce the release report

Start from:

`docs/technical/flagship-release-report.template.json`

Fill every field from observed product behavior. Do not mark a checkpoint true based only on source code or unit tests.

The final release asset must be named:

`flagship-release-report.json`

## Validate and bind to P14 evidence

From `src/`:

```bash
RELEASE_TAG=v1.0.0 \
LIOS_FLAGSHIP_RELEASE_REPORT=../flagship-release-report.json \
npm run acceptance:flagship:packaged -- --write-p14=p14-flagship-evidence.json
```

This executable example uses the current package version, `1.0.0`. Replace `v1.0.0` with the exact identified release tag if different.

The validator rejects:

- missing macOS or Windows proof;
- unsigned or non-client builds;
- macOS proof without notarization;
- service-only execution;
- mocked/fixture-backed financial data;
- developer-assisted completion;
- missing native secret custody;
- missing real BYOAI or BYOD;
- missing deterministic or AI execution;
- missing provenance/receipt inspection;
- missing Artifact revision/export;
- missing relaunch continuity;
- missing revocation fail-closed behavior;
- release tag/package/commit mismatches.

The generated `p14-flagship-evidence.json` hashes the validated flagship report. Upload **both** files to the exact GitHub release.

Final P14 certification downloads both assets, re-validates the report, verifies that the P14 flagship evidence is cryptographically bound to that report, and only then evaluates the qualification board.

## What does not count

The following are useful but insufficient by themselves:

- `npm run acceptance:flagship:live`;
- `npm run acceptance:flagship:live-service`;
- unit/contract tests;
- visual-smoke screenshots;
- a developer-run API request;
- mocked credentials or providers;
- screenshots without the structured report and hashes.

Those tests remain prerequisites and diagnostics. The packaged flagship report is the P14-12 release proof. Record `shipping point accepted` only when all applicable SP gates and evidence exist; a report template, source/service PASS or generated P14 record does not infer SP acceptance or `release proven`.
