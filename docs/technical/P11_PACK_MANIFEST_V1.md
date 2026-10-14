# P11-01 — Hidden Engine Pack Manifest v1

**Status:** implemented foundation  
**Task:** `LIOS-P11-01`  
**Contract:** `src/shared/hiddenEnginePackManifest.ts`

P11-01 freezes the first production contract for first-party hidden engine packs. P11-01 itself is a schema/contract foundation only, not implementation or verification of capability routing, installation, signatures, supervision, rollback or execution. Separate P11 tasks have since added source lifecycle behavior recorded in `P11_ENGINE_FABRIC_SPEC.md` §36; this task's bounded scope is not a claim that those mechanisms are globally absent or release-qualified.

## Frozen manifest surface

Every manifest v1 must declare:

- schema version, pack id, semantic version and internal display identity;
- first-party publisher/key identity;
- compatible LiOS Core version range;
- supported OS/architecture targets;
- runtime kind, runtime version, entrypoint and isolation boundary;
- LiOS capability ids exposed by the pack;
- explicit permissions for network, filesystem, secret handles, process spawn, GPU, external side effects and broker/write behavior;
- resource budgets for memory, CPU, concurrency, workers, timeouts, dataset size and optional idle shutdown;
- supported control/data interchange formats;
- SBOM and third-party notice paths;
- manifest/payload SHA-256 digests and Ed25519 signature metadata.

The schema is strict. Unknown top-level fields fail validation so v1 cannot silently expand.

## Security invariants

Manifest v1 is intentionally fail-closed:

- normal packs are `visibility: internal`;
- disabled network cannot carry host allow-lists;
- `filesystem: none` cannot carry filesystem roots;
- reserved `brokerWrite` metadata implies external side effects at schema validation, but never authorizes current prohibited brokerage execution or trade/order writes; approval cannot override product policy;
- duplicate platforms, capabilities, data-plane formats, secret handles and scoped roots are invalid;
- hard memory must be at least soft memory;
- maximum timeout must be at least default timeout;
- worker count cannot exceed declared concurrency;
- only Node/WASM may request `in_process` isolation in v1;
- integrity fields require SHA-256 digests and Ed25519 signature metadata.

P11-16 owns cryptographic verification, whose source implementation is recorded in the Engine Fabric specification. P11-01 freezes the signed metadata consumed by that verifier; valid metadata alone proves neither verified payload nor safe activation.

## Relationship to existing runtime packs

This contract extends the existing P10 managed runtime-pack model; it does not replace `src/server/runtimeManifest.ts` and does not create a second Project, Artifact, Provider, Connector or Runtime Registry.

The existing low-level managed Python allow-list remains authoritative for current managed Python dependencies until concrete packs migrate behind v1. Legacy pinned-only installs record `hashVerified: false`; they are not proof of full wheel locks, hash verification or isolated family environments. Supervised subprocess execution is not OS-enforced sandbox evidence.

SI strategic milestones and `SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` govern integrated delivery under existing P11/GM/P4/P5 owners. Manifest validity does not close SP-01/02/04/05/07: real MSJs, target execution where applicable, explicit failure/unavailable states, regression protection and exact evidence remain required. GM-11 authority must be proven before privileged interactive `exec.*`; no Shipping Point acceptance is inferred here.

## Validation

`src/shared/hiddenEnginePackManifest.test.ts` covers:

- complete valid manifest parsing;
- strict unknown-field rejection;
- uniqueness constraints;
- privilege contradictions;
- resource-budget contradictions;
- integrity metadata;
- runtime isolation rules.

The phase-specific command is `npm run test:p11` from the app root (`src/`).
