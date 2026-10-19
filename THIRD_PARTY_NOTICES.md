# LiOS Third-Party Notices

**Effective:** 2026-10-18
**Repository:** `kiranvbiim-coder/lios-terminal`

LiOS uses open-source software aggressively, but code licenses, external API/data rights, model-weight licenses, assets, trademarks and service terms are tracked as separate concerns.

This file is the human-readable notice entry point. The machine-readable source of truth for major donor/runtime intake is:

- `third_party/components.json`
- `third_party/upstream-lock.json`
- `third_party/release-rights-matrix.json` (including exact Node package grant reviews)

The npm lockfile and managed runtime manifest remain the authoritative intended dependency/version inventories for ordinary package-managed dependencies. The desktop packaging hook selects the locked production/optional/peer dependency closure plus the explicitly retained TypeScript operator-tool root, preserving original installation paths. This is not a `dev`-flag filter: any development-marked package reached by that closure remains included, and the auditor inventories **every package actually copied**, including unexpected extras. Build-only exclusion is a reachability decision, never a license ignore list.

The desktop ASAR rebuild retains this notice file, the root proprietary original-code `LICENSE`, the complete `third_party/licenses/` tree and full selected package payloads, including LICENSE/COPYING/NOTICE files, README grants, legal directories and source attribution headers. Binary resources also carry an ordinary-text copy of these root legal materials under `Resources/legal` (`resources/legal` on platforms using that directory spelling), so accompanying notices can be read without extracting ASAR. Unknown/restricted terms, missing metadata, missing/tampered reviewed grants, lock drift and untracked copied packages block binary packaging. Preserved bytes and source rights reviews do not establish signing, exact-target release qualification or complete sidecar/sandbox/model/data/asset rights.

### Local native runtime bundle candidate

The optional release-generated native core bundle uses CPython 3.13.16 from `astral-sh/python-build-standalone` tag `20261013`, build-source commit `9e40cba825ca0997a01cab9f60a0b15ffb976af2`. No upstream MPL-2.0 build-system source is copied into LiOS. CPython's full Python-2.0/PSF, BeOpen, CNRI and CWI licence chain remains in `runtime/lib/python3.13/LICENSE.txt`; component licence texts and exact upstream `PYTHON.json` remain under `runtime/legal/python-build-standalone/`. The retained snapshot is pinned from the matching full distribution, not inferred from the build repository licence.

The local builder materializes internal links, removes bytecode and unused absolute-path console wrappers, adds the hash-locked native core packages and their unchanged licence files, and signs native payloads before inventory hashing. It records these changes in `lios-build-changes.json`; native execution is through `bin/python3 -m`, not relocated pip launchers. The macOS arm64 candidate has a macOS 14 minimum due selected native wheels. Its ignored generated payload is not a public binary release or clearance for other targets. All native library, wheel, signing and release obligations remain independently reviewable; no licence grants ownership of Python trademarks or endorsement.

### Selected runtime alternatives and cumulative obligations

`src/script/audit_supply_chain.ts` parses SPDX precedence and parentheses. It selects a complete recognized `OR` branch and requires every `AND` term. Unapproved `WITH` exceptions remain unresolved. Exact package/declaration corrections below depend on the retained legal-file SHA-256 records in `third_party/release-rights-matrix.json`; they are not general approval of unknown declarations or other versions. The audit records each package's selected expression.

| Package/version | Selected terms and retained material |
| --- | --- |
| `dompurify@3.4.16` | Apache-2.0 alternative, not MPL-2.0. Complete package `LICENSE`, `src/license_header` and distribution attribution headers remain; retain applicable NOTICE and mark upstream modifications. |
| `rgbcolor@1.0.1` | MIT alternative expressly offered in `LICENSE.md`; Copyright (c) 2016 Stoyan Stefanov. The non-SPDX `FEEL-FREE.md` alternative is not selected. |
| `victory-vendor@36.9.2` | MIT **and** ISC plus BSD-3-Clause component obligations. All `lib-vendor/*/LICENSE` texts remain, including d3-ease's BSD terms and d3-voronoi's BSD/MIT terms. Root package MIT grant, omitted by npm, is preserved verbatim at `third_party/licenses/victory-vendor-36.9.2-LICENSE.txt`, from [Victory v36.9.2 commit `dd86278d205f3f306e2ab38c317a6f9c56f0a6f8`](https://github.com/FormidableLabs/victory/blob/dd86278d205f3f306e2ab38c317a6f9c56f0a6f8/LICENSE.txt). Preserve all copyright, permission, disclaimer and binary-redistribution notices; no endorsement is implied. |
| `pako@2.2.0` and nested `jszip/node_modules/pako@1.0.11` | MIT **and** Zlib; preserve each version's root `LICENSE`, `lib/zlib/README` and source headers, identify altered source and do not misrepresent origin. The exact versions have separate grant-hash reviews: the zlib README identifies 1.3.2 and 1.2.8 respectively. |
| `argparse@2.0.1` | Python-2.0 with full historical PSF, BeOpen, CNRI and CWI license chain in package `LICENSE`. LiOS redistributes the upstream JavaScript port without local source changes; future changes require the PSF/CNRI change summaries and attribution/endorsement rules. GPL compatibility discussion in that text is not a GPL distribution grant. |
| `nodemailer@10.0.13` | MIT-0; supplied `LICENSE` retains Copyright (c) 2011-2023 Andris Reinman, full permissive grant and disclaimer. |
| `sax@1.6.0` | Blue Oak Model License 1.0.0, full package `LICENSE.md`; each recipient of any part must receive that text or [its canonical link](https://blueoakcouncil.org/license/1.0.0). Omitted development BlueOak packages are not approved by this entry. |
| `pause@0.0.1` | MIT, Copyright (c) 2012 TJ Holowaychuk. Package metadata omits the declaration; complete `Readme.md` license section supplies the exact reviewed grant and must remain intact. |

Standalone MPL dependencies, Remotion commercial eligibility/distribution and unknown grants are **not** cleared by these selections. If Remotion is used to produce commercial media, the operator must establish entity eligibility or applicable paid terms; if intentionally redistributed, those terms must cover that exact distribution. Omitting development code from a runtime closure does not settle rights in prior promotional-media production.

### Bundled fonts — SIL Open Font License 1.1

The client imports the unchanged Fontsource CSS/WOFF assets for:

- `@fontsource/barlow-condensed@5.2.8`: Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow).
- `@fontsource/inter@5.3.0`: Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter).
- `@fontsource/jetbrains-mono@5.3.0`: Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono).

Each package's complete original copyright and OFL agreement remains in its `LICENSE`, hash-pinned by the rights matrix. The common agreement is reproduced below in the accompanying readable notice. Font software remains OFL-licensed, not proprietary LiOS material; no sale of fonts alone, endorsement or reserved-name permission is claimed. No LiOS font source alterations are recorded; any future alteration, subsetting or format conversion requires the modified-font/name conditions to be evaluated before distribution.

```text
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Bundled production dependencies added in P1

### Dockview open-source core — MIT

LiOS P1 bundles `dockview-react@8.3.1` and its pinned open-source `dockview@8.3.1` / `dockview-core@8.3.1` dependency chain for the Living Workspace layout renderer.

- Upstream repository: `dockview/dockview`
- Reviewed upstream commit: `3b519454178f203d41acd49bd2733b5cdcd0f9be`
- License: MIT
- LiOS integration boundary: docking, floating groups, tab groups and layout serialization only.
- LiOS retains canonical ownership of Projects, Sessions, analytical panes, linked context, permissions and credentials.
- `dockview-enterprise` is explicitly excluded and is not a dependency of LiOS.

The exact package versions are locked by `src/package-lock.json`. The upstream source paths and LiOS integration record are tracked in `third_party/components.json`.

## OpenClaw — MIT (major donor, Goldmine program)

LiOS adapts code from `openclaw/openclaw` (release `v2026.9.7`, commit `c074824a27c96d3983043f9eeb33823cd1772d8c`) under the MIT license below. The program, ownership boundaries and per-file import records are in `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md` and `third_party/components.json` (`importedPaths` / `destinationPaths` / `modifications`). OpenClaw branding, logos and product UI are not part of LiOS.

Files currently imported:

- `src/security/secret-equal.ts` → `src/server/safeEqualSecret.ts` (constant-time secret comparison; verbatim) and its test, ported to `node:test`.
- `src/infra/backup-archive-path-policy.ts` (`normalizeArchivePath`) → `src/server/tarFormat.ts` (adapted archive-entry path rules: relative, forward slashes, no traversal; shared by backup creation, verification and extraction).
- `src/secrets/ref-contract.ts` → `src/shared/secretRef.ts` (adapted SecretRef shape `{source, provider, id}`, env-id/provider-alias patterns and `secretRefKey`; LiOS sources are env/file/vault, OpenClaw's `exec` source is not adopted).
- `packages/net-policy/src/ip.ts` → `src/server/netPolicy/ip.ts` (IP classification for SSRF/egress policy: loopback, link-local, private, CGNAT, cloud-metadata and embedded-IPv4 forms) and its test, ported to `node:test`.
- `packages/gateway-protocol/src/schema/frames.ts`, `packages/gateway-client/src/{pending-request,event-listeners,timeouts,protocol-client}.ts` → `src/shared/gatewayProtocol.ts`, `src/client/src/lib/gateway/{pendingRequests,eventListeners,timeouts,gatewayClient}.ts` (adapted: request/response/event frame envelope, connect handshake, generation-scoped pending requests, listener identity, safe timers and reconnect behaviour; rewritten in zod with LiOS-owned methods, no OpenClaw wire compatibility).
- `packages/gateway-client/src/device-auth.ts` → `src/shared/devicePairing.ts` (adapted: versioned, delimiter-joined device proof payload; LiOS signs with Ed25519 and adds pairing-token binding, scope caps, approval and revocation).
- `src/shared/{bounded-buffer,deferred}.ts`, `packages/agent-core/src/harness/env/kill-tree.ts`, `src/process/{process-deadline,pipe-output}.ts`, `src/utils/utf8-truncate.ts`, and `src/gateway/terminal/{backend,output-ring,output-coalescer,output-flow-control}.ts` → `src/server/exec/` (GM-10a: copied with provenance headers and flattened import paths; bounded output and process-tree cleanup).
- `src/process/supervisor/{supervisor,types,cancellation-policy}.ts`, its child/stdin/env/process-event adapters, and `src/process/decoded-output.ts` → `src/server/exec/` (GM-10a: adapted child-process supervisor; LiOS environment allow-list and runtime ownership; OpenClaw broker/relay/Windows Job/Bun/PTY branches omitted from this child-only slice). Applicable upstream tests are ported to `node:test`; exact test lineage and modifications are recorded in `third_party/components.json`.
- `src/process/{terminal-pty,pty-terminal-name}.ts` and their test → `src/server/exec/{terminal-pty,pty-terminal-name}.ts` (GM-10c: adapted Node PTY path with lazy loading; Bun worker and Windows wrapper policy removed).
- `packages/retry/src/index.ts` (dependency-free timing subset: `BackoffPolicy`, `computeBackoff`, `computeBackoffSchedule`, `resolveSleepDelayMs`, `sleepWithAbort`) and `packages/retry/src/index.test.ts` (selected timing cases) → `src/server/exec/retry-timing.ts` and `src/server/exec/retry-timing.test.ts`. Arithmetic and timer normalization are retained; cancellation never reads/copies private `AbortSignal.reason`; tests are ported to `node:test` with overflow and secret-safety additions. Existing container extinction cleanup consumes the imported sleep without an abort signal and with referenced timers. No automatic retry runner/supervisor, agent dispatch, ledger or permission authority is imported or activated. Tests are authored, not executed in this slice.
- `packages/acp-core/src/runtime/{types,session-identity}.ts`, `packages/acp-core/src/{types,session-lineage-meta,error-format,structured-auth-redaction}.ts` and the used functions from `packages/normalization-core/src/{string-coerce,number-coercion}.ts` → `src/server/acp/{runtime-types,session-identity,identity-types,session-lineage-meta,error-format,structured-auth-redaction,normalization}.ts` (GM-13 / SI-02.10: actual source import; local dependency paths, identity-only declarations, used normalization closure, unused error-coercion re-export removed). Root MIT above applies to all retained source. No `acpx` package dependency, process spawning, donor session store, native approve-all or startup recovery imported. Existing P13 registry consumes read-only runtime installation health; canonical GM-11 runs remain sole process/cancel authority. `server/acpRuntime.test.ts` covers adapted helper behavior and LiOS boundaries; no upstream test execution or coding-workflow qualification is claimed.
- `src/gateway/{node-invoke-placement-grant,operator-approval-placement-grants}.ts` → `src/server/exec/placement-grant.ts` (SI-02.15 / GM-14: adapted exact-owner/node/generation retain/consume checks and final-boundary revalidation; donor worker/SQLite/standing-approval authorities are replaced by existing LiOS GM-11 authority callbacks, not imported). Relevant wrong-owner, node/generation/availability/revocation test cases from `operator-approval-placement-grants.test.ts` are adapted to `node:test` in `src/server/exec/placement-grant.test.ts`; LiOS adds real backend capability/locality eligibility, scoped approval-digest binding and projection-schema tests. No remote node executor, credentials, external service or new registry is included.
- `extensions/cua-computer/src/{actions,frame,driver-artifact-verification,node-invoke-policy}.ts`, `src/plugins/computer-use-contract.ts`, and `extensions/cua-computer/package.json` metadata → `src/server/computer/{actions,frame,driver-artifact-verification,risk-policy}.ts` and `driver-artifacts.json` (SI-02.14 / GM-14: actual source/policy import and adaptation; exact per-file modifications are in the table below). The root OpenClaw MIT notice applies to retained source. No `@trycua/cua-driver`, rastermill, native binary or unrestricted donor launcher is bundled; native execution and binary redistribution qualification remain open.
- `extensions/browser/src/browser/bounded-utf8-tail.ts` and its test → `src/server/browser-runtime-pack/bounded-utf8-tail.ts` and `.test.ts` (SI-02.13 / GM-14: byte-verified at the approved pin; helper copied with provenance, test ported from Vitest to `node:test`). LiOS also adapts the pinned browser subsystem's bounded transport, request interception, one-page ownership and close/join lifecycle mechanics into the canonical deny-network `ExecutionBackend` + supervisor + P13 host broker path. The donor control server, host Chrome/CDP/extension relay, profile/auth/storage and plugin/MCP authorities are not bundled because they would duplicate LiOS authorities or permit raw/host browser networking; this is a security/authority incompatibility, not a rejection based on integration difficulty. Exact reviewed paths, hashes, dependency closure and modifications are in `third_party/components.json`.

The GM-10c native PTY import is backend-only: it does not establish an interactive session manager, caller, uploads or attach/replay journey. The recorded macOS package probe loads the addon through a separate probe bundle; the unused backend is tree-shaken from the shipped server. GM-11 exact-operation authority, sandbox and receipts still gate privileged interactive `exec.*` exposure. Windows/ConPTY and Linux target packaging, signing and release qualification remain unproven by that probe.

```text
MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Third-party notices for incorporated or adapted code are recorded in
THIRD_PARTY_NOTICES.md.
```

## P0/P1 donor candidates

This inventory preserves the historical P0/P1 review entries; several now have partial or runtime integration records in `third_party/components.json` and `third_party/capability-assimilation.json`. **A listing or permissive code licence alone does not mean source is imported, capability is user-accessible, or a release is qualified.** When code is copied, vendored, modified or distributed, its exact imported paths, destination paths, modifications and required copyright/NOTICE text must be recorded before release. Candidate approval, actual import/distribution and external API/data/model/asset/trademark rights are separate decisions.

Reviewed inventory (consult the current per-component evidence, not this list, for implementation status):

- OpenTerminalUI — MIT
- OpenTerminal — MIT
- London Strategic Edge Terminal — MIT
- London Strategic Edge Data SDK — MIT client library; hosted data rights are separate
- Brue Language — MIT; Brue Connect implementation is not approved until independently verifiable
- TradingAgents — Apache-2.0
  - Selected source-adaptation candidate (SI-05.26/.27/.29): `TauricResearch/TradingAgents` at `2d17df8da1536c121e4d7395ac5a5dcec9e96d6f`, `tradingagents/agents/utils/rating.py`, `tradingagents/graph/conditional_logic.py`, `tradingagents/agents/utils/agent_utils.py`, `tradingagents/agents/researchers/{bull,bear}_researcher.py`, and `tradingagents/agents/risk_mgmt/{aggressive,conservative,neutral}_debator.py` → LiOS `src/server/tradingAgentsResearchGate.mjs`. Apache-2.0 terms and upstream attribution apply. Modified for explicit REVIEW/nontrading outcomes, bounded typed bull/bear and three-risk-perspective transitions, and missing-opponent/report safeguards; full 75-path pin audit lives in `third_party/tradingagents-path-dispositions.json`. This records donor code lineage only; it is not a packaged-agent or broker-integration claim.
- Dexter — MIT
- LangAlpha — Apache-2.0
- Fin-Agent — MIT
- Backtest Kit — MIT
- QuantConnect LEAN — Apache-2.0
- FlexLayout — MIT
- Monaco Editor — MIT
- whisper.cpp — MIT
- HQTUI — MIT
- assistant-ui — MIT
- tool-ui — MIT
- Univer OSS core — Apache-2.0
- @lydell/node-pty (fork of microsoft/node-pty) — MIT, Copyright (c) 2026 Simon Lydell; prebuilt native PTY addon, optional, lazy-loaded
- Perspective — Apache-2.0
- Apache ECharts — Apache-2.0
- TanStack Table / Virtual — MIT
- Tiptap OSS core — MIT
- xyflow / React Flow — MIT
- skfolio — BSD-3-Clause
- CVXPY — Apache-2.0
- QuantLib — QuantLib License
- EdgarTools — MIT
- Arelle — Apache-2.0 (with separately licensed included components)
- Docling — MIT
- sqlite-vec — MIT OR Apache-2.0
- Polars — MIT
- Apache Arrow — Apache-2.0
- OpenTelemetry JS — Apache-2.0
- OpenLineage — Apache-2.0
- Open Policy Agent — Apache-2.0
- Pydantic AI — MIT
- LangGraph JS — MIT

Exact pinned commits are recorded in `third_party/upstream-lock.json`.

### Current partial integration evidence

- **Univer OSS core — Apache-2.0:** `dream-num/univer` at `360c5ccb5e40e48be95b213a19527ac5afe9909a`, OSS presets `1.0.0-rc.0`, is partially integrated behind P4 Artifact state. The recorded unsigned/ad-hoc macOS package smoke exercised CSP, canvas/ribbon/formula interaction and P4 revision save. It is not signed/notarized clean-install, Windows, packaged size/startup/memory, full round-trip or release proof; stable re-pin remains required when available.
- **@lydell/node-pty — MIT:** `lydell/node-pty` at `e1212da80b2b1e7f9b03efb97addb97ecf27a2d4`, package `1.2.0-beta.15`, is an optional lazy-loaded native dependency, not merely a future candidate. Copyright (c) 2026 Simon Lydell. The backend/probe bounds above apply. Its component/upstream records supplement the preserved 92-entry capability registry baseline; this supplemental native dependency does not change that baseline count or establish an additional accepted capability.
- **assistant-ui / tool-ui — MIT:** interaction-pattern adaptations are recorded; this does not establish bundled upstream donor runtimes.

- **Tiptap OSS core — MIT:** packages `@tiptap/core`, `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit` pinned to `3.31.4`; upstream `ueberdosis/tiptap` tag `v3.31.4`, commit `d9af9c6a16e17438b06b2266765b9c1a21a3d7a0`. Copyright (c) 2025, Tiptap GmbH. The complete MIT permission and warranty terms reproduced above apply with this copyright holder. LiOS lazily uses the OSS editing runtime with canonical P4 block/version ownership. Paid extensions, cloud and collaboration services are excluded. Package locks retain transitive integrity; no upstream source modification or donor branding is imported. Native/editor checks do not imply packaged SP-04 acceptance.

- **PptxGenJS — MIT:** supplemental native presentation generator, npm `pptxgenjs@4.0.1`, upstream `gitbrent/PptxGenJS` tag `v4.0.1`, commit `3c9ec1b687c174952166f6a34b5e87ebf69fa469`. Copyright (c) 2015-2022 Brent Ely. The MIT permission and warranty terms reproduced above apply with this copyright holder. LiOS uses native Office chart/table serialization behind canonical P4 Artifact/version/provenance ownership; no remote assets, donor UI/store or upstream source modifications are imported. Package-lock records exact tarball integrity/transitives. This supplemental donor does not alter the historical 92 baseline.

- **noble-hashes — MIT:** existing dependency `@noble/hashes@2.2.0` is directly pinned for captured-image integrity validation. Copyright (c) 2022 Paul Miller (https://paulmillr.com). The MIT permission and warranty terms reproduced above apply with this copyright holder. LiOS reuses the browser-compatible SHA-256 implementation unchanged; no cryptographic implementation, remote service or new capability authority is introduced. Exact npm tarball integrity is recorded in package-lock.

The imported/adapted OSS regression inventory (`third_party/imported-oss-regression.json`) now records coverage paths and lineage for the later OpenClaw, Univer and supplemental native node-pty imports. These entries identify existing coverage and requirements, not fresh PASS results. Exact-release regression execution, upstream reconciliation and packaging acceptance remain required; notice entries, package locks and recorded partial smokes do not themselves supply that release evidence.

None of these records accepts `SP-01`–`SP-07`. Shipping Point acceptance requires the real Minimum Shippable Journey, target execution where applicable, no fake success, regression protection and exact evidence under `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`; P14 remains final release authority.

## SP-01 offline sandbox image — pinned document models

The macOS arm64 packaged image contains the exact offline linux/arm64 Docling 2.129.0 wheel, PyTorch CPU wheels, SheetJS 0.20.3, Node.js 22.12.0 and per-file pinned PDF/OCR models described in `src/sandbox-image/source-lock.json`, `docling-model-inventory.json` and `docling-wheel-inventory.json`. These are inside the isolated execution image, not LiOS Core's in-process Python runtime. Every image operation is network-denied and rootless.

- Docling code is MIT; `third_party/components.json` records its image-only distribution boundary.
- `docling-project/docling-models` (TableFormer) and `docling-project/CodeFormulaV2` weights are under **CDLA-Permissive-2.0**. The complete agreement is distributed beside the packaged sandbox image at `sandbox-image/CDLA-Permissive-2.0.txt`; [primary text](https://raw.githubusercontent.com/Community-Data-License-Agreements/Releases/main/CDLA-Permissive-2.0.txt).
- `docling-project/docling-layout-heron` and `docling-project/docling-layout-heron-onnx` are Apache-2.0; `docling-project/DocumentFigureClassifier-v2.5` is MIT; RapidAI/RapidOCR's v3.9.2 PP-OCRv6 weights are Apache-2.0. Their pinned repository revisions, package and model hashes and model-card sources are in the source lock. Upstream README and license files are retained in the model archive where provided.
- No third-party provider datasets, hosted data feeds, donor branding, or general-purpose Local AI weights are bundled by this sandbox image. License for parser code does not grant source-document rights.

This notice records redistributed artifacts; it does **not** assert SP-01 acceptance without the packaged user journey, full V3 and target evidence.

## Explicit exclusions and boundaries

- OpenBB is not an approved LiOS runtime, connector or donor and is intentionally removed under LIOS-P0-01.
- FinceptTerminal and other strong-copyleft projects are not approved for source-code incorporation into proprietary LiOS core without a separate explicit licensing/distribution decision.
- Dockview Enterprise features are not part of the open-source Dockview approval.
- Tiptap/Univer commercial extensions are not assumed to be licensed by their OSS cores.
- Provider/API/data licenses are not granted by the license of connector code that accesses them.
- Model weights used by local AI/voice runtimes may have licenses different from their inference code.

## Package-managed dependencies

LiOS also distributes package-managed dependencies through npm and optional managed runtime packs. Their notices and licenses must be reconciled from the exact locked release dependency graph before public distribution.

P0 adds automated checks for:

- locked dependency vulnerability status;
- major OSS donor/upstream pins;
- high-risk/copyleft license detection;
- runtime-pack license declarations;
- missing/manual-review license metadata.

Release qualification must regenerate/reconcile the final notice inventory against the exact packaged build. This notice file remains conservative and does not claim rights that have not been verified.


## London Strategic Edge intake boundary — 2026-09-22

LiOS has registered the following non-bundled donor/provider candidates:

- `londonstrategicedge/lse-terminal` at `62c48a5ce6de37a1c115d6270dfd0eee75166d8b` — MIT.
- `londonstrategicedge/lse-data` at `564c63dd99e3b447777cb396314ec6c4342f82ff` — MIT client library; its README explicitly separates rights in hosted data.
- `londonstrategicedge/brue` at `a846522fe8af0e11ee7739ef8b6b8a4c0f7922cb` — MIT.

No listing here means code is already bundled. Exact imported paths, modifications, copyright/license text and inherited third-party notices must be recorded when source is actually copied/distributed.

LSE-hosted data/API rights are not granted by these MIT code licenses and remain behind a provider-terms/entitlement release gate. The standalone Brue Connect repository referenced by upstream documentation was not retrievable during the audit and is not approved for source incorporation unless its source/license becomes independently verifiable.


## P10 release reconciliation — 2026-09-23

The P10 production-hardening release gate reconciles the human-readable notices here with
`third_party/components.json`, `third_party/upstream-lock.json`,
`third_party/imported-oss-regression.json`, and `third_party/lse-release-inventory.json`.

P10 interoperability/adaptation posture recorded in this dated reconciliation (not exact-release certification):

- **OpenTelemetry JS — Apache-2.0.** LiOS does not bundle the upstream OpenTelemetry JS runtime package in this release. P10 implements a LiOS-owned OTLP/JSON-compatible, local-first redacted observability adapter in `server/p10Observability.ts`. Remote export is disabled unless explicitly enabled with redacted-only confirmation.
- **OpenLineage — Apache-2.0.** LiOS does not bundle the upstream OpenLineage runtime in this release. P10 maps canonical LiOS P5 lineage receipts into an optional fingerprinted OpenLineage-style event representation. P5 lineage remains authoritative.
- **London Strategic Edge Data SDK — MIT client library.** No LSE Data SDK source file is copied verbatim into the current LiOS release. LiOS owns its Provider SDK adapter/protocol implementation. LSE-hosted data/API rights are separate, require a user-owned entitlement/key, are local-use only under the current release posture, and are not centrally redistributed by LiOS.
- **London Strategic Edge Terminal — MIT.** Recorded use is reference/architecture/test review only; no upstream source or branding asset is bundled. Its intended future candidate posture does not establish actual import or fulfil the SI donor-analysis obligation.
- **Brue Language — MIT.** Recorded use is pinned donor/reference only; no Brue source is bundled. Any future assimilation needs its canonical owner, evidence-backed disposition and revisit trigger; reference-only use is not accepted integration.

The final LSE-specific imported-path/modification/data-rights record is
`third_party/lse-release-inventory.json`. The regression evidence and upstream-update
review contract for materially adapted/bundled donors is
`third_party/imported-oss-regression.json`.

The cross-category release-rights matrix is `third_party/release-rights-matrix.json`.
It deliberately audits software-code licenses, external data/API terms, model-weight
licenses, dataset rights, and trademarks/assets separately. The current Core release
does not bundle third-party provider datasets or Local AI model weights and does not
treat connector-code licenses as permission to redistribute hosted provider data.


### Barlow Condensed display typography — SIL Open Font License 1.1

LiOS bundles the 700/800 display weights from `@fontsource/barlow-condensed@5.2.8` to implement the user-supplied Figma Make reference. Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow). The font is licensed under SIL OFL 1.1; the package's LICENSE retains the complete license and copyright notices. Inter and JetBrains Mono remain the conversational and numeric fonts. All production fonts are self-hosted.

## Device-network dependencies — GM-09b

PKIjs `3.4.0` and ASN1js `3.0.10` construct the Home's self-signed TLS identity using WebCrypto. Both use BSD-3-Clause; exact versions and transitive dependencies are locked in `src/package-lock.json`. The cryptographic algorithms remain supplied by the platform; LiOS does not implement certificate encoding or signature algorithms.

### PKIjs licence

```text
Copyright (c) 2014, GlobalSign
Copyright (c) 2015-2019, Peculiar Ventures
All rights reserved.

Author 2014-2019, Yury Strozhevsky

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this
  list of conditions and the following disclaimer in the documentation and/or
  other materials provided with the distribution.
* Neither the name of the {organization} nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### ASN1js licence

```text
Copyright (c) 2014, GMO GlobalSign
Copyright (c) 2015-2022, Peculiar Ventures
All rights reserved.

Author 2014-2019, Yury Strozhevsky

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.
* Redistributions in binary form must reproduce the above copyright notice, this
  list of conditions and the following disclaimer in the documentation and/or
  other materials provided with the distribution.
* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### bonjour-service — MIT

`bonjour-service@1.4.4` (with transitive `multicast-dns`) publishes opt-in `_lios-home._tcp` mDNS advertisements when the Home owner enables **Discover on local network** (GM-09c). Copyright (c) 2021-2024 bonjour-service contributors. The MIT licence terms in the OpenClaw notice above apply.

### QR Code Generator — MIT

`qrcode-generator@2.0.4` renders the pairing invitation QR in Settings. Copyright (c) 2009 Kazuhiko Arase, http://www.d-project.com/. The word “QR Code” is a registered trademark of DENSO WAVE INCORPORATED. The MIT licence terms reproduced in the OpenClaw notice above apply with this copyright holder.

## OpenClaw CUA computer policy mechanisms — SI-02.14 / GM-14

Imported/adapted source: OpenClaw commit `c074824a27c96d3983043f9eeb33823cd1772d8c`, Copyright (c) 2026 OpenClaw Foundation, MIT. The complete MIT permission and warranty terms reproduced in the OpenClaw notice above apply.

| importedPaths | destinationPaths | Modifications |
|---|---|---|
| `extensions/cua-computer/src/actions.ts` | `src/server/computer/actions.ts` | Preserved complete modifier/key normalization and coordinate scaling; reject negative/non-finite coordinates at the helper boundary. |
| `extensions/cua-computer/src/frame.ts` | `src/server/computer/frame.ts` | Complete generation, window/element/browser/dialog reference lifecycle and frame geometry binding retained; provenance header only. These ephemeral native references do not replace LiOS entity identity. |
| `extensions/cua-computer/src/driver-artifact-verification.ts` | `src/server/computer/driver-artifact-verification.ts` | Complete package/version/digest verification retained; replace OpenClaw fs-safe/string helpers with Node bounded streaming hash and local record guards; reject unverified macOS instead of donor's non-applicable success; use regular-file/no-follow checks. |
| `extensions/cua-computer/src/node-invoke-policy.ts` | `src/server/computer/risk-policy.ts` | Import complete risk-family/observation tables; replace plugin/node authority with strict LiOS assessment schema; all consequential inputs require `user_confirm`; no self-approval or raw provider dispatch. |
| `src/plugins/computer-use-contract.ts` | `src/server/computer/risk-policy.ts` | Preserve complete 40-action vocabulary; assessment-only schema uses existing Zod, not imported TypeBox/provider plumbing. |
| `extensions/cua-computer/package.json` | `src/server/computer/driver-artifacts.json` | Preserve exact 0.28.2 version and upstream artifact hashes; metadata only, no SDK or native binaries bundled. |

No new package dependency is added. Imported policy helpers depend only on Node and LiOS's existing Zod. The unimported provider closure includes `@trycua/cua-driver@0.28.2`, `@openclaw/fs-safe@0.21.1`, `rastermill@0.3.3`, donor Zod 4 and plugin SDK; LiOS does not pretend these are installed or redistribution-qualified.

Native source review also covered complete OpenClaw `driver-client.ts`, `mcp-driver-client.ts`, `commands.ts`, `action-targets.ts`, `window-actions.ts`, the three macOS `CuaDriver{Process,HostCoordinator,HostLifecycle}.swift` files and staging script. The macOS host deliberately launches unrestricted/bypass-approval mode, while direct SDK sessions are unrestricted; neither is imported as a LiOS execution fallback. `computer.assess` is a real policy-assessment descriptor for injection into the existing L1 registry, not GUI execution.

The driver upstream [0.28.2 source license](https://github.com/trycua/cua/blob/cua-driver-rs-v0.28.2/LICENSE.md) is MIT, Copyright (c) 2025 Cua AI, Inc.; its Rust workspace records MIT and npm SDK metadata records MIT. These observations do **not** qualify the prebuilt archive's complete transitive redistribution closure. The upstream macOS archive pin is `386db225a3080714a0f9f935525e61efaf46709587ef8b94dd2df81aeb2f6daa`; no archive was downloaded, hashed or redistributed by this lane. Native packaged execution remains unavailable until binary release rights/dependency notices, actual archive/executable integrity, signed-app TCC, scoped daemon lifecycle and canonical isolated transport are qualified.

Donor tests inspected: `node-invoke-policy.test.ts`, `driver-artifacts.test.ts`. Their classification, raw-control denial and integrity cases were ported into `computer-policy.test.ts`, with capture/reconnect/coordinate regressions added. No donor or LiOS tests were exercised in this lane; the integration owner runs focused V1/typecheck and real native V2 when prerequisites exist.

## Microsoft GraphRAG — MIT (source-scoped evidence relationship adapter)

LiOS adapts the pinned `microsoft/graphrag` source at `769542fbf1d8e5b4c6a8677fefc34621c87894c5`, originally `packages/graphrag/graphrag/query/input/retrieval/relationships.py` and `packages/graphrag/graphrag/query/context_builder/source_context.py`, into `src/server/graphragPermittedEvidenceLinks.ts`. Original Microsoft copyright and the full MIT license are preserved at `third_party/licenses/graphrag-MIT.txt`. The LiOS adaptation uses only in-network source-co-mention ranking **after P7 permission filtering**, removes donor GraphRAG persistence/model/network providers, and is not an import of the full GraphRAG distribution. The user-controlled fork `kiranvbiim-coder/graphrag` is source provenance, not shipping evidence.

## FinRobot — Apache-2.0 (immutable report provenance adapter)

LiOS adapts source mechanics from `AI4Finance-Foundation/FinRobot` at `2717499b8e30f242640af08c4ad9afd1113c2d45`: `finrobot_desktop/desktop/src/components/SourcedNumber.tsx`, `finrobot_desktop/desktop/src/pages/artifact-detail/reportData.ts`, and `finrobot_desktop/desktop/src/export/reportExportQueries.ts`. Adapted destination `src/server/finrobotReportSnapshot.ts`, real P4 caller `src/server/artifactReviewPackage.ts`. Full upstream Apache-2.0 LICENSE and NOTICE (including trademark restrictions) are retained verbatim under `third_party/licenses/finrobot-Apache-2.0.txt` and `third_party/licenses/finrobot-NOTICE.txt`. LiOS does not ship FinRobot branding, desktop, report database, model services or SEC/API clients.

## browser-use — MIT (browser-download safety mechanisms)

LiOS adapts the pinned `browser-use/browser-use@a6e103e27d28c390ac6421a6ee8ac21f1b1dfc1c` security concepts from `browser_use/browser/watchdogs/downloads_watchdog.py` and `tests/ci/security/test_download_filename_sanitization.py` into `src/server/browserDownloadSafety.ts`, `browserConnectorRuntime.ts` and `playwrightBrowserAdapter.ts`. Root MIT copyright is © 2024 Gregor Zunic and exact full license from the approved source commit is preserved at `third_party/licenses/browser-use-MIT.txt`. This imports no browser-use Python runtime, CDP agent, Chromium binary, network entitlement, third-party browser session or user credential authority. The original donor's filename-basename normalization and directory containment behavior are adapted to canonical LiOS GM-14 Project approval and isolated transport policy.

## LangAlpha — Apache-2.0 (bounded agent workflow response validation)

LiOS adapts the pinned `ginlix-ai/LangAlpha@941ca4a18f5a364caf481a6f78cdb040086aa38d` response validation mechanisms from `src/ptc_agent/agent/middleware/background_subagent/workflow/validation.py`, especially `parse_schema_result` and bounded JSON candidate attempts. Source adaptation is `src/server/langAlphaModelReplyParser.ts`, consumed by the canonical GM `src/server/agentLoop.ts`, with upstream-derived negative fixtures. Original Apache-2.0 full license from the approved commit is retained at `third_party/licenses/langalpha-Apache-2.0.txt`. LiOS does not import LangAlpha QuickJS, PTC agent, vendor AI providers, background job runtime or separate storage. LiOS owns approval, delegation, model selection and schema validation.

The independent P7 source-provenance adaptation uses the baseline upstream source pin `ginlix-ai/LangAlpha@db8f8c2dee948c9c6f77805558898c3abb637328`, the exact `src/ptc_agent/agent/provenance/types.py` source fingerprint and its `tests/unit/ptc_agent/agent/provenance/test_types.py` upstream references. The bounded LiOS TypeScript helper is `src/server/langalphaExcerptProvenance.ts`; existing Project evidence, governed web capture and reviewed research refresh paths record SHA-256 + UTF-8 size of the **exact displayed quote**. It does not import LangAlpha's agent, full result-body store, stream/event protocol, model pipeline or tool-argument capture. This byte-binding does NOT verify external factual accuracy, licensing of captured content, or Project access rights. The canonical P4/P7 subsystems retain those responsibilities. The same full Apache-2.0 text named above covers this selected adaptation.

## CUA — MIT (finite captured-frame geometry validation)

LiOS adapts safety invariants from source-pinned `trycua/cua` (mirror `kiranvbiim-coder/cua`) at `a7524cfd1d3e959963b43954d43f27c4bd260f08`, particularly `libs/cua-driver/examples/jev-use/python/action_policy.py` finite screenshot-to-action mapping and `libs/python/agent/tests/test_uitars_coordinate_security.py` malformed-coordinate regressions, into the existing `src/server/computer/actions.ts` frame coordinate helper and `computer-policy.test.ts`. Copyright (c) 2025 Cua AI, Inc.; full unchanged source MIT license is `third_party/licenses/cua-MIT.txt`. This selected source does not include the separate FSL-1.1-MIT Cua Spaces packages or native driver binaries; rights/transport/approvals remain LiOS-owned. See `docs/technical/CA_CUA_COORDINATE_GEOMETRY_ADOPTION.md`.

## Qlib risk-analysis formula adaptation — MIT

LiOS adapts only the `risk_analysis` numerical semantics (sum/product return accumulation, sample standard deviation, annualization, information ratio and max drawdown) from Microsoft Qlib. This is a bounded read-only formula challenger and **not** the packaged Python Qlib runtime, model, training weights, market data or trading engine. The original file and LiOS destination paths/modifications are recorded in `third_party/components.json`.

- Copyright (c) Microsoft Corporation.
- Upstream: `microsoft/qlib`, `qlib/contrib/evaluate.py`.
- Reviewed exact source commit: `be725493eb1a6bbb42bf11b37aa7669f59610ff1`.
- License: MIT.
- Distribution does **not** convey any third-party market-data rights or model-weight licensing.

MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## Apache ECharts (runtime package) — Apache-2.0

LiOS optionally lazy-loads `echarts@6.1.0` for Chart Artifacts whose canonical `rendererPreference` is `echarts`. Source upstream: Apache Software Foundation, https://github.com/apache/echarts, published npm package `echarts@6.1.0` with exact integrity pinned in `src/package-lock.json`. This distribution version is distinct from the separate source-review SHA in `third_party/upstream-lock.json`; no claim of exact Git-SHA/npm tarball identity. Copyright © Apache Software Foundation and contributors, licensed under Apache License 2.0 (license included in original npm distribution). The renderer is optional and loaded only when requested; the canonical LiOS Artifact owns source data, chart revision, permissions and exports. No external CDN, provider, executable `chart.options`, data recomputation or remote services.

Dependencies: `zrender@6.1.0` © zrender contributors, BSD-3-Clause; `tslib@2.3.0` © Microsoft Corporation, 0BSD. Their license files are supplied in their exact pinned npm package distributions. Further packaged macOS/Windows startup, chunk-size and accessibility acceptance remains required before SP-04 claims.

## EdgarTools — MIT (SEC canonical URL and archive-path safety)

LiOS adapts SEC URL-construction mechanisms from `dgunning/edgartools@4e817de7bf3efae44024e168754e8f5d53b1a227`, specifically `edgar/urls.py` (blob `02e17b91ce1fb7e0affc6866d484da925e7ea4a2`) with regression reference `tests/core/test_urls.py` (blob `42f716ddb9c8425b18e963257fef9238e6d5945a`). Copyright (c) 2022-present Dwight Gunning; the full unmodified MIT license is in `third_party/licenses/edgartools-MIT.txt`. LiOS applies additional strict CIK, accession and archive-filename validation in `src/server/edgartoolsSecUrls.ts`, consumed by the existing `secEdgarData.ts` and `secEdgarFinancials.ts` connectors. Official SEC hosts, existing source acquisition, SEC descriptive User-Agent and fair-access policy remain authoritative. This adaptation adds no new Python runtime or provider: the existing separately tracked managed EdgarTools package (`edgartools==5.51.0`) remains part of LiOS's Python SEC search tooling. It adds no alternate storage, investment advice, XBRL parser or trading engine. This limited integration does not establish donor exhaustion or SP-05 packaged acceptance.

## skfolio — BSD-3-Clause (read-only effective diversification)

LiOS adapts the bounded mathematical mechanism `effective_number_assets` from `skfolio/skfolio@eb73a4cfe3136d5615a6047060705695d4462588`, source `src/skfolio/measures/_measures.py` (blob `6451c83f92b80af50cdc9f8eca275da4bd635af4`), with tests referenced from `tests/test_measures/test_measures.py` (blob `b3dc127bce043411449e8c15be833a16e2246ff1`). Copyright (c) 2023–2026 the skfolio developers; full original BSD-3-Clause license retained at `third_party/licenses/skfolio-BSD-3-Clause.txt`. 

The pure TypeScript `src/server/skfolioEffectiveDiversification.ts` implements inverse Herfindahl concentration using already-recorded same-date long exposures; `src/server/portfolioAnalytics.ts` exposes the optional effective asset count and observation date through the existing portfolio analytics route. It refuses missing/stale/non-finite quotes, negative or invalid position sizes. This metric uses unverified recorded source closes, does not imply verified current pricing, and imports no Python skfolio runtime, optimizer, covariance model, new market provider, trading authority or data store. LiOS P6/P11 risk and portfolio authorities remain canonical; no full donor exhaustion or SP-05 packaged shipping claim.
