# OpenClaw Assimilation & User-Owned Runtime Blueprint

**Status:** OWNER-APPROVED ARCHITECTURAL DIRECTION / IMPLEMENTATION PROGRAM  
**Effective:** 2026-10-02  
**Canonical parents:** `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` (final execution authority), `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` (mandatory shipping evidence), `docs/LIOS_MASTER_PLAN.md`, `docs/LIOS_ARCHITECTURE.md`, `docs/LIOS_EXECUTION_ROADMAP.md`, `AGENTS.md`
**Pinned OpenClaw baseline:** `openclaw/openclaw` release `v2026.9.7`, commit `c074824a27c96d3983043f9eeb33823cd1772d8c`, MIT  
**Internal codename:** Goldmine

This document is the technical assimilation blueprint for the owner-approved decision to use OpenClaw aggressively wherever it gives LiOS a mature implementation advantage. It is not a competing master plan. Product, architecture, UX, connector and execution authority remain in the canonical documents above.

**Current execution/reuse decision (2026-10-03):** SI-01–SI-07 define strategic execution; S0–S10 are validation journeys only and CP1–CP7 are historical maturity/evidence references. Multiple coordinated bounded owners may advance independent work behind stable contracts, with one implementation owner per shared core. OpenClaw is the primary structural donor, not the limit. Analyze donor product, subsystems, mechanisms and LiOS transformations through **ANALYZE → DECOMPOSE → REUSE → ADAPT → REPURPOSE → COMBINE → GENERALIZE → INNOVATE → WRAP → BUILD LAST → REJECT ONLY WITH EVIDENCE**. Original-domain mismatch is not a rejection reason. Preserve exact pins, rights, provenance and canonical GM/TC/CA/P authority. SI-01.11 / GM-11 is the immediate structural priority; open PR #227 is in-flight work, not merged-main authority or shipping evidence.

Sections 32–48 preserve dated findings and implementation records at their stated bases, not current unresolved inventories. Their “today”, “remaining” and “not done here” statements must be read with later closure evidence and retained downstream ownership. Earlier pending GM-08/09, folder-only backup, plaintext-config and absent-PTY findings are superseded only to the bounded extents recorded later; no full interactive execution or release closure is implied.

The goal is **not** to ship a thin wholesale rebrand/fork of OpenClaw. The goal is to absorb as much mature, commercially compatible OpenClaw infrastructure as is useful while preserving one coherent LiOS product, one canonical LiOS state model and one user-owned infrastructure model.

**Naming/reuse rule:** when a donor subsystem fits, prefer reusing the full useful subsystem/package over rewriting it piecemeal. The shipped product, user-facing UI, commands, app names, LiOS-owned API surfaces and integrated product terminology use **LiOS** naming. Imported/adapted source may be renamed/refactored into LiOS modules/types where that improves integration; donor-internal names may remain when retaining them materially improves upstream diffability/maintenance. In every case, OpenClaw provenance, pinned source commit, MIT notices and material modifications remain recorded internally.

## 0.1 Owner decision — full OpenClaw capability convergence through an isolated supporting service — 2026-10-28

**Decision status: APPROVED PRODUCT/ARCHITECTURE DIRECTION; IMPLEMENTATION AND ACCEPTANCE NOT INFERRED.** This is a supporting integration contract inside the established SI-06/SI-07, GM/TC/CA/P13 and SP/P14 authorities. It is **not** a replacement phase hierarchy or second implementation roadmap. The actionable, verifiable five-package checklist is maintained in `docs/PENDING_WORK.md` and coordinated in [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91).

### Owner intent and integration boundary

The owner chose **a supervised, isolated OpenClaw-derived supporting service**, not a new primary LiOS runtime, not a standalone consumer-facing OpenClaw app and not an indiscriminate wholesale rebrand. The full useful donor capability surface is in scope for inspection and adoption; **Telegram and WhatsApp are explicit first-class examples**, not a reason to narrow adoption to simple send/receive. Agents must consider all applicable upstream channel and messaging features, agents and delegation, models/account access, tools, skills/MCP, browser/computer-use, orchestration, sessions, memory, scheduling, notifications, device nodes and diagnostics. Reuse entire sound subsystems/packages when that yields better LiOS integration than rewriting. Record unsupported/unsafe/non-permitted features individually with evidence; never silently declare them imported or ready.

**End-user experience:** users see only LiOS conversations, Projects, live Artifacts/Workbench, contextual integrations and permitted device experiences. They may know which external accounts/services they connect, and must see accurate permissions, delivery and failure status, but no extra OpenClaw-branded dashboard, account identity, product shell, setup labyrinth or implementation-specific branding is required. Internals must not be concealed from consent, troubleshooting, audits or required notices.

```text
LiOS desktop / mobile / tablet / watch / chat
             |
LiOS Chat + TC UX + P4 Artifacts / Workbench
             |
Existing LiOS Home / Gateway + canonical grants & trust receipts
             | (typed, versioned, local/user-owned, authorized)
Existing supervisor -> isolated OpenClaw-derived supporting service
             |       |       |       |       |
          channels  agents  skills  tools  device/runtime adapters
             |
  Telegram / WhatsApp / other user-connected endpoints
             |
normalized event/result -> existing LiOS Chat, P9 automation,
P4 Artifact, memory, notification and device authorities
```

A process boundary is desirable for faults, lifecycle management, resource limits, upgrades and independent donor maintenance. It **does not grant** execution permissions, eliminate the existing sandbox requirement, justify remote public ingress or introduce a second LiOS state authority. Prefer existing local IPC/supervisor/auth primitives; assess Unix sockets, named pipes and authenticated loopback only against existing GM security. LiOS Home owns launch, health, restart/backoff, disable/recovery, versions and shutdown. User-owned remote Home may host the service under the same contracts; no LiOS-operated customer cloud or relay.

**Canonical ownership:** GM/Home/Gateway owns process, identity binding, grants, execution/security and device trust; P13/GM owns plugins, skills/MCP and tool permissions; TC owns visible Chat/connection/Workbench UX; P4 owns durable Artifact identity/revisions; P9 owns automation/notifications; connector/AI-access owners own official source auth, OAuth/CLI/provider entitlements and egress. Imported donor modules are *implementations behind those contracts*, never a second auth/profile vault, chat ledger, schedule database, model-router authority or Artifact store. No new universal routing framework unless the existing owner proves its seam insufficient.

### Explicit channel-surface acceptance: Telegram and WhatsApp

Treat **complete useful channel capability** as an audited inventory, not a promise that every upstream/platform feature is technically or contractually available. For each channel and authorized account/path, inspect the exact pinned upstream and owner-fork implementations and record:

- account onboarding, official/supported login/authorization, re-authorization, revocation, logout, identity/scope and multi-account behavior where allowed;
- inbound/outbound one-to-one, group and other supported conversations; replies, threads, quoting, attachments and media, contacts/identifiers, reactions, edits/deletes, message status and delivery/receipt semantics **where the platform/API provides them**;
- incoming event verification, webhook/polling/transport constraints, dedupe, ordering, idempotency, retries/backoff, reconnect, offline queue, cancellation and attachment size/type/resource limits;
- conversation-to-Project mapping, history import/retention, background-agent and automation triggers, safe notifications, device continuity and file/evidence/Artifact creation when authorized;
- per-source/project/tenant scope, explicit recipient/action confirmation for outbound side effects, minimum necessary disclosure to AI providers, consent, quotas, privacy and data retention;
- server-side authorization, token custody, secret redaction, egress restrictions, external callback exposure, protocol updates, abuse/rate limits and rights/terms of service.

**No hidden user-account use or unauthorized automation**. Prefer authorized official interfaces; do not promise unsupported access or circumvent platform limits. Use exact feature-matrix statuses: `EXISTING_VERIFIED`, `DONOR_AVAILABLE`, `IMPORT_REQUIRED`, `ADAPT_REQUIRED`, `BLOCKED_BY_PLATFORM_OR_RIGHTS`, `DEFER_WITH_TRIGGER`, `REJECT_WITH_EVIDENCE`. Each decision includes source pin/path, owning LiOS adapter, rights/security note, required test and proof link. A listed capability, forked repo or copied folder is not an integrated, connected or working capability.

### Five execution packages — subordinate to current SI plan

**Package 1 — Full-source inventory, rights and contracts (SI-06/SI-07; GM/CA/P13).** Compare current public `main`, existing private/owner-approved forks where legitimately accessible, donor baseline `openclaw/openclaw@c074824a27c96d3983043f9eeb33823cd1772d8c`, current registered donor registry and active PRs. Identify already-landed implementations to avoid duplicate work. For all relevant upstream packages/channels, record license/dependency provenance, current adoption, canonical owner, security posture, resource footprint and `DIRECT_REUSE/IMPORT/ADAPT/REPURPOSE/COMBINE/GENERALIZE/INNOVATE/DEFER/REJECT` disposition according to the **existing** donor policy. Output: a crosswalk/evidence update within canonical docs/registry and issue #91, not a new product master plan.

**Package 2 — Isolated supervised supporting service (SI-06; GM-Home/Gateway/security).** Extend the existing supervised runtime and typed IPC/RPC boundary, version/health/restart and shutdown, bounded queues, lifecycle provisioning, logs/redaction, installed-app resources, safe disable/fallback and policy enforcement. Assess sandbox/permissions/capability grants before exposing privileged tools; reject duplicates of Home, Gateway, server identity, P13 plugin host, PGlite state or secret vault. Verify local off/denied/crash/unavailable/reconnect behavior and non-interference with existing Python/finance engines and normal AI-off work.

**Package 3 — Capability and channel assimilation (SI-06; existing GM/P13/connector owners).** Import/adapt the actual useful donor packages from verified pins/forks behind LiOS adapters. Complete Telegram/WhatsApp feature-matrix treatment; integrate allowed channel connection/receive/send, media, agents, skills/MCP, model access, automations, memory, browser/computer-use and device runtime where appropriate. The same LiOS user/source/Project grants, trust receipts, side-effect authorization, egress/cost and secret restrictions apply. Platform/rights limitations are recorded, not papered over. Maintain upstream provenance, tests and notices.

**Package 4 — Invisible unified LiOS interaction (SI-07; TC/P4/P9/GM).** Support conversation-first discover/connect/authorize/run/inspect flows. Channel activity must enter existing Chats/Projects with accurate source/delivery labels and permission visibility. Useful outputs become existing P4 Artifacts; the compact chat result, live sidecar and **existing full Workbench** stay synchronized. Notifications and recurrence use P9; mobile/tablet/watch act as permitted clients/nodes of the user's Home, not donor-branded parallel apps. Errors and unavailable states are visible in normal LiOS UX; no donor console or multiple settings stacks.

**Package 5 — Hardening, native shipping and acceptance (SI-07; SP-06/SP-07/P14 owners).** Qualify real entitled model and approved Telegram/WhatsApp user journeys on supported platforms where access exists, plus no-connected-provider/denial/revocation/offline/partial outage/replay, real tool and side-effect approvals, message/media integrity, restart/recovery, cross-Project isolation, storage/secret privacy, resource limits, native packaged regression, mobile continuity and backward-compatible upgrades. Record exact build/commit, environment, permissions, input/expected/actual results, privacy/rights posture, logs/receipts and gaps. Free source CI, unit pass or import counts are **not** native Shipping Point/P14 acceptance. Preserve the owner’s strict $0 additional-cash public-beta contract; do not mark paid signing/notarization production obligations met.

### Agent coordination and non-duplication gate

Before coding, each agent must read `AGENTS.md`, SI execution and shipping contracts, this section, `docs/PENDING_WORK.md`, the donor policy, target subsystem source and the current [master issue #91](https://github.com/kiranvbiim-coder/lios-terminal/issues/91). Claim **one bounded existing implementation-owner task**, state base/head SHA, file ownership and dependency class, inspect open branches/PRs and classify evidence. Do not make simultaneous changes to shared Gateway, P13, TC, P4, P9, schema or release cores without the respective canonical owner. Use distinct branches/PRs; link issue #91 and maintain a concise handoff with exact validation and remaining gaps. Existing SI-01–SI-07, SP-01–SP-07, S0–S10, GM/TC/CA/P IDs and P14 retain their established meanings.

**Acceptance principle:** `upstream found` is not `imported`; `imported` is not `integrated`; `integrated` is not `packaged/authorized`; `packaged` is not `real-user-journey verified`; only the canonical Shipping Point and release authorities may certify acceptance.

## 0.2 Package 1 source inventory and integration constraints — 2026-10-28

**Evidence level: read-only source inspection, not implementation or runtime acceptance.** Base LiOS `main`: `8ab41b15e8d4844982f3d9d5320fea7f77b31cde`; owner decision: PR #392 head `486d28267b650f1dcd05f1012e7511fe70dad3e5`. Approved upstream `openclaw/openclaw@c074824a27c96d3983043f9eeb33823cd1772d8c` resolves to tree `3b2db44f4450ccd69c986e165e8e6d45eaf9a808`. Owner fork `kiranvbiim-coder/openclaw` observed main `0be750916b123c328b8962117213f8c4fd1b2a0a` is **not** an import approval. No local donor checkout was found in the inspected locations; source inspection used exact-pinned upstream paths. No dependency installation, tests, builds, provider login or native qualification was performed for this inventory.

### Existing LiOS owners — reuse before adding service infrastructure

Paths below are relative to `src/`; `PRESENT_UNVERIFIED` describes this inspection, not a downgrade of separately recorded historical evidence.

| Existing owner | Current implementation | Service integration disposition |
| --- | --- | --- |
| Home / GM lifecycle | `main.cjs`, `server/index.ts`, `server/exec/index.ts:getProcessSupervisor` | `PRESENT_UNVERIFIED`: join existing Home startup/shutdown and process supervision; do not introduce an independently persistent vendor daemon. |
| GM supervised IPC | `server/p11SidecarSupervisor.ts:LepSidecarSupervisor` | `PRESENT_UNVERIFIED`: bounded NDJSON, environment filtering, timeout/cancellation, redacted diagnostics and restart eligibility exist. **Constructor explicitly refuses strict long-lived sidecars.** Do not remove this refusal or silently use host execution. |
| GM-11 strict transport | `server/exec/backends/container.ts`, `server/browserRuntimePack.ts`, `server/governedSandboxSession.ts` | `PRESENT_UNVERIFIED`: existing container and framed browser transport are precedents, not generic daemon isolation. Persistent service input policy, network mediation and extinction must be designed under these owners. |
| GM-08 Gateway / device authority | `shared/gatewayProtocol.ts`, `server/gatewayHub.ts`, `server/gatewayRuntime.ts`, `server/gatewayDeviceContinuity.ts` | `PRESENT_UNVERIFIED`: retain sole public Gateway, server-derived scopes, live account/device checks, sequencing and backpressure; service transport stays behind it. |
| P13 plugins / skills / MCP | `server/p13PluginRuntime.ts`, `p13PluginBroker.ts`, `p13PluginHost.ts`, `skillRuntime.ts`, `p13McpServer.ts` | `PRESENT_UNVERIFIED`: reuse registry, trust/install and broker contracts. Node broker's LEP lifecycle is not proof of strict channel-service availability. |
| GM secrets / connector egress | `server/credentialVault.ts`, `server/p13PluginNetworkBroker.ts`, `desktopSecretCustody.cjs`, `shared/secretRef.ts` | `PRESENT_UNVERIFIED`: Home resolves secret handles and current credential snapshots. Donor token files or multi-file Signal credentials must not become a second secret authority. |
| GM approvals / external effects | `server/governedTools.ts`, `conversationGrantStore.ts`, `governedExternalMcpTool.ts`, `exec/execution-journal.ts` | `PRESENT_UNVERIFIED`: exact recipient/action/account binding, dispatch intent and partial/unknown outcome reconciliation belong here; never automatically resend an unconfirmed external effect. |
| GM-12/22 AI access | `server/byoaiRouter.ts`, `openclawAiAccessMethod.ts`, `openclawByoaiFailover.ts`, `byoaiTransport.ts` | `PRESENT_UNVERIFIED`: preserve provider/source consent and cost boundaries. Classification/failover helpers are not proof of universal OAuth/subscription access. |
| GM memory | `server/aiMemory.ts`, `memoryLifecycleTool.ts`, `memoryReflectionTool.ts` | `PRESENT_UNVERIFIED`: existing `durableMemories` and scoped provenance remain authoritative; no donor transcript/index becomes canonical memory. |
| P9 automation | `server/p9AutomationService.ts`, `p9ConditionalInbox.ts`, `p9RunContinuity.ts` | `PRESENT_UNVERIFIED`: channel-triggered work enters current owner/tenant checks and scheduler; exclude donor cron and workflow state as competing authorities. |
| TC / P4 work | `server/projectChatStore.ts`, `conversationRunService.ts`, `artifactStore.ts`; existing Chat/sidecar/Workbench | Existing owners, not new donor stores. Channel-event adoption must resolve an authorized existing Chat and retain P4 outputs through current version/rights contracts. Full channel integration is not located or exercised. |
| GM-09 devices / native clients | `server/deviceRuntime.ts`, `deviceStore.ts`, `devicePairingService.ts`, `shared/devicePairing.ts`, `shared/deviceOutbox.ts` | `PRESENT_UNVERIFIED`: existing Home pairing service/public-key device store and explicitly enabled TLS listener remain authoritative. No donor device identity/pairing database; source presence does not qualify native phone/watch clients. |

Applicable existing test groups include `p11SidecarSupervisor`, `exec/supervisor.*`, `exec/browser-broker-rpc`, `gatewayHub`, `gatewayDeviceLiveAuthority`, `p13PluginBroker`, `credentialVault`, `governedExternalMcpTool`, `aiMemory` and `p9RunContinuity`. These are **reuse candidates, not tests run for this inventory**. No Telegram/WhatsApp adapter or channel-specific integration tests were located in the inspected current LiOS source.

### Pinned channel mechanisms and rights boundaries

All donor paths below are at [approved upstream `c074824a`](https://github.com/openclaw/openclaw/tree/c074824a27c96d3983043f9eeb33823cd1772d8c). `T/` = `extensions/telegram/src/`; `W/` = `extensions/whatsapp/src/`. `ADAPT_REQUIRED` means source exists but is not integrated in LiOS; it is not a provider-support claim.

| Feature | Telegram donor evidence / disposition | WhatsApp donor evidence / disposition |
| --- | --- | --- |
| Transport / account binding | `T/monitor.ts`, `polling-session.ts`, `webhook.ts`, `accounts.ts`, `token.ts`: bot-token Bot API, polling or authenticated webhook, account/token-scoped offsets. `ADAPT_REQUIRED`; not personal-account MTProto. | `W/session.ts`, `session.runtime.ts`, `accounts.ts`: Baileys WhatsApp Web linked-device QR authentication. `BLOCKED_BY_PLATFORM_OR_RIGHTS` for distribution pending dependency/transport review; not Meta Cloud API. |
| Inbound 1:1 / groups | `T/group-access.ts`, `bot-update-tracker.ts`: group/topic and sender policies plus update acknowledgement. `ADAPT_REQUIRED`: replace donor policy and conversation routing with LiOS authority. | `W/inbound/access-control.ts`, `group-policy.ts`, `inbound/monitor.ts`: DM/group admission and mention handling. `ADAPT_REQUIRED` mechanically, distribution gate remains; donor pairing store is not LiOS authority. |
| Outbound / replies / topics | `T/send-message.ts`, `reply-parameters.ts`: exact reply/topic/quote targeting. `ADAPT_REQUIRED`: preserve recipient/topic admission; do not retry outside a rejected topic. | `W/send.ts`, `quoted-message.ts`, `inbound/send-api.ts`: quoted native message key, JID and preview facts. `ADAPT_REQUIRED`; bare message ID is not sufficient for a quoted reply. |
| Edits / reactions | `T/send-edit.ts`, `send-actions.ts`: edit text/caption/markup and native reactions. `ADAPT_REQUIRED`, including current rights and target review. | `W/action-runtime.ts`, `inbound/send-api.ts`: native reactions present; outbound edit capability not established in inspected adapter. Reactions `ADAPT_REQUIRED`; edits `DEFER_WITH_TRIGGER` until exact adapter/platform review. |
| Media / attachments | `T/send-message.ts`, `outbound-media.ts`, `outbound-media-batches.ts`: MIME shaping, batching and partial receipts. `ADAPT_REQUIRED`; local configured size does not override provider limits. | `W/send.ts`, `inbound/send-api.ts`: text chunks, image/video/document/audio payloads and upload handling. `ADAPT_REQUIRED` subject to rights gate; media decoding/native dependency closure requires separate packaging evidence. |
| Dedupe / ingress acknowledgement | `T/telegram-ingress-spool.ts`, `message-dispatch-dedupe.ts`, `bot-update-tracker.ts`: update identity plus logical-message guard and safe offset watermark. `ADAPT_REQUIRED`: acknowledge only after canonical LiOS durable adoption. | `W/inbound/durable-receive.ts`, `inbound/dedupe.ts`: account-scoped receive queue, native ID identity, conversation lanes and outbound-echo guard. `ADAPT_REQUIRED`: use canonical LiOS admission/dedupe rather than donor authoritative inbox. |
| Send outcome / retry | `T/send-context.ts`, `send-message.ts`: non-idempotent retry classification, throttle reauthorization and per-part accepted IDs. `ADAPT_REQUIRED`; API acceptance is not recipient read/delivery. | `W/outbound-retry.ts`, `inbound/send-result.ts`, `inbound/socket-session.ts`: accepted/partial/unknown outcomes, bounded retry and late-acceptance handling. `ADAPT_REQUIRED`; unknown or partial sends must not replay. |
| Session / history | `T/monitor.ts`, `bot-message-context.session.ts`: token-scoped offsets and donor session recording. `ADAPT_REQUIRED`: replace donor transcripts with current Chat ownership; no complete-history claim. | `W/session.ts`: multi-file credentials/Signal keys and backups; `syncFullHistory:false`. `ADAPT_REQUIRED` for custody; bounded quote caches do not provide full history or OS-protected storage. |
| Automation / AI / durable work | Donor dispatch/session hooks require existing P13/GM execution, P9 schedule, source/AI consent and P4 persistence substitutions. `ADAPT_REQUIRED`; no background auto-response grant inferred. | Same LiOS substitutions required, plus linked-device/rights gate. `ADAPT_REQUIRED`; no independent donor agent, scheduler, memory or Artifact authority. |
| Outbound delete | `T/send-actions.ts:deleteMessageTelegram` calls `deleteMessage`, returning explicit warning on forbidden/missing/invalid outcomes. `ADAPT_REQUIRED`, not automatic deletion success. | No delete action established in inspected `channel-actions.ts`, `action-runtime.ts` or `inbound/send-api.ts`. `DEFER_WITH_TRIGGER`: identify exact native action, owner/recipient admission and tests before enabling. |
| Inbound edits / deletes | `T/bot-handlers.inbound-pipeline.ts` handles edited messages/channel posts by reauthorization and reply-chain recording, not ordinary new-message agent dispatch. Edits `ADAPT_REQUIRED`; delete-to-tombstone sync not established—`DEFER_WITH_TRIGGER` for provider event and canonical mutation review. | Upsert/content handling inspected in `inbound/message-delivery.ts` and normalization does not establish edit/delete synchronization. `DEFER_WITH_TRIGGER`: inspect native update/revoke events and authorized canonical revision/tombstone mapping. |
| Contacts / identity | `T/directory-config.ts` provides configured peers/groups; `send-context.ts` performs chat lookup. `ADAPT_REQUIRED` for configured identity resolution; complete address book/contact-card support not established. | `W/inbound/extract.ts` parses contact/vCard payloads; `inbound/send-api.ts` contains `sendContact` but inspected public inbox return does not expose it. `ADAPT_REQUIRED` for inbound contacts; outbound public wiring needs inspection, not inferred from the primitive. |
| History / catch-up detail | `T/history-read.ts` reads bounded retained local cache with current account/group/topic policy. Bot API pre-join history is explicitly unavailable in event bindings. `ADAPT_REQUIRED` for canonical retained history; no full provider import claim. | `W/session.ts` disables full history sync; bounded reconnect append handling and durable ingress replay exist. `ADAPT_REQUIRED` for catch-up only; complete account-history import remains `DEFER_WITH_TRIGGER` for native history ownership and consent review. |
| Structured operations / interactive features | `T/send-forum-topics.ts`, `send-location.ts`, `send-special.ts`, `send-actions.ts`, callback/native-command handlers: topic changes, location, polls/stickers, pin/unpin and typing mechanisms. `ADAPT_REQUIRED`: preserve correlation, current authority and partial outcomes, not just send/receive. MiniApp/native-menu integration remains separately undispositioned. | Existing poll/upload/reaction action descriptions are not blanket parity with Telegram or Baileys. `DEFER_WITH_TRIGGER` for each additional native operation until actual adapter wiring, account/provider authority and applicable tests are established. |

Telegram Business scope and outgoing recipient-delivered/read event projection remain unestablished by this inspection. They require additional exact adapter/platform review before promotion. WhatsApp forum-style subthreads were not established; a quoted reply is not a thread namespace.

Pinned Telegram manifest uses grammY `1.46.0`, throttler `1.2.1`, `undici` `8.10.2`, TypeBox `1.3.34` and Zod `4.6.5`. WhatsApp uses patched `baileys@7.0.0-rc14` and `audio-decode@3.12.0`; inspect the checked-in donor patch, not just the version. Root donor Node requirements are `>=24.16.0 <25 || >=26.1.0`, distinct from LiOS source CI Node22. Dependency substitution or a separately managed verified service runtime needs an explicit decision; do not silently upgrade the entire LiOS host.

**WhatsApp rights gate:** exact locked [`libsignal@6.0.0` metadata](https://registry.npmjs.org/libsignal/6.0.0) declares GPL-3.0; Baileys MIT and OpenClaw MIT do not establish clearance of the combined distribution. Isolation alone is not legal approval. Continue inspection and evaluate permissible alternatives without packaging this closure or declaring WhatsApp dropped from scope.

**Platform-use gates:** [Telegram developer terms](https://telegram.org/tos/bot-developers) require purpose limitation, accessible privacy policy, deletion/retention controls, encrypted-at-rest data, and consent for submitted data. Group/channel access is not permission to scrape into an AI corpus. [Bot FAQ](https://core.telegram.org/bots/faq) documents privacy-mode visibility, mutually exclusive polling/webhook modes and free rate limits; do not enable paid broadcasts under the $0 baseline. [WhatsApp business terms entry](https://www.whatsapp.com/legal/business-terms/) distinguishes Business App and Business Platform terms; neither is evidence that the inspected linked-device transport is authorized for the intended use. Full selected-transport terms/advisory review and entitled connected-provider journeys remain open.

**Official WhatsApp alternative is not automatically cleared:** [WhatsApp Business Platform terms](https://www.whatsapp.com/legal/WhatsApp-Terms-for-WhatsApp-Business-Platform) (effective September 23, 2026) restrict use to business/commercial authorized purposes, not personal use. Incorporated [Meta Platform terms](https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform), §4.7, restrict making general-purpose AI assistants the primary functionality, subject to specified country exceptions; §3 defines fees and §4.2 restricts certain regulated information. No country/account exemption, permitted provider arrangement or $0 usage entitlement was established here. An official Cloud API implementation therefore needs its own eligibility/data/cost review and cannot silently replace linked-device functionality or evade the applicable platform terms.

**Scope of this record:** P1.01/P1.02 identity and existing-owner inventory, P1.03 family inventory and P1.05 source-level channel feature matrix attest inventories with explicit uninspected/deferred rows, not full audits or connected-provider acceptance. P1.08 executable typed IPC and P1.09 acceptance definitions are recorded below. P1.04 full selected-package/fork dispositions and P1.06 complete rights/security clearance remain open. Strict service-session mechanics now have bounded source/runtime proof below; Home lifecycle registration and canonical account/request/event custody remain open. No donor service is enabled by this document.

### Useful-package breadth register — P1.03/P1.04

This is an exact-pin tree/entrypoint inventory, **not a full useful-package audit or approved import manifest**. `PARTIAL` means named entrypoints or critical sections were read; `NOT_INSPECTED` means paths were located but bodies remain unaudited. Reuse proposals are design inferences, not permission to import. Preserve each family for subsequent path/dependency/test disposition rather than dropping it behind the channel examples.

| Family | Approved-pin donor paths | Inspection / canonical LiOS owner / proposed adaptation |
| --- | --- | --- |
| Agents, delegation, sessions | `packages/agent-core/src/`, `src/agents/subagents/`, `src/config/sessions/`, `packages/session-url-contract/` | `PARTIAL`: reuse streaming, cancellation, compaction and delegation through GM `agentLoop`/checkpoint owners; exclude donor canonical session/chat ledger. |
| Coding / ACP | `extensions/acpx/src/`, `src/acp/`, `packages/acp-core/src/`, `extensions/codex/` | `PARTIAL`: adapt harness/admission/cleanup under existing GM/P13 ACP and execution owners, not a donor Gateway or approval system. |
| Tools / process execution | `src/agents/tools/`, `src/node-host/invoke.ts`, `extensions/{crabbox,openshell,code-mode-quickjs}/`, `packages/{tool-call-repair,retry}/` | `NOT_INSPECTED`: inspect complete execution/repair package and tests before selecting; GM-11/P13 grants and sandbox remain final authority. |
| Browser | `extensions/browser/index.ts`, `plugin-registration.ts`, `src/browser-tool.ts` | `PARTIAL` registration only: inspect sessions/tabs/proxy/tool mechanics against existing governed browser owner; exclude donor control plane/UI. |
| Computer use | `extensions/cua-computer/` | `PARTIAL` registration/driver checks only: inspect native commands/artifact verification under GM/P13 computer boundary; no native permission/target acceptance inferred. |
| Model/auth/local access | `src/agents/model-auth.ts`, `auth-profiles/`, `src/provider-runtime/`, `packages/{ai,llm-core,model-catalog-core}/`, provider extensions | `PARTIAL` facade only: retain protocol/auth mechanics through current AI-access/connector owners; exclude duplicate vault/model router, silent paid fallback and unconsented egress. |
| Memory / retrieval | `extensions/{memory-core,active-memory,memory-lancedb,memory-wiki}/`, `packages/memory-host-sdk/`, `src/memory/` | `PARTIAL`: inspected `memory-lancedb/memory-policy.ts` query normalization and escaped historical-context wrapper; adapted per-Project opt-in owner-authored recall into existing memory/conversation owners. Canonical full-text rank, current consent/revision fences and private no-fallback AI policy replace donor vector/store/capture authority. No embeddings or auto-capture; broader family remains open. |
| Scheduling / notifications | `src/cron/service.ts`, `src/cron/service/`, `src/cron/delivery*.ts`, `extensions/{llm-task,lobster,imap}/` | `PARTIAL`: scheduler/delivery/recovery mechanisms may deepen P9; exclude second active scheduler/jobs DB. IMAP entry is inbound watching, not proven general outbound mail. |
| Skills / plugins / MCP | `src/{skills,plugins,mcp}/`, `src/agents/mcp-*.ts`, `packages/{plugin-sdk,plugin-package-contract}/` | `NOT_INSPECTED` beyond channel SDK seams: inspect complete transport/lifecycle/auth package; P13 owns install/trust/grants/brokers, not donor marketplace or OAuth store. |
| Media / speech / extraction | `src/{media,media-understanding,tts}/`, `packages/{media-core,media-generation-core,media-understanding-common}/`, media/provider extensions | `PARTIAL`: complete selected speech-text/cleanup bodies and tests inspected; adapted into existing P12/Chat display projection and cancellable local playback, with actual macOS source-Home synthesis. General attachments/STT/transcoding/cloud media remain open; no implicit upload/model download or paid generation. |
| Search / extraction | `src/web-search/runtime.ts`, `extensions/{brave,duckduckgo,exa,firecrawl,parallel,perplexity,searxng,tavily,web-readability}/` | `NOT_INSPECTED`: compare adapters/normalization against P5/P7 source rights, egress and citation owners; no new research store. |
| Devices / diagnostics | `src/node-host/`, `src/pairing/`, `packages/{gateway-client,gateway-protocol}/`, `extensions/{device-pair,linux-node,bonjour,geolocation,file-transfer,diagnostics-otel,diagnostics-prometheus}/` | `NOT_INSPECTED`: existing GM device/Home/Gateway owns trust and state; assess transport/diagnostic mechanics without new pairing authority, public metrics ingress or default external telemetry. |

Other exact tree-discovered text-channel families at `extensions/<id>/src/channel.ts`: `a2a`, `buzz`, `clickclack`, `discord`, `feishu`, `googlechat`, `imessage`, `irc`, `line`, `matrix`, `mattermost`, `msteams`, `nextcloud-talk`, `nostr`, `qa-channel`, `raft`, `reef`, `signal`, `slack`, `sms`, `synology-chat`, `tlon`, `zalo`, `zalouser`. Bodies remain `NOT_INSPECTED`; directory presence is not official transport/rights/usefulness proof, and `qa-channel` is not assumed to be a user integration. `extensions/twitch/index.ts` was partially read as an IRC channel registration. Meeting/voice candidates `facetime`, `google-meet`, `slack-huddles`, `teams-meetings`, `zoom-meetings`, `voice-call` remain separately uninspected, not silently equated to text channels.

Applicable donor tests located (not run or ported): agent-loop async-tool/yield/continuation; ACPX native-permission/owner/cancellation/process-cleanup; tool-call-repair grammar/payload/protection; browser session-tab/proxy/upload/security; CUA command/driver/policy; cron grant-generation/recovery; MCP real cleanup; channel catalog/outbound-payload/shape contracts. Telegram exact HTTP edit/recovery, dedupe/update-offset/webhook/group-policy tests and WhatsApp retry/partial-delivery/durable-receive/socket-lifecycle/session tests accompany their respective selected mechanisms. Full disposition of these groups and fork-only material deltas is required before `full_useful_package_audit`, not inferred from this inventory.

### Confirmed service-runtime and distribution seams — 2026-10-29

Exact approved-source inspection with a real frozen development dependency install establishes additional integration constraints; it does not certify a distributable or connected service.

- **Dispatch injection is not canonical-state substitution.** Telegram `bot-message-dispatch-turn.ts` enters SDK `runChannelInboundEvent` → `runChannelTurn` → `dispatchRoutedChannelTurn`. `channels/turn/lifecycle.ts:assembleResolvedChannelTurn` hardwires donor session paths/recording, and `execution.ts:runPreparedChannelTurnCoreInTrace` merges/records transcript and route state before injected dispatch. Telegram context also synchronously reads session timestamps. A late `dispatchReplyFromConfig` override alone would retain competing state authority.
- **One bridge must cover multiple real entry paths.** `runtime-channel.ts` dispatch injection does not cover all direct SDK calls. Discord ordinary messages use `dispatchChannelInboundTurn` without the override; Feishu/LINE/Google Chat use `inbound.run`; Slack forwards dispatch; ClickClack directly calls `runtime.llm.complete`. `createPluginRuntime` always constructs its agent surface and exposes getter-only media/LLM surfaces. Do not supply a fake all-method SDK or rely on overriding a single callback.
- **Required owner interfaces:** asynchronous current account/tenant/source/consent routing and canonical context reads; durable ingress adoption/replay disposition; canonical turn execution/cancellation with streamed approval/progress/result; exact-admitted outbound/media effects and independent delivery facts. Existing Home Chat, conversation execution, P13/GM and P4/P9 owners remain authoritative. Move authoritative preparation to awaited boundaries; synchronous donor session reads cannot be transparently converted into pipe RPC. Current supporting-service protocol lacks general worker-initiated owner RPC and must not claim that bridge exists.
- **Transport-local state only:** bounded debounce/history working sets, typing/draft queues and delivery correlation may remain ephemeral in the service. No second canonical transcript, replay ledger, approval, vault, provider receipt or device identity store.
- **Root package is not raw `dist`.** Default source orchestration stages isolated WhatsApp/ACPX output under `dist/extensions/`, while root `package.json` explicitly excludes `whatsapp`, `acpx`, `qa-lab` and private QA surfaces. Private QA requires `OPENCLAW_BUILD_PRIVATE_QA=1`; Crabline's libsignal closure is reachable from QA runtime, not merely a test. WhatsApp dependencies include Baileys/libsignal and GPL/LGPL audio decoders; ACPX carries custom-licensed Claude runtime payloads. Preserve existing optional-package separation, not a blanket copy of `dist`/`node_modules`.
- **Distribution proof still required:** root npm exclusions and inspected worker entry chains are not exhaustive transitive absence proof. Sealed workers bundle reachable nonbuiltins. Retained worker/shared-chunk module attribution, final root-pack file list, exact installed runtime dependency/native-asset closure and license/notice texts must be checked before any binary publication. Development installation and isolated compilation are not license or provider-terms clearance.
- **Measured root distribution and source custody:** actual instrumented build/root-pack inspection at run40822536990 retained complete root file/module identifiers; local reconstruction verified their report hashes.364exact module-attributed package roots map to238distinct retained verbatim license/notice texts under `third_party/licenses/openclaw-service/`; an index binds package/version/root and notice hashes. This is root-config attribution, not final transitive distribution clearance. Missing root notices were resolved to exact source grants for Pi (`earendil-works/pi@13cbf77d`, Mario Zechner2025), `http_ece` (`0562510a`, Martin Thomson2015), standard-webhooks library (`b4d2c14f`, Svix2023) and werift (`b530e627`, shinyoshiaki2020); Pi includes separate OpenTUI attribution, standard-webhooks includes Deno timing-safe-equal attribution, and werift carries inherited BSD/ISC/MIT notices plus incomplete mpegts source attribution. Retain applicable secondary notices; MIT metadata alone did not expose these obligations.
- **Owner MPL decision, bounded:** quiz selected keeping `web-push@3.6.7` with exact covered source/notices, not excluding push capability to avoid obligations. Verified npm source archive SHA256 `85774fffee09f70bde084cebcebae20b3cf6f48239f61659e45aed9fd513463e`/published SHA512 matches; complete unmodified published source and its copyright are retained at `third_party/sources/web-push-3.6.7/`, full MPL2.0 at `third_party/licenses/MPL-2.0.txt`. All11retained source files match the recorded hashes. Future executable packaging must preserve recipient source rights/notices and review generated combined-file/modification obligations; neither owner approval nor upstream-only source custody is blanket legal/platform/release clearance.
- **Nested/WASM closure remains explicit:** QuickJS `encoding.so` is a WASM shared library, not a host-native executable. `quickjs-wasi@3.6.2` source `5a7a0eed` includes QuickJS-NG submodule `6d46d07d`, MIT notices and Unicode LicenseV3 data; WASI toolchain/libc/compiler-runtime composition still needs exact archive/link/notice proof. `tree-sitter-bash@0.25.1` source `80132668` has Max Brunsfeld2017MIT and an emitted grammar-license sidecar, but exact WASM toolchain contributions remain unestablished. Nested Canvas, diffs/Shiki, Discord and workboard bundlers may strip legal comments and do not inherit root module attribution; retain their actual input/source/notice inventories before distribution. Do not solve this by omitting requested useful families without a recorded disposition.
- **Nested browser custody now exercised without a root rebuild:** unchanged approved Canvas config and existing Workboard builder ran only their selected browser targets, offline/non-root/read-only over the existing frozen dependency cache (768MiB cap, no installs/downloads/runtime output publication). Canvas variants include543unique modules across15package roots; Workboard189inputs reproduce exact root-contained generation `a879fbe936e719c4ca2dda438c2be1d761f456033d1758ee7378d65cd939a711`. Nineteen combined exact roots map to retained notices or explicit donor-root inheritance; nine additional distinct verbatim texts are retained with SHA256 bindings in `third_party/licenses/openclaw-service/nested-runtime-attribution.json` / `nested-package-notices.txt`. Canvas's optional `@a2ui/markdown-it` remains a recorded dynamic peer import; its inspected code renders inert Lit text when absent, not a bundled or fetched renderer claim. Discord/diffs assets are absent from this actual root-pack inventory and require their own selected-plugin closure rather than a redundant root audit.
- **Cryptographic WASM source identity now verified:** installed Bash grammar `8292919c…be6a7a` passed `gh attestation verify` with exact source `80132668`, trusted reusable workflow `67eb38f6` and self-hosted-runner refusal; the matching complete-source archive digest is attested. Actual QuickJS/encoding and web-tree-sitter member hashes were bound to SHA512-verified npm archives, then their SLSA certificates/signatures/source commits/workflows passed the same verifier (`5a7a0eed`, `6070dbfe`). Full successful evidence is retained in `tree-sitter-bash-verified-provenance.json` / `wasm-npm-verified-provenance.json`; binaries were never instantiated or imported into LiOS. Source notice custody now includes exact QuickJS-NG MIT/source headers, UnicodeV3, Tree-sitter ICU text and applicable WASI/Emscripten/musl/cloudlibc/compiler-rt texts, with omnibus applicability caveats. **Remaining:** actual linked-object/source-specific closure and consumed toolchain identities, including historical Bash CLI/Emscripten override; verified provenance is not permission to claim exhaustive distribution clearance.

### Governed outbound channel design — canonical-owner cutover

**Plain-text/reply implementation is present; broad outbound remains incomplete.** Connections now requires explicit separate versioned outbound/target-metadata provider-use consent, off by default; importing alone never enables sending. `lios.channel.telegram.targets` and `lios.channel.telegram.send_text` use existing Project Chat, P13 exact once-only approval, L5 dispatch and Home protected-token/P13-pinned HTTP owners. The owner sees the complete exact recipient/text/topic/reply/silent projection before approval. The broader contracts below remain requirements for other actions, rich/media/multipart and other channel transports—not a claim they are implemented.

1. **Exact reviewed operation.** Register the channel adapter in existing `conversationRuntime.ts:registerConversationTool` / `GovernedToolRegistry` as external, write, `user_confirm`, `allowProjectApproval:false`, `replaySafe:false`. Operation-specific schema binds source/account, canonical Project/Chat, exact provider recipient/conversation/topic/reply identity, exact text or immutable attachment/version/hash and action kind. No worker-supplied method/URL/token, recipient fallback or broad standing-send grant.
2. **Current policy before intent.** Extend the existing `beforeExternalDispatch` preflight branch, following `preflightGovernedExternalMcpTool`; resolve canonical owner/org/source/consent/allowlist/credential-generation/AI disclosure and attachment rights after approval consumption and before L5 intent. Include the live account/credential/policy generation in `policyBindingSha256`. A refusal before intent has no external effect and must not manufacture unknown delivery.
3. **Home-owned physical dispatch.** Existing `telegramNetworkBroker.ts` is fixed to `getUpdates`, not a generic sender. Add an independently validated fixed provider operation behind Home custody and pinned P13 egress only when its exact adapter is implemented. Recheck current authority immediately at dispatch; stream/cancellation bounds remain absolute. Worker transformations carry no token or network grant. File fetch/upload is a separate admitted attachment operation, never arbitrary local path/remote URL forwarding.
4. **Durable, distinct outcomes.** Existing `tool_call_dispatch_intent`, `tool_call_dispatch_no_effect`, `tool_call_dispatch_committed` and unknown-effect recovery remain canonical. Provider acceptance is not delivery/read. Retain accepted native message/part identities before releasing later parts; partial or post-entry unknown outcomes prohibit automatic resend, target substitution, replay on resume/restart or treating a cancellation as no effect. Existing generic commit refs alone are insufficient custody for per-part channel delivery facts: add operation-specific evidence through the same Ledger/Chat owners, not a worker receipt store.
5. **Unified visible result.** Approval and compact result stay in existing Chat; retained output/evidence uses current P4 identity and source rights. Current Connections permissions govern whether outbound operations can even be offered. Account disconnect/revocation clears availability, not recorded effect evidence. Provider read/delivery updates require actual supported authenticated events and separate admission; never synthesize them from a successful HTTP response.

**Required implementation proof:** exact owner/recipient/content approval and foreign tenant/Chat/source rejection; no HTTP on pre-intent refusal; cancellation/revocation at each physical dispatch; provider rejection, acceptance, response loss and part-two failure with part-one custody; no duplicate after restart/resume; attachment scope/size/type/current rights; exact topic/reply identity without fallback; secret-free logs/receipts; normal Chat approval/result surface. Use synthetic HTTP/real DB boundary proofs first; live entitled provider and native journeys remain separate shipping gates. Reuse these tests unchanged while only transport adapters differ; do not launch the three-platform matrix per operation.

**Implemented text package and proof:** single plain-text payload≤4096characters, explicit forum/private/channel-direct-message topics and strict reply identity, no parse mode/link preview, fallback, hidden split or automatic retry. Current source/owner/org/active Project/Chat, separate consent, selected-source policy and credential generation bind discovery/review/pre-intent/physical dispatch/release. Target metadata is ephemeral private AI-review context with current release fences and no fallback, not checkpoint or donor state. Known provider acceptance is retained with actual message/recipient/topic/reply facts in the existing Project Ledger before any later authority/output observer can fail; delivery/read remain unknown. Provider rejection versus post-entry unknown outcome stay distinct and do not authorize resend.

Actual scratch canonical conversation-run smoke used three synthetic local model HTTP calls: discover→current private review→exact owner pause→allow once→one real pinned-loopback send→canonical L5 intent/commit→one user/assistant message pair→cold-reopened acceptance751. Zero send before approval; replayed review refused. Actual source Connections UI started outbound-off and refused missing outbound consent before any setup POST. Actual production review component rendered the recorded exact text/topic/reply, kept its expired approval disabled and visibly refused a stale submission through the real review endpoint. This is source/real DB/HTTP/renderer evidence; no entitled Telegram, native install or SP acceptance. Rich formatting, long/multipart/media send, edits/deletes/reactions, inbound execution/automatic replies, full worker/SDK bridge, delivery/read events and other channel families remain open.

Target-metadata follow-through: source-policy revalidation reloads the active ResearchArtifact head at actual review/provider release, not only the original connection's digest. Exclusion/head drift or changed Project/Chat/reference-transmission scope requires fresh inspection. Failing-before/passing-after real-DB regression plus canonical runtime/local-model HTTP proved zero metadata-bearing requests after actual source-policy version change; current account/consent/credential checks remain composed.
Retained imported Chat history also rereads bounded owner/org-scoped current canonical rows before each AI release. A captured row must still exist with identical content, role, Chat, original retention time and ingress facts; current source/consent/retention rules remain composed. Actual deletion/edit/permission-change regressions and a real model-HTTP release smoke refuse stale captured text rather than transmitting it or silently swapping content into an already prepared request.

### Consented incoming execution — canonical adopted-message cutover

Connections now keeps import, provider context, automatic incoming execution and outbound as distinct permissions. Automatic work is absent/default-off for legacy policies; enabling requires separate versioned execution consent, explicit observed `user:`/sending-`chat:` actors and bounded rolling hour/day/per-run limits. A sender-chat identity takes precedence over compatibility `from`; forwarded identities and display names cannot authorize execution.

Adoption binds original input, exact execution-consent generation and policy into existing canonical metadata. Home's bounded discovery filters current consent/policy, retention, actor, AI permission and unedited originals before its three-candidate limit, preventing old excluded rows from starving current messages. Only canonical ingress IDs enter the existing conversation owner. Migration0088 permanently claims existing ingress custody before journal admission; no duplicate user row, second run store, auto-reply hookup or worker-selected owner/text/flags. Unique source/Chat in-flight and assistant-output constraints preserve at-most-once admission across the SQL/filesystem gap, including unknown/crash/journal-failure cases.

Provider, tool and output release retain current input/owner/source/consent/AI fences through delegation, one physical AI-call ceiling, organization classification and no fallback. Fresh exact owner review remains mandatory for consequential tools; Project standing grants do not self-approve incoming work. The canonical registry signal binds exact approval while a separate combined signal enforces the original run deadline across live resumes. Interrupted incoming requests cannot restart automatically or via ordinary agent-restart endpoints.

Actual authenticated source UI + real PGlite/pinned-loopback/canonical run/local-model HTTP proof: separate consent required before POST; explicit actor/limits saved with outbound off; two admitted originals each reused their existing user row and produced one assistant result; foreign actor stayed import-only; third eligible message hit the hourly cap without another model call. Existing Gateway invalidation updated the already-open owning Chat without refresh, preserved external-author provenance and reused the normal run observer. Cold process reopen retained two settled claims, four imported rows and two answers; rediscovery made zero model/poll calls. Owner disconnect revoked execution/import consent and removed its protected token without deleting cursor/history/claims. Focused source/provider/tool/approval/migration/type/manifest evidence is recorded in `docs/PENDING_WORK.md`; no donor-service/native/live-provider or full-family acceptance follows.




### Selected lifecycle and Telegram package assessment — P1.04 evidence

**Exact pin remains `c074824a`; byte-framing and awaited-output mechanisms below are integrated in this branch.** Other assessed mechanisms remain candidates. Complete useful-package reuse is the target; these staged dependencies are not an arbitrary cap on adoption.

| Selected mechanism | Inspected donor closure / test | Disposition and LiOS-specific remainder |
| --- | --- | --- |
| Byte-bounded LF framing | `src/process/bounded-line-framer.ts` and `.test.ts`; Node Buffer only | `DIRECT_REUSE` in `server/exec/bounded-line-framer.ts`; implementation byte-equal beyond provenance header (upstream SHA256 `8a1a82baafa087e3060c3ec9fef51f45b52e783e8aef3168870b1cb9a7823c3c`). Both donor tests ported. LiOS transport supplies schema/generation/EOF/aggregate queues. This is not a full supervisor-family import. |
| Awaited output consumer | `src/process/decoded-output.ts` and `.test.ts`; deferred/error/Windows decoder helpers | `ADAPT` integrated into existing `server/exec/decoded-output.ts` and GM child/supervisor using current LiOS UTF-8/deferred implementation. Explicit async consumers apply native pipe pressure and completion retains accepted work. Relevant donor tests are ported; bounded runtime evidence appears below. No second supervisor. |
| Owned stdio and relay | `src/process/owned-stdio.ts`, `supervisor/service-child-output-relay.ts`, relay-host/retirement/cleanup/protocol/group-ownership families and associated awaited-output/cleanup tests | `COMBINE/ADAPT` custody invariants through current GM container plan/finalize/extinction path. Larger donor closure reaches worker-entrypoint/build output, spawn broker, secret FDs, Linux OOM and Windows native Job machinery; it is not wholesale-import cleared or cross-platform proven. |
| Generation-safe auth publication | `src/gateway/server-shared-auth-generation.ts` and tests | `ADAPT` stale-refresh compare/publish invariant, not donor config reload, credential store or Gateway authority. Existing Home/account/P13 revisions remain authoritative. |
| Telegram polling worker | `extensions/telegram/src/telegram-ingress-worker.runtime.ts`, worker/allowed-updates/API-root/deadline/network helpers and runtime tests | `ADAPT`: real injected `deps.fetch` and parent `spool-ack` seams exist. Home must own token/egress and persist canonical validated update before ACK/offset advancement. Default bootstrap carries token and is not safe broker-only adaptation unchanged. |
| Telegram send/format/media family | `send-prepared.ts`, chunk/reply/thread-proof, rich/plain/HTML/text formatting, media batches/MIME, mutation/topic/location/poll helpers; exact HTTP recovery/edit/media tests | `ADAPT/COMBINE`: retain useful formatting and accepted/partial/unknown semantics. Replace actual account/attachment/receipt/history/correlation authority; do not satisfy SDK imports with no-ops. |
| Telegram full plugin host | `index.ts`, `channel.ts`, `runtime.ts`, `runtime.types.ts`, SDK entry/runtime-store helpers | `REJECT_WITH_EVIDENCE` as a second host/authority, not as rejection of transport features: `setTelegramRuntime` accepts broad donor `PluginRuntime`, and direct imports still reach config/session/cron state. Preserve meaningful setup/status/MiniApp/native-command features for separate adaptation/disposition. |

The Telegram public sender's `send-context.ts → target-writeback.ts` can reach config mutation and cron-store load/save; `polling-session.ts` drains donor pending deliveries periodically. SDK `channel-outbound` combines pure receipt values with durable-delivery/session authority; `proxy-capture` includes SQLite storage. Importing those barrels unchanged would defeat the isolated-service state boundary even for a send-only adapter. Extract retained helper implementations with exact provenance and real LiOS authority substitutions.

For broker-only token custody, adapt worker request construction to opaque credential references and Home-executed Telegram methods. The unmodified worker constructs `/bot${token}/getUpdates`; ephemeral token possession is not equivalent to “worker never sees secret.” Apply the same current authority to polling, probes, sends/mutations, webhook management, callbacks and media; a proxy setting alone is not egress enforcement.

Telegram's direct Undici `8.10.2` requires Node `>=22.19.0`; root host requires newer Node as recorded above. LiOS Node `22.12.0` does not satisfy that direct dependency. Do not silently use the installed host interpreter; record any managed runtime or dependency substitution with exact package closure and platform evidence.

This assessment does not certify every Telegram/MiniApp/native-command import edge, all transitive advisories/licenses or full owner-fork material deltas. No `full_useful_package_audit`, donor exhaustion or deploy-ready package is claimed.

**Finite polling-only source closure (P1.04, still not the full useful Telegram family):** `T/` below is `extensions/telegram/src/`, `N/` is `packages/normalization-core/src/`; all OpenClaw candidates are at approved `c074824a`, not the observed owner-fork HEAD. Source inspection found that the polling state machine can avoid installing the donor host, grammY, Undici, proxy or SQLite dependency graphs after the following real authority substitutions:

| Exact candidate paths | Retained mechanism / disposition |
| --- | --- |
| `T/telegram-ingress-worker.runtime.ts`, `T/telegram-ingress-worker.ts` | `ADAPT` poll cadence, retry/stop and ACK-before-offset ordering. Replace Worker bootstrap, token/options, parent port and network invocation with current Home interfaces; never import a fallback direct fetch. |
| `T/allowed-updates.ts`, `T/request-timeouts.ts` | `ADAPT` explicit update selection, default poll30s/cap40s and getUpdates45s request deadline. Keep non-conversation update families visible; a missing conversation identity cannot be invented or silently ACK/dropped. |
| `T/api-root.ts` | Home-only normalization/token-path construction, not worker URL authority. Observed fork differs from the approved stripping/normalization behavior; no fork substitution is approved by observation. |
| `T/network-errors.ts`, `src/plugin-sdk/retry-runtime.ts` | Select polling recovery/error-code classification only, excluding send/edit/migrate recovery and donor SDK barrels. Keep actual retry wait separate from bounded wire diagnostics; preserve fatal401/409 vs retryable failures and redact provider URLs/raw errors. |
| `N/error-coercion.ts`, `N/string-coerce.ts`, `N/number-coercion.ts` | Select error-graph/code/name, nullable/optional/lowercase string and finite/timer helpers only; substitute existing equivalent LiOS helpers where behavior matches. No broad normalization barrel or config authority. |
| `src/infra/http-response-body.ts`, `src/infra/http-response-body-timeout.ts`, `N/response-bytes.ts` | `ADAPT` bounded whole-body reading, overall/idle deadline and nonsettling-cancel behavior. Cancellation must remain attached through body consumption, not stop at response headers. |
| Existing imported `src/process/retry-timing.ts` → `server/exec/retry-timing.ts` | `DIRECT_REUSE` current LiOS mechanism; do not create a second retry implementation. |
| `grammy@1.46.0/out/bot.js` default-update literal | Candidate data-only extraction; separate MIT copyright/notice required if copied. No grammY executable/package import is selected by this polling assessment. |

Relevant inspected donor tests: `T/telegram-ingress-worker.runtime.test.ts` (durable-before-offset, activity reset, empty-poll cadence,429 hints, malformed/HTML errors,401/409 fatal); `T/telegram-ingress-worker.deadline.test.ts` (stalled response body); `T/telegram-ingress-worker.test.ts` (bounded stop, replacing only actual worker wiring); selected `network-errors`, Home-only `api-root` and bounded HTTP-body deadline/cancel cases. Existing timing tests are reused. DNS/proxy/SOCKS tests are not ported as fake no-op support; donor bot/forum/probe/store tests need real canonical LiOS adoption/account replacements. The observed fork's main polling/runtime/deadline tests match the approved pin; its API-root and timeout/bootstrap adaptations do not confer approval.

Unresolved integration facts: current P13's public pinned transport caps requests at30s while donor getUpdates needs45s; its credential seam injects headers while Telegram tokens occupy the URL path. Donor polling accepts up to4MiB raw body, which expands beyond the current4MiB service frame when base64-encoded. Select a bounded Home response/chunk/reference protocol explicitly—do not silently clip provider bodies or globally weaken P13. Numeric donor spool IDs also require durable canonical event/cursor correlation before UUID service adoption ACKs. These are concrete implementation prerequisites, not reasons to exclude full requested Telegram features.

**Finite lifecycle closure assessment (source only):** the next existing-Home integration retains the approved [`server-shared-auth-generation.ts`](https://github.com/openclaw/openclaw/blob/c074824a27c96d3983043f9eeb33823cd1772d8c/src/gateway/server-shared-auth-generation.ts) revision-fenced publication invariant: generation equality alone cannot authorize an older async refresh/start to publish. Adapt its five ownership cases without donor config/reload/WebSocket policy. Process generation and canonical account-grant revision are different facts.

| Approved `src/process/` candidate | Useful mechanism / actual dependency cut |
| --- | --- |
| `owned-stdio.ts` and startup/real/Windows tests | `COMBINE` cleanup ownership published before readiness, root result distinct from extinction, and startup cleanup uncertainty retained. Replace child launch with current prepared GM/backend route; donor native fixture success is not LiOS platform proof. |
| `supervisor/service-child-output-relay.ts` and awaited-output/readiness tests | Already combined through existing LiOS decoder/child/supervisor/transport; no second output relay or rerun solely for the Home controller. |
| `supervisor/service-child-relay-host.ts`, owned-worker/retirement tests | `ADAPT` permanent start-gate closure, exact attempt/generation ownership, ordered control and separate root/cleanup facts. Exclude donor worker entrypoints, lineage/control FDs, spawn broker and executable launch authority. |
| `supervisor/service-child-relay-retirement.ts`, `service-child-cleanup.ts` and tests | `COMBINE` retained one-shot cleanup/retirement promises and matching generation/sequence receipts with existing backend finalization. A stopped observation or numeric PID is not extinction proof. |
| `supervisor/service-child-cleanup-deadline.ts`, `cleanup-budget.ts` | Retain one monotonic cleanup budget across repeated cancel/EOF; use existing supervisor escalation, not an outer timeout that releases uncertain ownership and allows a replacement. |
| `supervisor/service-child-protocol.ts`, `service-child-control-reader.ts` | `REPLACE` with existing strict LiOS frame contract; the donor trusts its own relay as sole control writer, inappropriate for an assimilated worker. Never accept worker-chosen command/environment/FD authority. |
| `supervisor/service-child-group-ownership.ts` and native-census tests | `REFERENCE` kernel/group/UID ambiguity cases for existing native backend: failed/expired/inaccessible census cannot mean gone. No Home numeric-PID service-control API. |

Do not wholesale import `service-child-relay-preparation.ts`, `service-child-relay.ts`, `service-child-group-anchor.ts`, `spawn-broker/{relay-integration,context,host}.ts` or `spawn-utils.ts`: they carry donor worker-entrypoint resolution, ambient environment, inherited FDs, native group anchors and alternate spawn-broker paths. `linux-oom-score.ts` also adds shell/procfs mutation; it is not isolation or a required service feature. `spawn-secret-input.ts` supplies secret bytes to a child and therefore does not meet this service's worker-never-sees-token rule.

Meaningful comparison-fork deltas: `owned-stdio.ts`, output-relay, cleanup and cleanup-deadline bodies match the approved pin. The fork's generation policy distinguishes transport-handshake revision from retained source grants; its relay host/protocol/preparation/retirement adds native Linux subreaper custody, and group inspection adds UID/opaque-foreign-owner classification. The fork-only `linux-child-subreaper.ts` requires dedicated built Node, Koffi/libc `prctl`, procfs children, retained `waitid` ownership and `waitpid` reaping; it is absent at the approved pin and **not approved by observation**. Windows donor routes require native Job handles/Koffi/launcher certification, and the shell Job-output route explicitly refuses awaited stdout. Do not import availability fallbacks as LiOS strict isolation or call any of this Windows qualification.

Implementation requirements from this assessment: Home owns one revision/attempt, single-flight fresh preparation, synchronous stop admission fencing, late-start retirement, and no replacement until prior native cleanup succeeds. Current typed health can project freshness but is not correlated ping/pong. Repeated ready→crash must reach a bounded crash-loop state; immediate readiness cannot reset crash history. Every replacement must obtain current account/policy and fresh exact launch approval; no pending send/write is replayed. Current service source delivery/verified runtime packaging and canonical account ownership must be resolved before Home registration, not supplied by a mock launch factory.

**Selected Telegram outbound closure (source assessment, not imported/connected capability):** three cooperating packages are required; formatting alone is not full send support. All `T/` paths below mean approved `extensions/telegram/src/`; `M/` means `packages/markdown-core/src/`.

| Coherent package | Exact retained implementation set / real authority cut |
| --- | --- |
| Formatting and payload planning | `T/telegram-text-delivery.ts`, `format.ts`, `format-html.ts`, `format-html-text.ts`, `format-assistant-transcript.ts`, `rich-block-{model,split}.ts`, `rich-blocks{,-html,-html-map,-list}.ts`, `rich-message.ts`, `rich-plain-fallback.ts`, `text-width.ts`, `caption.ts`, `outbound-media-batches.ts`, `inline-keyboard.ts`, `outbound-params.ts`, `thread-spec.ts`, `targets.ts`; actual pure `src/polls.ts` and `src/channels/location.ts`. Retain rich structures/tables/math/media representations, entity/grapheme-aware HTML splitting, long-caption follow-up, ordered albums, keyboard actions and provider rejection-specific fallback. Target parsing is not recipient authority; media URLs remain egress-bearing. Extract real button value types without the approval/native-command runtime graph. |
| Physical send, recovery and acceptance | `T/send-prepared.ts`, `reply-parameters.ts`, selected `bot/helpers.ts` thread constants/builders, `provider-thread-proof.ts`, selected `send-outbound.ts` result/report functions, selected `send-context.ts` message/thread/delete predicates, `network-errors.ts`, `send-error-predicates.ts`, `chunk-delivery.ts`, `account-throttler.ts`, `sendchataction-401-backoff.ts`, `chat-action-timing.ts`; actual `src/channels/message/receipt.ts` and receipt value types, `channels/turn/partial-delivery-error.ts`, `infra/outbound/deliver-types.ts` no-dispatch error, selected `plugin-sdk/retry-runtime.ts` classifiers, channel-runner `infra/retry-policy.ts`, `packages/retry/src/index.ts` and `infra/abort-signal.ts`. Replace config/cron/history/projection/token-keyed global-map authority, not actual retry/scheduling/receipt mechanisms. All album IDs are recorded before observers; observer/persistence failure cannot authorize another send. |
| Native operations | Adapt actual `T/send-message.ts`, `send-message-text.ts`, `send-message-types.ts`, `outbound-media.ts`, `voice.ts`, `send-edit.ts`, `send-actions.ts`, `send-forum-topics.ts`, `send-location.ts`, `send-special.ts`, `status-reaction-variants.ts`; replace `poll-answer-context.ts`/`poll-registry.ts`/group-policy persistence with canonical account/Chat/Project state. Retain photo/GIF/video/video-note/voice/audio/document selection and fallback, atomic edits/keyboard distinctions, typing/reactions/delete/pin/unpin, topic create/edit/rename, venue/location, stickers and polls with real answer-routing truth. General-topic and channel-DM thread proof cannot be inferred from requested thread fields. |

Formatting's finite shared source closure is `M/{assistant-transcript,assistant-transcript-headers,chunk-text,construct-fallbacks,fences,format-capabilities,html-tags,ir,ir-annotations,ir-metadata,ir-slice,ir-source-spacing,ir-spans,reasoning-tags,reasoning-tag-parser,render,render-aware-chunking,table-layout,types}.ts`; `src/shared/text-chunking.ts`, `shared/text/{auto-linked-file-ref,code-regions}.ts`; the actual `chunkByParagraph` helper closure in `auto-reply/chunk.ts` (not donor config exports); `packages/terminal-core/src/{ansi,ansi-sequences}.ts`; and selected normalization `{grapheme,utf16-slice,number-coercion,string-coerce,expect}.ts`. Receipt aggregation additionally uses real record/string normalization helpers. Preserve defining implementations or genuine existing equivalents; no SDK-barrel aliases/stubs.

Direct dependencies discovered by these bodies include `markdown-it@15.0.2`, `markdown-it-cjk-friendly@3.0.0`, `mdast-util-from-markdown@2.0.3`, `mdast-util-gfm-table@2.0.0`, `micromark-extension-gfm-table@2.1.2`, `string-width@8.2.2`; retained MIME sniffing reaches `file-type@22.1.1` through `packages/media-core/src/{mime,constants,file-name}.ts`, with `src/media/audio.ts` voice compatibility. Telegram-local `Intl.Segmenter` width does not replace Markdown IR's terminal-width dependency. `grammy@1.46.0` `InputFile`/`GrammyError` and throttler/Bottleneck are real runtime mechanisms if selected, not type-only imports. Direct MIT declarations and compatible individual Node floors are not a complete transitive SBOM/advisory/native-codec clearance; donor root/Undici version constraints still apply when those paths are selected.

Relevant selected tests to port against actual implementations: formatting/wrapped Markdown/rich spans/HTML/plain fallback; reply/target/General-topic/voice/keyboard; receipt merge/ambiguous network errors; flood waits, fairness and cancellation; real loopback `send.telegram-http`, `send.recovery.telegram-http`, `send.edit.telegram-http` and their local multipart fixtures; history/paragraph projection and poll correlation races against canonical Home state. Preserve no-dispatch versus ambiguous failure and current authority after queue/flood waits. Donor proxy/client-cache tests are not isolated-service egress proof; approval/native-command button tests need their real owning integration rather than no-op replacements.

Comparison-fork findings are not import approval: throttler captures/restores queued effect authority; target/reply/typing code tightens unsafe/nonpositive topic IDs; coordinated rich-block changes add nesting15/iterative measurement and literal HTML ownership protection. The fork inlines photo→document fallback instead of the approved shared helper, and poll-answer routing derives current registration truth. Keep a coherent source convention, not both fallback implementations. Selected edits/forum/location/text-delivery/media-batching/keyboard/voice/caption/thread-proof-support helpers were blob-identical where recorded; broader interactive/fork closure is not exhausted.

Concrete canonical gap: current `projectAttachmentService` admits documents and PNG/JPEG/WebP with20MiB file/6MiB image limits, not full GIF/audio/video. Extend the existing scoped attachment owner before claiming those media supported; never substitute donor arbitrary paths/URLs. Complete codec/image/video implementation, streaming/draft/preview delivery, callback/WebApp/MiniApp/native commands, full poll-answer/voter authorization, broader forum/live-location/business actions and inbound edit/delete/history remain explicitly uninspected/unintegrated. This selected sender assessment does not close P1.04 or establish Telegram parity.


**Tool-call repair entrypoint assessment (`PARTIAL`, no import):** approved `packages/tool-call-repair/src/{index,contracts,promote}.ts` and the grammar/payload/protection/stream entry sections were inspected. The package declares only normalization-core; source reaches `record-coerce`/safe JSON plus real local `{grammar,payload,protection-fast-path,stream-normalizer}.ts`. It recognizes bracket/Harmony/XML-ish text calls, gates exact names/assistant role/terminal stop reasons, promotes provider-native lifecycle events and preserves protected source ranges; the stream path also bounds pending candidates/events and Markdown context. Full parser/stream bodies and regression suites remain unaudited.

Disposition: `DEFER_WITH_TRIGGER` for provider-normalization adaptation, not automatic tool execution. Current `server/agentLoop.ts` already accepts bounded schema-validated plans with safe diagnostics/revision budgets and governed invocation; replacing that strict plan contract with text-call promotion would change—not merely repair—execution semantics. Any later provider-native adapter must retain literal user/code/source text and then pass repaired calls through the same current allowed-tool/input/approval/side-effect boundaries. Located `grammar`, `payload`, `protection-fast-path`, `stream-normalizer` and `stream-normalizer.protection` tests still require actual assertion/body review; directory presence is not a test pass or full useful tool-family audit.



### GM-11/Home implementation handoff — P1.07–P1.09 inputs

**Design input, not an enabled service or accepted package.** Keep `ExecutionBackend.prepare → ExecutionBackendLaunchPlan → startPreparedSpawn → getProcessSupervisor`. Extend existing GM admission rather than adding a runtime/placement registry. The original `exec/placement-grant.ts` admitted only `conversation:${requestId}`; the bounded internal Home-scope addition is recorded below. Container endpoint eligibility remains Unix-only here, and `startPreparedSpawn` still inherits an active conversation scope by default. A service must not impersonate an everlasting Chat or accidentally inherit its cancellation/permissions. Current container restrictions include network-none/read-only and closed interactive input policies. Channel sockets, mutable session files and credentials are not implicitly permitted by those restrictions.

**Proposed v1 internal transport contract:** owned framed stdio, no public listener; separate internal protocol identity from external Gateway v1. Select one canonical owner/account scope per admitted worker generation under one Home lifecycle controller. Multiple account bindings must not grant ambient cross-tenant access. Actual partitioning and persistent transport feasibility must be resolved before implementation approval.

| Contract element | Required typed fields / admission semantics |
| --- | --- |
| Handshake | Protocol version, approved service/build digest, Home-issued launch binding and generation, supported operation identifiers and bounded limits. Home validates against its exact launch plan; worker-echoed protocol/build alone is not authentication. |
| Invocation | Unique request ID, generation/session binding, finite deadline, explicit operation, current account-binding reference, canonical authorization/operation reference and typed payload/attachment references. Owner/tenant/Project/Chat/device/source scope is resolved from Home-held authority, not accepted from arbitrary worker fields. No generic shell command, donor plugin installation or unrestricted URL method. |
| Reply / errors | Exact request/generation binding; discriminated success or bounded redacted code (`invalid_request`, `protocol_mismatch`, `unauthorized`, `revoked`, `unavailable`, `rate_limited`, `cancelled`, `outcome_unknown`). A retry hint cannot authorize replay of a side effect. Unknown/partial provider outcomes retain accepted per-part IDs. |
| Incoming event | Account binding, generation, provider conversation/message/event identity, event kind, source timestamp when provided and bounded typed payload. Before adoption, Home rechecks current account/tenant/retention/Project mapping. A service event cannot choose a new owner or grant source/AI-transmission rights. |
| Acknowledgement / receipts | Home acknowledges provider progress only after canonical durable adoption/dedupe succeeds. Canonical dispatch intent/commit and receipt storage remain in LiOS; provider accepted, recipient delivered/read and local persisted are separate facts. Missing provider IDs are unavailable facts, not fabricated acknowledgements. |
| Attachments | Opaque Home-owned object reference, byte size, MIME type, hash and current scoped read authorization. Do not accept worker-selected host paths, arbitrary download URLs, inline unbounded binary data or credentials. P4 owns durable work products and revisions. |
| Cancellation / shutdown | Exact request or service-generation target; stop admission and revoke bindings before cancelling; reject pending requests, join descendant extinction/backend finalization, then admit replacement generation with capped backoff. No replay of unfinished sends or writes. |

Bound both directions: frame decoder bytes, queued writer bytes, concurrent requests/events, total attachment bytes, stderr and pending response duration. Existing `ManagedRunStdin.write` does not expose `drain`; bounded captured output does not bound streaming handler concurrency. Reuse the browser broker's framing/ready/close patterns, not its GET/HEAD-only transport as a claim of channel or WebSocket support. Keep credentials and channel-specific egress under existing Home/P13 auth; a network-none worker cannot directly open a donor connection.

**Bounded file ownership:** GM execution owner handles `exec/placement-grant.ts`, `execution-authorization.ts`, `run-command.ts` and necessary backend contract changes; Home owner integrates lifecycle into `server/index.ts`; P13/security owner integrates invocation, current credentials and exact-operation review through existing broker/governed-tool paths; Gateway owner extends the existing external catalog only for necessary user operations; channel owner handles normalized account/message facts. Parent owns shared-core integration; do not fan out simultaneous edits to these cores.

**P1.07 ownership claim:** this integration branch's parent remains the single implementation writer for shared GM/Home/P13/Gateway cores. Read-only inventory/review agents hold no edit ownership. As of the live PR listing at this record, only #392 (documentation) was open; no service implementation PR was present. Recheck before the first core edit. Current contract work touches `shared/supportingServiceContracts.ts` only; no migrations or existing Gateway methods changed.

| Bounded implementation task | Sole canonical owner / files | Dependency before coding |
| --- | --- | --- |
| Awaited pipe output, byte framing and joined cleanup | GM-10 process output, existing `exec/decoded-output.ts`, `child.ts`, `supervisor.ts`, `types.ts`; approved donor process mechanisms | Exact retained helper/test/dependency dispositions; no second supervisor. |
| Home-service placement and strict launch | GM-11 existing placement, backend plan and execution authorization | Home scope must be explicit; preserve conversation grants, exact image/digest, resource controls, no-host-fallback and native extinction. |
| Service lifecycle / diagnostics | GM Home, existing `index.ts` lifecycle plus supervisor consumer | Strict launch admission and contract generation; disable leaves ordinary work usable. |
| Account and provider invocation | P13/connector/GM secret and network brokers | Current account/tenant/Project binding, per-method operation schema, opaque credential refs, exact approved side effects and permitted provider transport. |
| Telegram transport adaptation | Existing connector/P13 owner, pinned complete useful Telegram family | Replace donor config/session/cron/ingress authority with real Home interfaces; preserve all feature dispositions. |
| WhatsApp transport adaptation | Same channel owner, separately pinned package/rights review | Resolve GPL dependency distribution, platform eligibility and key/session custody before enabling or packaging. Not permission to drop the requested capability. |
| Inbound Chat/workflow/work-product integration | Existing P2/P4/P9 owners | Durable scoped adoption/dedupe, source/AI-transmission consent and provider fact provenance; no donor canonical chat/memory/scheduler state. |
| UI and target/release proof | TC/P10/P14 existing owners | Actual admitted runtime/capability truth before connect/run affordances; entitled native journeys and source rights before acceptance. |

**Acceptance inputs (no checks executed):**

Risk classes follow the existing progressive-validation contract: inventory/documentation `R0`; this unconsumed shared frame/parser definition `R2` with V0/V1 and process-stdin smoke; live GM placement, authentication, broker, persistence and supervision changes `R3` with mandatory relevant V2 before more work stacks on them; SP/release candidate `R4` with applicable V3/V4. These are validation requirements, not new check results or automatic full-suite permission. The selected minimum SP-06 contribution is owner-authorized inbound → canonical Chat → permitted reply/work product → exact authorized outbound → disconnect/restart/reconcile without duplicate sends. SP-07 adds installed target, upgrade/rollback, accessibility and failure qualification. P1.09 records this acceptance definition only; actual acceptance remains Packages 2–5.

- V0/V1 during implementation: affected frame/lifecycle/authority behavior only—stale generation, wrong owner/account/Project, invalid/oversized/split-UTF8 frames, queue saturation, stalled stdin, revoked credentials during queued egress and unknown/partial send nonreplay.
- V2 when these boundaries converge: actual existing strict backend → framed process → canonical admission → bounded event adoption → cancellation/extinction/restart; missing image/binary/current grant must refuse without host fallback. Exercise stop/start races and disabled-service noninterference with current deterministic work.
- V3/V4 at the integrated SP-06/SP-07 candidate: installed target and entitled Telegram/WhatsApp operations with real provider facts, retained Chat/P4/Workbench identity, permission/AI-cost refusal, accessible failure/recovery, restart/no duplicate effects and release/rollback evidence. Missing target/accounts/rights remain BLOCKED, never replaced by mock acceptance.
- Rollback/disable: fence new admission, revoke the worker generation, settle pending operations as failed/unknown accurately, join cleanup and keep canonical LiOS work available. Do not roll back a canonical message/Artifact/receipt merely because the supporting binary rolls back. Exact older binary/protocol compatibility and persisted transport-state migration need verification before enabling upgrades.

### P1.08 executable transport contract — bounded source evidence

`src/shared/supportingServiceContracts.ts` defines internal protocol `lios-supporting-service/1`, separate Home/worker frame unions, exact session/generation/account/launch-nonce binding, typed invocation/adoption/cancel/shutdown, provider event IDs, bounded errors, canonical attachment identity fields and provider accepted/partial/rejected/unknown facts. These facts are **not** canonical execution receipts or proof of recipient delivery. `decodeSupportingServiceFrame` rejects oversized raw bytes before parsing, invalid UTF-8, wrong direction/version/binding and duplicate advertised operation IDs.

Evidence: six focused boundary tests and typecheck passed; an actual Node process stdin smoke preserved a partial-send provider ID and refused stale generation. Narrow independent source reviews found no concrete P1/P2 contract defect or import cycle. No service, channel adapter, account login, durable record, Gateway method or launch permission is enabled by these schemas. Operation-specific payload validation, current account/tenant/Project/source authorization, request correlation, event sequencing, queue limits and native extinction remain runtime integration requirements, not supplied by the frame decoder. Direct schema parsing is not the bounded wire entry point.

### Package 2 bounded transport mechanism — not enabled service acceptance

`server/supportingServiceTransport.ts` consumes the approved byte framer over externally admitted pipes. It checks the exact build/operation handshake, generation/account/session, current authority before/after queued work, monotonic event sequence, per-frame and aggregate wire-byte reservations, finite operation deadlines and serialized writes/handlers. Closing fences admission and aborts host work before joining the owning supervisor's stop callback. It does not create a launcher, listener, permission registry, channel account or state store.

Review found and corrected two real boundary defects: fragmented active frames must retain their full byte reservation until handler settlement, and the single cleanup promise must be published before synchronous abort listeners can reenter `close`. Regression tests cover both. Ten focused framer/transport tests and typecheck passed. An actual synthetic Node child-pipe smoke negotiated readiness, delivered health, refused a revoked outgoing request before a third physical write and joined child close. This proves transport behavior only—not strict service placement, provider delivery or installed acceptance.

Resource-bound follow-through: inbound retained fragments/queued chunks and outgoing queued writes also have finite count bounds (1024), preventing Buffer/Promise metadata growth from many tiny chunks beneath the wire-byte limit. Empty input chunks retain no queued state. Ten focused transport tests—including tiny-fragment and tiny-write saturation—plus typecheck and the actual synthetic child-pipe smoke passed after this addition; unchanged donor-framer evidence is reused.

Remaining runtime obligations are unchanged: current Home/P13 account and exact-operation authorization, operation-specific payload schemas, canonical request/receipt correlation and durable adoption, strict Home-scoped launch and actual native extinction through the established supervisor. Callbacks must honor cancellation and revalidate at their real dispatch boundary. No service or Telegram/WhatsApp path is registered or enabled; Package 2 checkboxes remain open.

### GM-11 explicit Home-service placement — bounded source and strict-container proof

The existing `exec/placement-grant.ts` now admits an internal `homeServiceId` only with explicit current `policy.allowHomeService:true`, a positive owner user, null Project/Chat ownership, strict container isolation, deny-network, runtime-only data, no secrets, no environment injection and no workspace transfer. The scope is bound to both service and exact request ID; it cannot be substituted for a conversation scope. Service identity participates in prepared approval facts and current-authority drift invalidates the retained grant permanently. Existing conversation placement is unchanged when no service identity is supplied; the public operation-proposal schema deliberately rejects internal service facts.

Eleven focused placement tests and typecheck passed. An actual fixed synthetic command traversed the existing exact-approval/GM supervisor/immutable Docker sandbox image `sha256:fc56816d4b6f160b3fa4159608ddde07b0ec9db9097510ba9d162615c9216c5e` path with this Home scope and produced `lios-home-service-scope`; current service-policy revocation was then refused. This is finite strict-container admission proof, not a launched long-lived supporting service, channel connection, native Windows result or SP acceptance. Home lifecycle/controller, account binding and rollback integration remain open.

Direct integration checks: 27 existing governed-command, governed-journal and container-authorization behaviors passed, including exact scope, policy drift, approval-digest and cleanup ordering. Narrow independent security/consumer review found no concrete introduced P1/P2. Both preparation and exact execution reject running a Home-service admission inside an active conversation scope. Existing durable trust receipts bind the approval digest but do not independently persist service identity; lifecycle/restart state must not be inferred from that receipt.

### Existing supervisor awaited-output and strict session composition — bounded runtime evidence

The approved donor awaited stdout/EOF mechanism is now integrated into existing GM-10 `exec/decoded-output.ts`, `child.ts`, `supervisor.ts` and `types.ts`, with exact donor tests/notice ledgers. Only explicit `onStdoutAsync` uses single-consumer native pipe backpressure; ordinary synchronous/raw subscribers retain their path. Raw bytes precede decoding, accepted work remains joined through native completion/disposal, and unsupported adapters refuse rather than accumulate callback promises. A first pipe failure now invokes cancellation immediately so an accepted host consumer waiting for revocation can settle; backend-plan admission rejects injected async stdout callbacks just as it rejects sync observers.

`server/supportingServiceSession.ts` consumes an already approved `PreparedGovernedCommand`, exact operation/admission digests, explicit strict Home-service placement and current authorization lease; it does not create another launcher/permission registry. It bounds/cancels prelaunch account lookup, routes original stdout bytes through the typed transport, disables generic retained protocol output, joins the canonical supervisor/backend cleanup and validates EOF before clearing buffered frames. Intentional shutdown distinguishes typed closure from genuine protocol failure; cancellation is not a successful provider outcome.

Evidence: initial72 focused decoder/child/output/admission behaviors passed; subsequent13 direct session/transport behaviors and42 changed output/approval behaviors passed with typecheck. The additional targeted late-output closure regression passed. Existing OSS ledgers validate62 pinned major components with12 pre-existing warnings; no npm dependency or executable was installed. Independent reviews found and the parent corrected EOF-clear ordering, late closed-pipe classification, delayed cancellation on stdout failure and unapproved backend observer injection.

Actual immutable strict-container session smoke traversed exact Home placement/approval → real stdio readiness → synthetic health → joined shutdown → closed-admission refusal. A second actual worker exited with a trailing incomplete frame and was rejected as `mid-frame`; it was not accepted as successful EOF. A real native Node child smoke blocked its async consumer, injected a controlled pipe failure, observed immediate consumer cancellation/native root disappearance and retained the original failure through cleanup. These are synthetic worker/authority checks, **not** provider/account authorization or installed acceptance. A separate Docker SIGTERM-tail attempt did not observe its marker, so native late-tail behavior is not qualified by that attempt; only the typed closed-pipe regression is claimed.

Still open before an enabled capability: existing Home lifecycle registration/provisioning/restart/rollback, real canonical account/source/operation authority, request correlation, durable provider adoption/cursor/receipt ownership, complete selected channel rights and entitled provider/native journeys. P2.01–P2.09 remain open; no Telegram/WhatsApp route, credential or capability is enabled by this helper.

**Request correlation follow-through:** the existing transport now reserves at most64 unanswered invocations and4096 unique request IDs per worker generation; saturation fails closed. Only handshake-advertised operations are sent. A terminal `result` or request-scoped `error` must match an invocation whose physical writer was entered and whose actual stdin callback completed successfully, not a queued/reserved ID or a failed write. It retires pending capacity once, while the generation retains the request tombstone to refuse replay. Unknown/duplicate terminal replies, reused IDs and cancellation of unknown requests are refused. This is bounded protocol state, not a canonical execution/adoption/receipt store; terminal provider facts still require Home authorization/validation and must not trigger automatic retry.

Fourteen focused transport behaviors and typecheck passed, including the4096-ID generation boundary. Independent review found a real pre-write/early-reply publication gap; a failing-before regression observed one invalid terminal callback, then passed with zero after write completion was joined before publication. Actual strict-container stdio smoke retained the synthetic `partial` outcome and exact accepted provider part ID after the repair, then joined close. No provider was connected or canonical receipt manufactured. Existing unchanged transport/exec/native evidence above was reused rather than rerunning broad suites.

### Home-only Telegram polling transport — bounded mechanism proof

`server/telegramNetworkBroker.ts` is LiOS-authored internal Home code, not a copied Telegram client or enabled channel. It constructs only fixed HTTPS `api.telegram.org` `getUpdates` POST requests, resolves the token solely through the Home callback, and rechecks current account/poll authority before/after DNS, token resolution and HTTP response. Worker-supplied URL/method/header/token parameters are not accepted. The existing P13 public-address DNS pinning and bounded HTTP transport remain the network owner; generic plugin/public requests retain their30s maximum.

The selected polling request has its own45s absolute deadline spanning DNS/authorization/secret lookup/body, with cancellation retained through response completion and late cancelled continuations unable to dispatch. Raw response bound remains4MiB in Home memory, not base64 stuffed into a4MiB worker frame. No cursor or event is acknowledged here. Negative offsets (which can discard older Telegram updates), duplicate update types, unknown fields and overlong poll timeouts are refused before secret/network access; raw exception/URL/token/abort-cause text does not escape redacted error codes.

Seven focused authority/cancellation/deadline/body/redaction tests and typecheck passed. Actual loopback HTTP smoke exercised the real P13 requester: fixed POST wire yielded synthetic update17, a stalled response body was cancelled, and account revocation prevented another physical request. The internal requester/resolver injection is a server test seam, not saved configuration or public protocol. Read-only security review found no concrete introduced P1/P2. No Telegram account/provider call, durable cursor adoption, service registration, external route, native package or live channel capability is credited. Complete canonical account/secret authority and rights consent must be connected before exposing this internal operation.

### Canonical connection/consent/credential binding — bounded Home read proof

`shared/telegramConnection.ts` defines bounded nonsecret metadata serialized into the existing `source_connections.config`, not a second account store. `server/telegramConnectionService.ts` binds polling to the actual current user/organization, owned active Project and Project-scoped Chat, enabled exact source binding, versioned unrevoked `user_data_consents`, and that owner's generated account-specific vault reference. Unknown/raw-secret config fields and arbitrary env/file/other-account credential references are refused. Source policy AI/outbound flags are intentions only; they grant neither AI transmission nor external effects.

Local reads require the existing configured vault master secret rather than the adjacent generated-key fallback. Organization mode requires a non-null organization and only its named organization credential; it never falls back to machine-local secrets. Existing `organizationCredentialVault` now supplies a single-name snapshot using its canonical version bindings, including same-value re-saves. Required async authority checks may return a synchronous credential-currentness fence, which the fixed-method broker invokes at actual requester entry and response release. Initial DB admission is included in the same45s cancellation/deadline scope.

Sixteen directly relevant broker/real-PGlite account behaviors and typecheck passed. A concrete null-organization machine-vault fallback was reproduced failing-before, then refused after the correction; tests also cover same-value organization credential replacement and cancellation while initial DB admission is queued. Actual isolated PGlite + encrypted vault + real local HTTP smoke observed update17 under the exact owner/Project/Chat/binding, then disabled the owner during a second request: the body was withheld and a third request made no network call. Scratch DB/vault were removed; this used a synthetic operator-provided test master secret, **not** installed OS-custody or provider proof.

No connector registration, public setup/consent route, channel UI, service controller or account login is enabled by this reader. Durable adoption/dedupe/cursor, actual retention enforcement, consent presentation, full provider operations and native/entitled qualification remain required before exposure. Existing Chat/P3/source stores need transaction-aware adoption and replay identity; do not store raw provider bodies in Ledger or progress in strict source policy.

### Atomic Telegram update adoption — bounded Home/DB proof

Migration `0086_lios_channel_ingress` adds a per-source cursor and minimal per-update replay custody (`channel_ingress_cursors`, `channel_ingress_updates`; unique source+update identity, content fingerprint, `adopted|ignored`, bounded reason, nullable Chat-message reference that survives Chat clearing). `server/telegramPollNormalizer.ts` parses the raw getUpdates body (fatal UTF-8, 4MiB/100-update/depth bounds, strictly ascending safe update IDs, typed redacted provider errors, single event family per update; business/guest/inline namespaces remain null identities). `adoptTelegramPoll` then commits, in ONE transaction under current canonical authority: Chat message (existing `project_chat_messages`, no second inbox), replay disposition, a minimal `channel.update.dispositioned` P3 event (no message text) and the cursor. Poll authority digest must still equal the transaction-time source/consent/owner/Project/Chat/policy digest; locks order source row→Chat row and do not nest a Project lock against lifecycle writers.

Edited, callback, reaction, member, media-only and every other non-text/unresolved family receive an explicit `ignored` receipt (`edit_not_applied`, `unsupported_event`, `namespace_unresolved`, `no_text`, `conversation_not_allowed`) — progress is accounted for honestly, **not** applied as a new turn or silently dropped; edit/delete synchronization and rich operations remain open. Adopted text is excluded from model history unless adoption-time source policy set `allowAiTransmission` (`channelMessageExcludedFromAi` in `conversationRunService`). Provider errors, malformed bodies and stale authority never advance durable progress; same-ID different-content conflicts roll back the whole batch.

Evidence: 39 directly relevant normalizer/account/adoption/ledger/migration-chain behaviors and typecheck passed (including identical replay after Chat clearing, rollback of an earlier update on a later conflict, and refusal after consent/policy/owner change leaving no rows/cursor). Actual isolated PGlite + real loopback HTTP smoke: poll offset0 → adopt update17 → cursor18 → next poll offset18, no duplicate Chat message. Local protocol/DB proof only: no provider acceptance of the offset, no installed-vault custody, no public route/consent UI/service controller, no retention enforcement, no hosted PostgreSQL concurrency run, and no Telegram entitlement.

**Identity/edit follow-through:** migration0087 extends those same custody records, not a donor cache: token-derived bot namespace plus fingerprint/current credential revision, conversation/message/family coordinates, ordered edit timestamps and a retained origin anchor. Both ordinary messages and channel posts support exact-row text/caption edits. Original row identity/time remain; edits cannot expand adoption-time AI permission. Missing text/caption becomes an explicit AI-excluded placeholder. Logical replay under a new update ID cannot resurrect a cleared/retention-deleted row; stale edits remain explicit ignored dispositions. Current history release compares canonical edited content and current bot namespace.

Same-bot token rotation preserves the cursor. Changed-bot and unattributable legacy state refuse before networking; the existing Connections UI gives explicit disconnect/new-named-connection recovery, preserving existing imported messages and cursor rather than guessing identity or resetting progress. Applicable approved pipeline/cache/dedupe/fingerprint/offset mechanisms and tests are registered in the canonical donor ledgers; no grammY dependency, donor TTL store, provider-delete inference or automatic run/reply is imported.

Evidence: corrected migration repair/legacy cases,33 adoption/current-credential scenarios, affected normalizer/controller/native checks, TypeScript and script-manifest behaviors passed. Actual real-PGlite/pinned-loopback post/edit/stale/no-text/clear/replay/cold-reopen journey retained the original anchor and cursor16. Authenticated Chromium displayed namespace refusal and explicitly disconnected the synthetic source, deleting its credential/revoking consent while preserving cursor71. Hosted PostgreSQL, connected Telegram, native packaging and full edit/media/channel acceptance remain open.

### Home polling lifecycle controller — bounded proof

`server/telegramPollingController.ts` (LiOS-authored, adapting only the approved revision/attempt-fence, permanently closed start gate and retained joined cleanup invariants; no donor worker/relay/spawn-broker/FD machinery) owns one loop per explicitly enabled source: attempt-token fenced publication, idempotent start, synchronous `stop` admission closure with abort+join, redacted status projection (`polling|backoff|refused|provider_blocked|exhausted|stopped`), typed terminal causes (revoked/changed authority, credential-unauthorized, conflicting replay) that are never retried, rate-limit hints and capped exponential backoff, a successful-cycle pacing floor, and a crash-loop ceiling that resets only after a stable-success window so ready→fail cycles cannot evade it. `telegramPollingRuntime.ts` is wired into Home start/shutdown (`index.ts`): inert on a clean install, reconciles newly enabled sources every60s, and shutdown joins it before the process supervisor. Every cycle re-reads current canonical authority (`runTelegramPollCycle`); the controller holds no grant.

Evidence: five controller behaviors (including a reproduced failing-before spin that exposed a missing pacing floor), 39 earlier relevant behaviors and typecheck passed; the actual Home server booted in a scratch data root with the runtime inert and exited on SIGTERM. A real enabled-source loop against Telegram was **not** run (no provider/account), and hosted-Postgres, installed-vault, UI/consent, outbound and native/entitled proof remain open.

### Other text channels — approved-pin inventory and hybrid-service disposition (2026-10-28)

**Source evidence:** every approved-pin `extensions/<id>` channel `package.json` was read; transport is source-verified only where marked. No extension declares `engines` or a package `license`; only the root MIT license and Node `>=24.16.0 <25 || >=26.1.0` are evidence. Every channel imports the host `openclaw/plugin-sdk/*` (state/config/session/cron coupling unverified), so none is standalone. Direct npm dependency licenses checked via deps.dev are MIT/Apache-2.0/Unlicense (`nostr-tools`); several packages (`@azure/identity`, `@microsoft/teams.api`, `express`, `@aws-sdk/*`, `@twurple/{api-call,auth}`, `@noble/{ciphers,hashes}`, GFM table packages) were not license-checked. deps.dev lists advisories for `undici@8.10.2` (8), `markdown-it@15.0.2` (2), `music-metadata@11.15.0` (4) and `zod@4.6.5` (1); applicability unassessed. **No clearance is claimed.**

| Channel(s) | Transport (verified/inferred) | Credential / rights facts | Hybrid disposition |
| --- | --- | --- | --- |
| discord, mattermost, slack(Socket Mode), feishu(WS), reef, twitch, tlon(SSE), clickclack, nostr/buzz (relay WS) | WebSocket/SSE long-lived egress (discord/mattermost/tlon/nostr/feishu/reef source-verified) | Bot/app tokens; nostr/buzz/reef private keys | Needs ONE Home-brokered WS-egress adapter (explicit `maxPayload`, handshake timeout, reconnect/resume) and Home-side signing/secret custody; the deny-network container never holds tokens/keys. |
| msteams, googlechat, line, sms(Twilio), synology-chat, nextcloud-talk, zalo(webhook), feishu(webhook), slack(HTTP) | Inbound public webhook with signature/JWT verification + REST egress | Service accounts/app secrets/HMAC secrets | Requires a Home-owned authenticated ingress (no public worker listener), shared body-size/in-flight guards (`webhook-ingress` family) and persist-before-ACK; local desktop Homes need a user-owned tunnel decision first. |
| signal | HTTP/SSE JSON-RPC to a `signal-cli` daemon (source-verified) | Linked-device keys on disk; `signal-cli` is **GPL-3.0** (separate daemon, not an npm dep) | Same distribution rule as WhatsApp: no GPL binary shipped; optional user-installed add-on only, after rights review; keys Home-side. |
| imessage | Spawns local `imsg rpc` over stdio on a signed-in Mac (source-verified) | macOS Full Disk Access; sensitive Messages DB; unofficial local bridge | macOS-only optional add-on run by Home (not containerizable); explicit consent + minimal projection; no default enablement. |
| irc, zalo(long-poll) | Raw TCP/TLS or bot long-poll | Server password / bot token | Home-proxied socket/poll; zalo polling is the simplest deny-network path. |
| zalouser | Unofficial personal-account automation (`zca-js`, QR session cookies) | Terms-of-service risk | `DEFER_WITH_TRIGGER`: not enabled by default; needs owner/rights decision. |
| matrix | `matrix-js-sdk` sync + Rust crypto bindings | Access token + persistent crypto/device store | Home-held crypto store; WASM/native crypto packaging and licenses (Apache-2.0) need review before any enablement. |
| a2a, raft, qa-channel | A2A protocol; loopback CLI bridge; QA fixture | Peer tokens / local profile | a2a: evaluate under agent/delegation family; raft: local CLI add-on only; `qa-channel` is a test fixture, never a user integration. |

**Reusable shared mechanisms (candidates for ONE Home-side port, SDK sources still unread):** `webhook-ingress`/`webhook-request-guards`/`webhook-targets` (bounded raw-body, pre-auth limiter, route conflict rules), `ssrf-runtime` (`fetchWithSsrFGuard`, a natural hook for the Home-brokered egress policy; reconcile with existing P13 DNS pinning), `security-runtime`/`secret-*` (map to the Home vault/SecretRef), durable-spool/persist-before-ACK patterns (`webhook-spool`, `ingress-spool`, `monitor-durable`; match the already-built canonical adoption), the existing byte framer, and the common `ws` client shape. Per-channel `config-schema`/`accounts`/`setup-*`/`doctor` are donor-config scaffolding to replace with the existing connection/consent flow, not import.

### Non-channel families — first mechanism cuts and remaining depth

The following is partial source investigation at the same approved pin, not completed imports. Every family remains in the hybrid scope; `DEFER` identifies a dependency before implementation, not permission to omit the family. Candidate source bodies/tests not read remain unverified. No additional npm package or executable was installed by these investigations.

| Family | Useful inspected mechanisms / next existing-owner seam | Authority and qualification boundary |
| --- | --- | --- |
| Agents, sessions and delegation | `packages/agent-core/src/harness/compaction/*`: bounded summaries/cut points and unresolved-user-request carry; `harness/utils/{truncate,turn-interruption}.ts`; subagent completion/yield/recovery candidates under `src/agents/subagents/`. Existing `agentLoop.ts`, delegation budgets and checkpoint/journal remain the owners. | LiOS currently consumes validated plan objects, not native tool-call streams. Tool-result pairing and `packages/tool-call-repair` need that consumer first; async children need multi-unfinished-step checkpoint custody. No second transcript/subagent ledger. Most subagent bodies/tests remain unread. |
| Coding/ACP | Inspected `src/acp/approval-classifier.ts`: conflicting tool identities fail closed; scoped reads/searches, mutation, execution/control-plane classification. `control-plane/{session-actor-queue,active-turns}.ts`: serialized owner lanes and active-turn draining. `extensions/acpx` lease/reaper mechanisms require exact native ownership. | Existing `server/acp`, GM-11/P13 approval and supervisor are final authority. Classification must not auto-approve. Donor Codex auth bridges, ambient home credentials, persistent allow-always policy and second ACP/Gateway stores are not adopted. ACPX requires Node>=22.13; full transport/native cleanup remains open. |
| Tools, skills, plugins, MCP | Inspected `src/agents/mcp-startup-backoff.ts`:15s→10min, single-flight startup, bounded keys; `packages/retry` runner and Retry-After; partial `src/skills/security/scanner.ts`: advisory execution/exfiltration/obfuscation findings; skill frontmatter/prompt bounds. | Compose into `sdkExternalMcpClient`, current source/credential revision, P13 signature/grant checks and declarative skill owner. No replay of ambiguous effects, no tool-error startup backoff, no shell/package-manager installs from skill metadata, no scan finding as a trust grant. QuickJS code-mode needs per-bridge-call authorization/idempotency before use. |
| Browser and computer-use | Browser `act-policy.ts` pure action budgets; run-owned tabs/compensating close, stable snapshots/delta cache, bounded screenshot returns, post-action URL checks. CUA `driver-result.ts` stale-generation semantics and `execution-resources.ts` opaque, confined handles. | Current browser remains deny-network/P13 brokered. No host Chrome/CDP/profile authority or unrestricted JS/file upload implied. CUA currently assesses only and reports native unavailable; driver transport, OS permissions and installed action proof remain open. |
| Memory/retrieval | Selected memory policy supplies escaped untrusted-history recall and injection screening; markdown chunking has CJK-aware overlap and rebuild version; nested search-deadline pause/resume. Existing GM-19 rows/tombstones and P7 lexical/RRF search remain authoritative. | Existing `getMemoryContext` was not found on the inspected production call paths. Recall integration must first resolve explicit user preference/consent and source rights; no silent automatic writer or external embeddings. Donor SQLite/LanceDB/transcript stores are not a replacement for current work. Full memory-core/wiki/active-recall bodies remain unread. |
| Scheduling/notifications | Cron stagger, restart catch-up, error-backoff/auto-disable and compare-and-set recovery mechanics map to current P9 leases, saved authority and notification owners. Existing `consecutiveFailures` is counted but does not yet drive failure policy. | No second cron database/scheduler; unknown outcomes never auto-replay. Cron/timezone/DST requires a reviewed Croner dependency and schema/UI contract; failure threshold/catch-up changes require explicit behavioral evidence. IMAP sender/auth/UIDValidity mechanics are candidates behind Home-held credentials and egress. |
| Media/voice/extraction | `src/media/{ffmpeg-exec,ffmpeg-limits}.ts`: bounded probe/transcode; `tts/speech-text.ts`: speech preparation; media read-scope and pure byte/MIME limits. Map to P12 voice, existing managed binary execution, attachments and P4. | No second media store. Full native codec/runtime/package closure remains unread; cloud speech/vision/generation need real provider entitlement, source-transmission consent and spending approval. Existing local voice is not proof of those features. |
| Search | Inspected `extensions/web-readability/web-content-extractor.ts` sanitization/size/nesting bounds; SearXNG's bounded client; `src/web-search/runtime-execution.ts` cancellation/fallback ordering. Map to existing source/ProviderSdk/P7 owners. | Readability's SDK sanitizer/Markdown closure and exact dependency notices remain prerequisite. User-owned SearXNG does not establish rights to downstream search-engine content. Vendor search, scraping, caches and query egress need per-source rights/consent; no blanket “rights-clean” claim. |
| Models/auth | Inspected profile types define auth/billing/rate-limit/overload/expiry taxonomy and cooldown state; small provider/model-ID/pricing helpers may deepen existing AI-access routing. | Existing vault, AI-access and cost controls remain final. No donor OAuth/profile store, unauthorized paid fallback or automatic account rotation. Full profile ordering/failure and provider-runtime bodies remain unread; donor package Node>=22.19 and SDK/Zod skew are unresolved package-import constraints. |
| Devices/nodes/diagnostics | Existing LiOS pairing/Gateway/mDNS/diagnostics are already substantive. Inspected join-code/challenge and Linux-node command headers identify optional camera/location/notification and bounded payload mechanics; file-transfer and scope-upgrade require deeper inspection. | No second pairing/update/node authority. Native actions require explicit device capability approval and target evidence; no default camera/location/downloads. Keep diagnostics authenticated/local and opt-in; OpenTelemetry dependencies conflict with the current footprint gate. |

Full depth still includes the unread source/test/dependency closures, all user-useful channel operations, actual brokered long-lived transports, multi-step/tool/native integration and entitled installed journeys. Family inventories are not completion percentages. Recent task agents for these first slices failed before implementation due provider rate limits; no code or tests from those failed jobs are credited.









---

## 1. Non-negotiable owner decisions

1. **LiOS operates no customer runtime cloud/server.** LiOS is deployable software, not a hosted intelligence service.
2. Cloud is allowed and encouraged where useful, but it is **the user's cloud/account/infrastructure and the user's bill/responsibility**.
3. **Desktop Local is the default deployment.** A new user installs LiOS and can work without configuring PostgreSQL, S3, Docker, VPN or a cloud account.
4. The user owns and selects database, storage, compute, model providers, secrets, networking, backup and identity.
5. LiOS must work with zero LiOS-hosted data/control plane. Third-party commerce/app-store/update infrastructure may exist, but it must not sit in the customer data or execution path.
6. User conversations, files, projects, memory, artifacts, credentials, terminal output and AI traffic must never require a LiOS-operated server.
7. **OpenClaw is a major donor, not a visual/product authority.** Reuse whole subsystems when advantageous; do not copy donor branding or create duplicate canonical state.
8. LiOS remains conversation-first. Capability depth must not become permanent UI chrome.
9. Mobile/watch devices are first-class clients/nodes of the user's LiOS Home, not clients of a LiOS SaaS backend.
10. Every future feature must first attempt a local/user-owned implementation before proposing vendor-operated infrastructure.

---

## 2. Product/deployment model

### 2.1 LiOS Home

**LiOS Home** is the canonical computer/server environment where a user's LiOS intelligence lives. It is a product concept, not a LiOS-hosted service.

Default:

```text
User desktop
├─ LiOS Desktop
├─ local Gateway
├─ embedded PGlite
├─ local filesystem storage
├─ OS-protected secrets
├─ local execution
├─ local memory/indexes
└─ user's AI/data providers
```

Advanced:

```text
User-selected LiOS Home
├─ Mac / Windows / Linux
├─ Mac mini / NUC / Raspberry Pi
├─ Synology / QNAP / TrueNAS / Unraid
├─ Docker / Podman host
├─ Kubernetes
├─ AWS / Azure / GCP / Hetzner / DigitalOcean / Oracle Cloud VM
└─ organization/private infrastructure
```

The same LiOS product must support both. Moving from local desktop to an always-on user-owned Home is a migration, not a product switch.

### 2.2 Distributed user-owned topology

```text
                         LiOS
                          │
               Conversation / Projects
                          │
          Agent + Analytics + Artifact Runtime
                          │
                    Device Fabric
                          │
       ┌──────────┬───────┼────────┬──────────┐
       │          │       │        │          │
    Desktop     Mobile   Watch   Browser     Nodes
       │                                      │
       └──────────────────┬───────────────────┘
                          │
                  USER INFRASTRUCTURE
                          │
      ┌──────────┬────────┼────────┬──────────┐
      │          │        │        │          │
   Database    Storage  Models   Compute    Secrets
```

No LiOS-operated server is required inside this graph.

---

## 3. Desktop Local — first-class default

Desktop Local must be a complete production deployment, not a demo/fallback.

### 3.1 Default providers

```text
DatabaseProvider = Embedded PGlite
StorageProvider  = Local filesystem
SecretProvider   = OS-protected local vault/keychain
ComputeProvider  = Local machine
Gateway          = Local
BackupProvider   = User-selected local/offsite target
AIProvider       = User-selected remote or local model
Network          = localhost/LAN unless user enables remote access
```

### 3.2 Local storage layout

The exact internal layout may evolve, but LiOS should have one governed storage root with separate lifecycle classes:

```text
LiOS Data/
├─ database/
├─ workspace/
├─ projects/
├─ attachments/
├─ artifacts/
├─ memory/
├─ datasets/
├─ indexes/
├─ cache/
├─ execution/
├─ logs/
├─ backups/
└─ config/
```

Existing Electron `userData/workspace`, PGlite, history storage and OS-protected vault foundations should converge toward this contract rather than be replaced blindly.

### 3.3 User-selected local storage

Users may choose:
- another folder;
- another internal drive;
- external SSD;
- mounted NAS;
- encrypted volume.

LiOS must detect unavailable/removable storage and fail safely. Never keep executing against a disappeared workspace.

### 3.4 Do not live-sync active databases through consumer sync folders

Do not recommend placing a live PGlite/PostgreSQL data directory directly inside Dropbox/OneDrive/iCloud Drive and relying on file-level sync.

Preferred path:

```text
live database
   ↓
consistent LiOS snapshot
   ↓
optional encryption
   ↓
user-selected backup destination
```

### 3.5 Mobile when Desktop Local is canonical

The desktop LiOS Home remains canonical. Mobile stores only the minimum required cache/outbox/device state.

When Home is offline:
- recent permitted state may remain readable from local mobile cache;
- drafts/outgoing work queue locally;
- no fake “completed” state;
- work resumes idempotently after reconnect.

Users wanting 24/7 mobile access move LiOS Home to an always-on machine/server they control.

---

## 4. Zero-LiOS-server boundary

There is no LiOS customer runtime/control/data server.

### 4.1 User-owned

The user owns:
- system database;
- files/object storage;
- project/conversation/artifact data;
- memory/indexes;
- AI keys and model accounts;
- data-source credentials;
- compute nodes;
- Gateway host;
- browser/computer-use host;
- backups;
- remote networking;
- enterprise identity;
- logs/telemetry unless deliberately exported.

### 4.2 Vendor/third-party services that may exist

LiOS may use external services for distribution/commerce such as:
- App Store / Microsoft Store / GitHub Releases / package registries;
- Paddle/Lemon Squeezy/another commerce provider;
- code signing/notarization infrastructure;
- optional user-selected public APIs/model providers.

These are not LiOS customer data planes.

There must be no generic runtime helper such as `sendToLiosCloud(customerData)`. Any vendor-network operation must be narrow, inspectable and unrelated to customer intelligence state.

### 4.3 Local/offline operation

After installation/entitlement resolution, normal local work must not require continuous vendor connectivity. Signed offline entitlements/license material are preferred where commercial enforcement requires an offline mechanism.

---

## 5. Replaceable infrastructure contracts

LiOS should own stable contracts and let local/user-managed implementations plug in.

Required target seams:

- `DatabaseProvider` — LiOS canonical persistence; default PGlite, advanced user PostgreSQL.
- `StorageProvider` — local filesystem, S3-compatible, Azure Blob, GCS, WebDAV/NAS, plugins.
- `SecretProvider` — OS vault, env, local encrypted vault, 1Password, HashiCorp Vault, external command/plugin.
- `AIProvider` — user-selected remote/local models.
- `ComputeProvider` / `ExecutionBackend` — local, container, SSH, user node, user cloud.
- `IdentityProvider` — local owner, organization OIDC/SAML/Entra/Okta/etc.
- `NetworkProvider` — LAN, Tailscale, WireGuard, SSH, reverse proxy, Cloudflare Tunnel/Access, direct TLS.
- `BackupProvider` — local disk/NAS/object storage.
- `NotificationProvider` — direct/device-local/Apple-native/user-managed mechanisms; no LiOS relay dependency.
- `BrowserProvider` — local browser, remote user node.
- `LicenseProvider` — local signed entitlement and/or external commerce integration; never a customer data authority.

Do not create these as duplicate registries if existing `runtimeContracts.ts`, `runtimeAdapters.ts`, P13 Plugin SDK or connector contracts can be extended.

---

## 6. Database model

### 6.1 LiOS system database

Canonical LiOS product state uses:
- embedded PGlite for default local installation;
- user-managed PostgreSQL for advanced/team/always-on installations.

Do not spend core effort making the canonical LiOS schema run on every database engine.

### 6.2 User data-source databases

Separate concern. Connectors may read user/business data from:
- PostgreSQL;
- MySQL;
- SQLite;
- DuckDB;
- SQL Server;
- Oracle;
- Snowflake;
- BigQuery;
- Databricks;
- future plugin sources.

Read-only is the default external-data posture. Credentials remain secret references.

---

## 7. Storage, encryption, backup and portability

### 7.1 Storage provider fabric

Use OpenClaw's provider abstraction as a donor/reference. Local filesystem is first-class. Prioritize a generic S3-compatible adapter so one implementation can cover S3, R2, MinIO, Wasabi, Backblaze B2 S3 API, DigitalOcean Spaces and similar services.

### 7.2 Encrypt before storage

Where enabled, LiOS encrypts object content before handing it to a storage provider. Storage credentials and encryption keys are distinct. Never imply that object-provider encryption replaces local key custody.

### 7.3 Backup

Required:
- consistent DB snapshot;
- workspace/artifact/file inventory;
- manifest + integrity hashes;
- optional encryption;
- retention policy;
- scheduled backup;
- verification;
- restore test;
- user-selected destination;
- explicit failure state.

### 7.4 Portability

Users must be able to:
- local → user PostgreSQL;
- user PostgreSQL → local where supported;
- local storage → NAS/object storage;
- one LiOS Home → another;
- export all LiOS-owned state in documented formats.

No vendor lock-in.

---

## 8. Secrets

Adopt OpenClaw-style secret references while preserving/strengthening existing Electron `safeStorage`.

Configuration stores references, not plaintext secrets.

Target providers:
- OS keychain/safe storage;
- environment variables;
- encrypted local vault;
- 1Password;
- HashiCorp Vault;
- external secret command;
- plugin secret providers.

Secrets must not enter:
- prompts unless explicitly required by a tool;
- logs;
- artifacts;
- Git;
- exports;
- diagnostic bundles;
- project JSON;
- backup manifests.

---

## 9. OpenClaw donor baseline and reuse posture

Pinned donor:

```text
repository: openclaw/openclaw
release:    v2026.9.7
commit:     c074824a27c96d3983043f9eeb33823cd1772d8c
license:    MIT
```

Preserve required MIT notice for copied/derived code and applicable third-party notices. Donor branding, logos, trademarks, screenshots and unrelated assets are not part of the product.

### 9.1 Verified high-value donor anchors

| OpenClaw area | LiOS posture | Intended LiOS use |
| --- | --- | --- |
| `src/process/terminal-pty.ts` + process helpers | TAKE/ADAPT | PTY abstraction, cancellation, Windows/macOS/Linux behavior, process-tree cleanup |
| `src/gateway/terminal/session-manager.ts` + types/limits | ADAPT HEAVILY | user/project/conversation-bound execution sessions |
| `output-ring.ts` | TAKE/ADAPT | bounded replay/scrollback |
| `output-flow-control.ts` | TAKE/ADAPT | PTY/WebSocket backpressure |
| terminal Gateway transport | ADAPT | targeted delivery and reconnect |
| terminal launch/policy/server methods | ADAPT | fail-closed host execution policy |
| `packages/gateway-protocol` | FORK/ADAPT | LiOS typed device/session protocol |
| `packages/gateway-client` | FORK/ADAPT | desktop/browser/node/mobile connection client |
| TUI command descriptors | ADAPT PATTERN | one LiOS command registry |
| TUI queue/goal/side-question semantics | ADAPT PRODUCT BEHAVIOR | steering/follow-up/side questions |
| `packages/terminal-core` | TAKE/ADAPT | safe ANSI/text/link/table terminal utilities |
| terminal UI tests | PORT | reconnect, restore, cancellation, upload, accessibility |
| mobile iOS application | FORK | LiOS iPhone/iPad native client/node |
| mobile Android application | FORK | LiOS Android native client/node |
| Apple Watch / Wear OS | FORK/ADAPT | approvals/status/voice/micro-interactions |
| Share extension/intents | TAKE/ADAPT | Share to LiOS |
| Live Activities/native progress | TAKE/ADAPT | long-running job progress |
| mobile offline/outbox | TAKE/ADAPT | resilient disconnected use |
| mobile/device capability/node architecture | FORK/ADAPT | camera/photos/location/voice/etc. under permission |
| `packages/agent-core` | ADAPT/INTEGRATE | agent loop, tool admission, streaming, steering, interruption |
| Codex/ACP adapters | INTEGRATE | coding runtimes beneath LiOS orchestration |
| browser/computer-use stack | ADAPT | authenticated browser/remote computer execution |
| session placement/worker patterns | ADAPT | user-owned node/cloud execution |
| memory/active-memory/dreaming patterns | ADAPT | LiOS Decision/Project memory consolidation |
| skills/plugin patterns | MERGE WITH P13 | reusable workflows without second plugin ecosystem |
| MCP patterns | MERGE WITH EXISTING | stronger lifecycle/policy, no duplicate MCP stack |
| System Agent/Doctor/Custodian patterns | ADAPT | setup/repair/diagnostics |
| channels | OPTIONAL PLUGINS | Slack/Teams/etc. through user's Gateway |
| OpenClaw visible product chrome | REJECT | LiOS conversation-first UI remains authoritative |
| OpenClaw canonical project/conversation stores | REJECT AS AUTHORITY | LiOS canonical state remains authoritative |
| donor branding/assets | REJECT | no OpenClaw rebrand |

### 9.2 Reuse rule

Literal source reuse is encouraged when:
- the code is useful and licensed;
- LiOS can retain notices;
- state/policy boundaries are mapped;
- tests are ported;
- packaging/security are verified.

**Prefer full useful subsystem/package reuse over piecemeal rewriting when the fit is good.** Fork/adapt the donor implementation into LiOS rather than recreating thousands of equivalent lines. Retheme and rename the **product-facing** surface to LiOS; rename internal modules/types when useful for integration, but preserve donor provenance and upstream diffability where that is more valuable.

Do not rewrite a mature generic subsystem only to avoid donor code. Do not import a subsystem merely because it exists.

---

## 10. Canonical ownership boundaries

### LiOS remains authoritative for

- Projects;
- persistent conversations;
- Artifacts and versions;
- deterministic finance semantics;
- Universal Data Fabric and entity identity;
- Decision/Project memory truth and provenance;
- user/tenant authorization;
- P13 plugin governance;
- connector/data rights;
- professional UX;
- trust receipts/audit lineage.

### OpenClaw-derived infrastructure may own

- device identity/pairing;
- device/node capabilities;
- Gateway transport;
- PTY technical session lifecycle;
- reconnect/replay protocol;
- runtime placement technical state;
- mobile local cache/outbox;
- terminal buffering/backpressure;
- agent-loop mechanics;
- optional technical worker state.

No two systems may own the same canonical conversation/project/artifact.

---

## 11. LiOS Execution Fabric

Create a LiOS-owned execution service rather than embedding PTY/process logic into Conversation Runtime.

Target conceptual package:

```text
shared/
  executionTerminal.ts

server/
  execution/
    ExecutionSessionManager.ts
    ExecutionPolicy.ts
    ExecutionAuthority.ts
    OutputRing.ts
    OutputFlowControl.ts
    ExecutionUploads.ts
    backends/
      LocalPtyBackend.ts
      PluginProcessBackend.ts
      RemoteNodeBackend.ts
      ContainerBackend.ts

client/
  components/execution/
    ExecutionTerminal.tsx
    ExecutionToolCard.tsx
    ExecutionApproval.tsx
    ExecutionSessionPicker.tsx
```

Names are not frozen; ownership boundaries are.

Protocol target:
- `execution.open`
- `execution.attach`
- `execution.input`
- `execution.resize`
- `execution.upload`
- `execution.close`
- `execution.list`
- `execution.data`
- `execution.exit`
- `execution.status`
- `execution.approval`

Preserve cumulative sequence/replay semantics.

---

## 12. Host execution authority

Renderer/chat approvals must not be the final authority for host shell execution.

The machine executing a side effect must:
1. receive a structured operation;
2. evaluate local/user/org policy;
3. bind approval to exact executable/command/args/cwd/relevant environment/context;
4. revalidate after async waits;
5. revalidate immediately before launch;
6. record the execution receipt;
7. support cancellation/process-tree cleanup.

Defend against approval drift, PATH changes, replaced scripts and stale authority.

---

## 13. Chat and terminal are two views of the same work

Desired flow:

```text
Ask LiOS
   ↓
Conversation Runtime
   ↓
Execution Orchestrator
   ↓
ExecutionSession
   ├─ compact live Tool Card in chat
   └─ same session in optional Terminal Pane
```

A user can take human control of a session, inspect/edit, then return control to LiOS. Do not create disconnected "chat terminal" and "real terminal" systems.

---

## 14. Agent runtime, coding and remote execution

1. Adapt OpenClaw agent-core mechanics under LiOS policy/state.
2. Separate model/provider from agent runtime.
3. Support LiOS Agent, Codex, ACP-compatible runtimes and future coding harnesses.
4. Let coding execution happen on the user's local or remote node.
5. Mobile may initiate/control the same execution without executing a full developer environment on the phone.
6. User-owned cloud/remote compute is an `ExecutionBackend`, never a LiOS cloud product.
7. Session mobility/checkpointing may move or resume work across user-owned nodes when integrity/security permit.

---

## 15. Device Fabric

Every paired device advertises capabilities.

Examples:

```text
MacBook
  terminal, files, browser, coding, local-model

GPU workstation
  CUDA, Python, quant, local-model

iPhone
  camera, photos, microphone, location, approvals

Android
  camera, files, location, voice, optional governed device actions

User VPS
  browser, Python, coding, long-running jobs
```

The capability advertisement is not permission. Every sensitive use still passes local/user/org policy.

### Pairing/networking

Prioritize:
- localhost/LAN;
- Bonjour/mDNS discovery;
- QR/device pairing;
- device credential issuance/revocation;
- Tailscale/WireGuard;
- SSH;
- direct TLS/reverse proxy;
- Cloudflare Tunnel/Access when user chooses it.

Multiple Gateways may be remembered, but every project must have one clear canonical Home/authority.

---

## 16. Native mobile and watch

### iOS/iPadOS

Fork/adapt OpenClaw native engineering for:
- Gateway connection;
- chat/session handling;
- offline transcript cache/outbox;
- voice/dictation;
- camera/photos;
- location when explicitly granted;
- contacts/calendar/reminders when explicitly granted;
- share extension;
- Live Activities;
- pairing;
- approvals;
- device/node capabilities;
- Watch bridge.

### Android

Fork/adapt:
- native Compose surfaces;
- Gateway connection;
- attachments;
- voice;
- camera/photos/location;
- contacts/calendar/notifications where permitted;
- offline state;
- device/node capabilities;
- Wear OS.

Accessibility/device automation must remain an explicitly reviewed opt-in capability because platform-store and privacy rules differ.

### Watch/Wear

Use for:
- approvals;
- status;
- brief answers;
- notifications;
- voice.

Do not build miniature desktop dashboards.

---

## 17. Apple notifications under zero-LiOS-server policy

LiOS will not operate an APNs relay.

Acceptable approaches:
- direct foreground/private-network Gateway connection;
- Apple-native/private CloudKit signaling where applicable and validated;
- local enterprise push mechanisms where Apple permits them;
- user/organization-managed notification infrastructure where technically viable.

For the public iOS app, reliable wake while fully suspended may be constrained when no publisher-operated APNs provider is used. Do not hide this limitation and do not violate the zero-server architecture to make it disappear.

Notification content should be minimal; actual state remains on the user's Home.

---

## 18. Memory and Dreaming

Merge useful OpenClaw patterns into existing LiOS memory, not a second store.

Target memory classes:
- durable project/instruction memory;
- episodic session memory;
- prospective/automation memory;
- inferred preference/goal memory;
- provenance and confirmed-vs-inferred status.

"Dreaming" / consolidation runs on user-owned compute/models and may:
- extract durable facts;
- consolidate repetition;
- detect changed assumptions;
- preserve provenance;
- update project memory;
- schedule nothing unless separately authorized.

**SI-03.02 / GM-19 bounded LiOS implementation:** `lios.memory.reflect` is an explicit, once-approved conversation tool over the canonical `durable_memories` authority. It reads only active owner memory plus grounded/confirmed agent memory in the authenticated user/Project scope; `system`, `untrusted` and prior `dreaming_reflection` rows are excluded before model transmission so reflection cannot recursively learn its own output or launder tainted source text. Private memory is sent through the existing BYOAI transport with `fallback: "none"`; the model must return strict structured patterns whose source IDs resolve to supplied memory revisions. The saved result is one ordinary durable-memory row with `originClass=agent`, `originKind=dreaming_reflection`, `epistemicStatus=inferred`, cited source revision refs, provider/model attribution and an owner/scope-bound idempotency key. Empty, malformed or ungrounded output writes nothing. Automatic scheduling is intentionally not introduced here; later SI-06 task/automation work may schedule this same governed operation after separate authorization.

**Donor disposition for this convergence:** pinned OpenClaw `c074824a27c96d3983043f9eeb33823cd1772d8c` (MIT), especially `docs/concepts/dreaming.md`, `src/memory-host-sdk/dreaming.ts` and `extensions/memory-core/src/dreaming-narrative.ts`, informs grounded-source gating, self-output exclusion, reviewability and fail-closed publication (**ADAPT**, not a second store/runtime). Letta Code reflection snapshot/integration patterns (observed `4b028fab07c69edaac2ddb4f7b9a43573ff20d81`) and Mem0's explicit inference/direct-write distinction (observed `c93420c49a6b14c3d446bdb156d96811908fd90a`) are **REFERENCE/ADAPT PATTERN** only; their persistence/session authorities are not imported.

**SI-03.03 / GM-19 bounded lifecycle:** the same `durable_memories` authority now exposes governed `lios.memory.inspect`, `lios.memory.correct`, and `lios.memory.delete`. Inspection is read-only and owner/Project scoped. Correction is an exact one-shot confirmed write: the stable `memoryKey` is preserved, the expected active revision must still match, the prior row becomes `superseded`, and a new owner-confirmed revision records its predecessor. Deletion is also exact and optimistic-revision guarded, but has stronger privacy semantics: all prior rows for that logical memory are erased transactionally and replaced by a non-sensitive `[deleted]` tombstone carrying only revision counts, a content digest, and optional owner-supplied reason. Active retrieval/context and Dreaming therefore cannot see deleted or superseded content. Derived-memory dedupe resolves the current logical revision rather than the original physical row and refuses to silently resurrect a deleted logical key.

**SI-03.03 donor disposition:** pinned OpenClaw `extensions/memory-core/src/memory-forget.ts` and `docs/concepts/memory-provenance.md` inform exact-target purge, lineage-aware cleanup and fail-visible mutation boundaries (**ADAPT**). Mem0's get/history/update/delete lifecycle (observed `c93420c49a6b14c3d446bdb156d96811908fd90a`) and Letta Code's serialized memory-update integration (observed `4b028fab07c69edaac2ddb4f7b9a43573ff20d81`) are **REFERENCE/ADAPT PATTERN** only. LiOS keeps the canonical GM-19 database, request identity, approval and Project-scope authorities.

Memory never upgrades inference into authoritative financial evidence.

---

## 19. Multi-agent orchestration

The user interacts with one LiOS. Internal specialists may include:
- coordinator;
- researcher;
- fundamental analyst;
- quant;
- risk;
- coding agent;
- reviewer;
- writer.

Specialists are implementation details unless an advanced user explicitly asks to inspect them. They share LiOS permission/data/artifact contracts.

---

## 20. Skills, plugins and MCP

Do not create another extension ecosystem.

- OpenClaw Skills concepts merge into P13 high-level workflow/skill contracts.
- P13 Plugin SDK remains the governed code-extension authority.
- Existing MCP stack remains authoritative; assimilate stronger lifecycle/policy patterns.
- Skill creation/workshop may eventually turn a successful user workflow into a reviewable reusable recipe.
- Skills/plugins may come from local files, Git or organization registries.
- User owns the source/registry infrastructure unless using a public third-party registry.

---

## 21. System Agent / Doctor / Custodian

Use OpenClaw patterns to make setup/repair conversational and provable.

Loop:

```text
Gather → Mutate → Repair → Prove → Report
```

`lios doctor` should eventually cover:
- DB/storage;
- backup/restore;
- secrets;
- models;
- Python/runtime packs;
- PTY;
- plugins;
- MCP;
- browser;
- voice;
- Gateway/network;
- devices;
- nodes;
- connectors;
- packaging/update health.

A repair is not successful until verified.

---

## 22. Desktop UX contract

The more capable LiOS becomes, the simpler the default UI must become.

Default:
- one conversation surface;
- one minimal composer;
- `+` for attachments/tools/context;
- one voice affordance when available;
- `/` for power commands;
- Cmd/Ctrl+K for universal search;
- contextual execution/tool cards;
- optional Workbench/terminal.

No permanent agent/model/session/tool bars merely because those capabilities exist.

Adopt descriptor-based command architecture so one registry powers slash commands, command search, completions, help, shortcuts and plugin/skill contributions.

Useful behavioral concepts to adapt:
- steering an active run;
- follow-up queue;
- collect/interrupt semantics;
- persistent goal/objective;
- side question that does not mutate primary task context.

---

## 23. Trust/provenance

Every important execution should produce a LiOS receipt with:
- who/which device initiated;
- project/conversation/execution id;
- node/backend;
- command/tool/runtime;
- approval/policy state;
- start/end;
- exit/result;
- files changed where knowable;
- output/source digest;
- source/evidence refs;
- model/provider when applicable.

This is a LiOS differentiator over generic agent shells.

---

## 24. Security invariants

- No sandboxed agent receives an unintended host shell.
- Revalidate authorization after async boundaries and immediately before side effects.
- Device capability does not imply permission.
- Secrets are references and narrowly resolved.
- No renderer-controlled state is sole authority for host execution.
- External DB access is read-only by default.
- Project/user/tenant boundaries remain independent from model prompts.
- Remote user-owned nodes are untrusted until paired/authorized.
- Plugin/skill/MCP capabilities use existing LiOS governance.
- Donor config/state never bypasses LiOS policy.
- No hidden telemetry/data upload.
- Logs/diagnostics are redacted and local by default.

---

## 25. Deployment and distribution

LiOS should eventually ship:
- signed desktop installers;
- native iOS/iPadOS;
- native Android;
- Watch/Wear companions;
- headless Gateway/node package;
- Docker/Compose reference deployment;
- NAS guidance;
- Kubernetes/reference manifests where justified.

All headless/server deployments run in user infrastructure.

Updates may use app stores/GitHub Releases/CDNs/package registries. This does not make them LiOS runtime infrastructure.

---

## 26. Verification requirements

Imported OpenClaw behavior is not "done" because it compiles.

Qualification applies continuously throughout SI-01–SI-07; GM-25 consolidates it rather than deferring security, numerical, licensing, persistence or packaging checks to a final wave. Each SP-01–SP-07 requires a bounded Minimum Shippable Journey, real integrated user outcome, applicable packaged/target execution, no fake success, regression protection and an exact commit/build/environment/outcome/limitations evidence record. P14 remains final release authority. Existing component closures and CP smoke records do not establish Shipping Point acceptance.

Required classes:
- port relevant upstream tests;
- PTY/process-tree tests;
- reconnect/attach/replay;
- WebSocket backpressure;
- offline/outbox;
- device pairing/revocation;
- mobile protocol compatibility;
- permission/approval stale-state tests;
- sandbox escape/regression tests;
- backup/restore verification;
- storage disconnect/failure;
- DB migration;
- cross-platform packaging;
- Electron native ABI/sign/notarize/ConPTY validation;
- chaos tests;
- end-to-end acceptance journeys.

Chaos examples:
- kill Gateway mid-run;
- suspend Home;
- drop phone network;
- revoke device;
- break PostgreSQL;
- disconnect external drive;
- expire secret;
- terminate PTY;
- reconnect from another client;
- interrupt agent;
- corrupt incomplete backup;
- fail remote node.

---

## 27. Canonical implementation program — GM tasks

These are the stable IDs for this assimilation program. They live inside the canonical roadmap; do not create a competing task family.

### GM-00 — Donor lock, license, provenance and architecture freeze
Pin OpenClaw baseline, machine-readable donor records, notices policy, ownership boundaries and zero-server rule.

### GM-01 — Repository duplication/hosted-assumption audit
Find duplicate routers/stores/session systems and every hosted-SaaS assumption that conflicts with user-owned infrastructure. Produce migration/removal map before structural imports.

### GM-02 — Replaceable runtime provider seams
Extend existing LiOS runtime contracts for database/storage/secrets/compute/network/backup/identity/notification/browser without duplicate registries.

### GM-03 — Desktop Local / LiOS Home
Make local PGlite + filesystem + OS vault + local Gateway + local execution a complete, coherent default. Add user-selected local workspace/drive posture.

### GM-04 — Canonical DB migration and relocation
Harden local PGlite, user PostgreSQL, migration/relocation/health/restore and canonical authority.

### GM-05 — Storage provider fabric + client-side encryption
Filesystem + S3-compatible first; then Azure/GCS/WebDAV/plugin as justified.

### GM-06 — Backup, restore, portability and Home migration
Verified snapshots, retention, encryption, export and local↔user-server migration.

### GM-07 — SecretRef and user-owned identity/network boundaries
Strengthen secret providers, local identity, enterprise BYO identity, no hidden vendor dependency.

### GM-08 — Gateway protocol/client assimilation
Fork/adapt OpenClaw protocol/client into LiOS-owned typed device/session transport.

### GM-09 — Device identity, pairing, discovery and mesh
QR pairing, device credentials, Bonjour/mDNS, revocation, capability advertisement, multi-Gateway rules.

### GM-10 — Execution Fabric kernel
PTY/process subsystem, ring buffer, flow control, session manager, attach/replay, uploads, cancellation and cleanup.

### GM-11 — Execution authority, sandboxing and trust receipts
Host authority, exact-operation approvals, stale-policy defense, sandbox backends, audit receipts.

### GM-12 — Agent-core and runtime abstraction
Integrate agent loop mechanics; separate providers/models from runtimes; retain LiOS canonical context/policy/artifacts.

### GM-13 — Codex/ACP and coding execution
Bring coding runtimes into governed LiOS sessions on local/user nodes.

### GM-14 — Browser/computer-use and user-owned remote nodes
Adapt browser/remote computer stack; session placement; user SSH/container/cloud execution.

### GM-15 — iOS/iPadOS fork
Native LiOS mobile client/node using donor code, fully rebranded/rethemed and mapped to LiOS protocol/state.

### GM-16 — Android fork
Native LiOS Android client/node with equivalent governed capabilities.

### GM-17 — Watch/Wear, Share, Live Activities, offline/outbox
Cross-device micro-interactions and resilient mobile state.

### GM-18 — Notification strategy without LiOS servers
Apple-native/local/user-managed routes, documented platform limitations, no LIOS APNs relay.

### GM-19 — Memory/Dreaming convergence
Integrate active/consolidated memory patterns into LiOS Project/Decision memory with provenance.

### GM-20 — Multi-agent/skills/P13/MCP convergence
Internal specialist orchestration, reusable skills, one plugin authority, one MCP authority.

### GM-21 — System Agent / Doctor / repair
Conversational setup, infrastructure health, prove-after-repair.

### GM-22 — BYOAI/local-model expansion
Broaden provider/runtime support and make local/self-hosted model routes first-class.

### GM-23 — Conversation-first desktop convergence for new capability
Minimal composer, one command registry, execution cards, terminal on demand; no new permanent chrome.

### GM-24 — User-owned deployment packs
Headless Gateway/node, Docker/Compose, NAS and user cloud deployment references.

### GM-25 — Hardening and release qualification
Compatibility matrix, chaos testing, supply-chain/signing, migration/export, opt-in telemetry, complete documentation and acceptance journeys.

---

## 28. Dependency waves

### Wave A — freeze and foundation
GM-00 → GM-01 → GM-02

### Wave B — local ownership
GM-03, GM-04, GM-05, GM-06, GM-07

### Wave C — transport and execution
GM-08 → GM-09 → GM-10 → GM-11

### Wave D — intelligence runtimes
GM-12 → GM-13, GM-14; GM-19/GM-20 can proceed against stable runtime interfaces

### Wave E — native devices
GM-15 + GM-16 after GM-08/09 contracts stabilize; GM-17/18 after device foundations

### Wave F — system experience/deployment
GM-21, GM-22, GM-23, GM-24

### Wave G — qualification
GM-25 consolidates continuous qualification across every SI phase and Shipping Point; it is not permission to postpone required gates.

Parallel work consumes stable contracts without rewriting unsettled shared core. One implementation owner per shared-core authority; independent adapters, donor analysis and isolated capability work may proceed under coordinated bounded owners. These dependency waves are subordinate to SI strategic outcomes and permit safe dependency pull-forward.

---

## 29. Agent working rules for this program

Before any GM implementation:
1. pull current `main`;
2. read `AGENTS.md`, the SI plan, Shipping Point contract, canonical docs and this blueprint;
3. select one bounded GM task, declare SI phase/workstream and target SP or `none/direct enabler` with explanation, and state the MSJ contribution and affected validation journeys;
4. open/update a GitHub issue;
5. declare high-conflict files;
6. inspect existing LiOS implementation before donor import;
7. inspect exact OpenClaw source at the pinned baseline;
8. state copied paths and destination paths;
9. state license/notices obligations;
10. define tests and rollback/removal path.

For donor imports, PR handoff must include:
- OpenClaw path(s);
- pinned source commit;
- LiOS path(s);
- copied vs adapted vs rewritten code;
- canonical state owner;
- security/policy mapping;
- tests ported;
- packaging impact;
- notices/third-party updates;
- known divergence from upstream.

Do not let two agents independently fork the same OpenClaw subsystem.

---

## 30. Do-not-do list

Do not:
- fork OpenClaw wholesale and call it LiOS;
- replace LiOS Project/Conversation/Artifact/Data authorities with OpenClaw stores;
- run a second permanent Gateway beside a LiOS Gateway-derived implementation;
- create a second plugin SDK, MCP stack, memory authority or approval system;
- make the user configure cloud infrastructure before first value;
- build LiOS-hosted compute/storage/sync to solve a convenience problem;
- expose all imported capability as permanent UI;
- ship donor branding/trademarks/assets;
- put APNs publisher private keys in desktop/user servers;
- blindly sync live DB files through consumer cloud folders;
- weaken sandbox/permission checks to make agents feel more autonomous;
- claim donor functionality is shipped until integrated and accepted.

---

## 31. Definition of success

A successful LiOS installation can begin as:

```text
one laptop
one local database
one local filesystem
one local Gateway
user-selected AI/data
```

and grow, without changing product identity, into:

```text
user-owned always-on Home
+ PostgreSQL
+ object/NAS storage
+ multiple compute nodes
+ mobile/watch clients
+ browser/computer use
+ coding runtimes
+ local/remote models
+ enterprise identity
+ encrypted backups
```

while LiOS itself operates no customer runtime server.

That is the Goldmine objective.

---

## 32. GM-01 findings — duplication and hosted-assumption audit

**Task:** GM-01 (issue #150, tracker #149). **Base:** `main` `2ec14399` (GM-00). **Type:** audit only — no behaviour change and no donor import. Paths are relative to `src/` unless prefixed `../`.

**Evidence tags.** **V** = re-read by the auditor in the cited file at the base commit (grep/sed reproducible). **S** = reported by a read-only survey of that file; not re-read. **I** = inferred, not read. Nothing tagged **I** is a finding of record; it is a lead. Counts come from `grep`/`ls` over non-test production files.

### 32.1 Headline

1. **The customer desktop is not zero-LiOS-server today.** A client-audience build refuses to start without an embedded HTTPS `LIOS_CONTROL_PLANE_URL` (`main.cjs:550` **V**; `script/desktop_build.cjs:43` **S**). Login/registration POST the user's email and password to that LiOS host (`server/controlPlaneRemote.ts:314-328` **S**), the local PGlite user is a "non-authoritative shadow" (`server/clientRoutes.ts:214` **S**), and every client request re-validates against it (`server/auth.ts:361,371,394` **S**; ~30 `isRemoteControlPlaneConfigured` sites **S**). Observed payloads are identity, commerce, device label and a domain list; **no conversation/file/artifact content was observed leaving** (not proven absent — see 32.7).
2. **The same codebase ships a LiOS-operated hosted service** (`../render.yaml:1` "Render Blueprint for the hosted LiOS service" **V**; `Dockerfile:39` `ENV HOST=0.0.0.0` **V**; `server/gateway.ts:142` `app.listen(PORT, "0.0.0.0")` **V**; hosted credential vault `server/organizationCredentialVault.ts`, trials, Paddle webhooks **S**).
3. **There is no single data root.** 47 production files derive `~/.limuria-terminal` / `LIMURIA_DATA_DIR` / `cwd/data` independently (**V** count); the PGlite directory sits outside the Electron `userData/workspace` that the only backup covers (`server/db.ts:31-36`, `main.cjs:383` **S**).
4. **Missing storage fails open.** If the PGlite directory is absent, `db.ts` creates an empty (or seed) database instead of refusing (`server/db.ts:74-75` `freshDatabase = !fs.existsSync(PGLITE_DIR); if (freshDatabase) restoreSeedDbOrCreateEmpty()` **V**). This contradicts blueprint §3.3.
5. **Secrets have five stores and no `SecretRef`.** The file vault falls back to a key derived from `HOME:hostname` with a constant salt (`server/credentialVault.ts:61-63` **V**); the OS-vault master key reaches the server through an environment variable (`main.cjs:246` **S**).
6. **Permission state is client-trusted.** Per-action approvals and the AI transmission policy live in browser `localStorage` (`client/src/lib/conversationRuntimeClient.ts:32,61,69` **V**) and are read by the server from the request body (`server/conversationRuntime.ts:1962,2284,3364` `input.request.approvals` **V**). A server-side authority is required before GM-11 host execution.
7. **Duplicates are real but bounded:** 3 MCP implementations, 4 plugin/manifest formats, ~7 permission mechanisms, 3 command registries, 3 provider caches, 2 auth stacks, 3 decision systems (details 32.3). Runtime execution has **no PTY and no common execution policy**; only the P13 plugin host is policy-governed.

### 32.2 Hosted / LiOS-operated assumptions

Class: **ENT** entitlement/licence, **ID** identity, **COM** commerce, **DIST** distribution (allowed by §4.2), **CDP** customer-data path or vendor-operated runtime (violates §1).

| ID | Finding | Evidence | Class | Disposition | Task |
| --- | --- | --- | --- | --- | --- |
| H-01 | Client build requires embedded control-plane URL at build and at launch | `script/desktop_build.cjs:43` S; `main.cjs:550` V | ENT/ID | **DECIDE Q1**; then make optional | GM-02, GM-07 |
| H-02 | Email + password sent to the LiOS host for login/register; control-plane cookie kept in the auth session | `server/controlPlaneRemote.ts:314-328` S; `server/auth.ts:764,804,936` S | ID/CDP | **DECIDE Q1** | GM-07 |
| H-03 | Local identity is a shadow of the remote one; entitlement re-checked per request | `server/clientRoutes.ts:214`, `server/auth.ts:361-395` S | ID/ENT | WRAP behind `IdentityProvider`/`LicenseProvider` | GM-02, GM-07 |
| H-04 | Device id (workspace UUID) and `hostname · platform` label sent to LiOS | `server/controlPlaneRemote.ts:~141`, `main.cjs:~252` S | CDP (low) | Drop hostname or hash; keep as **licence seat**, not pairing identity | GM-07, GM-09 |
| H-05 | Ed25519 offline licence lease + cache already exist; lease is minted only by a hosted server after online login | `server/licenseLease.ts`, `server/offlineLeaseCache.ts:45,78`, `server/controlPlaneRemote.ts:175-190` S | ENT | **KEEP**; add vendor-issued file import so first run needs no login | GM-07 |
| H-06 | Legacy dev-only HMAC lease variant | `server/licenseLease.ts:46-49` S | ENT | REMOVE | GM-07 |
| H-07 | Device-binding secret has a hard-coded fallback `limuria-local-device-binding-v1` | `server/auth.ts:236-238` S | ENT | REMOVE; derive from SecretProvider | GM-07 |
| H-08 | Enterprise policy projection and SAML verifier/callback depend on LiOS hosts | `server/index.ts:45,184`, `server/enterpriseSso.ts:694` S | ID | **DECIDE Q1** (OIDC/SAML must target the *user's* IdP) | GM-07 |
| H-09 | `render.yaml` hosted blueprint, `Dockerfile` (`HOST=0.0.0.0`, `seed:internal`), admin bootstrap `admin@limuria.com` | `../render.yaml:1,35-45` V/S; `Dockerfile:39-54` V/S | CDP | **DECIDE Q2** | GM-24 |
| H-10 | Second server `server/gateway.ts` binds `0.0.0.0` with one shared `x-gateway-key`; main server proxies finance routes to it via `DATA_GATEWAY_URL` | `server/gateway.ts:142` V; `server/routes.ts:342-346` S | CDP-capable | REMOVE (dev-only by its own header) unless Q2 retains it | GM-03 |
| H-11 | Hosted multi-tenant credential vault: `organization_credentials`, implicitly on whenever `DATABASE_URL` is set | `server/organizationCredentialVault.ts:13,18-26` S | CDP | Keep only as an optional **user-Postgres** `SecretProvider`; never a LiOS vault | GM-07 |
| H-12 | `release:preflight:hosted` mode requires hosted vault/device secrets | `script/release_preflight.ts:408-419` S | CDP | REMOVE mode | GM-24, GM-25 |
| H-13 | Crash/perf diagnostics forwarded browser → local `/api/client/diagnostics` → control plane; server side off unless `LIOS_TELEMETRY_ENABLED=true` | `client/src/lib/terminalTelemetry.ts:165-213`, `server/productionControlPlane.ts:315` V/S | CDP | Default off, explicit user opt-in, inspectable payload | GM-21 |
| H-14 | Event relay posts arbitrary ≤32 KB payloads to `LIOS_EVENT_RELAY_URL` (off by default) | `server/productionControlPlane.ts:512,569` S | CDP-capable | REMOVE or restrict to vendor-ops events | GM-21 |
| H-15 | `/api/public/leads` writes PII to the product DB; client page posts to it | `server/publicRoutes.ts:36-47`, `client/src/pages/ExperienceCenter.tsx:74` S | COM | Move to the marketing site; drop from desktop bundle | GM-24 |
| H-16 | Billing (Paddle live API), credit wallet, webhooks received by the product server | `server/billingProviders/paddleProvider.ts:85`, `server/billingWebhookRoutes.ts`, `server/creditMetering.ts:19` S | COM | Webhook receiver belongs to the vendor commerce site, not the customer runtime; local credit ledger **DECIDE** | GM-07, GM-24 |
| H-17 | Auto-updater from a generic HTTPS feed; no default host | `desktopUpdater.cjs:3-33` S | DIST | **KEEP**; add a user-visible disable | GM-24 |
| H-18 | Release workflows (website preview, mac/windows sign + `gh release upload`) | `.github/workflows/*release*.yml` S | DIST | **KEEP** | GM-24 |
| H-19 | `limuriaintelligence.com` in source is a User-Agent string and an OpenLineage namespace id, not a data path | `server/lseDataProvider.ts:294,730` V; `server/p10OpenLineage.ts:67` V | DIST | KEEP; resolved, not a finding | — |
| H-20 | Electron CSP allows any HTTPS/WSS origin for `connect-src` and `img-src`, overriding the server CSP | `main.cjs:528` V | CDP-capable | Tighten to an egress allow-list from the `NetworkProvider` | GM-07 |
| H-21 | No hosted AI proxy, push relay, sync or cloud-storage path found | provider calls are direct (`server/byoaiTransport.ts:139,467,479` S) | compliant | KEEP; re-verify in GM-25 | GM-25 |

### 32.3 Duplicate systems (canonical owner → redundant)

| ID | Group | Canonical owner (proposed) | Redundant / overlapping | Evidence | Task |
| --- | --- | --- | --- | --- | --- |
| D-01 | HTTP servers | `server/index.ts` as the local Gateway (loopback default `server/listenConfig.ts:15`) | `server/gateway.ts` (H-10); phase-named route modules: 71 `*Routes.ts`, ~110 registrations in `routes.ts`, ~811 route handlers | S | GM-02, GM-08 |
| D-02 | AI routing | `byoaiRouter.ts` + `byoaiTransport.ts` behind an `AIProvider` | provider catalogue repeated in `client/src/lib/providerCatalog.ts:808-869`, `server/connectorCredentialProbes.ts:45-50`; direct Ollama call `server/uideEngine/pdfStatementExtractor.ts:259`; chat entry in both `routes.ts:39` and `conversationRuntime.ts:42`; `masterAiGate` as a 4th gate | S | GM-22 |
| D-03 | Intent resolution | `conversationCapabilityResolver.ts` | `shared/askLiosRouter.ts` regex classifier (used by `routes.ts:41` and `conversationRuntime.ts:30`) | S | GM-12, GM-23 |
| D-04 | Connector/data routing | `shared/connectorRegistry.ts` (claims sole entry), `universalDataResolver` + `sourceRouter` | `providerSdk.ts` registry; 3 caches (`providerCache`, `providerExecutionCache`, `providerRuntimeHub`); `capabilityBroker.ts`; in-process vs gateway market data | S | GM-02 |
| D-05 | Runtime registries | `shared/runtimeRegistry.ts` / `runtimeContracts.ts` (§5 requires extending these) | `runtimeAdapters.ts`, `runtimeFoundation.ts`, `p6RuntimeRegistry.ts`, `p10RuntimePacks.ts`, `runtimeManifest.ts`, `capabilityRegistry.ts` | S | GM-02 |
| D-06 | Plugin / pack manifests (4) | P13: `shared/pluginSdk.ts` + `server/p13Plugin*.ts` | `connectorPlugin.ts` (`custom_` manifest, fs discovery, **no sandbox**); `hiddenEnginePackManifest.ts`/`engineFabricContracts.ts` + `p11*`; `ProviderSdkRegistry` | S | GM-20 |
| D-07 | MCP (3 hand-rolled JSON-RPC stacks) | `server/p13McpServer.ts` (tenant-bound, plugin-aware; mounted via `p13PluginRuntime.ts:120` V) | `server/mcpRoutes.ts` + `mcpTransport.ts` + `mcpFinanceTools.ts` (mounted `routes.ts:93` V); keep `externalMcpClient.ts` as the client | V (files), S (behaviour) | GM-20 |
| D-08 | Permission / approval (≥7) | `runtimePermissionClass` vocabulary + one **server-side** grant store | client `localStorage` grants (V); `byoaiRouter.evaluateToolPermission`; MCP role policies `mcpRoutes.ts:51-77`; plugin manifest permissions; `governanceEngine`/`p11Governance`/enterprise AI policy; `tenantContext`/`effectiveAccess`/`sourceConnectionPolicy`/`masterAiGate` | V/S | GM-11 |
| D-09 | Command registries (3) | `client/src/lib/terminalIntentCommands.ts` | inline `QUICK_COMMANDS` in `client/src/components/terminal/ProjectExperienceShell.tsx:203`; `terminalCommandComposer.ts` | S | GM-23 |
| D-10 | Auth surfaces | one identity model behind `IdentityProvider` | `/api/auth` (internal) vs `/api/client/auth` (client) and `IS_CLIENT_BUILD` gates | S | GM-07 |
| D-11 | Session concepts (≥7 meanings) | Project Session (`project_sessions`, `shared/schemaProjects.ts:86`) | UIDE workspaces/snapshots (file store, `/api/workspaces` still live); ≥6 `localStorage` layout keys; `sessionRestoration.ts` (auth, name collision) | S | GM-04 |
| D-12 | Memory / decisions | Project Ledger + Artifacts + P7 store; DB decision records | `aiMemory.ts` per-user JSON (max 100); `terminalSessionMemory`; 31 of 101 client `terminal*` libs use `localStorage` (decisions, thesis map, research thread, missions…); 3 server decision systems; `chat_messages` vs `project_chat_messages` (`server/storage.ts:108` V) | S | GM-19 |
| D-13 | Secrets (5 stores) | `SecretProvider` over OS `safeStorage` with a local-vault provider | `credentialVault` file vault; `organizationCredentialVault`; `sessionVault` + `session-secret` file; `apiKey.ts` `api-keys.json`; `~/.limuria-terminal/config.json` plaintext fallback; env-first resolution | V/S | GM-07 |
| D-14 | Paths / file stores | one `DataRoot` resolver | 47 files (V); user-state files (aiMemory, api-keys, UIDE stores, audit log) beside genuine caches | V/S | GM-03, GM-05 |
| D-15 | Process launch | one supervisor + `ExecutionBackend` (model: `server/p13PluginHost.ts:174,211` `node --permission`, spawn denied) | Python launched by `server/pythonService.ts:218`, `desktopPythonSidecar.cjs:140`, `p11SidecarSupervisor.ts:119`; 6 one-shot `execFile` paths; `pythonRuntimeManager` pip-installs at runtime | S | GM-10, GM-11 |
| D-16 | Backup / export | one portable archive (§7) | workspace backup (no DB), `pgliteBackup` (migration snapshot), project portability manifest, Artifact package, "snapshot" vocabulary used 4 ways | S | GM-06 |

### 32.4 Local-runtime gaps (Desktop Local readiness)

| ID | Finding | Evidence | Task |
| --- | --- | --- | --- |
| L-01 | No explicit runtime mode: ≥6 independent env sniffs (`DATABASE_URL`, `HOST`, `NODE_ENV`, `LIMURIA_CREDENTIAL_STORE`, `PYTHON_LOCAL_SERVICE_DISABLED`, control-plane URL) | `server/db.ts:59`, `server/auth.ts:84-89` S | GM-03 |
| L-02 | No user-selectable data root; no `setPath('userData')`; main forwards `LIMURIA_DATA_DIR` only if already set | `main.cjs:258` S | GM-03, GM-06 |
| L-03 | Backup scope is `userData/workspace` only; excludes PGlite, vault, history | `main.cjs:383`, `desktopWorkspaceBackup.cjs` S | GM-06 |
| L-04 | No PGlite → PostgreSQL migration, logical export or restore | `server/dbMigration.test.ts` fresh chain only S | GM-04 |
| L-05 | `drizzle.config.ts` throws without `DATABASE_URL`, so migration generation does not target PGlite | `drizzle.config.ts:3-5` S | GM-04 |
| L-06 | No per-launch credential between renderer and local server; session cookie only; fixed port with a probe-then-bind race | `server/index.ts:146-157`, `main.cjs:152-159` S | GM-08 |
| L-07 | Python sidecar HTTP has no auth (no token/`Depends` hit in `python-service/main.py`) and a fixed port 5077 | grep V (absence); `server/pythonService.ts:36` S | GM-10 |
| L-08 | Doctor reports booleans only (no path existence, space, lock, port) | `script/lios_doctor.ts:55-66` S | GM-21 |
| L-09 | Build targets: mac dmg/zip, windows nsis x64. No Linux, no headless mode, no compose | `package.json` `build` S | GM-24 |
| L-10 | No mobile, pairing, discovery or device identity (licence "device" ≠ paired device) | grep S | GM-09, GM-15 |
| L-11 | `runAsNode` fuse enabled; `main.cjs:233-235` hard-codes Homebrew/Framework Python onto `PATH` | `package.json` `electronFuses`, `main.cjs:233` S | GM-11, GM-25 |
| L-12 | `server/historyStore.ts` is market-price history, not conversation history (name collision) | `server/historyStore.ts:25-28` S | GM-05 |

### 32.5 Owner decisions required before dependent work

These change a policy boundary, so they are **reported, not decided here**.

- **Q1 — Identity and entitlement — DECIDED by owner 2026-10-02: option (b).** Vendor sign-in is used only to *obtain* a signed licence; **no LiOS contact at runtime**; organisation SSO targets the customer's own IdP; the existing Ed25519 lease verify/cache code is reused with a file-import path (H-05). Original question: The desktop currently logs the user in at a LiOS-operated control plane. Blueprint §4.2 allows commerce/entitlement services off the data path and prefers signed offline entitlements; §1.6 forbids requiring a LiOS server for credentials and conversations. Options: **(a)** local owner identity + vendor-issued signed licence file, no LiOS login at runtime; **(b)** optional vendor sign-in only to *obtain* a licence, never at runtime; **(c)** status quo. Recommendation: (b) with the file-import path in H-05, and organisation SSO pointing at the customer's own IdP. This fixes the shape of `IdentityProvider`/`LicenseProvider` in GM-02, so it blocks GM-07 and the seam design.
- **Q2 — Hosted artifacts — DECIDED by owner 2026-10-02: retire the hosted service; repurpose the Dockerfile as the seed of the user-owned deployment pack (GM-24).** No customer data on any LiOS-run service; a separate vendor marketing/commerce/update site may exist. Original question: Retire `render.yaml`, the hosted Dockerfile mode, `server/gateway.ts`, hosted vault and `release:preflight:hosted`? Or re-purpose the Dockerfile as the seed of the **user-owned** deployment pack (GM-24) and keep a separate vendor commerce/marketing site? Recommendation: the latter; no customer data on any LiOS-run service.
- **Q3 — Dual audiences — DECIDED by owner 2026-10-02: one build, one API surface, features driven by entitlement/role.** The `internal`/`client` split and the duplicate `/api/auth` vs `/api/client/auth` stacks converge behind `IdentityProvider` (GM-07). Original question: Keep `internal` vs `client` builds and two API surfaces, or converge on one build with entitlement-driven features?
- **Q4 — Telemetry — DECIDED by owner 2026-10-02: default off, explicit opt-in, payload inspectable before send, generic event relay removed.** Users may export a diagnostics bundle manually (GM-21). Original question: Confirm default-off, user opt-in, inspectable payload, and removal of the generic event relay.
- **Q5 — Renderer ↔ local server trust — DECIDED by owner 2026-10-02: per-launch random token and random loopback port handed to the renderer over IPC; CSP tightened to an egress allow-list from the `NetworkProvider`.** Browser/mobile clients use the separate paired-device Gateway path (GM-08/09). Original question: Choose per-launch token, unix socket/named pipe, or custom protocol (affects GM-08 Gateway).
- **Q6 — Server-side grants — DECIDED by owner 2026-10-02: a Project-scoped server-side store is authoritative; the client is a view; request-supplied grants are ignored.** Existing local grants migrate once. Precondition for GM-11. Original question: Confirm that approvals and AI-transmission policy move to a Project-scoped server store with the client as a view (precondition for GM-11).

### 32.6 OpenClaw opportunities not yet named in §9.1

Verified present at the pinned commit `c074824a…` (file counts from the git tree; not read for fit). Candidates only — **no import is proposed or started**; each would be claimed by the owning GM task.

| Donor path | Files | Possible LiOS use | Task |
| --- | ---: | --- | --- |
| `packages/net-policy` (deps: `ipaddr.js`) | 12 | Egress/SSRF policy for the `NetworkProvider`; compare with LiOS connector SSRF hardening | GM-07 |
| `packages/memory-host-sdk` | 135 | Memory/Dreaming host contract | GM-19 |
| `packages/model-catalog-core`, `packages/llm-core`, `packages/tool-call-repair`, `packages/retry` | 21 / 19 / 14 / 3 | Model catalogue, tool-call repair, retry for the single `AIProvider` | GM-12, GM-22 |
| `packages/acp-core` | 22 | ACP adapters for coding runtimes | GM-13 |
| `packages/plugin-sdk`, `packages/plugin-package-contract` | 62 / 5 | Package contract to merge **into** P13, not a second SDK | GM-20 |
| `packages/session-url-contract`, `packages/workboard-contract` | 14 / 2 | Session addressing; task board shape | GM-08, GM-10 |
| `crates/openclaw-node-host`, `crates/openclaw-gateway-client` (Rust) | 25 | Headless node/host for NAS, Pi, VPS Homes | GM-09, GM-14, GM-24 |
| `custodian-skills/*`, `security/opengrep` | 4 / 12 | Doctor skills; static-analysis rules for release gating | GM-21, GM-25 |
| `deploy/` | 5 | Reference deployment packaging | GM-24 |

**Licence note.** All sampled `packages/*/package.json` are `0.0.0-private` with no `license` field; the root `LICENSE` is MIT, "Copyright (c) 2026 OpenClaw Foundation". The notice carried into LiOS must use that exact holder. Each import must also record the package's own dependencies (e.g. `ipaddr.js`, `p-map`, `zod`, `typebox`) in `third_party/`.

### 32.7 Removal / migration map by task

| Task | Takes ownership of |
| --- | --- |
| GM-02 | `DatabaseProvider`, `StorageProvider`, `SecretProvider`, `IdentityProvider`, `LicenseProvider`, `NetworkProvider`, `BackupProvider`, `ExecutionBackend` as extensions of `runtimeContracts`/`runtimeRegistry` (D-04, D-05, H-03); explicit `runtimeMode` (L-01) |
| GM-03 | `DataRoot` (D-14, L-02), loopback-only Gateway, delete `gateway.ts` path (H-10), fail-safe missing storage (finding 4) |
| GM-04 | Relocation/health/restore, PGlite↔PostgreSQL export-import (L-04/05), UIDE/file-store and `localStorage` state into Project Sessions/DB (D-11, D-12) |
| GM-05 | `StorageProvider` reference impl from `projectAttachmentStore.ts` (the only place that already encodes "remote DB needs a blob volume"); client-side encryption |
| GM-06 | One portable archive including DB, vault references, attachments (L-03, D-16) |
| GM-07 | `SecretRef` seeded from `sourceConnections.credentialRef` (`server/sourceConnectionService.ts:81-82` S), secret-provider chain, remove fallback keys (H-07, D-13), identity/licence per Q1, egress allow-list (H-20) |
| GM-08 | Local Gateway protocol, renderer trust (L-06), route manifest (D-01), session/URL contract |
| GM-09 | Paired-device identity distinct from licence seat (H-04, L-10) |
| GM-10/11 | One supervisor (D-15, L-07), server-side grants (D-08, Q6); use `p13PluginHost` as the policy model |
| GM-19/20/22 | Memory (D-12), MCP/plugin/command convergence (D-06, D-07, D-09), AI catalogue (D-02) |
| GM-21 | Doctor path/DB/port checks (L-08), telemetry posture (H-13/14) |
| GM-24 | Headless/Docker/NAS packs (H-09, L-09), updater opt-out (H-17), marketing/commerce site separation (H-15, H-16) |
| GM-25 | Re-verify zero-LiOS-server (H-21), fuse/PATH review (L-11) |

### 32.8 Not examined / limits

- Bytes returned or forwarded by `/api/client/dashboard/domains`, `/api/client/control-plane/snapshot|access`; whether any client route forwards watchlist/portfolio content.
- Python service (`python-service/`) outbound calls and file writes; `p10Observability`/`p10OpenLineage` remote endpoints and defaults.
- First-run offline behaviour of a client build with no cached lease.
- Per-route authorization across ~811 handlers (partly covered by `server/routesAccessBoundary.test.ts`).
- Whether the packaged `dist/index.cjs` includes hosted-only routes (billing, webhooks, SAML) — inferred from the single bundle, not verified.
- Callers of `chat_messages` vs `project_chat_messages`, and the owner split of the three decision systems.
- Electron renderer font/CDN loads; remaining `localStorage` libs beyond those named; `.cursor/Dockerfile`.
- Behaviour was audited by source reading only; **no application run, no packaged-app inspection, no network capture.**

### 32.9 Corrections made during the audit

- A survey reported `better-sqlite3` as unused; it is imported by `server/databaseConnector.ts` (user SQLite data-source connector) and `server/capabilityBroker.test.ts` (**V**). It is **not** a removal candidate.
- A survey suggested `limuriaintelligence.com` in `lseDataProvider.ts` might be a data path; it is a User-Agent string (H-19).
- Survey GM numbers were re-mapped here to the §27 definitions.

---

## 33. GM-02 — provider seams: implementation record

**Task:** GM-02 (tracker #149). **Base:** `main` `82421535`. **Donor code imported:** none. **Owner decisions applied:** Q1–Q6 (§32.5) and "registry seam now; behavioural interfaces with the owning task".

### 33.1 What exists now

There is still **one** registry (`shared/runtimeRegistry.ts`). GM-02 added no registry, router or store.

| Piece | File | Role |
| --- | --- | --- |
| 10 new component kinds | `shared/runtimeContracts.ts` | `database_provider`, `storage_provider`, `secret_provider`, `execution_backend`, `identity_provider`, `license_provider`, `network_provider`, `backup_provider`, `notification_provider`, `browser_provider` (AI keeps `ai_provider`) |
| Slots, Home profile, conformance | `shared/runtimeProviderContracts.ts` | Which kind fills each slot; `HomeProfile`; pure `evaluateHomeProfile()` |
| Runtime mode | `server/runtimeMode.ts` | `desktop_local` \| `user_home_server`, from `HOST`. `auth.ts` `isLocalRuntime()` now delegates (identical results, table-tested) — closes GM-01 L-01's `HOST` sniff; the other env sniffs (`DATABASE_URL`, etc.) are now read in one place by `resolveActiveHomeProfile()` but still branch in their original files until GM-03/04 |
| Real provider projection | `server/runtimeProviders.ts` | Describes today's implementations as registry components with process-derived health |
| Foundation wiring | `server/runtimeFoundation.ts` | Snapshot gains `home` (mode, profile, conformance); registry gets providers with health |

Existing diagnostic route `GET /api/runtime/foundation` (internal-only) now includes `home`. No new route, no UI.

### 33.2 Providers registered (real code they describe)

| Slot | Provider id | Implementation described | Operator |
| --- | --- | --- | --- |
| database | `lios.database.pglite` / `lios.database.postgres` | `server/db.ts` (`DATABASE_URL` switch) | user |
| storage | `lios.storage.local-fs` | `server/projectAttachmentStore.ts` | user |
| secrets (ordered chain) | `lios.secrets.env` → `lios.secrets.local-vault` **or** `lios.secrets.organization-vault` | `resolveCredential()` order in `server/credentialVault.ts` | user |
| execution | `lios.execution.local` | Node server, P13 plugin host, Python sidecar | user |
| identity | `lios.identity.local-session` · `lios.identity.control-plane-remote` | `server/auth.ts` · `server/controlPlaneRemote.ts` | user · **vendor (legacy)** |
| license | `lios.license.signed-offline-lease` · `lios.license.control-plane-remote` | `server/licenseLease.ts`, `offlineLeaseCache.ts` · remote entitlement | user · **vendor (legacy)** |
| network | `lios.network.loopback` · `lios.network.user-bind` | `server/listenConfig.ts` | user |
| backup (chain) | `lios.backup.workspace-archive` · `lios.backup.pglite-snapshot` | `desktopWorkspaceBackup.cjs` · `server/pgliteBackup.ts` | user |
| browser | `lios.browser.playwright-optional` | `server/playwrightBrowserAdapter.ts` | user |
| notification | *(none)* | nothing ships; GM-18 | — |

Each provider declares **exactly one** `operator:user|vendor` tag and the `mode:*` values it supports. Vendor-operated providers are registered so the inventory is honest, but a conformant profile never selects one (Q1).

### 33.3 Conformance, as measured by the code

`createHomeRuntimeSnapshot(env).conformance` reports every issue (not just the first): `required_slot_empty`, `unknown_provider`, `wrong_kind`, `mode_incompatible`, `vendor_operated_runtime_dependency`, `operator_undeclared`. Verified behaviours (tests): a default desktop process is conformant; a client build with a usable `LIOS_CONTROL_PLANE_URL` fails with exactly the identity and licence dependencies (the work GM-07 removes); a server Home on a user PostgreSQL reports `backup:required_slot_empty` (the GM-06 gap); the vault-protection mode (OS-protected or file-permission-only) is stated in health detail. Payloads never contain connection strings, URLs or secrets (tested with sentinel values).

### 33.4 Deliberately not done

- **Behavioural interfaces** (`put/get`, `resolve`, `relocate`, `execute`…) — defined by GM-04 (database), GM-05 (storage), GM-06 (backup), GM-07 (secrets/identity/licence/network), GM-10/11 (execution), GM-14 (browser), GM-18 (notification) against real code.
- No provider implementation was changed or wrapped; `db.ts`, the vault, attachment store, listen config and licence code are untouched except two backward-compatible reads: `getVaultProtection()` (key-source status, no key material) and an optional `env` argument on `organizationCredentialStoreEnabled()`.
- The AI provider catalogue remains `byoaiRouter.ts`; GM-22 owns its convergence.
- `GM-01` items H-03, D-02, D-04, D-05 are **seam-ready, not converged**.

### 33.5 How a later task adds or replaces a provider

1. Add a spec to `HOME_PROVIDER_SPECS` (id, slot, operator, modes) — or register an adapter from a plugin/donor import with `source.origin: "oss"`, repository, pinned commit and licence already supported by `runtimeSourceSchema`.
2. Teach `resolveActiveHomeProfile()` when it is selected.
3. Extend `server/runtimeProviders.test.ts` with its conformance and health cases.

---

## 34. GM-03 (part 1) — Desktop Local data root, fail-safe storage, hosted retirement: implementation record

**Task:** GM-03 (tracker #149). **Base:** `main` `d0fd1048`. **Donor code imported:** none (the OpenClaw gateway/auth/state code surveyed for this task is tightly bound to OpenClaw's config and infra layers; the adaptable pieces — constant-time secret compare, auth rate limiting, origin check, file locks, backup archive policy — belong to GM-06/GM-08 where the matching LiOS component is built). **Owner decisions applied:** Q1–Q6, DataRoot placement ("whichever is best long term"), vault key policy, first-owner bootstrap.

### 34.1 What changed

| GM-01 finding | Fix | Evidence |
| --- | --- | --- |
| D-14 / L-02: 47 modules each derived the data location | One resolver: `src/dataRootCore.cjs` (shared by Electron main and the server) + `server/dataRoot.ts` (`dataRoot`, `dataPath`, `stateDir`, `databaseDir`). Resolution: `LIOS_DATA_ROOT` > legacy `LIMURIA_DATA_DIR` > production `~/.limuria-terminal` > dev `./data`. **Physical layout unchanged**, so no installed data moves. A guard test (`server/dataRootUsage.test.ts`) fails if any production file derives these paths again. | `dataRoot.test.ts` (13), `dataRootUsage.test.ts` |
| Finding 4: missing database folder silently became an empty database | `prepareDataRoot()` runs before anything creates state. A root with a marker (`.lios-root.json`) whose database has gone, or a user-chosen root (`LIOS_DATA_ROOT`) that was used before but is missing (unmounted drive), is **refused** with exit code 78 — nothing is recreated. The desktop does not restart-loop on 78 and shows the message. Installs that predate markers are adopted, not reset. | real `dist/index.cjs`: first run initialises, restart works, removing `pgdata` → exit 78 and `pgdata` not recreated |
| D-13 / H-07: guessable `HOME:hostname` vault key | New writes use the OS-protected secret the desktop supplies, otherwise a random 32-byte key stored 0600 (`vault.key`, exclusive-create). The old key can only **open** legacy entries; startup re-encrypts them after keeping `credential-vault.enc.json.pre-gm03.bak` (0600). | `credentialVaultKeyPolicy.test.ts`; real server: legacy vault migrated, backup kept |
| GM-01 D-12: vault master secret passed via environment variable | The desktop pipes it on the child's stdin (`LIOS-VAULT-SECRET …`), read before any module opens the vault (`server/vaultSecretBootstrap.ts`); the server refuses to start if it was promised and not received. | real `dist/index.cjs` and a real Electron launch: secret reached the server, never in `main.log`/`server.log` |
| L-03 / workspace location | Electron `userData/workspace` is folded once into `<root>/workspace`: staged copy, file-list + digest verification, atomic rename, absolute paths rewritten, **workspace id (licence device id) preserved**, original left as a backup; any failure falls back to the old location. | real Electron launch against a temp profile: folded, id preserved, original kept |
| H-10 / H-09 / H-12 (Q2) | `server/gateway.ts` (second server on `0.0.0.0`, shared key), its proxy in `routes.ts`, `render.yaml`, the hosted preflight mode and their docs are deleted. `Dockerfile` stays as the seed of the user-owned deployment pack (hosted-only Python disabling removed). | `grep` shows no remaining references outside this document |
| H-14 (Q4) | The generic vendor event relay is removed: code, UI, acceptance rows, the `event_relay_deliveries` table and `relay_days` column (migration `0075`), receipts relabelled. | `dbMigration.test.ts` |
| Found while smoke-testing | SIGTERM never terminated the server (open keep-alive/WebSocket connections held `close()` forever; database never released). Now closes connections and exits. | real server: exits 0, 240 ms after SIGTERM |
| Found while fixing | `audit:oss` had been red on `main` since GM-00 (fixed in #153). The ledger repair migration test assumed it was the last migration; it now forgets later entries too. | tests |

### 34.2 Deliberately not done here (each has a named owner and is not a surprise)

- **First-owner bootstrap for server Homes** and removal of `seed:internal` from the Dockerfile: DONE in GM-03d (§36).
- **Per-launch loopback token, persisted random port and CSP allow-list (Q5), Python sidecar token (L-07):** DONE in GM-03 part 2 (§35). **Server-side approvals (Q6):** GM-11, still open.
- **User relocation of the data root** (pointer file, UI): GM-04/GM-06; `LIOS_DATA_ROOT` is the supported manual mechanism today.
- Remaining hosted-control-plane documentation and `.env.example` sections for the hosted vault / licence signing keys: GM-07 (identity and licence), where Q1 retires them.

---

## 35. GM-03 (part 2) — local Gateway and Python sidecar trust

**Task:** GM-03 (tracker #149). **Base:** `main` `5282fdc1` (GM-03 part 1 merged). **Owner Q5 refinement:** per-launch token is the real protection; the loopback port is random *per install* then persisted, because a new port each launch would silently discard renderer `localStorage` (layouts, tabs, preferences) on every restart. Existing installs keep the historical 5052 origin. **Donor:** `openclaw/openclaw` release `v2026.9.7`, commit `c074824a27c96d3983043f9eeb33823cd1772d8c`, MIT.

### 35.1 Adapted and copied donor code

- **Copied** `src/security/secret-equal.ts` → `src/server/safeEqualSecret.ts` verbatim with an attribution header. Its tests (`src/security/secret-equal.test.ts`) were **ported** from Vitest to `node:test` at `src/server/safeEqualSecret.test.ts` (exact UTF-8, unequal lengths, trailing NUL). `third_party/components.json` now marks OpenClaw bundled and maps the paths; `THIRD_PARTY_NOTICES.md` carries the full MIT text and OpenClaw Foundation copyright.
- **Studied, not copied:** donor `src/gateway/auth.ts`, `auth-rate-limit.ts`, `origin-check.ts`, `net.ts`, `startup-auth.ts` and `packages/net-policy/src/ip.ts`. They depend on OpenClaw's config/normalization/tailnet stack; importing them into this Express server would create a second Gateway authority. LiOS implements the narrow Q5 handshake in its existing server; GM-08 can adapt the broader protocol/client stack against the merged runtime seams.

### 35.2 Behaviour and evidence

| GM-01 gap | Fix | Evidence |
| --- | --- | --- |
| L-06 renderer→server session cookie only | `main.cjs` creates a random 32-byte **per-launch** token and passes it to the server on stdin (`server/desktopHandoff.ts`); Electron `webRequest` adds it to the app window's requests for its own loopback server. `server/localDesktopTrust.ts` checks with the donor's padded timing-safe compare before routing HTTP or WebSocket upgrades; missing/wrong token → 401 / closed. Other windows and cross-origin initiators never receive it (`desktopRequestTrust.cjs`). The token never enters page JavaScript, process env, logs or diagnostics. | Real `dist/index.cjs` HTTP smoke: no/wrong token 401 without cookies, correct token reaches normal session auth; real Electron window on a temp profile renders and its `/api/auth/me` reaches auth; external fetch blocked by CSP. |
| Q5 random port vs origin continuity | `desktopPort.cjs` selects a random free high port on a new install, saves it 0600 in `userData/server-port.json`, reuses it on later launches; upgrades with existing state keep 5052. An operator `PORT` override remains possible. | Real Electron temp profile selected 39563 and then 38115; unit tests cover reuse, busy port, existing 5052 and explicit override. |
| H-20 permissive CSP egress | Desktop CSP `connect-src` is self + the exact loopback port; no blanket `https: wss:` or `localhost:*` for scripts/fetch. Images still allow HTTPS thumbnails; media allows blob/data. The header injector is scoped to the main webContents and the trusted initiator. | Real Electron `fetch('https://example.com')` was blocked, page rendered with no CSP errors. |
| L-07 unauthenticated fixed-port Python sidecar | `server/pythonService.ts` generates a separate token and ephemeral loopback port, never reuses a foreign service. Its requests send `X-LiOS-Sidecar-Token`; `python-service/sidecar_auth.py` checks with `hmac.compare_digest` for **every** HTTP/WebSocket route, including `/docs`. Unauthenticated GET `/health` returns only `{ok:true}`. Unset token refuses startup except explicit dev override. | Python 100 tests (91 existing +9), Node Python tests 24, desktop sidecar tests 12; real uvicorn curl: /health 200, /docs and normal route 401 without/wrong token, correct token 200; Node `callPythonService` smoke returned mean=3. |
| WebSocket origin bug (found by smoke test) | `server/index.ts` had derived the expected WebSocket scheme from `NODE_ENV`, which is "production" in the packaged desktop even though its server runs on plain HTTP. `webSocketOrigin.ts` derives it from the socket/proxy and tests wrong-origin rejection. Unauthenticated upgrades now return 401 instead of an empty 200. | Real WS smoke: wrong/missing token closed, right token reached session auth; four unit cases for origin/protocol. |
| Pre-auth legacy LSE bridge (found while reviewing timing-safe compares) | Removed `POST /api/internal/legacy-lse`, which let a "hosted legacy comparison Terminal" borrow the LiOS LSE credential via a shared header secret. No other callers found. | `environmentSetupRoutes.ts` + tests, full server suite. |

### 35.3 Remaining ordered work

- **GM-03d:** DONE (§36).
- **GM-04:** DONE for database portability (§37). **GM-06:** portable archive including the DB, vault key and workspace (the current backup is only the workspace folder).
- **GM-07:** split into GM-07a SecretRef (DONE, §40), GM-07b licence file import + HMAC lease removal (DONE, §41), GM-07c control-plane removal + licence enforcement (DONE, §42), GM-07d egress policy + `net-policy` donor (DONE, §43), GM-07e one desktop build / one auth stack (DONE, §44). Q1: no LiOS contact at runtime.
- **GM-08/09:** donor Gateway protocol/client, pairing/device identity, user Home remote access. The Q5 local token is not a pairing credential.
- **GM-11:** Project-scoped server-side approval store and removal of client-supplied grant authority (Q6). Local transport auth is not a substitute for action authorization.

---

## 36. GM-03d — server-Home first-owner bootstrap: implementation record

**Task:** GM-03d (tracker #149, issue #158). **Base:** `main` `84a788d9`. **Donor code imported:** none. OpenClaw `src/gateway/startup-auth.ts` (gateway token/password resolution) was studied; it is bound to OpenClaw's config stack, and the constant-time compare it relies on was already imported in GM-03 part 2 (`server/safeEqualSecret.ts`). **Owner decision applied:** both a one-time setup token (default) and an operator email + password-file option.

### 36.1 What changed

| Area | Change |
|---|---|
| One account-creation authority | `createBootstrapAdministrator` in `server/auth.ts` now serves the desktop first-run form, the Home token flow and the Home password-file flow. It runs in one transaction behind `LOCK TABLE "users" IN EXCLUSIVE MODE`, so two Home processes sharing one PostgreSQL cannot both enrol. Server Homes require an empty `users` table; desktop keeps legacy-admin rotation. Audit event `initial_admin_created` / `legacy_admin_rotated`. |
| Token | `server/ownerBootstrapCredential.ts`: 24 h, 256-bit, `owner-setup.token` (0600, exclusive create) in the data root. Minted only at process start, never over HTTP, only when no user exists; printed once; reused (not reprinted) across restarts until expiry; deleted on use or when any user exists. Verification is constant time. Symlinks and permissive files are refused, not regenerated over. |
| Operator automation | `LIOS_OWNER_EMAIL` + `LIOS_OWNER_PASSWORD_FILE` (+ optional `LIOS_OWNER_NAME`). The file must be absolute, a regular file, not a symlink, owner-only, owned by the process user, ≤1024 bytes, one line. An environment password is deliberately not supported. Missing/weak/unreadable file fails startup closed. The file is left in place (it may be a read-only mounted secret). |
| Transport rule | Remote setup requires real HTTPS (`req.secure`, which behind a proxy needs explicit `TRUST_PROXY`). Plain HTTP is accepted only for a direct loopback socket AND a loopback `Origin` host. `trustProxySetting` no longer trusts forwarded headers unless `TRUST_PROXY` is 1–5. |
| Session secret | `loadOrCreateSessionSecret`: `SESSION_SECRET`, else a random 0600 `session-secret` in the state dir. No hosted-production throw and no shared default. |
| Abuse control | `/api/auth/bootstrap/complete` rate-limited to 5/minute. |
| Client | `FirstRunAdminSetup` shows a setup-token field when the status endpoint reports `mode: "server_token"`. |
| Retired | `script/seed_internal_users.ts`, the `seed:internal` script and the Dockerfile seed call. The Dockerfile sets `LIOS_DATA_ROOT=/data/lios`, `VOLUME /data/lios`. `.env.example` documents the three bootstrap paths. |

### 36.2 Evidence

- `server/ownerBootstrap.test.ts` (5, isolated PGlite): three concurrent enrolments → exactly one wins; second enrolment refused and stale token removed once accounts exist; desktop legacy rotation unchanged; token created only on an empty Home, 0600, printed once across two starts; password-file path needs both variables, rejects weak files, creates `internal_admin`.
- `server/ownerBootstrapCredential.test.ts` (4), `server/auth.test.ts` origin/transport cases, `server/runtimeSecurity.test.ts` proxy cases.
- Real `dist/index.cjs` smoke (`HOST=0.0.0.0`, `NODE_ENV=production`, temp `LIOS_DATA_ROOT`, no `SESSION_SECRET`): token printed once and 0600; no Origin, wrong token, missing token → 403; correct token → 201 with session cookie and an `internal_admin` user; token file deleted; `status` → `setupRequired:false`; reuse → 409; password never logged. Password-file run: owner created, login 200, no token file; missing file → process exits non-zero.
- A defect found during the smoke and not an artefact: deleting a data root and restarting under the same HOME correctly exits 78 under the GM-03 fail-safe (no empty replacement), which the smoke harness now accounts for.

### 36.3 Remaining

- `seed_demo_client.ts` is retained as an explicit developer fixture; it is not part of any Home or image.
- The user-owned image/pack (compose, TLS reverse-proxy recipe, first-owner walkthrough) is GM-24.
- Server-Home owner recovery (lost password) is not designed yet; it needs an offline operator command and is tracked with GM-24.

---

## 37. GM-04 — database portability: implementation record

**Task:** GM-04 (tracker #149). **Base:** `main` `ae0b3c04`. **Donor code imported:** none (OpenClaw's state migrations are file/JSON based and do not apply to a relational store). **Scope split (reported, not hidden):** this change delivers PGlite ↔ PostgreSQL export/import, relocation, restore, health (L-04, L-05). Moving UIDE file-store workspaces and `localStorage` layout state into Project Sessions (D-11) is a separate change, **GM-04b**, because it changes product behaviour and persistence rather than database mechanics.

### 37.1 What changed

| Area | Change |
|---|---|
| Engine-neutral transfer | `server/databaseTransfer.ts`. Export writes one directory: `manifest.json` plus `tables/<table>.ndjson` (one `to_jsonb` document per row) from a single `REPEATABLE READ READ ONLY` snapshot via a server cursor. Import loads each table through a temp staging table and one `INSERT … OVERRIDING SYSTEM VALUE … jsonb_populate_record(null::table, doc)`, so Postgres does all type conversion (enums, jsonb, timestamps, identity) the same on both engines. Self-referencing FKs are checked at statement end; other FK cycles are refused (none exist: 121 tables, 273 FKs). |
| Integrity | Manifest records per-file SHA-256, row counts and an order-independent content digest (`md5(string_agg(md5(to_jsonb(t)::text)))`). Import verifies every file before touching the destination, requires identical applied-migration hashes and table set, re-computes each table's digest inside the transaction and rolls back on any mismatch. Identity sequences are re-seeded to `max(id)`. |
| Safety | Whole import is one transaction (locks all tables, truncates, loads). A destination with user accounts is refused unless `--replace` (migrations and the bundled seed leave reference rows in every new database, so "empty" is defined as "no accounts"). Manifest is schema-validated (table names constrained) and file names come only from validated names. |
| Commands | `npm run db:export -- <dir>`, `db:import -- <dir> [--replace]`, `db:health`. The "current database" is `DATABASE_URL` or the data-root PGlite; running Homes/Desktop hold the PGlite lock, so the command fails with the existing ownership error instead of corrupting it. Export/import recipes: **PGlite → PostgreSQL**: export with no `DATABASE_URL`, then import with `DATABASE_URL`. **PostgreSQL → PGlite**: reverse, against a new `LIOS_DATA_ROOT`. **Relocation**: export from the old root, import into the new one. |
| Health | `databaseHealth`: applied migrations vs bundled journal, table count, unvalidated constraints. |
| L-05 | `drizzle.config.ts` no longer throws without `DATABASE_URL`; it targets the data-root PGlite (`driver: "pglite"`) or the PostgreSQL URL. |

### 37.2 Evidence

- `server/databaseTransfer.test.ts` (2): full 121-table round trip with nested/unicode jsonb and identity columns; re-export digests identical; sequence continues after restore; health ok. Damaged file (checksum), populated destination (accounts), changed schema, hostile table name, and a row the destination rejects (full rollback proven).
- Live CLI round trip on a real `postgres:16` container: PGlite → PostgreSQL (121 tables, 280 rows, re-verified), `db:health` ok (76/76 migrations), rows added on PostgreSQL, PostgreSQL → fresh PGlite (282 rows), re-export of that PGlite has **digests identical** to the PostgreSQL export for all 121 tables; second import into PostgreSQL with an account refused without `--replace`.
- Found in GM-04, **repaired in #176**: the `migrations/meta` snapshots stopped at `0066`, so `drizzle-kit generate` guessed a rename `event_relay_deliveries` → `artifact_interaction_receipts`. Fix: one new file, `migrations/meta/0075_snapshot.json`, derived with `generateDrizzleJson` from the unchanged `shared/schema.ts` and chained (`prevId`) to `0066_snapshot.json`; the journal and every SQL file are untouched and no migration was added. `drizzle-kit generate` now reports “No schema changes” without a prompt and `drizzle-kit check` passes. Snapshots for `0067–0074` are not reconstructed: those migrations were hand-written SQL and, like `0053–0064` before them, never had snapshots; `drizzle-kit` diffs only against the newest. `server/migrationMetadata.test.ts` now fails if the newest journal entry has no snapshot, if the snapshot differs from what the schema derives, or if a database built from the SQL differs from the snapshot beyond a documented list of SQL-only objects (`data_field_mappings`, `consulting_requests.pricing_tier` + enum `request_pricing_tier`, seven legacy `organization_licenses` signature columns).

### 37.3 Remaining

- Encrypted secrets move as ciphertext; the destination needs the same vault key (GM-06 bundles it).
- Import needs a role that bypasses or owns RLS-protected tables (the migration/owner role).
- **GM-04b:** UIDE workspaces / `localStorage` layout state into Project Sessions (D-11).
- GM-06 wraps this export (plus vault key and workspace) into one encrypted, verified archive and UI.

---

## 38. GM-05 — storage provider fabric and client-side encryption: implementation record

**Task:** GM-05 (tracker #149). **Base:** `main` `6d2d6a76`. **Donor code imported:** none. The OpenClaw tree has no object-storage provider (only Matrix/browser/session storage specific to those features), so the reference implementation is LiOS's own `projectAttachmentStore.ts`, as the audit planned; SigV4 is written on `node:crypto` rather than adding `@aws-sdk` or `aws4` (no dependency, no notice).

### 38.1 What changed

| Area | Change |
|---|---|
| Seam | `server/storageProvider.ts`: `StorageProvider { put/get/delete }` with validated `/`-segment keys (no traversal, no dot-leading segments). `FilesystemStorageProvider` is the old attachment-store code (atomic temp+fsync+rename, 0700/0600, `O_NOFOLLOW`, size cap). |
| S3-compatible | `server/s3StorageProvider.ts`: one adapter for S3/R2/MinIO/Wasabi/B2/Spaces (path style default, virtual-hosted optional), SigV4 over `fetch`, single-PUT objects (largest writer today is a 20 MB attachment; multipart arrives with the first larger writer). https required except localhost; endpoint with credentials/query refused; redirects refused; 30 s timeout; errors carry only the HTTP status. |
| Encryption | `EncryptedStorageProvider`: AES-256-GCM, random 96-bit nonce per object, storage key + key id authenticated, so ciphertext cannot be moved to another key or silently read under another master key. Key `<data root>/data/storage.key` (0600, auto-created) is distinct from the S3 credentials and from the credential-vault key. Always on for S3 (no off switch); `LIOS_STORAGE_ENCRYPTION=on` for local disk. Plaintext objects are refused, except legacy plaintext on a local filesystem. |
| Selection | `server/storageRuntime.ts` (`LIOS_STORAGE_PROVIDER`, `LIOS_S3_*`). `lios.storage.s3` is registered in the runtime registry and becomes the active storage provider when selected (conformance stays zero-LiOS-server: operator `user`). |
| First consumer | `projectAttachmentStore.ts` now uses the fabric; its public functions and error types are unchanged, the former `LIOS_ATTACHMENT_STORAGE_DIR` and "remote DB must choose a blob volume" rules moved into `storageRuntime.ts`. |

### 38.2 Evidence

- `server/storageProvider.test.ts` (6): filesystem privacy/traversal/symlink; encryption (plaintext never reaches the provider, nonce randomness, moved/flipped/wrong-key objects fail, plaintext refused unless opted in); key file perms/malformed; **SigV4 reproduces AWS's documented GET Object signature** (`f0e8bdb8…bdb41`); S3 provider against an in-process verifying server (prefix and RFC 3986 encoding, ciphertext only in the bucket, 404/403 mapping); cleartext/credential endpoints and incomplete configuration refused. Existing attachment, runtime-provider and DataRoot tests unchanged and green (32/32 across those files).
- Real S3-compatible server (SeaweedFS 3.x with SigV4 auth): attachment write → read round trip equal, bucket object starts `LIOSENC1` and contains no plaintext, wrong secret rejected with 403, delete → unavailable, `storage.key` mode 0600. (MinIO's public images are no longer pullable; SeaweedFS was used instead.)

### 38.3 Remaining

- Other file stores (columnar Parquet needs a local path for DuckDB; UIDE stores, `historyStore` (market history, name collision L-12), AI memory, API-key digests) still use the DataRoot directly. They are user-state/caches, not blobs; migrating the blob-shaped ones (artifacts, imports) is a follow-up per consumer, not part of this seam.
- S3 secret can now be a SecretRef (`LIOS_S3_SECRET_ACCESS_KEY_REF`, GM-07a, §40); the literal env var still works.
- GM-06 must include `storage.key` in the portable archive and offer re-encryption (key rotation) and copy between providers.
- Azure/GCS/WebDAV only if a user needs them (spec: "as justified").

### 38.4 SI-02 governed external object publication

`server/projectObjectPublicationTool.ts` supplies `createProjectObjectPublicationTool(): ConversationToolDefinition`, ID **`lios.project.publish_object`**. This is deliberate external publication of a bounded JSON `{schemaVersion,title,content}` object, **not** encrypted Home blob persistence or a P4 write. It reuses GM-05 `S3StorageProvider` SigV4, GM-07 `credentialVault`/SecretRef resolution, canonical Project ownership checks, canonical credential-shape guards and the imported ACP secret redactor. No new SDK, approval authority, journal or run store is introduced.

- Input is strictly `{title,content}` (title 300 characters, content 64 KiB UTF-8, encoded object 70 KiB); model-selected destinations/keys/scopes and credential-shaped content are refused. The descriptor is `user_confirm`, `allowProjectApproval=false`, external/write, and replay-safe only through atomic `If-None-Match: *` publication plus actual-byte SHA-256 reconciliation.
- Explicit operator configuration is `LIOS_PUBLICATION_S3_ENDPOINT`, `LIOS_PUBLICATION_S3_BUCKET`, `LIOS_PUBLICATION_S3_REGION`, `LIOS_PUBLICATION_S3_ACCESS_KEY_ID` and exactly one of `LIOS_PUBLICATION_S3_SECRET_ACCESS_KEY` / `LIOS_PUBLICATION_S3_SECRET_ACCESS_KEY_REF`. SecretRefs follow the existing `env:LIOS_SECRET_*`, private `file:` and `vault:` grammar. Missing/malformed settings disable publication visibly; there is no Home-storage/local fallback.
- `projectObjectPublicationPolicyBindingSha256()` binds the full target and resolved credential generation, including disabled identity, without returning secrets. Canonical policy/lease consumers must use the descriptor's server-only policy hook. Every actual PUT/reconciliation GET also rechecks the current binding and cancellation signal.
- Object keys are server-derived `publications/v1/tenant-<organization-or-local>/owner-<user>/project-<project>/<request-and-idempotency-sha256>.json`. Success returns opaque `publication-object:`, `publication-commit:` and `publication-target:` refs, content SHA-256, byte count and truthful `created`/`matched` disposition, never an endpoint, key or credential.
- The immutable adapter uses a fresh native HTTP(S) socket per request, reusing SigV4 but intentionally avoiding hidden fetch retries. Redirects are never followed; each request is bounded to 30 seconds and reconciliation bytes to the expected object size. Only new-socket connect `ECONNREFUSED` certifies pre-transmission no-effect. It records an opaque proof through canonical L5, reports bounded progress, waits a real cancellable two-second backoff and enters canonical `beforeExternalDispatch` once for the sole retry. Ambiguous writes reconcile by reading real provider bytes or remain outcome-unknown; 404 after a lost response is not proof of no effect.
- Provisioning must prove authenticated SigV4 access **and atomic conditional PUT semantics on the actual provider/image**: first bytes create; identical replay yields a precondition conflict plus equal bytes; differing/concurrent PUTs cannot replace the original or make duplicate objects. Grant only List/Read/Write access to the dedicated publication bucket; do not enable anonymous access. The SP-02 packaged journey stops the actual provider before first dispatch, presses Stop during genuine no-effect backoff, restarts Home without implicit resume, restores that same provider/durable volume, then explicitly resumes with fresh exact approval and observes exactly one object.
- Added consumer regression coverage: `server/projectObjectPublicationTool.test.ts` exercises canonical owner review, owner/Project key separation, strict input/secret guards, one concurrent commit, immutable hash conflicts, lost-response reconciliation, unknown-outcome refusal, target/credential drift, real refused sockets, cancellation during pending backoff and one bounded retry. These source regressions are not real SeaweedFS/package qualification; consolidated checks and SP-02 qualification are owned by integration.


---

## 39. GM-06 — portable verified backup and restore: implementation record

**Task:** GM-06 (tracker #149). **Base:** `main` `9259f919`. **Donor:** OpenClaw `src/infra/backup-archive-path-policy.ts` (`normalizeArchivePath`) adapted into `server/tarFormat.ts`; recorded in `THIRD_PARTY_NOTICES.md` and `third_party/components.json`. The rest of OpenClaw's `backup-*` (≈15 files: config capture, SQLite source groups, git backup, scratch, tar retry/walk) is tied to OpenClaw's config/SQLite/`node-tar` stack and was studied, not imported. **Scope split (reported):** this change delivers the archive engine, verification, restore, retention and CLI. The Desktop/Home UI or API route and scheduled backups are **GM-06b**; until then `desktopWorkspaceBackup.cjs` (folder copy, no database) remains the only in-app backup and is the duplicate GM-06b retires.

### 39.1 What changed

| Area | Change |
|---|---|
| Container | `lios-backup-<UTC>.tar.gz` (plain) or `.liosbak` (passphrase-encrypted tar.gz). Standard tar+gzip, so an unencrypted backup opens with any `tar`; no entry-count or size ceiling (classic ZIP fails at 65 535 entries, tested against fflate). `server/tarFormat.ts`: ustar + pax `path`/`size`, regular files only, checksummed, strict push reader. |
| Contents | `db/**` = the GM-04 logical export; `files/**` = the whole data root except the live PGlite dir, local pre-migration snapshots, session secret, setup token, diagnostic logs, locks/temp files and symlinks (each omission is listed with a reason in the manifest); last entry `lios-backup.json` with SHA-256 and size of every entry, engine, versions, notes. |
| Secrets | Encrypted backup includes `vault.key` and `data/storage.key`; an unencrypted backup never does and says what cannot be recovered. No passphrase is ever read from an env var or argv: `--passphrase-file` (private file, `server/privateSecretFile.ts`, extracted from the owner-bootstrap reader). |
| Encryption | `server/backupCrypto.ts`: scrypt (N=2^15,r=8,p=1) + AES-256-GCM in 1 MiB frames; header, frame index and a final-frame flag are authenticated, so truncation, reordering and bit flips are detected (tested, including a dropped final frame and swapped frames). Minimum passphrase length 12. |
| Verification | Every create is re-read and verified before success is reported or retention prunes anything. `backup:verify` streams the whole archive: authenticates, validates every path (donor rules), rejects duplicates/unexpected entries/zip-slip, enforces an expansion cap, checks every entry against the manifest (changed / missing / unlisted). Unencrypted archives detect corruption and tampering of entries; only encrypted ones authenticate against deliberate rewrites of the manifest. |
| Restore | `backup:restore`: verify in privately owned staging → reserve durable prior DB/file custody → exclusive DB transaction and checked file/desktop-credential publication → commit/audit retirement. Late failure restores prior DB/files; interrupted/ambiguous outcomes block startup until explicit offline `backup:restore -- --recover`. Prior file copies use distinct private `restore-previous-*` slots and are not overwritten by later restores. `backup:extract` remains the passphrase-only export path. No full power-loss/shared-Postgres target qualification is inferred. |
| Retention | `--keep N` after a verified success, only for `lios-backup-*.tar.gz|liosbak` in the chosen destination. Destination inside the data root is refused. Failure removes the partial archive; there is no half-written file under a final name. |
| Registry | `lios.backup.portable-archive` registered and active for both modes/engines; the server-Home-on-PostgreSQL "no backup provider" conformance gap is closed (test updated). |

### 39.2 Evidence

- `server/backupArchive.test.ts` (6): standard tar read by system `tar` (long unicode path via pax), key material absent from plain archives, encrypted archives carry keys and no readable content, wrong/missing passphrase, bit flip, truncation; multi-frame crypto with dropped-final-frame and swapped-frame detection; hand-made hostile archives (traversal, absolute, duplicate, unlisted, changed, missing, no manifest, foreign root); restore into a fresh Home (rows, files, keys, replaced file preserved, staging removed, second restore refused without `--replace`, refused restore changes nothing); retention and destination guard.
- Live CLI: create encrypted + unencrypted from a real data root (124/123 entries, 280 rows), verify, wrong and missing passphrase refused, `tar -tzf` on the plain archive, extract, restore into a fresh Home B (vault key, attachment, 121 tables, `db:health` ok, 76/76 migrations).
- Found while doing this and fixed in the same change: `readOwnerPasswordFile` was a one-purpose reader needed again; it is now `readPrivateSecretFile` with the owner flow as a caller.

### 39.3 Remaining (GM-06b)

- Desktop/Home UI or authenticated API route so a running Home can back up without stopping (PGlite is single-owner: the CLI needs LiOS stopped; the export itself is a consistent snapshot and works against a live PostgreSQL).
- Scheduled backups (OS scheduler recipe or in-app) and a destination picker; retire `desktopWorkspaceBackup.cjs`.
- A desktop-protected vault secret lives in the OS secret store, not in any file, so a desktop restore on another machine must re-enter provider credentials; the manifest note says so when relevant.
- Re-encryption/rotation of `storage.key` objects and copy between storage providers.

---

## 40. GM-07a — SecretRef and secret-provider boundaries: implementation record

**Task:** GM-07 part a (tracker #149). **Base:** `main` `e09da1a6`. **Why GM-07 is split:** it covers nine findings across four independent subsystems (H-01–H-08, H-11, H-16, H-20, D-10, D-13). One PR per subsystem keeps each reviewable and testable: **a** SecretRef + secret fallbacks (this change); **b** licence file import and removal of the legacy HMAC lease (H-05/H-06); **c** identity convergence and control-plane removal (H-01–H-04, H-08, H-11, D-10, Q1/Q3); **d** egress allow-list and CSP from `net-policy` (H-20). Billing (H-16) goes with GM-24.

**Donor:** OpenClaw `src/secrets/ref-contract.ts` (MIT, c074824a) adapted into `shared/secretRef.ts`. `src/secrets/resolve.ts` (753 lines) and the `exec` source were studied and **not** adopted: the exec provider runs operator commands and the resolver is bound to OpenClaw's config planner; LiOS already has one resolver (`resolveCredential`) and keeps it.

### 40.1 What changed

| Area | Change |
|---|---|
| SecretRef | `shared/secretRef.ts`: `{source: env\|file\|vault, provider, id}` with text form `env:LIOS_SECRET_X`, `file:/abs`, `vault:name`, or a bare vault name (the original `credentialRef` form, unchanged). |
| One resolver | `resolveCredential` (credentialVault.ts) understands references, so every existing `credentialRef` caller (source connections, external MCP, provider adapters) gains them with no call-site change and no second resolver. Order is unchanged: env var by name, organization store, then the reference/vault. A hosted organization request never reaches env/file references (no operator secrets across tenants). |
| Exfiltration guard | A reference can be typed through the product API and its value is sent to a connector as a credential, so it must not become an arbitrary-read primitive: `env:` accepts only `LIOS_SECRET_*` (not `DATABASE_URL`, `SESSION_SECRET`…); `file:` must be a private 0600 single-line file whose real path is inside `<data root>/secrets`, `/run/secrets` or `LIOS_SECRET_FILE_DIRS` (symlinks out are refused). |
| S3 | `LIOS_S3_SECRET_ACCESS_KEY_REF` (preferred) alongside the literal variable. |
| Fallback key removed (H-07) | `server/sessionSecret.ts` is the one session/device-binding secret (`SESSION_SECRET` or a random 0600 file). The device-binding cookie no longer falls back to the hard-coded `limuria-local-device-binding-v1`; `index.ts` uses the same module. |

### 40.2 Evidence

- `server/secretRef.test.ts` (4): grammar rejects `env:DATABASE_URL`, `env:SESSION_SECRET`, relative paths, control characters; env/file resolution, outside-directory, symlink-out, permissive-mode, operator-approved directory; session secret random/private/stable/override. `storageProvider.test.ts` now drives the S3 provider through a `file:` reference. Auth, vault key policy and storage tests unchanged and green.
- Real built server (`NODE_ENV=production`, `HOST=127.0.0.1`, no `SESSION_SECRET`): starts, `session-secret` is 0600, device-binding cookie issued.

### 40.3 Not done here / decisions

- `~/…/config.json` plaintext credential fallback (D-13) is **kept**: it is also the terminal's user-edited settings file, so it cannot be migrated or silenced without a UX decision. `organizationCredentialVault` (H-11) and `apiKey.ts`/`sessionVault` consolidation (D-13) move with GM-07c.
- No `exec` source and no OS-keychain `SecretRef` source yet; the desktop OS secret already protects the vault key, which is what `vault:` entries use.

---

## 41. GM-07b — signed licence files, pinned trust anchor, HMAC lease removed: implementation record

**Task:** GM-07 part b (tracker #149). **Base:** `main` `977f3d86`. **Donor:** none (OpenClaw has no licensing). **Owner decisions applied:** generate a new Ed25519 key pair (public key pinned, private key held by the vendor off-repo); licence files **honour their contents** for device binding (bound if the signed payload names a fingerprint, otherwise unbound).

### 41.1 Defect found and fixed
`offlineLeaseCache` verified the cached lease with **the public key stored in the same cache file** (delivered by the server alongside the lease). Anyone could write their own key pair and lease, include their own public key, and pass verification: the "signed" licence was not a trust boundary at all. Verification now looks the key up by `payload.keyId` in **pinned anchors** (`shared/licenseTrust.ts`); a lease may select a key but never supply one. Version-1 cache files with a `publicKey` are still read but the key is ignored.

### 41.2 What changed

| Area | Change |
|---|---|
| Trust anchor | `shared/licenseTrust.ts` pins key `9cd9a99c75e6afd2` (key id = SHA-256 of the PEM, test-enforced). Rotation = add a second entry first. Private key: `~/.lios-vendor/license-signing-private.pem` (0600) on the owner's machine, **not in the repository**; back it up offline. |
| Verification | `verifyLeaseAgainstTrustAnchors`; reasons `lease_untrusted_key`, `lease_expired`, `lease_signature_mismatch`. |
| Legacy removed (H-06) | HMAC-SHA256 lease variant, `LIMURIA_ALLOW_LEGACY_HMAC_LICENSE_LEASE`, `resolveLicenseSigningSecret`, the issuer fallback `env:hmac:v1`, and their tests. |
| Licence file | `server/licenseFile.ts`: `lios-license/1` JSON wrapping the existing Ed25519 lease; strict schema (unknown fields rejected, 64 KiB cap); import verifies signature, pinned key, expiry, entitlement mode and device claim **before** storing, so a refused file leaves the current licence untouched. |
| Binding | A payload with `deviceFingerprintHash` works only on that install; without it the licence is unbound. Install identity = desktop workspace id, or for a headless Home the data-root marker id (`dataRootId()`), so a restored backup in a new root needs its licence re-issued. |
| Storage | `<data root>/license/offline-entitlement.json` (was the Electron userData folder; `main.cjs` no longer sets `LIOS_LICENSE_CACHE_DIR`). |
| Surfaces | `GET /api/license/status`, `POST /api/license/import` (internal admin, behind the global gate); `npm run license:status|import|inspect`; vendor `license:keygen|issue`. Issuing refuses a key that is not pinned. |

### 41.3 Evidence
- `licenseFile.test.ts` (3), `offlineLeaseCache.test.ts` (4 incl. forged self-keyed lease and unbound licence), `licenseLease.test.ts` (anchor tests; anchor ids equal the hash of their PEM), `controlPlane*`/`effectiveAccess` suites green (31/31 together).
- Real CLI: status shows the install hash; licence issued with the real vendor key (bound and unbound); bound import succeeds on its install and is refused on another; unbound works on both; a tampered seat count and a licence signed by an unpinned key are refused.

### 41.4 Not done here
- No Settings UI for the licence yet (the routes exist); that belongs with the identity/settings changes in GM-07c.
- The hosted issuer route (`/api/client/control-plane/lease`) still signs with its own env key; its leases verify only if that key is the pinned one. It is retired with the control plane in GM-07c/GM-24.
- Enforcement semantics (which features require a licence when no control plane is configured) are decided in GM-07c together with identity convergence.

---

## 42. GM-07c — hosted control plane removed; licence enforcement: implementation record

**Task:** GM-07 part c (tracker #149). **Base:** `main` `7265349e`. **Donor:** none. **Owner decisions applied:** with no licence an install gets a **time-limited local trial, then is locked until a licence is imported**; the removal is **one clean cutover PR** (no shims). **Scope split (reported):** the `internal`/`client` audience and the duplicate `/api/auth` vs `/api/client/auth` stacks (Q3, D-10) are a product-surface convergence, not a vendor-dependency removal, and are **GM-07e**, behind the owner's review pause.

### 42.1 Removed
- `server/controlPlaneRemote.ts` (+test): the whole LiOS-hosted client (login/register/session cookie/`me`/access/trial/billing forwarding/policy projection/SSO device flow/lease refresh), and every `isRemoteControlPlaneConfigured()` branch (≈40) in `auth.ts`, `clientRoutes.ts`, `billingRoutes.ts`, `billingSubscriptionRoutes.ts`, `productionControlRoutes.ts`, `trialAccess.ts`, `index.ts`, `p9AutomationService.ts`, `runtimeProviders.ts`. The local code paths those branches sat beside were already the tested implementation and are now the only ones.
- Shadow identities (`ensureRemoteShadowIdentity`, snapshot remapping), the hosted lease issuer `POST /api/client/control-plane/lease`, the per-request remote entitlement call, and the offline-lease fallback for a down control plane.
- `server/sessionVault.ts`: its only purpose was encrypting the stored hosted cookie; `DrizzleSessionStore` no longer takes a vault secret. Request-context `enterprisePolicy`/`enterprisePolicyProjectionMissing` removed: AI governance now always reads the organization's stored policy (`getStoredEnterprisePolicy`). Registry entries `lios.identity.control-plane-remote` and `lios.license.control-plane-remote` removed (the vendor-dependency conformance rule stays as a guard).
- Desktop/release (done by a delegated engineer, reviewed): `LIOS_CONTROL_PLANE_URL`, embedded `liosControlPlaneUrl`, the packaged-client hard failure in `main.cjs`, the build/preflight/self-test/workflow requirements.

### 42.2 Licence enforcement (Q1, owner policy)
| Situation | Behaviour |
|---|---|
| Customer registers on Desktop Local | Local trial is on by default for `desktop_local` (`selfServeTrialsEnabled`); a server Home stays opt-in. 7-day trial from the organization's licence row, local clock. |
| Trial runs out, no licence | Paid execution routes return 402 "import a LiOS licence". The trial belongs to the installation: once its clock has run out, new registrations are refused (402) until a licence is imported, so a second account cannot restart it. |
| Valid licence imported (client_admin or internal_admin, `POST /api/license/import`) | Trial state becomes `converted`; effective access comes from the signed file (allowlist or wildcard grant, **bounded by its expiry**); device claim honoured. |
| Administrator lock on the organization (suspended, security-locked, terminated, grace expired) | Still wins over the licence. |
| Admin-created `client` organizations with no licence | Unchanged (database-managed): they are the Home owner's own records, not a vendor grant. |
This is a speed bump against casual use on a local clock, not DRM; the signed, pinned-key licence is the trust boundary.

### 42.3 Evidence
- Real built server, no control plane: register 201 → `me` shows trial/`license_active` → trial `active` → licence imported with the real vendor key → trial `converted`, access reason `license_file` → tampered licence refused; server log contains no control-plane references.
- `licenseEnforcement.test.ts` (3: desktop trial default, expired-trial lock then unlock, licence entitlements vs administrator lock), `effectiveAccess.test.ts` (licence-bounded wildcard), plus auth/billing/trial/client/controlPlane suites green (140/140 together). Acceptance validators P1B/P1C/P10/P14 updated or unchanged as noted in the PR.
- Defect found while testing: `featureIsEntitled` treats mode `unrestricted` as unbounded, so an unrestricted licence would never expire inside a snapshot; licence access is therefore expressed as a time-bounded wildcard grant.

### 42.4 Not done here
- `reissueOfflineLicenseLease` / `/api/admin/.../reissue-lease` (vendor admin tooling inside the product) and the Paddle billing server (H-16) stay until GM-24 decides where vendor commerce lives; they are not on the customer runtime path.
- `LIOS_SAML_VERIFIER_URL` / `LIOS_CONTROL_PLANE_PUBLIC_URL` remain operator-configured (H-08): the enterprise SSO code now targets the customer's own IdP and verifier.
- Historical V4 runbooks (`LIOS_V4_P3/P4/P5_*`) still describe the retired hosted model; they are superseded by this section.
- Settings UI for licence import and for the desktop client's own account-creation copy.

---

## 43. GM-07d — egress policy (NetworkProvider, outbound half): implementation record

**Task:** GM-07 part d (tracker #149). **Base:** GM-07c (stacked; PR #171). **Donor:** OpenClaw `packages/net-policy/src/ip.ts` (+ its test and fixtures) copied into `server/netPolicy/` with two string helpers inlined; `ipaddr.js` ^2.5 added as a direct MIT dependency (OpenClaw's pin; the 1.9.1 that Express pulls in stays nested under `proxy-addr`). Notice and `third_party/components.json` updated. **CSP (H-20):** the renderer's `connect-src` allow-list was done in GM-03 part 2 (§35); `img-src https:` is kept for news thumbnails and is the one remaining remote channel from page code.

### 43.1 What changed
| Area | Change |
|---|---|
| Policy | `server/egressPolicy.ts`: `LIOS_EGRESS_MODE=open|allowlist|offline`, `LIOS_EGRESS_ALLOW=host,*.suffix,ip,cidr`. Loopback is always reachable (Python sidecar, local model servers). Cloud-metadata and link-local addresses (`169.254.169.254`, `100.100.100.200`, `fd00:ec2::254`, `metadata.google.internal`, mapped/embedded forms, decimal/hex spellings) are blocked in every mode unless the operator names them. A malformed policy stops the server from starting. |
| Enforcement | Installed on the process-wide `fetch` at startup: every AI-provider, market-data and connector call. In `allowlist`/`offline` the guard follows redirects itself, re-checking every hop, applying fetch's redirect semantics (303→GET, 307/308 keep the body, credentials stripped across origins, streamed bodies refuse replay, 10-hop cap). In `open` only the first hop is checked, because connector code already has its own redirect-aware endpoint policy (`sourceConnectionPolicy`). |
| Visibility | `createHomeRuntimeSnapshot` reports `egress: { mode, ruleCount }` (no host names). |

### 43.2 Evidence
- `netPolicy/ip.test.ts`: the donor's 40 cases pass unchanged under `node:test`.
- `egressPolicy.test.ts` (7): strict parsing; metadata blocked in all spellings; allowlist suffix/apex/lookalike/CIDR/IP; offline; hop-by-hop redirect to metadata never requested; 303/307/credential/loop semantics; Request input and pass-through cases.
- Real global `fetch` with a real local redirecting server: loopback allowed; public host blocked; loopback→metadata and loopback→public redirects blocked. Real built server starts in `offline` mode and serves; `allow-list` (typo) exits 1 with the error.

### 43.3 Limits (stated, not hidden)
- Guard covers `fetch`. Raw sockets (a remote PostgreSQL, SMTP-style clients), the optional Playwright browser and direct `http(s).request` callers (`p10Observability`, the plugin network broker which has its own policy) are outside it.
- Hostname rules are matched by name; DNS rebinding of an allow-listed name is the operator's trust decision. Private/metadata blocking of resolved addresses for user-supplied connector endpoints stays in `sourceConnectionPolicy` (which resolves and re-checks).
- `img-src https:` in the Electron CSP (see above).

---

## 44. GM-00 → GM-07 closure: audit matrix and GM-07e

**Why this section exists.** The owner asked for GM-00 to GM-07 to be rechecked in full before the review pause. Each task's text in §27 and every finding the §32 map assigns to it was re-read against the code. The recheck found items that earlier records had deferred or not mentioned; they were done in this closure (marked **new**). Items that remain are listed with the reason and the owner decision that governs them.

### 44.1 What the recheck found and fixed (new)

| Gap found | Task | Resolution |
| --- | --- | --- |
| Two login stacks (`/api/auth` vs `/api/client/auth`), two desktop builds/audiences (D-10, Q3) | GM-07e | One stack: `/api/auth/{login,logout,me,register}` for every role; role decides the experience. `/api/client/auth/{login,logout,me,register}` deleted (SSO callbacks under `/api/client/auth/sso/*` keep their path because customers register them in their own IdP). One desktop build: `LIOS_DESKTOP_AUDIENCE`, the packaged audience metadata, the audience build modes and the preflight rule are gone; both web bundles ship in it and the web app routes a session to `/` or `/client-terminal/` by role (`client/src/lib/audienceRouting.ts`). |
| Customer desktops had no way to import a licence (CLI only) | GM-07b | `LicenseSettings` section (both bundles): state, plan, seats, bound/unbound, the installation id to send to the vendor, file import. |
| Billing / Paddle / credit wallet / webhook receiver still in the customer runtime (H-16) | GM-07 | Removed by owner decision: billing, subscription and webhook routes, Paddle provider, credit ledger/metering (the one call site, the holdings CSV export, no longer meters), tier/credit UI, merchant rows in readiness ledgers. Database columns/tables remain until the owner schedules the dropping migration. |
| `DATABASE_URL` silently switched secrets to the org vault (H-11) | GM-07 | `LIMURIA_CREDENTIAL_STORE=organization` is now the only way; pointing LiOS at your own database no longer changes where credentials live. |
| SSO/SAML public origin named after a LiOS control plane (H-08) | GM-07 | `LIOS_HOME_PUBLIC_URL` (this Home's own origin) replaces `LIOS_CONTROL_PLANE_PUBLIC_URL` / `LIOS_PUBLIC_APP_URL` fallbacks for SSO and enterprise deployment checks. OIDC/SAML always targeted the customer's IdP. |
| Remote images from page code allowed under any egress setting (H-20 remainder) | GM-07 | Electron CSP `img-src` now follows `LIOS_EGRESS_MODE`/`ALLOW` (`desktopCsp.cjs`): open keeps `https:`, allowlist lists the allowed hosts, offline allows none. Limit: the desktop shell reads the process environment only, not a `.env` the server loads. |
| "User-selected local workspace/drive posture" (GM-03) and L-02: only an env var | GM-03/06 | Saved data-folder pointer (`<home>/.limuria-terminal/data-root.json`, lowest-precedence explicit setting), `moveDataRoot` (copy to an empty folder, verify every file by size and SHA-256, keep the original, same root id, ledger entry so a missing drive is an error not a fresh start), `npm run data-root`, and Desktop Settings → Data folder (picker, confirm, relaunch). |
| Scheduled backup, user-selected destination, explicit failure state, restore test (§7.3) and in-app backup (GM-06b); the old folder-copy backup was still the only in-app one (D-16, L-03) | GM-06 | `backupService` (settings, schedule, persisted status incl. last error and last restore test), owner-only `/api/backup*` routes, Settings → Backups section with folder picker, encryption/passphrase, schedule, Back up now, Test restore and a red failure state; `restoreTestBackup` loads the newest backup into a scratch database and compares every table digest. `desktopWorkspaceBackup.cjs` and its IPC deleted. |
| Backup and licence controls reachable by any customer admin | GM-06/07 | Defect found during this closure: on a server Home a tenant's `client_admin` could have backed up every organization's data. `requireHomeOwner`: internal admin everywhere; customer admin only on single-user Desktop Local. |
| `server/historyStore.ts` name collision with conversation history (L-12) | GM-05 | Renamed `marketHistoryStore.ts` (imports, scripts, validators updated). |

### 44.2 Matrix

This is a historical GM-00–07 foundation closure matrix, not certification of every aspirational provider or state migration, full execution, SP-01 acceptance or release. Provider copy/re-encryption/key rotation and larger-object multipart remain open; Azure/GCS/WebDAV are conditional. D-04/D-05 convergence is not proved by provider seams alone. D-11 remains GM-19/23, D-12 GM-19, D-06/D-07 GM-20, D-02 GM-22 and D-03/D-09 GM-12/23. Later GM-08/09 transport/device evidence and GM-10 backend/journal records below deepen the foundation without closing these downstream responsibilities.

| Task | Deliverable (§27) | Status | Evidence |
| --- | --- | --- | --- |
| GM-00 | donor pin, machine-readable records, notices, boundaries, zero-server rule | Done | `third_party/components.json` (OpenClaw v2026.9.7 @ c074824a, per-file import records), `THIRD_PARTY_NOTICES.md`, `audit:oss` passes, AGENTS.md rules; imports so far: `secret-equal`, `backup-archive-path-policy`, `secrets/ref-contract`, `net-policy/ip` |
| GM-01 | audit + removal map | Done | §32 (21 H, 16 D, 12 L); every row below has a disposition |
| GM-02 | provider seams on existing contracts | Done | §33; `lios.storage.s3` and `lios.backup.portable-archive` registered; vendor providers removed (GM-07c); conformance test |
| GM-03 | Desktop Local / Home default | Done | §34–36, 44.1 (data-folder picker/pointer) |
| GM-04 | DB migration, relocation, health, restore | Done | §37; D-11 deferred, see 44.3 |
| GM-05 | storage fabric + client encryption | Done | §38; L-12 closed |
| GM-06 | verified snapshots, retention, encryption, export, local↔server migration | Done | §39 + 44.1 (GM-06b) |
| GM-07 | SecretRef; local identity; enterprise BYO identity; no hidden vendor dependency | Done | §40–43 + 44.1 |

Finding closure: H-01..H-03, H-05..H-08, H-10, H-11, H-16, H-20 closed (this program). H-04 moot (no vendor channel left). H-09/H-12/H-15/H-17/H-18 belong to GM-24; H-13/H-14 to GM-21 (H-14 relay already removed in GM-03); H-21 to GM-25. D-01 (second server removed; route-module consolidation is GM-08), D-10 closed, D-13 partly: `apiKey.ts` `api-keys.json` stores key *digests* (not secrets) in the state dir and is covered by backups, and the plaintext `config.json` fallback stays because it is also the user-edited settings file (needs a UX decision); D-14 closed for state (storage consumers beyond attachments migrate per consumer); D-16 closed. L-01..L-07 closed; L-08 GM-21; L-09 GM-24; L-10 GM-09/15; L-11 GM-11/25.

### 44.3 Deliberately not in GM-00..07 (owner decisions)
- **D-11 (UIDE file stores and layout `localStorage` into Project Sessions):** deferred to GM-19/GM-23 by the owner (they rewrite memory and the conversation shell over the same state). Backups already carry the UIDE files.
- **Two web bundles and per-audience data routes:** carried here originally; **closed in §45** (one bundle, audience chosen at runtime).
- Billing tables/columns stay until the owner schedules a dropping migration (irreversible; see §45.3). The vendor-side `reissue-lease` route was removed in §45.
- Historical V4 runbooks describing the hosted model are superseded by §42–44.

---

## 45. Recheck of GM-00 → GM-07: problems found and fixed (no carry-forward)

The owner asked for one more full recheck with every problem fixed rather than deferred. Items I had parked in earlier records on my own authority were re-opened; those that are genuinely the owner's call are listed in §45.3.

### 45.1 Fixed
| Problem | Fix |
| --- | --- |
| Two compile-time web bundles (`/` and `/client-terminal/`), `IS_CLIENT_BUILD` at ~150 sites, second Vite config and bundle-absence build check (Q3 not met) | **One bundle** at `/`. The audience is derived at runtime from the signed-in role (`client/src/lib/audience.ts`: `audienceForRole`, `getAudience`, `useAudience`, `setAudienceFromRole`); ~22 components and `Terminal.tsx` gate by it; the `/api/client/dashboard/*` vs `/api/*` families stay and are chosen by role at use time (the server already enforces role and entitlement on every route). `vite.client-terminal.config.ts`, the second build, `/client-terminal` serving, the dev `LIMURIA_AUDIENCE` switch, the cross-bundle redirect and the bundle-exclusion check are deleted; login is one page with an in-page trial-registration mode; SSO return URLs go to `/`. Trade-off stated: internal-only panels now ship as lazy chunks to every install (role-gated in the UI, enforced on the server). |
| Vendor lease issuer inside the product (`POST /api/admin/organizations/:id/license/reissue-lease`, `reissueOfflineLicenseLease`, env signing keys `LIMURIA_LICENSE_SIGNING_*`, `hashSignedLease`) | Removed. Licences are issued only by `npm run license:issue` with the off-repo private key. |
| Plaintext credentials in `config.json` (D-13) were still read | `migrateLegacyConfigCredentials()` runs at startup: every credential-named string moves into the encrypted vault (never overwriting an existing entry), the file keeps only settings, the original is kept once as `config.json.pre-gm07.bak` (0600); the plaintext read path in `resolveCredential` is deleted. |
| Egress guard covered only `fetch` | Also guards `node:http`/`node:https` `request` and `get` (first hop; node does not follow redirects), so callers such as `p10Observability` obey the same policy. Still outside: raw sockets (a remote PostgreSQL), the optional Playwright process, native addons. |
| Dead `LIMURIA_AUDIENCE` fallback in `retailSoftwareProfile.ts` | Removed; its tests use `LIOS_SOFTWARE_PROFILE=retail`. |
| Docs still described the hosted model | Banner added to the nine V4 hosted-model runbooks; `LIOS_ARCHITECTURE.md` identity/session/commercial lines rewritten. |
| Source-text acceptance proofs tied to removed code | Rewritten against the runtime-audience code (seven IA assertions, each still fails if its gating were removed). |

### 45.2 Verification
Clean-checkout full local gate (all steps), `tsc`, Postgres RLS (29), a real Electron temp-profile run **with `LIOS_EGRESS_MODE=allowlist`**: first-run owner setup, sign-in, Settings showing Licence / Backups / Data folder, then through the real UI: set folder + passphrase, Save, Back up now (an encrypted `.liosbak` was written and the page reported the last successful backup) and Test restore ("every table matched"). No console errors.

### 45.3 Not changed, and why (owner decisions)
- **Billing tables and credit-wallet columns remain in the schema.** Dropping them is an irreversible data migration; unused tables are inert. Recommendation: drop them in one migration at release time once no installed database could still hold paid history.
- **Marketing preview**: the pre-login product preview page still has a static “Pricing” section of reference text (no server dependency); moving marketing off the product is GM-24.
- **Packaged customer builds do not set the retail software profile** (`LIOS_SOFTWARE_PROFILE`), as before; whether community/Yahoo data is restricted by default in customer installs is a data-rights decision.
- Desktop CSP reads the process environment, not a `.env` file the server loads.

## 46. GM-08 — LiOS Gateway (typed device/session transport)

Owner decisions (2026-10-03): LiOS-owned protocol with **no wire compatibility** with OpenClaw; **zod**, not TypeBox; GM-08 stays **loopback / existing bind only** (remote and LAN paths arrive with GM-09 pairing); sliced **a → b → c**; the HTTP `respond` SSE endpoint stays as the scripted-API door over the same run registry (b); conversation runs survive reload/reconnect, **not** an app restart, until GM-10 owns durable execution.

### 46.1 GM-08a (this slice): protocol core, Gateway hub, browser/desktop client, first consumer
| Piece | Where | Notes |
| --- | --- | --- |
| Protocol v1 | `shared/gatewayProtocol.ts` | `req` / `res` / `event` frames, `connect` handshake → `hello-ok` (server version, `bootId`, methods, events, scopes, policy), structured errors (`code`, `retryable`, `retryAfterMs`), per-connection event `seq`, `tick`/`shutdown` events, method and event catalogues with zod schemas (the only place a method or event is declared) |
| Server hub | `server/gatewayHub.ts` | transport-agnostic; scope check, params and result validation, handshake timeout, backpressure close, `maxPayload`, graceful `shutdown` event, per-connection feature state |
| Runtime and first feature | `server/gatewayRuntime.ts` | the one hub; `quotes.subscribe/unsubscribe` + `quotes.update` |
| Upgrade | `server/index.ts` | `GET /gateway`: same session cookie, local-trust and origin checks as before; scopes derived from the account (`isHomeOwner` ⇒ `admin`), a client can only narrow them; unknown upgrade paths are destroyed in production |
| Client | `client/src/lib/gateway/*` | `GatewayClient` (typed `request`, `onEvent`, `onReady({restarted})`, `onGap`, jittered reconnect that stops on terminal errors, tick watchdog, abort/timeout, in-flight rejection on close), `GatewayProvider` mounted once in `App.tsx` for the signed-in session |
| Cut-over | `client/src/lib/useWebSocket.ts` | `useLiveQuotes` is on the Gateway; the old `/ws` endpoint, the broadcast-to-everyone `quote_update` and `wsClients` are deleted |

Security mapping: authentication is the existing session (no new credential); the Gateway adds no listener; quote updates are now filtered per connection (previously every connected client received every quote — the `organizationId` filtering warning in the old code no longer applies because nothing tenant-bearing is broadcast).

### 46.2 Verification
`tsc` clean; `server/gatewayHub.test.ts` (9) and `server/gatewayRuntime.test.ts` (1) over a real `ws` loopback; client `lib/gateway/*.test.ts` plus `useWebSocket.test.ts` (19); real built server + real `GatewayClient`: unauthenticated upgrade 401, cross-origin refused, old `/ws` refused, owner gets `read/write/admin`, ping / subscribe / `NOT_FOUND` / `INVALID_REQUEST` answered, server SIGTERM puts the client in `reconnecting`.

### 46.3 Next
(GM-08c is §46.5.) push events (backup, licence, update, ledger/artifact), route manifest with auth classes enforced by a test, session/URL contract.

### 46.4 GM-08b: Conversation runs on the Gateway
| Piece | Where | Notes |
| --- | --- | --- |
| Run registry | `server/conversationRunRegistry.ts` | one in-memory registry of runs keyed by `requestId` and owner; bounded event buffer (superseded cumulative `text` events are dropped), replay `afterSeq`, 10-minute retention of finished runs, 20 runs per user, failing observers isolated; a thrown or silent runtime always ends with `error`?+`done(failed)` |
| Run service | `server/conversationRunService.ts` | the logic that lived inside the two `respond` handlers, moved unchanged in behaviour (validation, AI gate, voice review 428, attachment errors, ledger, history, persistence); rejections are `ConversationStartError(status, body)` raised **before** a run exists |
| Gateway methods | `server/gatewayConversation.ts`, `shared/gatewayProtocol.ts` | `conversation.start` / `.subscribe` (replay) / `.cancel` / `.active`, event `conversation.event {requestId, runSeq, event}`; start errors keep the HTTP status/body in `error.details`; observers are per connection and detach on close, the run continues |
| HTTP door | `server/projectConversationRoutes.ts` | thin SSE adapter over the same service and registry (scripted clients, tests, MCP); closing the stream detaches, it never cancels |
| Client | `client/src/lib/gateway/conversationRun.ts`, `ProjectExperienceShell.tsx` | the shell's two private `fetch`+SSE paths and the SSE reader are deleted; reconnect re-subscribes from the last seen `runSeq`; a connection lost during start is reconciled (no duplicate run); a restarted Home ends the run with a clear message; a reloaded chat re-attaches to its running run |

Problems found and fixed while moving the code: the assistant message was saved *after* the stream had ended, so a UI that refetched on `done` could miss it. `done` is now held until the message is persisted. A runtime that threw after emitting its own error showed a second synthetic one; it is now emitted once.

Limits (by owner decision): runs are in-memory and end on an app restart; durable runs belong to GM-10.

### 46.5 GM-08c: push events, route manifest, LiOS address contract
**Push instead of poll.** One event, `data.invalidate {topics}`, names *what* changed and carries no data (the client refetches through its normal authorised API). Topics: `alerts` (alert triggered → that user only), `backup` and `license` (Home owner / `admin`-scope connections only), `quantlab` (run state → run owner only). `GatewayProvider` invalidates the matching TanStack queries and refetches every mapped topic once after each reconnect. The 15 s alert poll and the 1 s Quant Lab poll are removed; the Quant Lab panel reloads on the event and on reconnect. Backup status is announced only after the `running` flag is cleared (otherwise the UI would refetch a stale "running").

**Route manifest (D-01).** `docs/technical/ROUTE_MANIFEST.json` lists all 830 HTTP routes with the identities that reach the handler. It is produced by *probing the live Express router*: for each route the middleware before the final handler (matching `app.use` layers, then the route's own guards) is executed with a synthetic request for `anonymous`, `client_user`, `client_admin`, `internal_analyst`, `internal_compliance` and `internal_admin`; the final handler is never run. Name-based classification was tried first and rejected: 577 routes looked public only because the central `/api` gate (`PUBLIC_DATA_PATH_PREFIXES` / `requireInternal`) is an anonymous function. Semantics: `reachableBy` is who passes role/session guards *without a stored entitlement*; an empty list (42 `/api/client/*` portal routes) means the route needs licence/entitlement state. `npm run routes:manifest` regenerates; `npm run check:routes` (in `test:trust` and `test:offline`, so in CI) fails if the file is stale **or** if the set of anonymously reachable routes differs from the reviewed allow-list in `script/route_manifest.ts` (14 routes: auth/setup/SSO, `public/desktop-distribution`, `public/leads`; the last two are GM-24's marketing review). Verified against a real server: every one of the 816 non-anonymous routes answered 401/403 to an unauthenticated request (fresh server per 200 requests because the global rate limiter answers 429 after ~260).

**Address contract.** `shared/liosAddress.ts` is the one grammar for pointing at a Project or conversation: `#/p/<id>`, `#/p/<id>/c/<id>`, `#/c/<id>` (strict positive integers, one parser, round-trip tested). The selection hook reads it on load and on `hashchange` (an address beats the remembered selection) and keeps it in step with the selection via `history.replaceState`; the router serves the Terminal for `/p/*` and `/c/*`. Adapted in intent from OpenClaw `session-url-contract` (no code copied: its session-key/slug grammar belongs to OpenClaw's agent sessions). Real Electron run: `#/p/1/c/1` survives reload and reopens that chat.

**Not done on purpose:** an OS-level `lios://` protocol handler (needs signing/registration decisions; arrives with the paired-device work, GM-09/15), and moving the remaining time-based market-data polls to events (they are provider refreshes, not Home state changes).

## 47. GM-09 — Device identity, pairing, discovery and mesh

Owner decisions (2026-10-03): the Home accepts remote devices only after the owner turns on **Allow my devices**, over **TLS with a self-signed certificate pinned in the pairing QR** (09b); a device is approved by **QR/code from Settings plus an explicit approve prompt on the Home**; devices authenticate with an **Ed25519 keypair (public key stored in the Home, nonce signed on every connect, revoke = delete, scopes capped below admin)**; **mDNS discovery is opt-in** and only while devices are allowed, advertising Home name, port and a certificate-fingerprint hash (09c). GM-09 is split a/b/c.

### 47.1 GM-09a (this slice): identity, pairing, authentication, revocation (loopback only)
| Piece | Where | Notes |
| --- | --- | --- |
| Contract | `shared/devicePairing.ts` | Ed25519 public key (43-char base64url), device id = first 128 bits of SHA-256(key), proof payload `lios-device-v1|id|client|mode|scopes|signedAt|nonce|pairingToken`, 5-minute token, 2-minute clock skew, scopes `read`/`write` only |
| Protocol | `shared/gatewayProtocol.ts` | `connect` gains `device` (proof) and `pairing`; server sends `connect.challenge {nonce}` first on `GATEWAY_DEVICE_PATH` (`/gateway/device`); first-time devices get `pairing-pending`, then `pairing.resolved` and a normal close |
| Hub | `server/gatewayHub.ts` | `attachUnauthenticated(socket, authenticator, remoteAddress)`; the handshake deadline ends when a pairing is pending; `disconnectDevice(id)` closes a revoked device's sockets (4001) |
| Service | `server/devicePairingService.ts` | token kept only as a hash, single use, per-user cap; pending requests in memory, approve/deny only by the issuing user; proof verified with `node:crypto` (no WebCrypto experimental warning); rejects stale/replayed/foreign-key/wrong-client proofs, revoked devices, locked owners; per-address failure limiter (8/min) |
| Store | `server/deviceStore.ts`, `shared/schemaDevices.ts`, migration `0076_lios_paired_devices` | `paired_devices` holds the public key only; a revoked key stays known so it cannot silently re-pair |
| API | `server/deviceRoutes.ts` | `GET /api/devices` and `DELETE /api/devices/:id` are caller-owned; pairing-code creation and approve/deny require the Home owner; changes push `data.invalidate{devices}` |
| Client | `client/src/lib/gateway/deviceIdentity.ts`, `gatewayClient.ts`, `components/settings/DevicesSettings.tsx` | WebCrypto Ed25519 identity (platform persists the key), challenge-first connect, `pairing` state, Settings section for every signed-in user |

A paired device acts as the user who approved it and can never be granted `admin`: it cannot manage backups, the licence, the data folder or other devices, and it has no cookie, so the REST API stays closed to it. Verified on a real server: unknown device and wrong/reused token refused, owner notified, approve → device connects with `read/write` and its device id, `admin` request refused, `last seen` recorded, revoke disconnects it within a second and it cannot reconnect.

Pairing failure paths are closed: a code is consumed before any asynchronous lookup, its original expiry also bounds pending approval, persistence failures resolve the device as denied, and disabled/password-reset accounts cannot authenticate paired devices. Regression tests exercise concurrent code reuse, expiry during approval, database conflicts and account restrictions.

Not in 09a: any network exposure beyond today's bind (09b), QR rendering, discovery (09c), the Rust node-host/client crates and the node role (GM-14/15).


### 47.2 GM-09b: opt-in TLS listener and certificate-pinned pairing invitation

`server/deviceNetwork.ts` owns the separate device-only HTTPS listener. It is off by default, opens only after the Home owner selects **Allow my devices**, and accepts only an exact `GET /gateway/device` WebSocket upgrade. Every HTTP path, including `/api/auth/me`, returns 404; the local Home's browser/session API is not exposed on this port. Disabling it closes its sockets without closing local UI connections. Lifecycle operations are serialized; failed enables do not persist `enabled=true`. Startup failures leave networking closed and the local repair UI available.

`server/deviceTls.ts` uses pinned PKIjs/ASN1js dependencies with platform WebCrypto to generate a stable P-256 self-signed server certificate. The Home identity, certificate and private key are atomically stored in `data/device-tls/identity.json`; symlinks, malformed/mismatched/expired keys and unsafe custody are rejected, never silently rotated. POSIX custody is 0700/0600 plus an inode comparison between the path and the opened handle. Windows has no meaningful mode bits, so it hardens the file and directory with `icacls` (inheritance removed, current user only) and verifies the real ACL on every load (no Everyone, Users or Authenticated Users entry, current user present); the path-versus-handle inode comparison is skipped there because those identifiers are not comparable on Windows (it rejected the genuine file on CI), making the owner-only ACL the boundary. Encrypted backups include this identity so restores retain the certificate pin; plaintext backups exclude it.

`shared/deviceNetwork.ts` defines the strict, expiring `lios-pair:v1:` invitation containing the Home UUID, name, TLS addresses, SHA-256 certificate pin and one-time code. `server/pinnedDeviceSocket.ts` verifies the leaf certificate pin and validity **before** releasing the TLS socket to HTTPS: a wrong pin causes no HTTP upgrade, signature or pairing token transmission. There is no process-wide TLS bypass. Native clients must enforce this same out-of-band pin.

Settings → Devices presents the owner-only toggle, Home name, actual listener addresses/fingerprint and a QR rendered by `qrcode-generator`. A listener change clears the displayed invitation so a stale port is never reused. Socket count and the authentication-failure address cache are bounded. The existing owner-approval step remains required after scanning.

Evidence: typecheck clean; 20 certificate/listener/pinning/invitation tests passed on macOS, and the P11 `windows-latest` and `macos-15` jobs passed on the final commit (including the Windows-only Everyone-readable-ACL rejection test). Real built-server smoke: TLS invitation → pinned connection → owner approval → authenticated read/write → ping; REST on the device port 404; disabling networking disconnected the device. Actual browser Settings: enable succeeded, QR rendered, Apple Vision decoded its pixels and the decoded Home UUID/pin/address matched the server; full invitation copied correctly; disabling removed the QR. A Quick-chat deep-link restoration defect discovered during the UI smoke was fixed: an explicit null Project in `#/c/<id>` no longer falls back to a remembered Project or triggers auto-selection.

Native desktop proof: a source-built Electron instance with a temporary profile/DataRoot and the per-launch renderer trust token enabled the TLS listener through Settings, rendered the pairing QR and returned to disabled status through the same control; no renderer errors were observed. This was a smoke launch, not an in-place install or packaged-release qualification.

PKIjs/ASN1js BSD-3-Clause, QR generator MIT and `bonjour-service` MIT notices are retained. The installed desktop application has not been rebuilt or replaced.

### 47.3 GM-09c: opt-in mDNS discovery, capability advertisement and remembered Homes

| Piece | Where | Notes |
| --- | --- | --- |
| Contract | `shared/deviceDiscovery.ts` | `_lios-home._tcp` TXT `v=2`, `homeId`, `fp` (SHA-256 pin), `methods` / `events` counts and contiguous comma-separated `m0`… / `e0`… chunks; each complete key=value string ≤255 bytes, total TXT ≤1300 bytes; no pairing secrets |
| Advertiser | `server/deviceMdnsAdvertiser.ts`, `server/deviceNetwork.ts` | Publishes only when **Allow my devices** and **Discover on local network** are both on; UUID-qualified instance names retain probing without display-name collisions; `discovering` waits for publication; shutdown awaits TTL-zero goodbye before destroying the socket |
| Settings | `DevicesSettings.tsx` | Owner-only **Discover on local network** toggle (shown only while devices are allowed); `network.discovering` status and an "Advertising on the LAN" notice |
| Multi-Home | `shared/deviceHomes.ts`, `client/src/lib/gateway/deviceHomeStorage.ts`, `DevicesSettings.tsx` | Settings accepts a pasted pairing invitation (scheme, size and expiry validated), remembers the Home's public identity, lets the owner switch the active Home or forget one; a fingerprint change for the same Home UUID replaces the saved record |

Scope boundary: this app advertises and keeps a registry; it does not browse mDNS or dial out to other Homes. Native clients (GM-14/15) discover with standard DNS-SD and connect through the pinned, owner-approved device channel. The registry is the shared selection rule: one active Home at a time, a changed certificate fingerprint replaces the record and requires re-pairing, and only a Home's public identity (name, addresses, fingerprint) is stored on a device, never a pairing code.

Evidence: typecheck clean; 16 discovery, registry and listener tests pass locally, including a real-LAN mDNS publish-then-browse test (skipped only on GitHub Actions runners; CI covers the publisher state). Real Electron (source-built, temporary profile/DataRoot): enabling **Allow my devices** then **Discover on local network** made an external mDNS browser see `_lios-home._tcp` with the Home UUID and certificate fingerprint matching the server and TXT keys `v`, `homeId`, `fp`, `methods`, `events` only (no secrets). Nothing was advertised while discovery was off; turning it off stopped the advertisement with the listener still up; turning **Allow my devices** off cleared both settings. Settings → **Other Homes this device can use**: an expired or malformed invitation is refused with a message and writes nothing; a valid one is listed as active with the pairing code absent from storage; two Homes can be switched and survive a reload; **Forget** removes the record; no renderer console errors. This was a smoke launch, not an in-place install or packaged-release qualification.

**2026-10-06 SI-02 blocker correction:** the local-gate LAN timeouts at `31d2a689` and `9d1d3385` were a protocol defect, not established OS multicast failure. A direct real-Bonjour diagnostic measured the then-current complete `methods=` TXT string at **361 bytes** (16 methods; 8 events). The reused `bonjour-service` 1.4.4 / `dns-packet` codec writes a single length byte without rejecting values over 255 bytes; decoding the actual encoded record raised **`Buffer overflow`**. On the same host, a short valid advertisement was discovered on the real LAN, while the full malformed advertisement yielded four decoder warnings and no discovery; there were no socket errors. The original failing test was not rerun to establish that evidence.

The correction retains the existing MIT Bonjour publisher and its probing rather than introducing a second discovery implementation. The v2 advertisement splits complete capability identifiers across bounded numbered chunks, validates counts/continuity/identity/pin, and rejects unknown fields, invalid byte values and the obsolete v1 layout. Both same-name Homes can advertise independently because the instance name includes the full public Home UUID. Pending/failed publication is not reported as `discovering=true`; bind/permission failures surface through device-network status. Stop sends the real goodbye and waits for socket close, including cancellation of stale probe/reannouncement callbacks. Tests now exercise the installed wire codecs and require the exact LAN test to decode all current methods/events, distinguish two same-name Home identities, observe both real goodbye removals and stop cleanly. Focused suites, the exact failing test, consolidated local gate and packaged-target qualification remain the integration owner's checks; the diagnostic alone is not SP-02 acceptance.

If a different target reports an actual permission/socket failure, retain the failed qualification and the surfaced error. On macOS, enable the running LiOS application (or Terminal for source diagnostics) under **System Settings → Privacy & Security → Local Network**, allow incoming connections for the app in the firewall, reconnect to a multicast-capable LAN, then explicitly toggle **Discover on local network** off/on. On Windows, use a trusted Private network and permit the app's UDP 5353 traffic in Windows Defender Firewall. VPN/AP isolation or blocked UDP 5353 must be corrected on that network before retrying the real LAN/package qualification; a QR/manual pinned pairing invitation is supported provisioning but does not prove discovery.

## 48. GM-10 / CP1 — execution fabric

Current structural boundary: GM-00–09 foundations and major GM-10 kernel/journal/backend pieces are recorded below at bounded truth levels. Full interactive execution/session attach/replay/upload and its real consumer remain incomplete. GM-11 exact-operation authority, sandbox and trust receipts remain the immediate prerequisite before privileged `exec.*`; PR #227 is open, not a merged implementation or accepted SP-01. Later agent/coding/browser/node, durable memory, skills/MCP, managed local models and deployment/provisioning remain owned by GM-12–25. Native mobile/watch and reliable public-iOS fully suspended wake remain unproven.

### 48.1 GM-10a — child-process kernel and runtime cutover

Donor-first: OpenClaw `v2026.9.7`, MIT, pinned commit `c074824a27c96d3983043f9eeb33823cd1772d8c`. Ten leaf modules (bounded buffer, deferred, process-tree kill, deadlines, pipe output, UTF-8 truncation, backend contract, output ring/coalescing/flow control) are imported unchanged except attribution and import paths. Supervisor, child/stdin/env/process-event adapters and decoded output are adapted, not replaced by a second orchestrator. Exact paths, modifications and upstream-test lineage are in `third_party/components.json`.

The existing LiOS permission, P11/P13 engine/plugin, Python-runtime and data-provider authorities remain canonical. `server/exec/run-command.ts` is the bounded one-shot entry point: required deadline, filtered inherited environment, deliberate explicit overlay, typed failure diagnostics, output-drain and process cleanup before success. It rejects overflow instead of treating truncated JSON as a valid result.

Existing Yahoo scripts, ZIP extraction, Docling, Python inspection/install, voice transcription/benchmark, ffmpeg and macOS speech output now use that entry point. The Python sidecar and P11/P13 LEP sidecars use the same process supervisor; protocol, handshake, per-request cancellation and crash backoff remain in the existing LEP owner. The server shutdown closes admission and joins supervised children. Native group ownership continues after the root exits so a SIGTERM-ignoring grandchild cannot outlive its run.

Evidence: integrated TypeScript check passes; 205 targeted execution/provider/sidecar/security tests pass, plus manifest validation and OSS provenance audit. The first integration run exposed a Darwin `EPERM` group-probe issue: a real-process diagnostic showed `kill(-pgid,0)` returning `EPERM` while `ps` showed no group members, so bounded explicit enumeration now confirms that error case rather than assuming cleanup. Linux testing exposed unreferenced cleanup timers allowing Node to exit before descendant extinction; bounded cleanup now keeps its owner alive. The 15 real-command/descendant tests pass inside the actual Linux runner container. A real command smoke observed drained output and no inherited parent secret; the real uvicorn sidecar passed token-authenticated readiness and runtime-info, then shutdown joined its exit (Python 3.12.14). No installed desktop app was replaced; Windows certification is not claimed.

Scope: this slice migrates server child processes; it adds no arbitrary-command REST/Gateway endpoint and grants no execution permission. Session attach/replay, upload, the encrypted journal and native PTY are subsequent GM-10 slices, not claimed implemented here. Desktop main-process launch/probe ownership remains its existing lifecycle boundary until that integration lands. Spawn broker/service relays/Windows Job ownership are deferred because they depend on OpenClaw runtime hosts or separate native capabilities; Bun paths are inapplicable to the Node runtime.

### 48.2 Owner decisions for remaining GM-10 slices

The owner approved a bounded encrypted execution journal using the existing storage key: interrupted runs retain their transcript after restart, but commands are never automatically resumed (delivered in §48.3). The owner also approved including native PTY now with lazy loading; plain-pipe operation remains available when the native module is unavailable. Native-module packaging, signing and platform verification are required before claiming packaged/release proof (GM-10c).

### 48.3 GM-10b — encrypted execution journal and conversation-scoped process ownership

Donor-first: the journal has no OpenClaw equivalent that is durable and encrypted (OpenClaw's terminal replay map is volatile memory), so it is LiOS-owned and reuses the imported OpenClaw `surrogateSafeTail` for UTF-16-safe truncation. Persistence reuses the GM-05 `EncryptedStorageProvider` + `storage.key`; no second key or crypto authority. It is always local, even when S3 storage is selected.

`server/exec/execution-journal.ts` stores one versioned encrypted record per run (owner `{userId, projectId, chatId}`, generic label, status, bounded stdout/stderr transcript, exit code). Argv, env and credentials are never recorded; credential-shaped strings are redacted best-effort, and encryption is the real privacy boundary. Transcripts are capped (256 Ki chars), records are capped (256, never evicting an active run), corrupt/tampered/key-swapped/plaintext records fail closed and visibly. `recoverInterrupted()` runs at startup before listeners and rewrites stale `running` records as `interrupted`; **commands are never resumed**. Plaintext backups omit the whole `execution-journal` directory together with `storage.key`; encrypted backups keep both.

`server/exec/execution-scope.ts` binds a saved Quick/Project conversation run to the supervisor: the run's existing cancellation controller now also cancels every subprocess started on its behalf (AsyncLocalStorage scope, `runCommand` inherits it), and the journal records begin → deltas → finish before the terminal `done` is visible. `conversationRuns` stays the sole active-run registry; the journal is persistence only. **Temporary chats never touch the journal.** A journal failure fails the run visibly, with no plaintext fallback.

Two authenticated, caller-owned read endpoints expose retained history after restart: `GET /api/project-chats/:chatId/executions` and `.../:requestId` (tenant + chat authorization, then exact owner match; 503 on journal failure). No execution endpoint and no new permission were added. Route manifest updated.

Not in this slice: native PTY, interactive terminal sessions and `exec.*` Gateway methods (GM-10c, built together with their consumer so no backend ships unused).
The owner approved a bounded encrypted execution journal using the existing storage key: interrupted runs retain their transcript after restart, but commands are never automatically resumed. The owner also approved including native PTY now with lazy loading; plain-pipe operation remains available when the native module is unavailable. Native-module packaging, signing and platform verification are required before claiming packaged/release proof.

### 48.4 Orphaned Python sidecar after a crash or force-quit (found by the CP1 acceptance run)

The CP1 acceptance run found **41 Python sidecars with parent pid 1, up to 20 hours old**, left by force-killed app runs. A graceful quit stops its sidecar (verified: one fewer process after quit), but a crash, force-quit or power loss gives the launcher no chance to, and neither macOS nor Windows reaps children. Each leaked process held a loopback port and memory until reboot.

Fix, LiOS-owned (no donor needed for a 60-line liveness poll): the launcher passes `LIOS_PARENT_PID`; `python-service/parent_watchdog.py` (started from `main.py`, so dev, packaged `sidecar_entry.py` and tests share it) polls the parent every 2 s (`kill(pid, 0)` on POSIX, `WaitForSingleObject` on Windows) and exits when it is gone. A launcher that died before start-up makes the sidecar exit immediately; invalid values fail closed. Unset (a developer running uvicorn by hand) means no watchdog.

Verified: 4 Python tests including a real sidecar process that exits after its real parent is killed; and end to end with the real server-side launcher: `SIGKILL` of the launcher → real uvicorn sidecar gone in 1.76 s, zero orphans left. Windows branch is untested until the manual P11 gate. The P11/P13 engine sidecars are not changed by this fix and were not checked for the same crash behaviour; that remains open.

### 48.5 Orphaned server after a desktop crash or force-quit (found by the second CP1 acceptance pass)

#202 stopped the Python sidecar from outliving *its* launcher, but the acceptance run then showed the layer above: after a `SIGKILL` of the desktop app the **server process (`dist/index.cjs`) survived with parent pid 1**, kept its port, database lock and its sidecar, and the relaunch could not open a window. The desktop spawns the server as a plain child, and neither macOS nor Windows reaps it.

Fix, LiOS-owned: `main.cjs` passes `LIOS_PARENT_PID`; `server/parentWatch.ts` polls it every 2 s (`process.kill(pid, 0)`: `ESRCH` means gone, `EPERM` means alive) and, once gone, runs the existing graceful `shutdownAndExit` (supervisor shutdown joins the sidecar, HTTP and database close). A launcher already dead at start-up shuts down immediately; a malformed value fails closed; unset (a hand-run server) means no watch. The sidecar chain is therefore Electron → server → sidecar, each watching its own parent.

Verified: 4 tests with real processes (a watcher exits by itself after its real launcher is `SIGKILL`ed; an already-dead launcher is reported at once; liveness; bad values). End to end in real Electron: `SIGKILL` of the whole app → the server and sidecar both exited on their own (0 left), the relaunch opened, the session and chat context survived. Windows relies on the same `process.kill(pid, 0)` semantics and is untested until the manual P11 gate.

### 48.6 CP1 cross-track acceptance record (2026-10-03, macOS, source-built Electron on merged `main`)

One scripted journey on real `main` after #197–#202, temporary profile, deterministic offline mode (the data gaps make every run end `failed`; that is the runtime's honest status, not a defect):

- **TC:** `$MSFT` request → follow-up "Compare this" with a different ambient symbol resolved to MSFT; a two-subject turn then "Analyse this" returned 409 `working_context_clarification_required` and registered no run; `$NVDA` resolved it; after a renderer reload and after a full app restart the follow-up still resolved to NVDA. Working Context never appears in the UI.
- **GM:** 4 encrypted journal records before the restart, 6 after; pre-restart records survive; none stuck `running`; the detail view holds no argv/env. A graceful quit leaves 0 sidecars; a `SIGKILL` crash leaves 0 servers and 0 sidecars; the relaunch works. Temporary chats never touch the journal.
- **CA:** a spreadsheet Artifact revision created through the P4 API survives the restart (formula kept as source text); the Univer editor itself was verified separately in a real browser (edit → revision 4 → reload → recomputed value).
- No console errors; one runtime per layer after restart (1 sidecar).

Defects found by this acceptance and fixed in the same cycle: 41 leaked sidecars (#202), the orphaned server (this PR), "Analyse this" read as the ticker `THIS` (#201), `tsc` out of memory on the runner (#199), macOS `EPERM` group probe and Linux timer-ownership races (#198).

Not covered by this acceptance (so not claimed): packaged/installed app, Windows, the Univer editor inside the Electron shell (checked in a browser), a long-running run killed mid-flight, the interactive terminal (GM-10c, parked until GM-11).
### 48.7 GM-10c (part 1) — lazy native PTY backend with a real pipe fallback

Owner decision (§48.2): include native PTY now, load it lazily, fall back to plain pipes. Delivered as a **backend only**. Donor: OpenClaw `src/process/terminal-pty.ts` + `pty-terminal-name.ts` (MIT, pin `c074824a27c96d3983043f9eeb33823cd1772d8c`), Node path adapted; the Bun worker PTY and the Windows wrapper/shell policy are removed and `.bat`/`.cmd` launch is rejected. Native layer: `@lydell/node-pty` 1.2.0-beta.15 (MIT, exact-pinned `optionalDependency`, upstream commit `e1212da8…`).

`openTerminalBackend({argv, cwd, env, cols, rows, preferPty})` returns `{backend, mode: 'pty'|'pipe', pid}`. The addon is imported only inside the lazy loader, so ordinary start-up never loads it. Fallback happens **only** when the native module is unavailable, never for a bad executable, cwd or authorisation (no bypass). The pipe mode is a real supervised child (stdin open, stdout+stderr merged, real stream `pause()/resume()` backpressure, exit published after output drain and descendant cleanup); its `resize` throws `PipeTerminalResizeError` instead of pretending to succeed, and the mode is reported so a UI can tell. Both modes keep a bounded 64 Ki-char startup tail so a late subscriber does not miss an immediate-exit command. Environment is the filtered LiOS allow-list; descendants are killed through the same process-tree path as §48.1.

Verified (macOS arm64): 29 tests (native loader injected, fallback, resize, pause/resume against a live child, kill idempotence, descendant cleanup); a real native smoke showed `TTY=yes`, the requested 30×100 size and an interactive `read`, and the pipe fallback showed `TTY=no` with the honest resize error. A test race found on the way (Node resumes a paused stdio pipe when its child exits, which masked the pause) is fixed by keeping the child alive while paused.

**Not exposed.** There is no Gateway or REST endpoint and no caller yet: an interactive terminal is a remote shell, so `exec.*` methods wait for the owner's decision and GM-11 exact-operation authority. Not verified: Linux/Windows native behaviour (ConPTY), the packaged and signed app (the whole `node_modules` tree is already asar-unpacked, but notarization and loading are unchecked), and the beta pin should move to a stable release when one exists.

### 48.8 CP1 hardening — packaged-app and Electron-shell verification (2026-10-03, macOS arm64)

Historical owner decision after CP1: harden before the then-planned CP2. CP labels now describe evidence history only; SI phases and mandatory Shipping Points govern execution. Built an **unsigned local pack** (`npm run app:pack`, output inside the worktree; the installed `/Applications` app was not touched) and ran the real packaged app with a throwaway HOME and `LIMURIA_VAULT_SECRET` (so no keychain is used). This partial target smoke does not establish SP acceptance, a shipped interactive terminal, signed/notarized qualification or Windows proof.

- **Univer in the real shell, under the real desktop CSP** (`script-src 'self'`, no `unsafe-eval`): the lazy chunk loads, the ribbon and canvas render, the formula recomputes, "Save spreadsheet revision" writes revision 2 with the formula kept as source text; zero CSP violations, no alerts. Verified both in the source-built shell and in the packaged app.
- **Crash recovery in the packaged layout:** `SIGKILL` of the packaged main process → the server (the packaged binary in `ELECTRON_RUN_AS_NODE` mode) and the Python sidecar were gone within about a second.
- **Native PTY in the packaged layout — a real defect found and fixed.** The packaged app runs the server from `app.asar.unpacked/dist`. node-pty locates its `spawn-helper` by rewriting the first `app.asar` in its own path to `app.asar.unpacked`; applied to a path that is already unpacked this produces `app.asar.unpacked.unpacked`, and every spawn failed with `posix_spawn failed: No such file or directory` (reproduced). `terminal-pty.ts` now loads the addon at runtime through the equivalent `app.asar` path (`nativePtyLoadPath`), which also keeps it out of the esbuild bundle. Verified: a probe bundle run from the packaged app's unpacked `dist` with the packaged runtime opened a real PTY (`mode: pty`, `TTY=yes`, 25×90); the same load without the rewrite fails with the error above.
- The PTY backend has no caller, so esbuild tree-shakes it out of `dist/index.cjs`; the check above is therefore a probe bundle, not the shipped server. It becomes a shipped path only when a consumer exists (GM-10c part 2).

Still not verified: Windows (ConPTY, the `process.kill(pid, 0)` watch, `icacls`), Linux packaged builds, a **signed/notarized** build (the ad-hoc signed pack proved loading and CSP, not notarization or hardened-runtime library validation for the native addon), auto-update, and the landing page still shows "PRICING / START FREE TRIAL" (GM-24, by owner decision).

## 49. GM-11a — server-side Project action grants (implementation record)

**Truth level: code integrated, tests passed. Not packaged, not exercised in the installed app, not user-verified end to end.** Issue #226. Owner decision Q6 (§32.5) is implemented; the rest of GM-11 is still open.

- **Authority.** A conversation run may rely only on grants held by the server. `server/conversationGrantStore.ts`: *Project* grants are rows in `conversation_action_grants` (migration `0078`, owner + Project scoped, unique per action, idempotent SQL, revoke deletes); *once* approvals are single-use, user- and request-bound, in memory with a 15-minute lifetime (a restart asks again). Only actions whose policy class is `user_confirm`/`admin_confirm` can be granted.
- **Request-supplied grants are ignored.** `conversationRunService.withServerApprovals` overwrites `approvals` and `aiDirectApproved` on both start paths (Project/Quick chat and Temporary chat, therefore HTTP/SSE and Gateway) from the store; a once approval is consumed by the continuation it approves. Project grants apply only in Project chats.
- **Routes (all authenticated, listed in `docs/technical/ROUTE_MANIFEST.json`):** `POST /api/conversation/approvals`, `GET /api/projects/:projectId/conversation-approvals`, `DELETE /api/projects/:projectId/conversation-approvals/:action`.
- **Client is a view.** Approving first records the approval on the server (a failure stops the continuation and tells the user); the browser list mirrors the server per Project and the pre-GM-11 localStorage grants are posted once, then never trusted again.
- **Evidence.** `server/conversationGrantStore.test.ts` (real embedded Postgres): once is single-use/request-bound/user-bound/expiring; Project grants are Project- and user-isolated and revocable; ungrantable actions and missing Project/request are rejected; a run whose body *claims* approval is refused (`approval_required`), the same run after a server-recorded approval proceeds, and replaying it is refused again. Negative control: with the server override disabled the claim test fails. Client: `conversationRuntimeClient.test.ts` (payload shape, one-time migration, server mirror). `dbMigration.test.ts` replays 0078 idempotently.
- **Not done (later GM-11 parts):** exact-operation binding (an approval for one operation must not authorize a different one) and stale-policy defence, sandbox/`ExecutionBackend` backends (D-15), audit receipts for granted/denied operations, saved-workflow (P9) permission recheck before a scheduled run (S9), per-organization grant policy. The `exec.*` terminal stays unexposed until these land. Known edge: a one-time approval is consumed when the continuation starts, so a continuation that fails before the run begins needs a fresh approval.

### 49.1 SI-02 L1 canonical tool-grant convergence (#283 / #286)

**Truth level: source change and boundary regressions authored; integration validation belongs to the parent. No privileged agent workflow or SP-02 activation is claimed until the L4 consumer is integrated and exercised.**

`conversationGrantStore.ts` remains the only approval authority. Tool proposals/reviews/authorizations extend its existing bounded `onceGrants` map; they do not register runs, plans, checkpoints or journal transitions. Project tool permission uses the existing `conversation_action_grants` table with server-owned subject `tool:<canonicalToolId>`. Legacy action keys/APIs and the exact sandbox operation flow are unchanged. There is no governedTools issuer, approval WeakSet, client authorization payload, new table or second run store.

Server API and continuation sequence:

1. L4 obtains the exact paused run from the existing registry closure and calls `proposeGovernedToolOperation` with authenticated user, exact Project/Chat, request UUID, step/toolCall/tool ids, validated plan SHA-256, the exact immutable `descriptor` returned by the registered tool lookup and input, current policy snapshot, canonical **run** signal and the canonical live `currentPolicy` callback. The store checks descriptor id/permission/schema, parses and freezes a JSON-only argument snapshot before any ownership lookup await, then computes sorted-key canonical JSON SHA-256 and returns an opaque `reviewId`, display-only binding and expiry. Only one pending tool review per live run is admitted. Descriptor identity stays process-local, not in persisted journal/history.
2. Authenticated review calls `reviewGovernedToolOperation({ user, requestId, reviewId, allow, scope })`. The client does **not** supply a tool, step, toolCall, input digest, plan or policy. Denial destroys the pending grant; once review is ephemeral; Project review persists the namespaced subject in the existing table.
3. `resolveGovernedToolOperation({ user, requestId, reviewId })` consumes the reviewed grant once and returns one frozen, server-held `GovernedToolAuthorization`: `{ reviewId, binding, grant, lease, policy }`. A previously reviewed Project subject can also resolve a fresh exact proposal, but never becomes a lease itself. Parallel or repeated resolution cannot manufacture another handle.
4. L4 must **await** `assertGovernedToolAuthorizationMatches` with this authorization and its server-held exact owner/Project/Chat/run/step/toolCall/tool/plan, schema-parsed input, exact registered descriptor, current descriptor permission class and canonical `runSignal` before L2 durable release. This validates input and descriptor identity as well as plan/action binding before a journal transition; `assertGovernedToolAuthorizationCurrent` remains the freshness-only seam. L4 uses this exact `authorization.lease` in its live approval-continuation binding. The existing registry closure retains the authorization for same-run/same-plan L3 continuation. Project revocation is rechecked through the canonical SQL authority; lease freshness is rechecked through the retained live policy callback.
5. Resumed invocation receives the same authorization through server-created `GovernedToolCall`, including exact user/Project/Chat/run/step/toolCall/plan and canonical `runSignal`. After strict descriptor input validation, the registry freezes a JSON-only argument snapshot (never tenant/functions/signals), then calls `consumeGovernedToolAuthorization`: compares every binding, exact immutable descriptor identity, tool permission class and parsed input SHA, permanently removes the authorization **before** any invoke, and revalidates the live GM-11 lease immediately before/after tool execution. Re-registering the same tool id requires fresh review. It propagates lease cancellation and closes the lease on success or failure. This claims the already-resolved authorization, not the once grant a second time.

Copies/JSON/model claims never pass canonical identity checks. Once grants and live handles disappear on restart; persisted Project permission survives, but a new live-run lease and exact proposal are always required. Tool review/lease expiry is five minutes. Policy/permission drift, canonical run cancellation, explicit close, revoked Project permission or changed arguments fail closed without an effect.

Parent focused commands from `src/` (not executed by this lane):

```sh
npx tsx --test server/conversationGrantStore.test.ts server/governedTools.test.ts server/exec/execution-authorization.test.ts
npm run check
```

After L4/L2/L3/L7 integration, additionally exercise authenticated owner review → same journaled paused call release → one real tool effect → exact receipt; replay/copy/change input/Project/user/Chat/plan/policy → no effect; cancel while paused and in-flight → no resumed effect; restart → once authorization rejected and Project permission yields only a fresh exact-run lease. Source boundary tests are not that runtime smoke or packaged Shipping Point proof.

Parent integration smoke commands once the named L4/L3 files have landed:

```sh
npx tsx --test server/exec/approval-continuation.test.ts server/conversationRunRegistry.test.ts server/conversationRuntime.agentLoop.test.ts
npm run acceptance:sp01-packaged
```

The second command protects the accepted packaged exact-sandbox journey, not SP-02. There is no active privileged-agent approval endpoint in this L1-only branch, so an end-to-end SP-02 command must come from the integrated L4 journey rather than a fabricated UI or bypass route.


## 50. GM-11 (b–d) — Total Donor Intelligence Analysis and sub-plan

**Truth level: pinned-source audit complete; GM-11b.1 is implemented on the current branch with V0/V1/V2 checks passing.** Issue #226 · SI-01.11 (execution authority), SI-01.12/13/14 for sandbox/resources/receipts. The upstream annotated `v2026.9.7` tag resolves to commit `c074824a27c96d3983043f9eeb33823cd1772d8c`; GitHub reports the commit signature verified, while the tag object is unsigned. Root `LICENSE` is MIT, Copyright 2026 OpenClaw Foundation. Full exact-operation authority, sandbox, receipts and packaged SP-01 MSJ remain incomplete; privileged `exec.*` stays unexposed.
Verified source paths include `src/infra/exec-approval-policy-snapshot.ts` and its test, `exec-approvals-authorization.kernel.ts`, `exec-approvals-allow-always.ts`, `exec-authorization-plan.ts` and its test, `exec-command-resolution.ts` and its test, `command-carriers.ts`, `command-analysis/`, `agent-run-approval-leases.ts`, and `src/process/supervisor/adapters/env.ts`. The last file converts optional environment values to strings; it does not contain the earlier-described blocklist.
The old `system-run-*` filenames and `src/infra/host-env-security-policy.json` path are not verified at this pin. No code or policy data is imported by this task. The verified durable command approval is not a LiOS exact-operation binding; see below.

### What the donor does (summary of the mechanisms)
OpenClaw host execution combines policy, allowlist and optional user approval. The pinned source provides command analysis/resolution and delayed policy snapshots. Critical limitation: `exec-approvals-allow-always.ts` states durable `=command:` approvals hash command text only and do not bind cwd, environment or PATH; candidates needing those bindings remain one-shot. Therefore LiOS exact argv/cwd/env/executable/file-snapshot binding remains a LiOS requirement, not a verified upstream feature. The pinned source also provides nested-carrier/inline-eval analysis and run-bound approval leases. No environment blocklist JSON was found at the previously cited pinned path.

### Dispositions
| # | Mechanism (donor path) | Disposition | LiOS owner / destination | Phase |
|---|---|---|---|---|
| 1 | Approval planning, delayed policy snapshot and current-policy recheck (`exec-authorization-plan`, `exec-approval-policy-snapshot`, `exec-approvals-authorization.kernel`, `exec-approvals-allow-always`) | **ADAPT**; the text-only durable marker is insufficient for LiOS exact-operation approval | `server/exec/authority/` (LiOS operation descriptor/hash + approval authority) | GM-11b |
| 2 | File-operand snapshot and immediate drift denial (the previously recorded `system-run-file-snapshot` paths are not verified at this pin) | **ADAPT** as a LiOS requirement; no donor import until a pinned source path is verified | GM-11b execution authority; generalize to P4/TC proposal apply | GM-11b, then SI-04 |
| 3 | Delayed policy snapshot and invalidation (`exec-approval-policy-snapshot`, `exec-approvals-authorization.kernel`) | **ADAPT**; generalize to project-policy changes and P9 scheduled-run rechecks | `conversationGrantStore` policy version; P9 recheck | GM-11b, SI-06.06 |
| 4 | Nested-carrier/inline-eval risk analysis (`command-analysis/{risks,inline-eval,policy}.ts`, `command-carriers.ts`, `exec-authorization-plan.ts`) | **ADAPT** the pure analysis needed to judge actual command behavior | `server/exec/authority/command-analysis` | GM-11b |
| 5 | tree-sitter command explainer (`command-explainer/`) | **DEFER_WITH_TRIGGER** (WASM grammar footprint); trigger: approval UI needs plain-language "what this command does" | TC approval card | later |
| 6 | Environment policy (the cited `src/infra/host-env-security-policy.json` is not verified at this pin; verified donor `src/process/supervisor/adapters/env.ts` only normalizes values) | **ADAPT** as a LiOS-owned deny policy; no direct data reuse claim | `server/exec/env.ts` across child and PTY launches | GM-11b |
| 7 | Safe-bin / safe-builtin policy (`exec-safe-bin-*`) | **ADAPT**: the existing internal launches (Python, unzip, ffmpeg…) become registered **ExecIntents** with fixed argv templates, so internal programs and AI-requested commands go through one authority and one receipt format | `server/exec/authority/intents` + the current `runCommand` callers (bseBhavcopy, marketData, pythonRuntime, pythonRuntimeManager, p12VoiceRuntime and others) | GM-11b |
| 8 | Approval blast-radius scope (`approval-scope`: message-send / payment / external-post) | **ADAPT** as display-only facts for external-action approvals; the `payment` kind stays **refused** (no brokerage/transfer in scope) | SI-02.19 external side effects | SI-02 |
| 9 | Agent-run approval leases (`agent-run-approval-leases`, delegated authority tied to run abort signals) | **ADAPT** the "approval dies with its run" rule in 11b; **DEFER_WITH_TRIGGER** the delegation tree until subagents exist | GM-11b / GM-12 | 11b, SI-02.08 |
| 10 | Model-assisted auto-review (`exec-auto-review`) | **REPURPOSE as advisory only**: a risk annotation shown to the user, never an approval authority (LiOS rule: AI may not bypass authorization) | later SI-02 | later |
| 11 | Approval delivery to chat/native surfaces (`approval-native-*`, `exec-approval-forwarder`) | **REPURPOSE** for phone/watch approvals over the user's own Gateway (no LiOS push relay) | GM-17/18 | SI-06 |
| 12 | Sandbox backends (`agents/sandbox/*`: docker, podman, ssh, openshell, crabbox; fs-bridge path safety; sandbox tool policy) | **ADAPT** as `ExecutionBackend` implementations: `local` (today), `docker`/`podman` (optional, user-visible size/consent), `ssh` (this *is* the GM-14 user-owned remote node); fs-bridge path-safety **GENERALIZE** to Artifact/attachment path ownership. OpenShell/Crabbox: **DEFER_WITH_TRIGGER** (third-party services; user-owned only) | `server/exec/backends/` (D-15) | GM-11c |
| 13 | SQLite state/config documents, worker kernels, CAS hash of the approvals document | **REJECT_WITH_EVIDENCE** for storage (a second state authority; LiOS state is the PGlite/Postgres store); **ADAPT** the compare-and-swap hash for policy edits | n/a / policy store | 11b |
| 14 | `exec.*` Gateway methods / node-host `exec-policy` | **ADAPT** after 11b–c; stays unexposed until then (owner decision) | GM-10c part 2 | after 11d |

### Cross-donor mechanisms considered
- **OPA** (registry, Apache-2.0, documented only): **DEFER_WITH_TRIGGER** — a sidecar is not justified while policy is `security/ask/allowlist`; trigger: organisation-level rules the small policy cannot express. It remains a *validator* candidate for differential tests of the policy evaluator.
- **P13 plugin host** (`node --permission`, spawn denied; LiOS-owned): becomes one registered `ExecutionBackend` (`node-permission`) so plugin launch uses the same authority and receipts (D-15).
- **LangGraph.js / pydantic-ai** (checkpoint/resume): not GM-11; **DEFER_WITH_TRIGGER** to SI-02.06.
- **HQTUI** (doctor pattern): GM-21, not GM-11.

### Sub-plan
- **GM-11b — exact-operation authority.** LiOS must create an operation descriptor/hash binding argv, canonical cwd, normalized environment, resolved executable identity and mutable-file snapshots; server-side policy snapshot/CAS; approval bound to `(user, run, operation hash, policy snapshot)`; single-use invalidation on cancellation, abort or policy change; prelaunch drift checks; and registered internal ExecIntents. OpenClaw policy snapshots, parsing and resolution are adaptation sources, not proof that its durable command approval satisfies this contract. Tests: known-answer hash vectors, argv/cwd/env/executable/file drift, policy tighten/loosen, cancel-then-late-approval and nested-carrier cases.
- **GM-11 approval/lifecycle integration (PR #268 branch, not Shipping Point acceptance):** `executePreparedGovernedCommand` requires an independently supplied exact-operation digest as well as the backend/control approval digest; both are checked before supervisor admission, followed by the supervisor's immediate pre-native recheck. Prelaunch aborts use a typed, secret-safe cancellation error rather than `AbortSignal.reason`. Optional #251-style backend lifecycle is retained on the same GM-10 runner: synchronous `onCancel` precedes native termination; `finalize` runs only after native extinction and must succeed before completion. A named backend generation is a validated immutable receipt fact. Container #251 rebasing, trust receipt #267 wiring and packaged SP-01 evidence remain separate integration gates.
- **GM-11b.1 — explicit environment overlay policy (issue #231).** Implemented a LiOS-owned deny policy at child/PTY spawn, with case-insensitive matching and no values in errors. Default overlays reject `NODE_OPTIONS`, `NODE_PATH`, `PYTHONHOME`, `PYTHONPATH`, `BASH_ENV`, `ENV`, `GIT_*`, `NPM_CONFIG_*`, `LD_*` and `DYLD_*`; the fixed `python-runtime` profile preserves only the existing Python/runtime/package/proxy/certificate keys.
- **GM-11b.1 evidence:** focused child/command/PTY tests passed (53/53); relevant execution integration pack passed (301/301); `npm run check` passed. Manual local smoke confirmed the fixed Python profile starts a real child, `NODE_OPTIONS` is rejected before child launch, and a `DYLD_INSERT_LIBRARIES` PTY request is rejected before native PTY loading. No V3, packaged-target or SP-01 claim.
- **GM-11c — `ExecutionBackend`.** Interface (D-15), `local` backend, `node-permission` (plugins), then optional container and SSH backends behind the authority; path-safety checks; resource bounds (SI-01.13).
- **GM-11d — trust receipts.** Every allow/deny/drift/expiry is a receipt in the GM-10b encrypted journal (operation hash, policy hash, intent or command preview, decision, reason; no secret values), visible in the run's receipt and exportable.
- Out of this task: tree-sitter explainer, auto-review advisory, native/phone approval delivery, OpenShell/Crabbox, subagent delegation.

## 51. SI-02 L5 — pinned retry timing import (2026-10-05)

**Truth level: actual dependency-free source import and existing cleanup-wait consumer migration; tests authored, not run. No L5 dispatch/runtime or SP-02 activation/acceptance claim.** Coordination: #281 / #287; durable idempotency/state-machine ownership remains #313. Stack base: L1 `omp/lios-si02-l1-governed-tool-descriptor` at `3b7aa2e7`.

The complete pinned `packages/retry/src/index.ts`, `packages/retry/src/index.test.ts`, package manifest and root `LICENSE` were inspected at OpenClaw `v2026.9.7`, commit `c074824a27c96d3983043f9eeb33823cd1772d8c`. The implementation has no imports and the package manifest declares no runtime dependencies. Root MIT (Copyright 2026 OpenClaw Foundation) applies; a missing package-level license field is not rejection evidence.

| Imported upstream path | LiOS destination (repository-relative) | Disposition / modifications |
| --- | --- | --- |
| `packages/retry/src/index.ts` timing subset | `src/server/exec/retry-timing.ts` | **IMPORT + ADAPT:** preserve `BackoffPolicy`, `computeBackoff`, `computeBackoffSchedule`, `resolveSleepDelayMs`, `sleepWithAbort` as a coherent timing module; preserve arithmetic, positive jitter, schedule cap, finite-delay floor/clamp, timer ceiling, listener cleanup and `ref:false`; fixed `AbortError` contains no raw reason/cause and never reads `AbortSignal.reason`; simplify Node timer typing/cleanup; include full root MIT notice and exact pin/path header. |
| `packages/retry/src/index.test.ts` selected timing cases | `src/server/exec/retry-timing.test.ts` | Port capped schedules, long-lived exponential cap, cancellation and unref tests from Vitest to `node:test`. Replace upstream raw-cause assertion with secret-safe cancellation; add initial/cap/jitter boundaries, empty schedules, fractional/invalid delays, native timer overflow, listener cleanup and throwing reason-getter checks. |

**Actual current consumer:** `src/server/exec/backends/container-lifecycle.ts` replaces its private delay helper with imported `sleepWithAbort` only for its already-admitted positive integer cleanup wait (1..5000ms). No cancellation signal is passed and `ref` remains true: caller cancellation must not abandon authoritative extinction cleanup. Attempts, container remove/inspect admission and fail-closed absence proof remain unchanged. `src/server/exec/backends/container-lifecycle.test.ts` adds exact delay and attempt-bound coverage. This is a source-level consumer migration, not observed target-execution evidence.

**Authority boundary:** donor `RetrySupervisor`, `retryAsync` / `createRetryRunner` (including default `shouldRetry = true`), retry configuration and thrown-error conversion are deliberately not imported. L5 #313 owns write-ahead/commit/reconciliation facts in the L2 encrypted stream; L1 descriptors and the canonical runtime decide whether a retry is safe. Timing cannot approve, dispatch, replay or write the ledger. Unresolved post-dispatch outcomes remain reconciliation-only. This revises the early L0 assumption that retry timing should be clean-room: actual pinned source fits, with narrow secret-safety changes.

**Retained donor semantics:** `computeBackoff` expects caller-selected numeric policy/attempt values; it is not a retry-policy validator. Zero/invalid sleep delays resolve without consulting cancellation, positive finite delays floor to at least 1ms and cap at 2,147,000,000ms. This abortable timing subset caps long waits; the omitted runner's chunked long `Retry-After` sleep is not imported or claimed.

**Validation handoff (not executed):** from `src/`, parent runs `node --import tsx --test server/exec/retry-timing.test.ts server/exec/backends/container-lifecycle.test.ts`, `npm run check`, `npm run audit:oss`, and `npm run audit:licenses`. Relevant execution integration includes `server/exec/backends/container.test.ts` and `server/exec/run-backend.test.ts`. A real utility smoke and Docker extinction smoke remain parent-owned. No upstream test execution, V1/V2/V3 pass, package proof or SP-02 completion is asserted by this record.
## GM-13 / SI-02.10 — pinned ACP helper import and runtime truth (#315)

**Disposition revisits L0 #298:** prefer actual coherent import, not automatic clean-room ADAPT. At `c074824a27c96d3983043f9eeb33823cd1772d8c`, complete `packages/acp-core/src/runtime/{types,session-identity}.ts`, `types.ts`, `session-lineage-meta.ts`, `error-format.ts` and `structured-auth-redaction.ts` were read, together with normalization dependencies and root LICENSE (MIT, Copyright 2026 OpenClaw Foundation). Exact import/destination paths and modifications are in `third_party/components.json` and `THIRD_PARTY_NOTICES.md`. Retained runtime dependency closure is local TypeScript, Node and existing LiOS zod; only two used normalization functions and identity type declarations are retained. The unused error-coercion re-export is removed; no additional npm runtime is installed.

Complete extension `extensions/acpx/src/{runtime,runtime-proxy,runtime-probe,runtime-process-cleanup,process-lease,process-reaper,session-owner,session-resource}.ts` and both package manifests were inspected. Its actual backend depends on `acpx@0.19.1`, Claude ACP `0.79.0`, Codex ACP `1.12.0`, plugin SDK and filesystem/state machinery. Donor process lifecycle, file session store, host-native `approve-all`, MCP bridges and startup orphan reaping are not imported: those would introduce competing GM-11/P13 authority. This is a bounded import of useful metadata/auth-redaction mechanisms, not a replacement runtime.

- `server/acp/session-binding.ts` attaches a backend locator to an **already admitted** GM-11 `ManagedRun`. Authenticated organization/user/Project/Chat/request tuple owns the attribute; copied external handles cannot look up or resume work. Case/type of opaque LiOS ids is preserved; locator drift fails closed. Cancel fences metadata/output and joins exact native extinction even when hooks fail; raw failure causes and caller abort reasons are never retained.
- `server/acp/runtime-capabilities.ts` is consumed by existing `runtimeFoundation.ts`/P13 RuntimeRegistry. It reports PATH executable presence and local `acpx/runtime` module resolvability without loading third-party code, spawning or network contact. Executable presence never implies protocol verification, authentication or governed coding availability. Inventory descriptor advertises only `coding:runtime-inventory`, no execution adapter.
- Actual host investigation on 2026-10-05: `command -v acpx codex claude cursor-agent` found only `cursor-agent`. CLI presence does not prove ACP support. Parent smoke: from `src`, `npm run coding:runtime` (inventory returns 0); `npm run coding:runtime -- --require-installed` returns 2 when neither executable nor module exists; `npm run coding:runtime -- --require-governed` returns 3 while governed transport is unavailable. Output contains booleans/reason only, not installation paths or credentials.
- Focused parent checks: `node --import tsx --test server/acpRuntime.test.ts server/runtimeFoundation.test.ts`, then `npm run check`. Added tests cover owner/session/request binding, identity drift/snapshot isolation, cancellation/extinction/error secrecy, imported redaction and runtime installation versus availability. Upstream lineage tests were read as reference; no upstream suite or new checks have been exercised by this worker.

**#315 remains open.** Real executable workflow proof requires an installed/licensed user-owned ACP backend in an approved immutable sandbox image, ACP transport connected through GM-11 exact-operation/file/env/working-directory admission and bounded permission requests, L3/L2/L7 run/receipt/cancel ownership, bounded patch proposal + exact user-approved application, approved checks, and reconnect/explicit-resume/drift journey evidence. Installing or describing a host CLI does not meet those prerequisites. No new vendor cloud, provider stack, automatic resume or unrestricted process launch is introduced.
### SI-02.15 / GM-14 — exact placement binding on existing execution targets (#317)

Pinned source: OpenClaw `c074824a27c96d3983043f9eeb33823cd1772d8c` (root MIT, Copyright (c) 2026 OpenClaw Foundation), `src/gateway/node-invoke-placement-grant.ts`, `operator-approval-placement-grants.ts`, and complete `operator-approval-placement-grants.test.ts`. Inspected the `ExecApprovalDecision`, `PluginApprovalPlacementGrantBinding`, `NodeSession`, and worker placement codec closure: donor placement ownership ties session/agent/environment/node/pairing/generation/cwd to current rows, and standing grants die with runtime/parent approval/placement changes. This is **ADAPT**, not an imported donor remote-execution stack.

The user-supplied read-only `/Users/kiran/Downloads/openclaw-main` copies of all three donor files match the exact pinned GitHub archive byte hashes: `node-invoke-placement-grant.ts` SHA-256 `f03740b65f20490cda5fa750c44726273ea510ce27fda3661dc9144a17f30a46`; `operator-approval-placement-grants.ts` `d5b541a982b36ff8ee229f728f013ea90aa40c1fb082d808f25b4e06b03d44fd`; its test `b4646e5a161e1dc7b00fd5ec9e275173bc9224a41b5eca3d52907124fefdea81`. This verifies these files only, not the download's whole-tree commit identity.

`src/server/exec/placement-grant.ts` preserves coherent exact-current binding, retain/consume failure closure, and permanent invalidation after drift. Instead of importing SQLite/Kysely worker tables, a second node registry or the donor's 30-day standing approval cache, it consumes the current GM-11 authority callback and independently approved operation lease. `requestId`, user/Project/Chat ownership, backend, selected node, generation, explicit local endpoint, policy revision, trust posture, data locality and secret locality enter the existing approval digest. Final native launch and interactive input recheck placement; the existing encrypted journal retains that approval digest and rejects cross-owner/request relabeling before journal admission. No schema/store/approval authority is forked.

**Supported target truth:** the current Home/runtime process can select the existing local host backend (truthfully host-access, not sandbox), restricted local Node Permission Model backend (not a remote device), and Docker/Podman container backend at an explicit user-configured local `unix:///` endpoint. The production restricted sandbox terminal consumes container placement only; it never degrades to host execution. Policy/capability mismatch, unavailable target, revocation, generation/node/owner drift or authority failure is terminal denial/failure, not ambient-host fallback. The review card displays selected node, owned endpoint, isolation/trust posture and data/secret locality before approval. The node id `home-runtime:<pid>` describes the actual current process, not a fabricated durable device identity.

**General remote subprocess backend unavailable:** paired GM-09 devices remain ineligible for arbitrary `ExecutionBackend` launch, SSH/cloud shell or cross-Home relocation. Existing exact-approval/resume/native-extinction rules are unchanged. The later SI-06 closed read-only node extension below is not a remote shell backend or a bypass of those rules; it accepts no argv, RPC filename or credential.

Relevant donor regression cases are adapted into `exec/placement-grant.test.ts`: wrong owner, unavailable/unsupported target, policy/capability denial, generation drift, revocation and safe local placement; additional LiOS tests cover actual backend surfaces, scoped secret locality, approval-digest differences, no native dispatch after drift, journal owner binding and strict placement projection schema. Checks are intentionally not run in this worker lane. Parent verification from `src/`: `npm run check`; `node --import tsx --test server/exec/placement-grant.test.ts server/exec/authority/governed-command.test.ts server/exec/authority/governed-command-journal.test.ts server/exec/sandbox-runtime-profile.test.ts`; existing governed terminal V2 / packaged SP-02 journey on the final integrated branch. This record is not Shipping Point acceptance.
### SI-06 closed paired-node capabilities

`shared/remoteNode.ts`, `gatewayRemoteNode.ts`, `remoteNodeWorker.ts` and `remoteNodeFinance.ts` reuse the same paired Gateway and encrypted GM execution journal. The exact owner/device/connection-generation/request/capability binding mechanism is adapted from the pinned OpenClaw placement path above (MIT); no donor database, standing grant cache, second node registry or executor stack is imported.

Only two real synchronous capabilities are available: OS/runtime diagnosis and canonical P6 personal-finance snapshot from a locally configured, explicitly approved user-owned profile. Finance binds exact source id/raw-byte SHA-256, checks owner-only regular-file/no-symlink custody before offering and executing, rejects mixed currencies/unknown account identity, provider FX and stress simulation, and returns aggregate results rather than accounts, paths or credentials. Windows finance fails closed pending ACL qualification. Home verifies device/transport/currentness, not remote hardware or independent financial attestation; outputs are explicitly **remote-reported**.

`node.operation.poll/result` is a strict client-request exchange within one live generation. One admitted operation is released once. Revocation, disconnect or deadline records failed/not-dispatched or failed/outcome-unknown in the existing journal; no new generation resumes it and no Home-host fallback runs. General remote shell, GPU/resource attestation and provider/broker authority remain unavailable.

Parent proof used actual owner-approved signed/pinned TLS clients and a second Node worker process: diagnosis completed; an owned INR profile produced **1200** net worth through `lios.personal-finance.core-v1`, exact input hash and completed encrypted journal, with no raw account export or inference. Source tests exercised stale generations, revocation, timeout, one-shot dispatch, file/hash drift and unsupported operations. This is a two-process local transport/capability journey, not deployed remote-machine or shipping qualification.

## SI-02.14 / GM-14 — pinned CUA policy import, native execution unavailable

Issue #316 remains open. Actual reusable source is imported, not labelled clean-room by default: complete key/coordinate helpers, generation/reference/frame lifecycle, native artifact verifier, complete action vocabulary and risk classification tables are in `src/server/computer/`. Import mappings/modifications/license/dependency boundaries are in `THIRD_PARTY_NOTICES.md`. Imported source and inspected native bridge sources were compared byte-for-byte against raw GitHub files at `c074824a27c96d3983043f9eeb33823cd1772d8c`; an extracted tree's package version was not treated as pin evidence.

Current supported path is policy assessment only: `registerComputerAssessment(existingRegistry, existingKind)` installs `computer.assess` on the supplied L1 registry. It classifies the requested app/window/action/capture scope and blast radius, returns no screen data, mints no grants and explicitly reports `nativeAvailable:false`. There is no second registry/router. Ordinary observations remain read-only; ordinary clicks, typing, app launches, dialog acceptance and all high-risk families remain consequential. Observational classification never itself grants capture. `assertComputerCaptureScope` separately checks declared window/desktop ceiling and current native generation/frame references.

Native admission reuses GM-14's existing `assertBrowserRuntimeIsolationBackend`/`ExecutionBackend` boundary. The local host backend cannot satisfy it; even an isolated capability claim cannot substitute for a qualified native GUI transport. `assertComputerExecutionAvailable` therefore explicitly refuses execution rather than creating a fake backend or silently using host accessibility APIs.

Observed on the owner macOS checkout: `cua-driver` is absent from PATH, `OPENCLAW_CUA_DRIVER_ENDPOINT` is unconfigured, `@trycua/cua-driver` is absent from installed dependencies and no `cua-driver` artifact was found in the LiOS build output search. Native screen/action execution, session cancellation/extinction and persisted GUI receipts are **not delivered or claimed**. #294 owns canonical isolated browser/computer transport; no browser policy, permission authority, conversation runtime or journal was changed here.

Pinned donor macOS runtime requires a signed-app-owned daemon and private Unix endpoint. Its launcher selects unrestricted mode and bypass flags; direct SDK sessions are also unrestricted. LiOS does not import those authority bypasses. Driver 0.28.2's bounded manifest can constrain exact launch-time windows/apps/display, origins and file grants, so scoped manifest-backed execution is a useful native integration target, not evidence of current activation. Before a real scenario: qualify the canonical user-owned isolated transport, exact-operation approval lease/L4, visible capture/input/TCC consent, bounded native grants, file/download grants, cancellable session extinction and canonical receipts. Verify native release dependency rights/notices and actual binary/archive hash before redistribution; upstream MIT source and a published archive hash alone do not establish that qualification.

Regression cases were added but intentionally not run mid-flight: complete action-risk table, raw driver controls/self-approval denial, denied L1 invocation/no execution, honest native refusal, capture-scope ceiling, stale references/frame geometry, key/coordinate bounds and driver version/hash/missing-file/symlink checks. Integration checks: focused `server/computer/computer-policy.test.ts`, existing L1/browser isolation suites and `npm run check`; a real packaged macOS scenario remains blocked on the prerequisites above.


## 52. SI-02 L0 donor-first correction and current dispositions (2026-10-05)

This section corrects the early #298 disposition at the current integrated base `c909da8d`. The useful default is **inspect the complete pinned subsystem, import/reuse coherent source when suitable, then adapt/combine; scratch implementation is last**. There is no blanket clean-room, no-import or ADAPT-only rule. Every source claim below is bounded to OpenClaw `v2026.9.7`, commit `c074824a27c96d3983043f9eeb33823cd1772d8c`, root MIT, Copyright (c) 2026 OpenClaw Foundation. Imported source remains subject to the root MIT notice; external services, data, model weights and native-binary redistribution rights remain separate.

### 52.1 Actual SI-02 imports/adaptations already present

| Outcome | Exact pinned upstream paths | LiOS destinations | Rights and authority boundary |
| --- | --- | --- | --- |
| **IMPORT + ADAPT — retry timing** | `packages/retry/src/index.ts`, `packages/retry/src/index.test.ts` | `src/server/exec/retry-timing.ts`, `src/server/exec/retry-timing.test.ts` | Dependency-free retained timing subset under root MIT. No donor runner, default retry-all predicate, dispatch, ledger or approval authority. |
| **IMPORT + ADAPT — ACP helpers** | `packages/acp-core/src/runtime/{types,session-identity}.ts`, `packages/acp-core/src/{types,session-lineage-meta,error-format,structured-auth-redaction}.ts`, used functions from `packages/normalization-core/src/{string-coerce,number-coercion}.ts` | `src/server/acp/{runtime-types,session-identity,identity-types,session-lineage-meta,error-format,structured-auth-redaction,normalization}.ts` | Root MIT applies to retained source. No `acpx` dependency, donor process/session store, approve-all path, ACP transport or patch authority; metadata attaches only to an already admitted GM-11 run. |
| **ADAPT — exact placement binding** | `src/gateway/{node-invoke-placement-grant,operator-approval-placement-grants}.ts` and selected cases from `operator-approval-placement-grants.test.ts` | `src/server/exec/placement-grant.ts`, `src/server/exec/placement-grant.test.ts` | Root MIT. Exact owner/node/generation/currentness is retained; donor SQLite/Kysely worker state, 30-day standing-grant cache and remote executor are not imported. Existing GM-11 callbacks and real LiOS backend eligibility remain authoritative. |
| **IMPORT + ADAPT — CUA policy/helpers** | `extensions/cua-computer/src/{actions,frame,driver-artifact-verification,node-invoke-policy}.ts`, `src/plugins/computer-use-contract.ts`, test cases from `node-invoke-policy.test.ts` and `driver-artifacts.test.ts`, and `extensions/cua-computer/package.json` artifact metadata | `src/server/computer/{actions,frame,driver-artifact-verification,risk-policy}.ts`, `driver-artifacts.json`, `computer-policy.test.ts` | Retained source is OpenClaw MIT. No `@trycua/cua-driver`, rastermill, native archive/binary or unrestricted launcher is bundled. `computer.assess` is policy-only and reports `nativeAvailable:false`; driver dependency rights/hashes, signing/TCC and isolated transport remain release gates. |

`third_party/components.json` remains the exact machine-readable imported-path/destination/modification authority; `third_party/imported-oss-regression.json` records authored lineage paths, not executed results. `THIRD_PARTY_NOTICES.md` carries the root MIT text and per-import rights boundaries. None of these records claims donor tests passed, native runtime availability, packaging, SP-02 acceptance or release qualification.

### 52.2 L3 agent loop — mechanism adaptation, not source import

The pinned useful loop/admission/steering closure was inspected in `packages/agent-core/src/{agent-loop,agent-stream-response,agent,stream-steering,turn-interruption,internal-hooks,types,validation}.ts`. It provides streamed assistant turns, resolve/prepare/validate/batch-admit/before-call/execute/finalize ordering, sequential or parallel batches, cancellation fences, two-phase ready-call commit/release, queued steering/follow-up ownership, in-flight provider steering and interruption transcript handling. At this pin, `validation.ts` is a facade over `@openclaw/ai/validation`; `beforeToolCall` is optional; parallel execution is the default; and the package loop has neither LiOS's explicit plan phase nor its step/AI/revision budgets.

Current `src/server/agentLoop.ts` has no OpenClaw provenance header and no `packages/agent-core` source mapping in `components.json`; therefore it is **not recorded as a code import**. The current disposition is:

- **Mechanism-level ADAPT:** fail closed before native invocation; validate model-selected tool identity/input through the offered catalogue and canonical governed invoker; recheck cancellation around model/tool boundaries; keep pre-execution and executed outcomes distinct; run calls sequentially; preserve the exact paused call for explicit continuation rather than silently replaying it.
- **LiOS-owned mechanisms:** goal → plan → act → inspect → revise → complete; stable dependency ordering; enforced step/AI-call/revision/wall-clock budgets; L2 durable step/tool-call events; GM-11 exact approval pause/release; same-plan hash-bound resume; `outcome_unknown` reconciliation; secret-safe error summaries; no implicit retry. These are not claimed donor ports.
- **Not adopted at this base:** donor-default parallel batches, optional hooks as permission authority, steering/follow-up queues, in-flight provider steering, transcript-only continuation, injected interruption guidance, and donor tool-loop recovery. Their source remains available for later donor-first evaluation, but absence is not relabelled as an import.

This supersedes #298 language that treated retry and ACP as clean-room by default or implied that no SI-02 donor code had been imported.

### 52.3 Corrected pinned subsystem paths

The stale `src/browser`, broad `src/gateway`, and `src/nodes` subsystem entries did not identify the pinned browser/computer/placement sources. `third_party/components.json` now records:

- browser runtime: `extensions/browser`;
- computer use: `extensions/cua-computer`, `src/plugins/computer-use-contract.ts`, `src/gateway/node-computer-use-descriptor.ts`;
- placement/node policy: `src/gateway/node-invoke-placement-grant.ts`, `operator-approval-placement-grants.ts`, `node-command-policy.ts`, `node-browser-proxy-policy.ts`, `node-agent-cli-runtime.ts`, and `node-catalog.ts`.

Each selected directory/file was resolved directly from the GitHub tree/raw source at the approved commit. This is path verification, not a claim that the whole local download has verified commit identity or that every listed subsystem is imported.

### 52.4 L12 browser donor-first disposition and canonical activation

The canonical L12 implementation is based on integrated candidate `d1c7a0e4`. Inspection covered the pinned browser package manifest and the complete useful worker/session/tab/navigation/transport paths: `bounded-utf8-tail.ts`, `runtime-lifecycle.ts`, `pw-session*.ts`, `session-tab-*.ts`, `navigation-guard.ts`, client request/action transport, bridge/control routes and their dependency closure.

| Browser mechanism | Canonical L12 disposition | Result and authority boundary |
| --- | --- | --- |
| Byte-bounded UTF-8 subprocess diagnostics (`extensions/browser/src/browser/bounded-utf8-tail.ts`) | **DIRECT IMPORT + test adaptation** | Byte-verified at `c074824a` (source SHA-256 `96f185682672dd849d1e4c909681fa8edad8c3a933d9e38cd209a6066207b28b`, test `990555c19b88be78921b45c867c1ecba13f3de8fb0e1c756233fba8c553f0f51`) and imported to `src/server/browser-runtime-pack/`; test ported from Vitest to `node:test`. |
| Runtime stop/invalidate/drain ordering (`runtime-lifecycle.ts`) | **ADAPT** | `browserRuntimePack.ts` cancels the worker, aborts and joins broker tasks, waits for supervisor/native extinction and backend finalization, and never imports donor global server/plugin state. |
| Page ownership and bounded observations (`pw-session-contracts.ts`, session-tab claim/registry/tracking) | **ADAPT** | The fixed worker owns exactly one primary page, closes popup pages, caps links/text/commands/network requests/bytes, disables downloads and binds the adapter to one authenticated Project. Donor SQLite/profile identity/storage are not imported. |
| Navigation and request interception (`navigation-guard.ts`, `pw-session-navigation.ts`) | **ADAPT + COMBINE** | Every HTTPS page/subresource request is intercepted inside the physically `--network=none` container, reauthorized by existing `BrowserConnectorPolicy`, then fetched through the existing P13 DNS-pinned/private-address-denying/bounded host transport. Browser DNS/raw sockets are unavailable. |
| Framed transport (`pw-session-cdp-transport.ts`, typed client request/action paths) | **ADAPT** | A strict-schema newline JSON stdio RPC runs through the exact prepared `ExecutionBackend` plan and canonical supervisor. It has frame/pending/output/page/network/download bounds and no caller-selected CDP endpoint. |
| OpenClaw control HTTP server, profile/config/storage/identity/auth, host Chrome/CDP/extension relay/native launch/fallback, plugin/MCP authority, broad evaluate/upload/cookie/action surfaces | **REJECT_WITH_EVIDENCE for L12 import as a unit; DEFER_WITH_TRIGGER individually** | These paths are mature but either create a second LiOS authority or launch/attach a host/raw-network browser, which cannot satisfy L12's physical deny-network/P13-only egress requirement. Integration difficulty is not the rejection reason. Individual surfaces may be reconsidered only behind the canonical permission/file/session/receipt authorities. |

`agent.browser.navigate` is registered in the existing conversation governed-tool registry with a strict model schema, `user_confirm`, external side-effect classification and no replay. Tenant, Project and source scope come only from the server-held call context; exact input approval remains in `conversationGrantStore`. No client grant, second registry or host Chromium fallback is introduced.

The Linux-arm64 Browser Runtime Pack is now built and exercised in immutable image `sha256:3e66d904f1d3ff33763671de744a823c6cfd28699ef98746179d865004f060e0`: Playwright 1.63.0, open Chromium revision 1243 / 153.0.8010.12, Node 22.12.0 and locked Debian dependencies. The real deny-network rootless worker retrieved the approved HTTPS page through the P13 broker, then cancellation joined shutdown with no surviving `lios-exec` container. Browser admission explicitly bounds 512 MiB memory, 128 tasks, wall time and output; the earlier 64-task ceiling exhausted Chromium's threads. This is runtime/image evidence, not packaged SP-02 acceptance. CfT/Widevine is not distributed; licenses, third-party credits and exact source references remain in the locked inventory/image.

### 52.5 Native restart-resume integration and qualification boundary

The native L3 loop now produces bounded continuations in the existing encrypted L2 journal. A checkpoint-aware Stop parks the run as `interrupted`; restart executes nothing. Explicit owner-scoped resume accepts only `requestId`, rebuilds the current Project/Chat context, checks the plan/tool/policy bindings and revalidates authorization before reopening that same journal record and registering the same run identity.

The binding covers a digest of included Project instructions and the exact initiating chat-message row ID. Missing native binding facts, instruction/context drift, changed attachments, foreign owners and unresolved dispatch outcomes refuse resume. Journal admission precedes initiating-message persistence, preventing concurrent duplicate starts from appending a second objective. An admitted run that cannot be registered is durably finalized as failed.

Unavailable journal storage rejects start admission with `503 / execution_journal_failed`, before a run or initiating message is created. HTTP observation follows the registry's actual lifecycle: ordinary workflow approval ends its SSE response; a pausable native agent keeps observation open for the opaque review event. A read-only approval response must not leave a scripted caller waiting for the HTTP idle timeout.

A restarted confirm-class step proposes a fresh opaque Allow-once review. Its new `tool_call_started` event carries `resumesToolCallId` to the cancelled call of the same step/tool/input; the original call is never reopened. The link survives a crash between abandoning the old call and starting its replacement. L2 validates the link and enforces a single committed external effect per idempotency key. `outcome_unknown` takes precedence over Stop cancellation and is projected as non-resumable reconciliation state.

The packaged SP-02 harness requires an explicit locally available immutable image through `LIOS_SP02_SANDBOX_IMAGE`, exercises a second request-bound Allow-once after explicit resume, and checks exactly-once evidence by idempotency key plus prior-call linkage. Source-text, prompt-wording and component-line-count assertions are not acceptance evidence.

**Owner decision:** keep the real external-effect qualification target; the later “fix all blockers” instruction authorizes closing its missing capabilities, not substituting an internal P4 write or inventing provider evidence. `lios.project.publish_object` now uses the existing S3 SigV4 adapter with atomic `If-None-Match:*`, owner/Project/idempotency-scoped immutable keys, exact target/credential-generation policy binding and provider-state hash reconciliation. Real authenticated SeaweedFS 4.48 qualification proved one initial create, matched same-byte replays, mismatch refusal, one winner under competing concurrent creates and wrong-credential denial. Only direct pre-connect refusal certifies no-effect and permits one cancellable retry. Installed Ollama `llama3.2:3b` produced real inference; the composer now exposes deliberate bounded-agent selection. The complete packaged recovery journey and owner acceptance still require their own evidence.


### 52.6 Darwin capacity truth during qualification

Darwin `os.freemem()` reports only unused pages, not native allocatable/reclaimable capacity. On the qualified 8 GiB Mac it reported about 64 MiB while `/usr/bin/memory_pressure -Q` reported 60% available. The capacity probe now uses that fixed read-only system query, validates physical memory and the bounded percentage, subtracts one percentage point for rounding, and retains the unchanged memory/disk safety reserves and hardware fractions. Malformed/unavailable telemetry falls back conservatively to the old free-page count. Generated assistant package/worktree outputs were reclaimed; no user source or dirty worktree was deleted.

