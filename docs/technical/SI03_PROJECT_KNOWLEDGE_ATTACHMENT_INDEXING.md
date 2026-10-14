# SI-03.04 — Project Attachment Knowledge Indexing

Status: bounded SI-03.04 integration for SP-03 Research Alpha. This document does **not** claim full SP-03 or full SI-03 acceptance.

## Authority

Project attachment truth remains owned by the existing P1 ProjectResource + attachment blob store. P7 Project Intelligence remains a derived, tenant-scoped, rebuildable search projection. SI-03.04 does not create a second file store, memory authority, vector database, parser runtime, source-policy system, or retrieval router.

## Canonical path

1. A Project attachment is stored as the existing `chat_attachment` ProjectResource and integrity-bound blob.
2. P7 rebuild first removes resources whose `contextMode` is `excluded`; their attachment blobs are therefore not read for indexing.
3. For permitted non-image attachments, P7 reuses `findProjectAttachmentResource` and `resolveProjectConversationAttachments`, which enforce canonical Project ownership, resource state, blob integrity and the existing bounded attachment parser.
4. Extracted text is added only to the derived P7 resource document. It is **not** written back into ProjectResource metadata and does not become a second source of truth.
5. P7 records the attachment checksum, `originClass: untrusted`, and a bounded extraction record. Character/page truncation remains explicit through the existing parser truncation object.
6. Image attachments stay metadata-only. P7 does not persist base64 or invent OCR/vision-derived text.
7. If extraction/storage is unavailable, P7 degrades the attachment projection to explicit metadata-only/incomplete state rather than fabricating content or aborting unrelated Project knowledge rebuilds.

## Security and truth boundaries

- Project/tenant isolation continues to be enforced by the existing ProjectResource and attachment service boundaries.
- Excluded attachments are filtered before any attachment-content resolution call.
- Attachment text is untrusted source material; making it searchable does not verify its assertions.
- Integrity validation uses the stored attachment SHA-256 and byte length before extraction.
- Unsupported/failed extraction never becomes synthetic searchable text.
- Images are not OCR'd by this workstream.

## Focused acceptance

`p7ProjectAttachmentKnowledge.test.ts` covers the bounded minimum-shippable journey:

- a token that exists only inside a permitted uploaded text file becomes retrievable after P7 rebuild;
- the P7 projection retains the canonical attachment source ref, checksum and extraction state;
- character-limit truncation is explicit;
- an excluded attachment's unique content is not retrievable;
- an image remains metadata-only with no base64/OCR text in the index;
- the derived Project knowledge remains retrievable after database close/reopen.

The regression is permanently registered in the canonical `npm run test:p7` suite, alongside the existing P7 coverage, so future P7 gates retain this journey after temporary focused validation infrastructure is removed.

Focused V1 plus `npm run test:p7` and `npm run check` is required before merge. Broader SP-03 acceptance remains governed by the Shipping Point contract.
