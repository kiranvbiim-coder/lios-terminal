# OpenClaw Primary Donor — AI Access & Assimilation Directive

**Status:** OWNER-APPROVED TECHNICAL DIRECTIVE  
**Effective:** 2026-10-13  
**Canonical parent:** `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md`  
**Execution authority:** `AGENTS.md`, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md`, `docs/technical/SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`  
**Primary owners:** GM-12, GM-22; supporting GM-07, GM-11, GM-13, GM-21, GM-23 and relevant TC/CA/P authorities  
**Approved OpenClaw baseline:** use the exact pin recorded by the canonical OpenClaw assimilation blueprint and donor registry; do not silently substitute fork HEAD.

This directive records the owner decision that LiOS must assimilate OpenClaw's mature user-owned AI access/runtime patterns as completely as is legally, technically and architecturally suitable. It is a subordinate technical directive, not a competing master plan, roadmap, provider registry or product authority.

The goal is not to turn LiOS into an AI-model vendor. Limuria should not operate, proxy or subsidize normal customer model inference. LiOS should make the AI access the user already owns dramatically easier to use.

---

## 1. Core product decision

The narrow interpretation:

> **BYOAI = Bring Your Own API Key**

is superseded by:

> **BYOAI = Bring Your Own AI Access / Entitlement**

A user may power LiOS with any legitimate, user-controlled AI access method that the relevant provider/runtime permits, including:

- existing AI subscriptions/entitlements where officially usable by third-party/local tooling;
- OAuth/account-based access;
- installed provider-native CLIs/runtimes;
- provider free tiers;
- promotional/trial access;
- API keys;
- enterprise AI gateways/accounts;
- local models;
- self-hosted models;
- OpenAI-compatible/custom endpoints.

LiOS orchestrates these routes. LiOS does not become the underlying inference provider.

The target experience is:

```text
Install LiOS
    ↓
LiOS detects AI access already available to the user
    ↓
Connect / Sign in / Use installed runtime
    ↓
Start using LiOS
```

Avoid making the normal user learn API billing before first value.

---

## 2. Primary OpenClaw donor rule

For platform/runtime infrastructure, OpenClaw is the **first implementation donor to inspect** before building an equivalent LiOS subsystem.

For each requirement:

```text
NEW REQUIREMENT
       ↓
Does OpenClaw already solve the mechanism?
       │
   YES │ NO
       │
       ↓
Inspect exact        Inspect other
pinned subsystem     approved donors
       ↓
Can the useful subsystem/mechanism be reused?
       ↓
REUSE
       ↓
ADAPT
       ↓
WRAP IN LIOS CONTRACTS
       ↓
INTEGRATE
       ↓
HARDEN
       ↓
VERIFY
       ↓
SHIP
```

Use the repository-wide donor policy:

> **ANALYZE → DECOMPOSE → REUSE → ADAPT → REPURPOSE → COMBINE → GENERALIZE → INNOVATE → WRAP → BUILD LAST → REJECT ONLY WITH EVIDENCE**

Do not reject a donor mechanism merely because OpenClaw's original product context differs from LiOS.

Do not copy branding, create a second canonical state authority, or ship a thin OpenClaw reskin.

---

## 3. Required AI-access abstraction

LiOS must separate these concepts instead of conflating them:

- **Model** — the logical model/capability the user selects or LiOS routes to;
- **Provider** — the company/service/runtime family;
- **Runtime** — API, OAuth/account session, CLI/native runtime, local server, enterprise gateway, etc.;
- **Authentication profile** — a specific user-owned account/credential context;
- **Entitlement/access type** — subscription, free, trial, local, enterprise, metered API, custom;
- **Routing policy** — priority, permissions, privacy and spend rules;
- **Fallback state** — cooldown, unavailable, rate-limited, expired, disconnected or healthy.

Do not encode assumptions such as:

```text
Claude = Anthropic API
OpenAI = OpenAI API key
```

Instead, support a logical model/provider through multiple permitted runtimes, for example:

```text
Provider / Model family
├── supported account/subscription runtime
├── supported provider-native CLI/runtime
├── API
├── enterprise route
├── local/self-hosted route where applicable
└── custom compatible route
```

Exact availability is provider- and terms-dependent and must be verified at implementation time.

---

## 4. LiOS AI Access Manager target

Evolve the current BYOAI router behind existing LiOS-owned contracts into a unified **LiOS AI Access Manager**. Do not create a duplicate permanent provider registry if current runtime/provider contracts can be extended.

Conceptual structure:

```text
LiOS AI Access Manager
│
├── Subscription / Account Access
│   ├── supported ChatGPT/Codex-style access
│   ├── supported Claude/Claude Code-style access
│   ├── Copilot or similar entitlements
│   └── future provider-supported account access
│
├── Free / Trial Access
│   ├── provider free tiers
│   ├── free model routes
│   └── promotional/trial credits
│
├── API Access
│   ├── OpenAI
│   ├── Anthropic
│   ├── Gemini
│   ├── OpenRouter
│   ├── Groq
│   ├── xAI
│   ├── Mistral
│   ├── Together
│   └── other approved providers
│
├── Local Runtime
│   ├── Ollama
│   ├── LM Studio
│   ├── llama.cpp
│   ├── vLLM
│   └── other local/self-hosted runtimes
│
├── Native / CLI Runtime
│   ├── supported Claude Code runtime
│   ├── supported Codex runtime
│   ├── supported Gemini/provider CLI runtime
│   └── other approved native runtimes
│
└── Custom
    ├── OpenAI-compatible endpoint
    ├── enterprise gateway
    └── user-defined runtime/provider
```

The provider/runtime catalogue is not a promise that every route exists forever. Implement only routes supported by current provider terms and technical interfaces.

---

## 5. Authentication profiles

Assimilate OpenClaw's profile-oriented approach so one provider is not limited to one global credential.

Conceptual example:

```text
OpenAI
├── personal account/subscription profile
├── work account profile
└── API-key backup profile

Anthropic
├── supported subscription/native-runtime profile
└── API-key backup profile
```

Each profile must have explicit:

- provider;
- runtime/access method;
- account/profile identity label;
- entitlement class;
- credential/secret reference;
- model/capability compatibility;
- routing priority;
- health/cooldown state;
- last verified state where safe;
- user-visible disconnect/revoke control.

Multiple profiles exist for legitimate personal/work/enterprise access, explicit account selection and provider-permitted failover. **Do not implement account rotation to circumvent provider limits.**

---

## 6. OAuth/account-based connections

Where a provider officially permits OAuth/account-backed third-party or local-tool access, LiOS should offer a normal **Connect / Sign in** flow rather than defaulting to API-key entry.

Requirements:

- provider login must use the official/approved flow;
- tokens/secrets remain user-controlled and are stored through LiOS SecretRef/OS-protected mechanisms where LiOS must store them;
- the UI clearly identifies the active account and access type;
- sign-out/revoke must be available;
- expired/revoked credentials fail safely;
- provider account login is not the same as LiOS product identity unless explicitly designed by the owning identity contract.

Never:

- scrape provider consumer web applications;
- collect provider passwords;
- steal/reuse browser session cookies;
- reverse-engineer private consumer endpoints;
- bypass subscription restrictions;
- circumvent provider quotas or rate limits.

---

## 7. CLI/native runtime reuse

OpenClaw demonstrates an important pattern: a local product need not force every model interaction through a direct HTTP API when an officially supported local/native runtime already exists.

LiOS must inspect and assimilate this pattern wherever legally and technically supported.

Examples to investigate at implementation time include provider-native tools such as:

- Claude Code;
- Codex;
- Gemini/provider CLIs;
- other approved local agent runtimes.

Preferred behavior:

```text
LiOS
  ↓
Supported installed native/CLI runtime
  ↓
Runtime owns its permitted authentication/session
  ↓
Provider
```

Do not unnecessarily extract, duplicate or forward native runtime credentials when the runtime can own them itself.

A native runtime must still be wrapped by LiOS permission, execution, cancellation, provenance and trust-receipt contracts. Installed software is not automatically authorized for all Projects/data.

---

## 8. Local AI/runtime detection

LiOS should detect supported installed/running AI runtimes and present a consumer-friendly setup flow.

Example:

```text
AI detected on this computer

Claude Code       Installed
Codex             Installed
Ollama            Running
LM Studio         Not detected
Gemini CLI        Installed
```

Detection must be bounded, local and privacy-respecting. Do not scan arbitrary user files or upload discovery data.

The UX should prefer:

> **Use what I already have**

before asking a normal user to manually configure endpoints and environment variables.

---

## 9. Routing and fallback

LiOS must support user-controlled ordering across legitimate access methods.

Default conceptual preference:

```text
1. Existing subscription/account entitlement
2. Free/trial access
3. Local model/runtime
4. Metered API
```

This is a policy template, not a hard-coded universal order. Privacy requirements, task capability, latency, model suitability and enterprise policy may require a different route.

Required user policies:

### Free / already-owned only
Never invoke a metered paid API.

### Ask before metered use
Use subscription/free/local routes automatically when allowed; require explicit confirmation before paid metered API use.

### Allow paid fallback
Use configured metered APIs when higher-priority routes are unavailable and policy permits.

### Custom
User specifies exact provider/profile/runtime/model priorities.

Failures such as rate limits, quota exhaustion, invalid credentials, unavailable runtime and offline state should degrade through permitted fallbacks instead of surfacing raw transport errors where a safe alternative exists.

Fallback must never become quota-circumvention logic.

---

## 10. Cost/access classification

Every AI route should expose an internal access classification such as:

```text
subscription
free
trial
local
enterprise
metered_api
custom
```

This classification drives user-visible spending policy and routing. Do not infer that a consumer subscription covers an API unless the provider officially supports that route.

Where reliable pricing/cost information is unavailable, LiOS must not fabricate a cost estimate.

---

## 11. Free/trial discovery

LiOS may help users discover legitimate provider free tiers, free models and promotional access, but these are not permanent LiOS infrastructure.

Free/trial availability can change. Therefore:

- maintain provider metadata separately from core product logic;
- verify current terms before claiming availability;
- show limits/requirements when known;
- gracefully remove/disable expired offerings;
- do not market LiOS itself as providing free third-party inference.

A future Free AI Directory may expose provider, model, access class, user-connected state, health and reset/limit metadata when the provider exposes that information reliably.

---

## 12. Secrets and privacy

The desired path is:

```text
User-owned credential/session
    ↓
OS secure storage / user-selected vault / provider-native runtime
    ↓
LiOS local runtime
    ↓
AI provider directly
```

Avoid:

```text
User
    ↓
Limuria inference proxy
    ↓
AI provider
```

Normal customer AI inference must not require a Limuria-operated server.

Use/extend existing LiOS SecretProvider/SecretRef authority instead of creating another credential store.

Project data transmission remains governed by LiOS policy. Having a connected AI account does not imply permission to send every Project, file, Artifact, connector result or secret to that provider.

---

## 13. Consumer UX contract

Do not expose technical plumbing by default.

Preferred setup surface:

```text
Power LiOS with your AI

Use AI you already pay for
  ChatGPT / Codex                Connect
  Claude / Claude Code          Connect
  Other supported subscriptions Connect

Use free AI
  Available legitimate free/trial routes

Run AI on this computer
  Ollama / LM Studio / supported local runtimes

API access
  OpenAI / Anthropic / Gemini / OpenRouter / others

Advanced
  Custom compatible endpoint / enterprise gateway / self-hosted runtime
```

Normal chat should show a simple, understandable access indicator such as the provider/account/access class when useful, without turning the composer into a provider-control panel.

Power users may open Advanced Settings for the complete routing/profile configuration.

Product message:

> **LiOS does not sell you AI. It helps you use the AI access you already have.**

And:

> **Start with existing, free or local access. Use metered provider APIs only when you choose to.**

---

## 14. OpenClaw assimilation scope beyond AI access

This owner decision reinforces that OpenClaw is the primary donor/reference for commodity platform/runtime infrastructure, including where suitable:

- AI provider/runtime abstraction;
- authentication profiles;
- OAuth/account connections;
- CLI/native runtime integration;
- subscription/access patterns;
- provider/model/profile fallback;
- local/self-hosted models;
- agent loop;
- tool execution;
- execution sessions;
- PTY/process handling;
- cancellation;
- attach/replay;
- permissions and approvals;
- sandboxing;
- Gateway;
- device identity/pairing;
- mobile/device protocol;
- user-owned remote nodes;
- browser/computer use;
- memory mechanisms;
- skills;
- MCP;
- secret references;
- health checks;
- Doctor/repair flows;
- onboarding;
- background jobs/scheduling where applicable;
- self-hosted/user-owned deployment;
- failure recovery;
- native/mobile/watch architecture.

For each capability, inspect the exact pinned source before implementation and preserve path-level provenance/license evidence for reused code.

---

## 15. LiOS remains the product authority

OpenClaw is the primary infrastructure/runtime donor. It does **not** become the LiOS product/state authority.

LiOS retains canonical ownership of:

- Projects;
- Chats/Conversations;
- Artifacts and revisions;
- conversation state;
- provenance/evidence;
- research workflows;
- deterministic financial engines;
- valuation;
- portfolio/risk;
- entity/security/listing/instrument identity;
- source/data governance;
- professional outputs;
- automation semantics;
- LiOS UI/UX and branding;
- permissions/policy;
- connector/data contracts;
- LiOS memory semantics;
- LiOS trust receipts.

Conceptually:

```text
OpenClaw
Runtime / Agent / Device / Execution Infrastructure
                ↓
         Assimilate & Adapt
                ↓
              LiOS
────────────────────────────────
Projects / Chats / Artifacts
Research / Finance / Data
Provenance / Automation
Professional Intelligence
```

Do not ship an OpenClaw reskin.

---

## 16. Current LiOS gap this directive closes

The current BYOAI implementation already supports multiple API/provider and local routes, including provider API keys, OpenAI-compatible endpoints, Ollama and LM Studio.

However, the existing implementation remains substantially credential/API-centric. This directive makes the following explicit target work:

- subscription/account-based access where officially supported;
- OAuth-first connections where supported;
- provider-native CLI/runtime reuse;
- authentication-profile abstraction;
- model/provider/runtime separation;
- entitlement/access-type classification;
- user-controlled routing priority;
- subscription/free/local-first fallback policies;
- explicit metered-API spending policy;
- automatic detection of supported existing AI runtimes;
- graceful cooldown/recovery/fallback states;
- clean consumer onboarding that hides unnecessary provider plumbing.

This work must extend or consolidate existing LiOS authorities rather than create another AI/provider stack.

---

## 17. Canonical implementation ownership

Do not create a new task family.

Primary mapping:

- **GM-12 — Agent-core and runtime abstraction:** model/provider/runtime/profile separation and runtime integration;
- **GM-22 — BYOAI/local-model expansion:** account/free/API/local access breadth, routing and local models;
- **GM-07 — Secrets/identity/network boundaries:** SecretRef, credential/session custody and user-owned identity boundaries;
- **GM-11 — Execution authority/sandbox/trust receipts:** native runtime/tool authorization and receipts;
- **GM-13 — Codex/ACP and coding execution:** governed coding/native runtime integration where applicable;
- **GM-21 — System Agent/Doctor/repair:** runtime/account discovery, diagnostics and repair;
- **GM-23 — Conversation-first convergence:** simple setup and model/access UX;
- relevant **TC/CA/P** owners for user-facing experience, provider capability depth, deterministic engines, connectors and provenance.

Classify work under the current SI execution phase/workstream and Shipping Point contract. Update issue #192 and active canonical task/PR rather than creating a competing execution board.

---

## 18. Required implementation workflow for agents

Before implementing this directive:

1. read `AGENTS.md`;
2. read the SI execution plan and Shipping Point contract;
3. read `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md`;
4. read this directive;
5. inspect current LiOS BYOAI/provider/runtime implementation;
6. inspect the exact pinned OpenClaw source for the selected mechanism;
7. inspect active issue #192/task/PR ownership to avoid conflicts;
8. record the canonical GM/TC/CA/P owner and SI workstream;
9. record exact donor source path(s), pin, license and destination path(s);
10. define tests and rollback/removal path before import;
11. prefer a complete useful subsystem/package over piecemeal rewriting when fit is strong;
12. integrate through LiOS-owned state, permission, provenance and runtime contracts;
13. update canonical docs/truth registry after verified implementation.

For AI-access work, produce a gap map containing at least:

| Field | Required |
| --- | --- |
| OpenClaw capability/mechanism | Yes |
| Exact donor path + pin | Yes |
| Current LiOS equivalent | Yes |
| Reuse/adapt/repurpose decision | Yes |
| Canonical LiOS owner | Yes |
| Destination paths | Yes |
| Missing behavior | Yes |
| Security/privacy implications | Yes |
| Packaging/provisioning impact | Yes |
| Tests/acceptance | Yes |
| Provider-terms dependency | Yes |

---

## 19. Minimum verification matrix

Any implementation claiming this directive must test the applicable cases, including:

- multiple auth profiles without credential leakage;
- explicit account/profile selection;
- login/connect and logout/revoke;
- expired/revoked credential behavior;
- unavailable native runtime;
- local runtime detection;
- runtime process failure/cancellation;
- offline state;
- rate-limit/quota response;
- allowed fallback;
- forbidden fallback under user policy;
- metered API blocked when policy disallows spend;
- provider-specific capability mismatch;
- secret isolation/redaction;
- Project transmission policy enforcement;
- no raw provider error leakage when a safe user-facing state exists;
- trust/provenance receipt contains model/provider/runtime/profile class as appropriate without exposing secrets;
- packaged desktop behavior on applicable target platforms.

Provider-specific subscription/entitlement tests must use only officially permitted interfaces and accounts.

---

## 20. Hard constraints

Do **not**:

- make Limuria pay for normal customer AI inference;
- introduce a LiOS-hosted general AI proxy/customer inference plane;
- require a central LiOS runtime cloud;
- silently spend through a metered provider API;
- scrape consumer AI websites;
- collect provider passwords;
- steal/reuse browser session cookies;
- reverse-engineer private consumer endpoints;
- circumvent provider rate limits/quotas;
- rotate accounts to evade usage limits;
- claim a consumer subscription can be used programmatically unless the provider officially supports the implemented route;
- create a second model/provider/runtime registry when an existing canonical authority can be extended;
- create a second permission/secret/state authority;
- import fork HEAD without the canonical pin/provenance process;
- let donor branding/trademarks leak into the normal LiOS product;
- claim donor functionality is shipped merely because it exists upstream or in a controlled fork.

---

## 21. Target end state

A normal user should experience:

```text
Install LiOS
      ↓
Sign in / unlock LiOS
      ↓
LiOS detects available permitted AI access
      ↓
Use existing account/subscription
Use free/trial access
Use local AI
Use provider API
Use enterprise/custom runtime
      ↓
User selects or accepts routing policy
      ↓
LiOS chooses an allowed capable route
      ↓
User chats and works normally
```

The user should not need to understand OAuth, CLI, API, endpoint or local-server plumbing unless they open Advanced Settings.

---

## 22. Business/architecture outcome

The intended outcome is:

- Limuria normal customer inference cost remains effectively zero;
- users maximize legitimate AI subscriptions/access they already own;
- legitimate free/trial routes can reduce user cost where available;
- paid API use remains optional and user-controlled;
- LiOS stays provider-neutral;
- LiOS remains local/user-owned;
- model/provider changes do not change the LiOS product identity;
- OpenClaw supplies mature commodity runtime mechanisms where suitable;
- LiOS engineering effort concentrates on differentiated intelligence, research, finance, data, provenance, Artifacts and professional workflows.

Strategic principle:

> **OpenClaw is the primary donor for platform/runtime infrastructure. LiOS builds differentiated intelligence above that layer instead of repeatedly rebuilding mature infrastructure OpenClaw already solves.**

Implementation status must always be stated separately from architectural intent. This document authorizes and requires the direction; it does not by itself claim that every described access route or OpenClaw subsystem is already integrated or shipped.
