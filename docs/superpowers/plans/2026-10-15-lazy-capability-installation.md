# SI-07.09 — Governed Lazy Capability Installation

## Goal

Add missing managed-runtime capability packs only when a user invokes a capability, without creating a second installer, capability registry, package resolver, or Doctor path.

## Existing authorities reused

- `P10_RUNTIME_PACKS` remains the canonical product capability-to-runtime-pack catalog.
- `MANAGED_RUNTIME_MANIFEST` remains the low-level signed/allow-listed Python package source.
- `installManagedRuntime()` remains the only managed Python runtime installer.
- Strict provisioning authority remains the only permitted lazy-install execution path.
- Doctor/repair execution remains separately owned and is not changed by this tranche.

## Behaviour

1. Resolve a requested product capability through the canonical P10 runtime-pack catalog.
2. If the capability is unknown, do not synthesize package names or install anything.
3. If all required low-level managed packs are already present, return a no-op result.
4. If the pack is classified as heavyweight, return `consent_required` unless explicit user consent is present.
5. If the pack is externally supplied (currently Local AI), never silently download a model/runtime; return `external_setup_required`.
6. For an approved install, union the required managed pack IDs with the currently installed pack IDs so an incremental request cannot drop prior capabilities.
7. Preserve existing release-pack metadata.
8. Delegate installation to `installManagedRuntime()` while forcing `isolationMode: "strict"`; a missing governed provisioning authority therefore fails closed before any host `pip`/`venv` fallback can occur.
9. Inherit the existing managed-runtime staging, verification, activation, and rollback behaviour rather than reimplementing it.

## Canonical lazy-install policy

The policy is stored on the existing P10 pack definitions rather than in a new registry:

- `core`: `automatic`
- `research`: `explicit-consent`
- `quant`: `explicit-consent`
- `modeling`: `explicit-consent`
- `data-lab`: `explicit-consent`
- `local-ai`: `external`

The optional non-core packs currently carry meaningful package/runtime footprint or user-controlled setup, so none may be silently expanded beyond Core.

## Security invariants

- No arbitrary package-name installation.
- No host `pip` fallback from lazy installation.
- No caller-controlled downgrade from strict provisioning to legacy-host provisioning.
- No Local AI model download by LiOS.
- No removal of already selected low-level managed packs during an incremental install.
- No duplicate Doctor repair implementation.

## Tests

`lazyCapabilityInstaller.test.ts` covers:

- already-available no-op;
- heavyweight consent gate;
- preservation of prior low-level packs and release metadata;
- forwarding of the governed provisioning authority;
- forced strict provisioning even when a caller requests legacy-host mode;
- Local AI external-setup behaviour;
- unknown-capability fail-closed behaviour.

`p10RuntimePacks.test.ts` locks the lazy-install policies to the existing canonical pack catalog.

## Integration boundary

This tranche provides the server-side orchestration primitive. Product surfaces that encounter a missing P10 capability should call `ensureLazyCapability()` and translate `consent_required` / `external_setup_required` into UI actions. Wiring that primitive into every conversation/tool invocation path is intentionally separate from this bounded tranche so the installer/security authority remains reviewable and non-duplicative.
