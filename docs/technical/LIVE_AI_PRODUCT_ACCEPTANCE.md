# Live AI Service Smoke and Product Acceptance Boundary

Provider code or a passing service smoke does not make LiOS AI-ready. Product acceptance requires the real user workflow, from credential setup through a useful governed conversation, to work in the packaged desktop app.

## Product contract

A valid BYOAI setup must prove all of the following without exposing the credential:

1. The user selects a governed provider and explicit model.
2. The credential is stored through LiOS credential custody and is never returned to the renderer.
3. A tiny public live-verification request succeeds and reports only safe provider/model/latency metadata.
4. The same provider/model is used by the real Conversation Runtime in Temporary, Quick and Project scopes.
5. Every exercised Conversation Runtime scope emits an AI-derived execution receipt with provider attribution.
6. Project data is not part of the connectivity probe.
7. Provider failures are returned as structured, sanitized errors.
8. Deterministic LiOS functions remain usable when AI is disabled.

## Manual real-key service smoke

This smoke is intentionally **not** part of normal GitHub Actions. It consumes the user's provider API and should be run deliberately on the desktop/development machine. The default performs four minimal server-service calls: a public connectivity probe plus Temporary, Quick and Project Conversation Runtime responses/receipts. All three conversations use the provider and model reported by the probe. A `--scope` diagnostic selects one conversation and therefore performs two calls; that restricted run does not replace the full default acceptance.

It checks the public-only Project-instruction transmission boundary, with resources, selection and tools disabled. It does **not** exercise the renderer setup form, `/api/setup/ai/test`, credential-vault persistence, saved setup across relaunch, authenticated Project/Chat API flow, arbitrary private Project-data transmission permissions, or the packaged Electron app. A provider environment variable can supply the credential, so a pass does not prove that the encrypted-vault UI flow works. Those are separate product/release acceptance checks and must not be inferred from this service-smoke result.

From `src/`:

```bash
npm run smoke:ai:live -- --provider=openai --model=<model-id>

# Optional diagnostic only; does not satisfy release acceptance by itself:
npm run smoke:ai:live -- --provider=openai --model=<model-id> --scope=project
```

The key must be provided through the normal LiOS encrypted credential setup or the provider's supported environment variable. Do not paste credentials into logs, documentation, issues, pull requests, or command arguments.

The default smoke performs four minimal real calls:
- one public provider connectivity probe;
- one Temporary Conversation Runtime request;
- one Quick Chat Conversation Runtime request;
- one Project Conversation Runtime request with Project-instruction transmission enabled and resource/selection/tool transmission disabled.

Each conversation must return an `ai_derived` result and a LiOS execution receipt attributed to the selected provider. The Project run also verifies that the governed context marks Project instructions as included only in Project scope.

It passes only after **every selected Conversation Runtime scope** returns an `ai_derived` result, emits a LiOS execution receipt attributed to the same verified provider/model, and preserves the expected Project-instruction transmission boundary. The stable output marker is `LIVE_AI_SERVICE_SMOKE: PASS`, but this is still service-level acceptance rather than packaged product acceptance.

## Source-controlled flagship gate

Normal CI must prove the pieces that do not require a real user credential or packaged desktop:

```bash
npm run test:flagship
npm run acceptance:flagship
```

This gate covers:

- provider verification contract and sanitized metadata;
- a regression guard that the manual live smoke cannot report PASS before exercising its requested Conversation Runtime scopes;
- offline Project → Conversation → deterministic Artifact → keep → review/edit → export-plan → close/reopen lifecycle;
- tenant isolation of the persisted Artifact;
- documentation/accounting that still marks real-key and packaged proof as external evidence.

The manual real-key service run remains:

```bash
npm run acceptance:flagship:live -- --provider=<provider> --model=<model-id>
```

A full default run must succeed in **Temporary, Quick and Project** scopes. A scope-specific run is diagnostic only.

For a stronger service-level journey that combines a real provider with durable Project work:

```bash
npm run acceptance:flagship:live-service -- --provider=<provider> --model=<model-id>
```

This command uses a temporary local LiOS data directory and:

1. verifies the real provider/model;
2. creates a temporary Project and Project Chat;
3. executes a real AI-assisted Project conversation with public-only transmission;
4. records the AI receipt/provider/model metadata in that chat;
5. runs a deterministic finance workflow in the same Project;
6. keeps the generated Artifact and verifies export formats;
7. closes and reopens local state;
8. verifies the Project, Chat, AI receipt metadata, Artifact and export plan survived reopen;
9. deletes the temporary local acceptance data when complete.

It does **not** write the provider credential into Project state or output. It still does not prove the renderer credential form, native secret vault, packaged desktop relaunch, signed installer or clean-machine journey.

## Packaged flagship release proof

Service and source acceptance are prerequisites, not release proof. The exact signed client release candidate must also produce `flagship-release-report.json` under the contract in `PACKAGED_FLAGSHIP_RELEASE_ACCEPTANCE.md`.

The report requires complete macOS and Windows product journeys, native secret custody, real user-controlled AI and data, deterministic execution, governed AI synthesis, provenance/receipt inspection, Artifact revision/export, quit/relaunch continuity and permission revocation that fails closed. It rejects service-only, mocked/fixture-backed or developer-assisted completion.

Validate the report from `src/` with:

```bash
RELEASE_TAG=<exact-release-tag> \
LIOS_FLAGSHIP_RELEASE_REPORT=../flagship-release-report.json \
npm run acceptance:flagship:packaged -- --write-p14=p14-flagship-evidence.json
```

Upload both the report and generated P14 flagship evidence to the exact release. Final P14 certification re-validates the report and verifies that the evidence hash is bound to it.

## Release rule

A mocked/unit-test-only or service-smoke-only pass does not satisfy live AI product acceptance. Before production release, the packaged desktop build must prove the credential setup and custody flow, provider/model persistence across relaunch, successful live verification, and the authenticated flagship conversation journey with explicit transmission permissions and a correctly attributed AI-derived receipt. Use a real user-controlled credential and retain sanitized evidence only. The broader flagship journey is tracked in Product Hardening Issue #1.

Live AI work contributes to the relevant `SI` workstream and `SP` Minimum Shippable Journey (MSJ), not a separate execution program. Under the [Shipping Point contract](SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md), `SP-01`–`SP-07` each require a real user journey, target execution where applicable, explicit unavailable/denied/error states, protection of accepted journeys and exact evidence. Record commit/build/release, target/topology, MSJ, checks/outcomes, permissions/provenance, limitations, truth level and gaps/next dependency. A source or live-service PASS neither accepts an SP nor certifies a release. P14 remains final release authority; `S0`–`S10` are validation coverage only.


## Quality-gate regression rule

The product-hardening gate must remain compatible with the frozen P11 engine namespace and the governed P13 plugin transport. Plugin component identifiers are not P11 engine capabilities; P13 uses the supervised `broker.plugin.invoke` transport capability and carries the exact plugin component inside the governed payload. Provider tests must also reflect the runtime contract that providers marked `allowCustomModel` accept explicit model IDs.
