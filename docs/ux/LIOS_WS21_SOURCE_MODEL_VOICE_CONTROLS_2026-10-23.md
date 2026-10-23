# WS-21 — Model, Source and Voice Truthful Availability/Consent

**Date:** 2026-10-23. **Plan:** [65-workstream plan #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119); [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). **Repo:** `kiranvbiim-coder/lios-terminal`.

## Original code audit

- `ChatSourcesControl.tsx` already reads the authorized `GET /api/setup/source-registry`. It exposes all four server-governed source scopes (Auto/My Data/Web/Files) with descriptions and Connection Center navigation. Its original list filtered `connected` but did not distinguish `operational` or the recorded `lastCheckedAt`; a connected-but-broken source was visually identical to a working one. It also presented a retry button on error but could still show cached entries without clearly labeling their freshness, and did not explain unavailable pricing/quota terms.
- `useBoundedAgentComposer.ts` already reads authoritative `/api/wave-c/ai/state` and `/api/setup/status`, checks Master AI, model ID and provider availability, and blocks agent actions when unready. It did not display the **observed configured provider/model** beside the agent toggle or say whether price/quotas could be verified. No reason to add a fake model picker or second AI settings store.
- `useVoiceInput.ts` reads the original `/api/voice/providers` and transcribes using `POST /api/voice/transcribe`, through the original session. `voiceTranscriptSchema` is validated; transcript is staged in the Chat editor and does **not auto-send**. **Gap:** on a transcription failure it echoed raw `payload.error` from the server or raw browser microphone exception strings into the visible UI, potentially exposing server paths/provider diagnostics. Source `voiceRoutes.ts` confirms that backend error text can contain underlying conversion/executable messages. UI did not clearly explain that the **recorded audio is uploaded after Stop**, followed by editable transcript review, or allow retry when voice provider enumeration failed.
- [PR #100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100) already changes `ChatSourcesControl.tsx` for Quick Chat source compatibility. WS-21 deliberately **stacks on #100** (`fix/p12-quick-chat-attachments-20261022`) and does **not** undo its supported Quick/Project Chat behavior.

## Implementation

1. `src/client/src/lib/composerAvailability.ts`: pure, bounded `sourceAvailability` distinguishes catalogue-only, connected unverified, observed operational at last check, and nonoperational needs-attention. A connected flag alone never becomes an operational claim. `voiceAvailability` distinguishes unknown/loading/error state, registered local Whisper and its `browserRecordingReady` dependency, other configured transcription providers, speech-only providers, and local versus nonlocal voice. The pure `voiceFailureCopy` maps generic HTTP/status or microphone failures to safe customer-facing guidance, without echoing raw server errors.
2. `ChatSourcesControl.tsx`: uses the original authenticated registry and its `summary.connectionCount` versus `operationalCount`, displays per-provider operational/unverified/needs-attention status and `lastCheckedAt` when present. A failed registry lookup warns that cached entries may be stale with actionable **Retry status**. It retains Connection Center as the sole place to configure credentials and licences. Adds clear caveat: source selection changes the next request scope, **not** access/authorization, provider retrieval, cost, licence grants or AI consent; usage prices/quotas are not exposed. Adds focus-visible, accessible 40px controls and bounded mobile menu.
3. `useBoundedAgentComposer.ts` + `BoundedAgentComposerControl.tsx`: shows **only server-verified ready** provider/model identity when available; otherwise retains original Master AI unavailable/configure/needs-provider guidance, and does not invent cost, free allowance, token prices or a new provider configuration route. Multi-step agent tool approvals remain governed by existing server policy.
4. `useVoiceInput.ts`: before parsing server transcription response, check status and map to `voiceFailureCopy`; refuse malformed transcript data rather than relying on raw error strings. Browser microphone permission/errors are reported with non-sensitive copy. Successful `voiceTranscriptSchema.safeParse` is still mandatory and does not send a Chat message.
5. Existing `ProjectExperienceShell.tsx`: uses the availability view for mic readiness and speech output; voice UI states **when** audio is uploaded to LiOS Home, that the transcript can be reviewed/edited before Send, and that pricing/quotas are unverified; provides a **Retry voice provider status** button on actual provider enumeration error. Voice recording and the existing source and AI send/approval path are not bypassed. Existing microphone permission, browser MediaRecorder and the original server transcription/voice output APIs are unchanged.
6. **No new provider, pricing API, credential storage, telemetry, automatic consent, source connection, native voice pack downloader or fabricated availability.** The voice provider runtime's own readiness and server authorization are the only authorities.

## Evidence and tests

- `src/client/src/lib/composerAvailability.test.ts` — **11 executable pure cases** for source readiness and voice status/error mapping.
- `src/script/validate_ws21_controls.test.mjs` — source contracts for Source Registry, provider IDs, original voice routes, no raw errors, privacy copy, model readiness, voice transcript staging, no fake pricing and native acceptance honesty.
- Preserve existing `useBoundedAgentComposer` and voice provider tests, the parent #100 Chat attachment/source tests and P1 source scope tests.

Run on exact head under `src/`:
```bash
node --import tsx --test client/src/lib/composerAvailability.test.ts script/validate_ws21_controls.test.mjs
npm run test:ux
npm run acceptance:ux
```

| Acceptance | Status |
| --- | --- |
| Feature source and new regressions committed to draft branch | IN_PR |
| Exact-head Node unit tests, TypeScript and Linux/Windows/macOS hosted CI | PENDING |
| Connected/nonoperational and registry-timeout real fixtures | NOT_RUN |
| Model configured, unavailable, Master AI disabled and provider/license failures | NOT_RUN |
| Local/remote speech/transcription provider and absent ffmpeg/microphone permission | NOT_RUN |
| Recording capture → user Stop → Home upload → reviewed transcript → explicit Send | NOT_RUN |
| Actual provider price/quotas and licence visibility, network/403/429/5xx retries | NOT_RUN |
| Browser screenshots at 320/390/768/1280/1440 and 200% zoom | NOT_RUN |
| Keyboard-only and native macOS/Windows VoiceOver/Narrator | NOT_RUN |
| Independent review, parent #100 merge, conflict resolution and protected main | PENDING |

### Merge and PR ownership

- **Parent [#100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100) first**; WS-21 retargets to protected main after #100 merges, so Quick Chat source-scope behavior is not regressed or duplicated. The same original Chat TSX is edited by #98/#102/#115/#130, WS-14 #134, WS-15 #136, WS-16 #137, WS-17 #138, WS-18 #139, WS-19 [#140](https://github.com/kiranvbiim-coder/lios-terminal/pull/140), WS-20 [#141](https://github.com/kiranvbiim-coder/lios-terminal/pull/141). **Reconcile actual current heads before merging**; preserve their attachments, Send/Stop, draft safety, resource mentions, accessible controls, first-use and file upload progress.
- [#105](https://github.com/kiranvbiim-coder/lios-terminal/pull/105) owns Connection Center's credential and source setup dialogs; WS-21 does **not** modify its files or implement competing provider configuration UI.
- Source tests cannot prove a live provider, real prices, OS microphones or native accessibility. Show unverified as unverified. The existing separate P1 runtime and server permissions remain authoritative.

**Next:** WS-22 — observed streaming/Stop/retry/receipt correctness, coordinated with WS-18 #139 and runtime owners.
