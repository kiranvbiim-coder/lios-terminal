# LiOS Local / User-Owned Infrastructure Boundary

Supporting technical detail for the local-first/user-owned rules in [LIOS_ARCHITECTURE.md](../LIOS_ARCHITECTURE.md) and the [OpenClaw Assimilation & User-Owned Runtime Blueprint](OPENCLAW_ASSIMILATION_BLUEPRINT.md).

**Owner lock — 2026-10-02:** LiOS operates **no customer runtime cloud/server**. Cloud use is allowed, but infrastructure ownership, credentials, bills, retention and operational responsibility remain with the user or their organization.

## Boundary principle

> **LiOS is deployable software, not a hosted intelligence service.**

A user may run LiOS:
- entirely on one desktop;
- on a local server/NAS;
- across multiple personal machines;
- in their own AWS/Azure/GCP/VPS/Kubernetes environment;
- in enterprise/private infrastructure.

LiOS does not require a vendor-operated data/control/runtime plane for conversations, Projects, Artifacts, memory, execution, storage, mobile connectivity, data sources or AI inference.

## Desktop Local default

A clean installation must be useful without external infrastructure:

- embedded PGlite for canonical LiOS data;
- local filesystem/workspace for user files/artifacts;
- OS-protected local secret custody;
- local Gateway;
- local execution;
- local caches/indexes;
- optional user-selected remote/local AI and data providers.

Users may select another local drive, external SSD or mounted NAS. LiOS must handle unavailable removable storage safely.

The canonical DataRoot resolver (`src/dataRootCore.cjs`) chooses `LIOS_DATA_ROOT`, legacy `LIMURIA_DATA_DIR`, saved selection, then `~/.limuria-terminal` for production or `<cwd>/data` for development. PGlite normally lives at `<DataRoot>/pgdata`, with legacy direct-directory layouts recognized. One live owner may use a PGlite directory; unavailable previously initialized roots must fail closed rather than create empty state. User PostgreSQL is an advanced canonical database target, not another state authority.

## User-owned cloud/server mode

Advanced users may move or deploy LiOS Home to their own:
- PostgreSQL;
- S3-compatible storage;
- Azure/GCS;
- NAS/MinIO/WebDAV;
- Linux/Windows/macOS server;
- Docker/Podman/Kubernetes;
- cloud VM;
- enterprise infrastructure.

LiOS supplies software, adapters, migration and diagnostics. LiOS does not supply or pay for the infrastructure.

## Customer data that never requires LiOS custody

- Projects and conversations;
- uploaded/private files;
- artifacts/exports;
- memory/indexes;
- analytical state;
- source payloads/caches where permitted;
- database credentials;
- AI/API credentials;
- terminal/execution output;
- browser/computer-use state;
- backups;
- device/node state except local/user infrastructure state.

## External commercial/distribution services

Commerce, app stores, code signing, signed-licence issuance/import, release distribution and update metadata are distinct from customer runtime. Their narrow services must not become a customer data/intelligence path; imported vendor-signed licences are verified locally rather than requiring a generic runtime vendor API.

Normal customer intelligence/data operation must not depend on a vendor runtime endpoint. Any distribution/commercial network operation must be narrow and inspectable.

## BYOAI boundary

- The user/organization chooses the model/provider.
- Remote provider billing belongs to the user's account.
- Local providers such as Ollama/LM Studio/llama.cpp/vLLM remain valid first-class routes.
- LiOS must not silently substitute another external provider for a strict user selection.
- AI is optional where deterministic/non-generative capability can operate without it.
- Data transmission to a model follows source/Project/organization policy.

## BYOD boundary

A connector distinguishes:
1. authentication/secret reference;
2. endpoint/provider identity;
3. retrieved payload;
4. normalized LiOS observations;
5. derived deterministic outputs;
6. cache/retention policy;
7. provenance/entitlement.

External DB connectors are read-only by default. User credentials remain in user-controlled secret providers.

Home server egress currently guards `fetch` and `node:http`/`node:https` request/get through `src/server/egressPolicy.ts`, installed during server startup. The open/allowlist/offline modes and metadata blocking do not constitute a whole-process sandbox: raw sockets, browser/native processes and database drivers require separate permission/network controls. Connector SSRF, redirect and credential-forwarding safeguards remain mandatory independently of this guard. Source integration is not fresh packaged security evidence.

## Storage boundary

LiOS storage is provider-based:
- local filesystem by default;
- user-owned object/NAS/cloud providers optionally.

When client-side encryption is enabled, encrypt before handing bytes to the provider.

Do not use live file-sync of an active database as a backup/synchronization mechanism. Create a consistent LiOS snapshot first.

## Backup boundary

Backups go only to user-selected destinations. A backup must be consistent, integrity-verifiable and restore-tested. Users may choose local disk, external disk, NAS or their cloud/object storage.

## Secrets boundary

Configuration stores secret references, not raw secret values. Supported/target custody includes OS keychain, encrypted local vault, environment, 1Password, HashiCorp Vault, external command and governed plugins.

## Mobile/device boundary

Mobile/watch clients connect to the user's LiOS Home/Gateway. They do not require a LiOS SaaS account/data server for runtime.

Desktop-local Home may be unavailable while asleep/offline; mobile must show cached/queued state honestly. Users requiring 24/7 access can run Home on an always-on machine/server they control.

## Apple notification boundary

LiOS will not operate a push relay. Use direct connection, Apple-native/private signaling where applicable, local enterprise mechanisms or user-managed infrastructure. Where iOS background restrictions prevent guaranteed wake without publisher-operated APNs infrastructure, document the limitation rather than introduce a hidden LiOS server.

## Identity

Single-user local installations use Home-owned local owner identity; team/enterprise deployments may federate user/organization identity such as OIDC/SAML/Entra/Okta/Google Workspace under the approved deployment contract. Human identity, device identity, subscription and effective entitlement are distinct. One `/api/auth/*` stack, API authority and web build retain server/main-process role gates; UI hiding or separate legacy audiences cannot substitute for authorization.

## Portability

Users must be able to migrate LiOS Home and export their state. Local storage, user PostgreSQL and user object storage are deployment choices, not lock-in boundaries.

## Review rule

Every new feature that communicates off-device must document:
- destination and owner;
- exact data sent;
- why it is required;
- credential custody;
- retention/caching;
- offline behavior;
- failure behavior;
- whether the endpoint is user-selected, public data, commerce/update infrastructure or another category.

If a feature requires a new LiOS-operated customer runtime service, redesign it for user-owned infrastructure before implementation.

Privileged interactive `exec.*` stays blocked until GM-11 exact-operation authority, sandbox and trust receipts are proven. The SI Shipping Point contract requires real integrated MSJs, applicable target execution, no fake success, protected accepted behavior and exact evidence; this boundary specification does not claim SP acceptance. P14 remains final release authority.
