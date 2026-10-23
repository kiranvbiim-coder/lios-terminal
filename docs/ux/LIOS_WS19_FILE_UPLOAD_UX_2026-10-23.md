# WS-19 — Real File Import, Transfer Feedback and Retry-Safe Staging

**Date:** 2026-10-23. **Track:** TC/UX plan [PR #119](https://github.com/kiranvbiim-coder/lios-terminal/pull/119), issue [#91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). This source implementation is **stacked on [PR #100](https://github.com/kiranvbiim-coder/lios-terminal/pull/100)**, the actual Quick and Project Chat real-attachment owner. There is no new file database, user-data index, provider permission or made-up attachment.

## Code-backed audit

- Original `ProjectExperienceShell.tsx` already has local browser file selection, drag-and-drop, file chips, removal, five-file cap, 20 MiB general cap / 6 MiB image cap, allowlisted PDF/Office/text/image extensions, voice-transcript review, saved attachment references and a real server upload during Send. PR #100 adds the actual **`/api/quick-chats/:chatId/attachments`** endpoint, Quick Chat attachment persistence, Quick Chat downloads, source-scope support and authenticated tenant/owner server validation alongside existing Project Chat APIs. **Temporary Chat rejects files**. No forced Project migration.
- The original uploader used browser `fetch` with **no transfer progress**, so a user could not distinguish queued file vs data transfer vs server verification. It surfaced arbitrary server `error` strings in the Chat notice rather than limited safe status copy.
- Repeated picker/drop events could stage the same file twice and fill five slots. Multi-file validation happened against snapshot state, with no common pure test contract.
- The UI did not clearly say that 100% transferred **does not mean server-verified saved**. On upload failure, staged files were retained via the original try/catch path, but failure/retry and saved-reference status needed deliberate, trustworthy copy.
- Existing `@shared/conversationRuntime` already specifies `conversationAttachmentRefSchema` with exact UUID, kind, sourceRef, sha256, filename, MIME, byteLength and optional preview. A positive HTTP code alone should never be treated as an accepted persisted reference.

## Implemented

1. `client/src/lib/fileAttachmentStaging.ts` provides pure allowlist/size/five-slot and duplicate file-key staging checks. Batch validation is atomic: reject an invalid batch without losing previously staged files. Only staging UI checks; original authenticated backend validates signatures, file contents, tenant and attachment ownership. `progressPercent` uses real `loaded/total`, caps transfer reporting at **99%** until HTTP + canonical schema success.
2. `client/src/lib/realFileAttachmentUpload.ts` uses native `XMLHttpRequest` multipart POST to the existing same-origin Quick/Project API routes, retaining session cookies and original server side protections. `xhr.upload.onprogress` reports real transferable bytes; completed transfer enters a separate **Verifying saved file** state, and only a successful 2xx with a parsed **`conversationAttachmentRefSchema`** resolves an attachment reference. Network, timeout, abort, invalid response, 400, 401, 403, 404, 413, 429 and 5xx failures produce bounded, **safe** copy and never disclose arbitrary backend response text.
3. `ProjectExperienceShell.tsx` retains exactly one existing Send path and uses the upload helper for staged Quick/Project files, updating saved attachment refs only **after server verification**. Queued and transferred files display accurate per-file status with an accessible HTML `progress` element and `role=status`, including file position in a multi-file batch. A failed upload leaves the unconfirmed local file in the original staged list, available on the next Send; already uploaded refs remain staged and are not uploaded again. No automatic retry while permissions or storage might have changed.
4. Stage files through the pure, deduplicated plan, guard busy mutation and disable file-chip removal while a Send is in flight, keeping the immutable file list consistent for the server request. The existing five-file cap, Temporary Chat refusal, sourceScope='web' exclusion, server file signatures and privacy/transmission approvals are preserved. No raw file bytes stored in browser localStorage, telemetry or new memory snapshots; files go directly to the existing authenticated endpoint only after user Send.
5. **8 pure staging/progress tests** `client/src/lib/fileAttachmentStaging.test.ts`; **6 mocked XMLHttpRequest transport tests** `client/src/lib/realFileAttachmentUpload.test.ts`; **8 source integration tests** `script/validate_ws19_real_file_upload.test.mjs`. Parent PR #100's API/service, attachment-contract and migration tests must remain passing.

## Dependencies, merge sequence and caveats

- WS-19 **draft base**: `fix/p12-quick-chat-attachments-20261022` owned by #100. This branch contains **only incremental UX improvements beyond #100**. Merge/review the parent first, then rebase/retarget WS-19 against actual protected main. Do not copy or recreate Quick Chat schema migration or server storage here.
- Other canonical Chat edits: WS-16 [#137](https://github.com/kiranvbiim-coder/lios-terminal/pull/137), WS-18 [#139](https://github.com/kiranvbiim-coder/lios-terminal/pull/139), WS-17 [#138](https://github.com/kiranvbiim-coder/lios-terminal/pull/138), #98/#102 saved Chat, #115 message actions, #130 recovery, #134 first-use, #136 Chat handoff. **Compare exact current heads before merging** and preserve all original draft-clearing, Send mutex, Stop, Attachments and source-policy logic. WS-19 is not an alternative to WS-18 and must acquire its send/draft safeguards in final integration.
- The XHR progress reports **bytes uploaded by the browser**; it does not show server-side document extraction/analysis progress or certify successful storage at 99%. The actual schema check is only confirmation of server-issued reference. Signed-in permissions and tenant scoping still come from the original backend. No external upload endpoint, anonymous upload or background transmission.

## Verification and acceptance

| Check | Status |
| --- | --- |
| Source implementation plus 22 new regression cases | IN_PR |
| Exact-head Node unit/source tests, typecheck and CI | PENDING |
| Valid PDF/Office/text/image Quick and Project file upload | NOT_RUN |
| Duplicate/drop/repeated picker, five-slot, file-size and wrong-signature fixtures | NOT_RUN |
| Real 401, 403, 404, 413, 429, 503, timeout and reconnect | NOT_RUN |
| Partially uploaded multi-file batch resumes only unsaved local files | NOT_RUN |
| Temporary Chat rejects file data and does not persist private bytes | NOT_RUN |
| SourceScope/files/web and AI transmission policy remain enforced | NOT_RUN |
| 320/390/768/1280/1440px, 200% zoom and keyboard-only progress/retry | NOT_RUN |
| VoiceOver/Narrator in installed native macOS/Windows | NOT_RUN |
| Parent #100 merge, conflict reconciliation and protected-main acceptance | PENDING |

Run on the **exact reviewed WS-19 PR head** from `src/`:

```bash
node --import tsx --test client/src/lib/fileAttachmentStaging.test.ts client/src/lib/realFileAttachmentUpload.test.ts script/validate_ws19_real_file_upload.test.mjs
npm run test:ux
npm run acceptance:ux
```

Real signed-in fixtures must verify that a file failing server validation stays staged and is **not claimed uploaded**, and that a successful upload creates a server reference only for the actual owner Chat. Attach exact SHA, OS, fake nonprivate files, recorded HTTP status and screenshots to issue #91. Do not claim that authored source tests demonstrate real Windows/macOS UX, security, verified saved content, or a shipped feature.

**Next:** WS-20 — context references and advanced composer controls, coordinated with source/mention and command owners.
