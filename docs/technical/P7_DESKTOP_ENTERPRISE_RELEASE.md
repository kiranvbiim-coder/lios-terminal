# Active P7 — World-Class Desktop Hardening & Enterprise Release

## Purpose

“Active P7” names the existing convergence/readiness contract from the historical seven-phase program; it is not the final phase of the current execution program. [SI-01–SI-07](../LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md) is the active program. P7 composes existing P10/P14 release capabilities and enterprise/security stacks without duplicating them; P14 remains final release authority.

The central rule is:

```text
engineering complete ≠ release certified
```

LiOS may be engineering-complete when every source-controlled security, identity, device/session, offline, performance, accessibility, packaging/recovery and release-rights gate is implemented and green. It becomes release-certified only when the exact release candidate also carries the required real-world evidence.

## Authority boundaries

Active P7 composes existing authorities:

- P1 identity/session/device/entitlement/offline contracts remain the access authority.
- Enterprise policy + SSO + deployment services remain the enterprise authority.
- Security Acceptance remains the repository/security-control authority.
- Desktop Acceptance remains the signed-package/native-platform evidence authority.
- P10 remains the production hardening/runtime/release-capability baseline.
- P14 remains the typed clean-machine and final release-evidence authority.
- Electron updater, backup/restore, safeStorage, Python sidecar and release workflows remain the packaging/recovery authorities.

P7 adds a typed convergence/readiness contract and consumes final certification evidence under P14. It adds no second identity stack, updater, release pipeline, backup system, scheduler or release-evidence format.

The [Shipping Point contract](SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md) requires `SP-01`–`SP-07` progressively under SI. Each Minimum Shippable Journey (MSJ) requires real user execution, packaged/target execution where applicable, no fake success, regression protection and an exact evidence record. Record commit/build/release, target/topology, MSJ, checks/outcomes, phase-appropriate permissions/provenance/numerical evidence, limitations, truth level and gaps/next dependency. `SP-07` release-candidate proof does not replace P14; `S0`–`S10` are validation journeys and CP phases are historical maturity references. Neither P7 source readiness nor a generated category infers any accepted SP.

## Engineering-owned completion

Engineering completion requires:

1. Enterprise OIDC/SAML runtime and one-time desktop device handoff.
2. Device authorization, session revocation/restoration and ownership boundaries.
3. Signed, device-bound, feature-scoped offline entitlement policy.
4. Local security/privacy/tenant/SSRF/upload/redaction/dependency controls.
5. Explicit desktop/professional performance budgets and tests.
6. Keyboard/focus/reduced-motion/semantic accessibility source contracts.
7. Workspace backup/restore and signed release workflow contracts.
8. Supply-chain, license, OSS and release-rights audit gates.
9. One active P7 API/UI surface that reports engineering readiness separately from external evidence.
10. Active P7 source acceptance wired into the authoritative Quality Gate.

The authoritative `.github/workflows/lios-hardening.yml` Quality Gate defaults to the owner's `[self-hosted, Linux, lios-docker]` runner. Manual alternatives select `ubuntu-latest` or `[self-hosted, macOS]`; there is no implicit hosted fallback. Linux source acceptance does not certify native macOS/Windows behavior. Signing, cross-platform packaging and final certification remain deliberate manual qualification.

## External / release-owner evidence

The following must remain external until they actually exist for the exact release candidate:

- macOS Developer ID signing, notarization, Gatekeeper/stapling;
- Windows Authenticode signing;
- bundled sidecar/native secret-custody packaged probes;
- clean-machine macOS and Windows install/self-tests;
- previous→current update, failed-update rollback and workspace recovery;
- packaged performance evidence;
- VoiceOver, Narrator and keyboard-only packaged walkthroughs;
- production privacy/security evidence and independent security review;
- exact release-rights evidence;
- first-use and flagship journey evidence.

The macOS production workflow automatically generates P14 `security_privacy` and `release_rights` records from its own preflight, audits, native self-test and signed artifact evidence. Those records do not establish independent security review, all-platform human privacy proof or Windows security/rights qualification. The release owner must retain the independent and per-platform evidence required above, beyond typed-category accounting.

P10 also records unresolved source/configuration defects: 15-case UX capture versus production 9-PNG and validator 13-case requirements, shared raw release assets uploaded with `--clobber`, and no analogous Windows P10 visual/release-mode validator. These are source-derived gaps, not measured failures or documentation fixes. The P10 packaging/workflow owner must reconcile counts and publication integrity with exact per-platform execution evidence; the release owner must provide Windows rendered/manual qualification. Bare `self-hosted` preview scheduling is also unqualified, and unsigned previews never count as signed-release proof. See [P14 release-path gaps](P14_DESKTOP_LAUNCH_QUALIFICATION.md#unresolved-release-path-evidence-gaps).

Tenant IdP and private-cloud verification are customer/deployment-specific. They are exposed as Enterprise Governance readiness, but they do not pretend to be generic package certification.

## Final certification

`npm run acceptance:p7` validates the source-controlled engineering readiness contract; its pass does not establish every external/native control or a current independent security result.

`npm run acceptance:p7:release` is release-mode certification. It requires the complete typed P14 evidence bundle for one exact release tag/version and is invoked by the final release-certification workflow after the evidence assets are downloaded.

The Operational Readiness surface displays:

- **ENGINEERING COMPLETE / BLOCKED**
- **RELEASE CERTIFIED / EVIDENCE REQUIRED**
- engineering-owned checks;
- release-owner evidence gates;
- tenant/deployment-owned gates.

This allows LiOS to say exactly what is complete without fabricating external proof.
