# P12 — Voice and Multimodal Runtime

**Status:** bounded V1 source integration recorded — native-picker/discovery and attachment service durability are present; managed zero-setup provisioning, interactive packaged, benchmark and live-provider qualification remain outstanding
**Effective:** 2026-09-23

P12 adds voice and additional input modalities to the existing LiOS Conversation Runtime. It does not create a second command system, second permission model, or provider-owned conversation state.

Execution follows `../LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` (`SI-01`–`SI-07`) and `SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` (`SP-01`–`SP-07`). P12 remains the modality owner; CA-08 and GM-22 supply provisioning/local-runtime depth behind existing authorities, TC owns the visible experience, and P14 remains final release authority. S0–S10 are validation journeys, not execution phases; CP references are historical evidence. Voice supports agentic/research/professional-work journeys and local AI without establishing a full SI phase or Shipping Point. Privileged interactive `exec.*` remains blocked until SI-01.11 / GM-11 authority, sandbox and trust receipts are proven; transcript review does not unlock prohibited brokerage writes.

## Target canonical pipeline

**audio → transcription provider/local optional pack → editable transcript → ConversationRequest → normal context/intent/tool runtime → artifacts/actions → optional speech output**

The composer appends recognized speech to the ordinary editable text input while preserving the full transcript evidence separately. Before sending, the user can edit the combined text and explicitly mark the voice transcript reviewed. The Project/Quick and Temporary routes re-plan the canonical request server-side, determine whether any step requires governed confirmation, and reject an unreviewed voice request with HTTP 428 before persistence or execution. The normal action-approval gate still applies after transcript review. The review receipt records transcript IDs, providers, locality, and audio hashes; raw audio is never persisted.

Project chat now provides a file picker and drop target. Uploads are validated and retained as private Project Resources; only governed attachment references are persisted in chat metadata, while extracted text and image bytes remain runtime-only. The Project Conversation Runtime resolves each reference under tenant/Project ownership and applies `allowResourceReferences` before making content available to BYOAI. Saved files can be downloaded again from the persisted user message.

Current supported inputs are PDF, TXT, Markdown, CSV, TSV, JSON, PNG, JPEG and WebP. Files are capped at 20 MiB each, images at 6 MiB, five files per message, 12 MiB of images per AI request, and 100 MiB per Project. Text extraction is bounded to 20,000 characters per file; PDF parsing is additionally bounded to the first 20 pages and the same 20,000-character cap. Character/page truncation is disclosed in the model context and execution receipt so omitted content is never represented as reviewed. Scanned-PDF OCR, DOCX, spreadsheet formula interpretation and broad document-intelligence claims are not part of this first path. Uploaded files default to on-demand Project context. Image requests are sent only through the selected provider/model when the LiOS runtime allowlists that pair for image input; they never silently fall back to another provider. User-owned Home/server deployments using a remote database must configure an absolute persistent `LIOS_ATTACHMENT_STORAGE_DIR` volume; this is not a LiOS-operated customer runtime.

Automated service/runtime/provider-shape coverage now includes an actual local database close/reopen for Project attachment metadata, saved-message references and blob recovery, plus corruption and storage-write failure handling. This is still not a packaged desktop restart test, interactive user acceptance, or a live BYOAI provider result. Do not mark packaged P12 product qualification complete until those remaining checks are recorded.

## Implemented contracts

- `shared/multimodalContracts.ts` — modality, attachment, transcript evidence/review, TTS preference/provider and whisper.cpp benchmark contracts.
- `shared/conversationRuntime.ts` — canonical governed attachment refs on `ConversationRequest`.
- `server/p12VoiceRuntime.ts` — transcription provider registry, local whisper.cpp adapter, server-derived transcript-review requirement, speech output providers and benchmark.
- `client/src/components/terminal/ProjectExperienceShell.tsx` + `server/projectConversationRoutes.ts` — editable voice transcript evidence and explicit review UI; authenticated Project/Quick and Temporary routes enforce the review gate before chat persistence/runtime execution.
- `server/p12VoicePack.ts` + `server/voiceProviderSetup.ts` + `server/voiceRoutes.ts` — fail-closed local-runtime discovery across explicit user paths, managed/packaged `lios.voice` assets and system fallbacks, with privacy-safe readiness/status surfaces.
- Electron `main.cjs` / `preload.cjs` + `DataConnectionCenter.tsx` / `LocalVoiceRuntimeSettings.tsx` — the active Connection Center exposes native picker setup for user-selected whisper.cpp/model/ffmpeg paths. Files are not uploaded or copied.
- `server/p12Multimodal.ts` — document/image/screenshot normalization and ConversationRequest bridge.
- `server/p12RuntimeComponents.ts` — optional runtime components wired into the existing RuntimeRegistry.
- `script/benchmark_p12_whisper_cpp.ts` — real optional-pack benchmark command.
- `script/validate_p12_voice_multimodal_acceptance.ts` — phase acceptance.

## P12 invariants

1. Spoken and typed text enter the exact same ConversationRequest and planner.
2. Project, conversation, workspace, active-object, approvals and AI transmission policy survive modality conversion unchanged.
3. Before execution, the user can inspect and edit the recognized transcript.
4. The authenticated runtime derives transcript-review need from the planned step permission classes. A spoken request with any non-safe-auto step is rejected until the user explicitly marks the editable transcript reviewed; the guard runs before persistence and execution. Existing deterministic/tool/action approvals remain independently enforced.
5. Speech output is disabled by default and always provider/user preference controlled.
6. Local-only speech preference rejects non-local providers.
7. No raw audio is persisted by the P12 adapter; transcript evidence carries only a SHA-256 audio reference plus provider metadata.
8. The Project upload route signature-checks supported image/document inputs through the existing multimodal normalization helper before creating conversation references.
9. The current PDF/text parser is a bounded local extraction path, not a claim of full document intelligence. Images/screenshots do not create a new artifact authority.
10. Local whisper.cpp remains an optional Runtime Pack implementation. Current source discovers a user/release-provisioned managed pack at `runtime-packs/lios.voice/current` or packaged resources; it has no downloader. The normal product target requires LiOS-managed provisioning/verification under CA-08/GM-22/P12, not mandatory manual dependency installation. Optional heavy binaries/models require visible size, storage, rights and explicit consent; no silent download is permitted.
11. A concrete whisper.cpp build must pass `npm run benchmark:p12:whisper` using real binary/model/audio inputs before release bundling.
12. Voice never bypasses normal Conversation Runtime permission classes.
13. Current BYO/native-picker setup stores only explicit user-selected local paths in `~/.limuria-terminal/voice-runtime.json` (mode 0600 where supported); it does not copy, upload or silently download runtime files. This remains an optional user override, not the approved final dependency-setup UX.
14. Automatic executable discovery accepts `whisper-cli`; ambiguous legacy binaries named only `main` require an explicit user-selected path.
15. Microphone recording readiness is distinct from WAV transcription readiness: browser/Electron WebM audio requires a validated ffmpeg path.
16. Explicit user-selected runtime files take precedence over managed-pack discovery; environment overrides remain supported for development/managed deployments.
17. `/api/voice/providers` returns only booleans, source categories and guidance for runtime readiness; absolute local paths are never exposed to the renderer.

## Local-runtime setup integration status

The native bridge, server readiness routes, local-path validation and active Connection Center UI are integrated. **Connections → Local Voice Runtime** reports three independent prerequisites:

1. whisper.cpp executable;
2. Whisper model;
3. ffmpeg for browser/Electron microphone formats that are not already WAV.

Each missing component can be selected through a trusted Electron native file dialog. LiOS validates file type/size and executable permission where applicable, writes only the selected path to its local voice-runtime config, then refreshes provider registration. Server/development environments may use `LIOS_WHISPER_CPP_BIN`, `LIOS_WHISPER_MODEL` and `LIOS_FFMPEG_BIN` instead.

This is current BYO local runtime setup, not zero-setup provisioning or release qualification. CA-08/GM-22/P12 must deliver the normal managed install/verify/activate/update/rollback path, with explicit size/storage/rights/consent for heavy optional assets and truthful missing/failed/cancelled states. Native picker configuration remains an optional BYO override. P14/P12 packaged acceptance still requires an actual supported runtime to pass benchmark, microphone/transcription, restart and clean-machine evidence before a release can claim local Voice readiness.

### Optional managed Voice Pack discovery

LiOS also recognizes the following local layout under the configured LiOS data directory or packaged resources:

```text
runtime-packs/
  lios.voice/
    current/
      bin/
        whisper-cli        # whisper-cli.exe on Windows
        ffmpeg             # ffmpeg.exe on Windows
      models/
        ggml-tiny.en.bin   # or another supported configured GGML model
```

This is a discovery convention, not a downloader or proof of verified provisioning. A release process or the user can currently place these files; requiring normal users to obtain/install them is a delivery gap, not the final approved experience. Managed provisioning remains required under CA-08/GM-22/P12. The native picker remains an optional override and its explicit paths take precedence. Browser recording is reported ready only when whisper.cpp, a model and ffmpeg are all available.

## whisper.cpp optional-pack budget

The benchmark currently enforces:

- realtime factor <= 1.5x audio duration;
- peak RSS <= 2 GB when supplied by the benchmark environment;
- executable <= 100 MB;
- model <= 1.6 GB.

These are release gates for an optional local Voice Runtime Pack, not a claim that a specific third-party binary is already bundled.

## Phase gate

The bounded P12 V1 source implementation and service-test coverage are recorded; this does not close managed provisioning or packaged product qualification.

- **P12-02 bounded source integration is present:** active Connection Center setup, native path selection, readiness refresh and optional managed-pack discovery are wired, but a managed downloader/install-verification lifecycle is not established. Release qualification still requires a real whisper.cpp/model/audio benchmark plus packaged clean-machine evidence.
- **P12-03 source implementation is present:** server-side planning determines whether a voice request requires transcript review; Project/Quick and Temporary routes reject an unreviewed high-impact request before Project persistence/provider/tool execution. Normal governed action approval remains separate. Packaged interactive acceptance is still required.
- **P12-06 source implementation is complete:** Project chat supplies picker/drop, validation, private Project Resource storage, governed ConversationRequest references, bounded text/PDF extraction, policy-aware runtime consumption, allowlisted vision routing, saved-message metadata and authenticated download. Focused tests cover limits, integrity, tenant/Project isolation, cleanup, runtime consumption, provider payload shape, database close/reopen durability, corruption detection and storage-write failure cleanup. The composer retains staged files after retryable storage failures and tells the user how to retry.
- **Release/product qualification remains open:** run the flow in the packaged desktop app; verify the same attachment interaction/reopen/download journey on a clean install; exercise microphone cancel/type/size/storage failures interactively; record a real local Voice walkthrough/benchmark; and, only with explicit authorization, verify a live vision-capable BYOAI provider. Mock/source tests do not substitute for this evidence.

For any claimed SP contribution, define a real Minimum Shippable Journey (for example microphone → edit/review transcript → governed request → persistent result/attachment → restart/reopen/download), exercise the actual target build/topology, keep unsupported/denied/offline states explicit, protect already accepted journeys from regression, and record exact commit/build, environment, checks/outcomes, privacy/permission evidence, limits, truth level and remaining dependencies. Source tests, a discovered path or a benchmark command alone do not establish `shipping point accepted`; no SP acceptance is asserted here. Benchmark thresholds above are gates, not recorded binary/model/audio measurements.

```bash
cd src
npm run test:p12
npm run acceptance:p12
```

Optional local whisper.cpp release qualification:

```bash
WHISPER_CPP_BIN=/path/to/whisper-cli \
WHISPER_CPP_MODEL=/path/to/model.bin \
WHISPER_CPP_AUDIO=/path/to/fixture.wav \
WHISPER_CPP_AUDIO_DURATION_MS=10000 \
npm run benchmark:p12:whisper
```

P12 and P13 work may proceed behind stable canonical contracts as SI dependencies allow, without reopening P12 architecture unless a reproduced defect or an explicit modality expansion requires it. Neither subsystem's source integration closes the other's provisioning, convergence or release evidence.
