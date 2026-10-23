# BYOAI provider access terms matrix

**Status:** research evidence, read 2026-10-22 from provider primary pages. Not legal advice; re-verify before shipping any route. Subordinate to `OPENCLAW_AI_ACCESS_ASSIMILATION_DIRECTIVE.md` (GM-12/GM-22). Community claims (including OpenClaw docs) do not set LiOS defaults; only the provider's own text does.

This table is a **proposed admission policy, not implemented feature status**. “Enable” means eligible for a deliberate user connection after required privacy, entitlement and cost consent—not enabled by default or permission for automatic inference. Unclear or restricted routes stay disabled until provider permission is established; owner approval cannot override provider terms or source licences.

| Provider | Route | Third-party app permitted? | Source | Data caveat | LiOS default |
|---|---|---|---|---|---|
| OpenAI | API key | Yes | developers.openai.com/api/docs/guides/your-data | No training unless opted in; abuse logs up to 30 days | enable |
| OpenAI | Sign in with ChatGPT (OAuth PKCE) | Official quickstart offers plan use to open-source partners and selected private clients; local hosting alone does not establish eligibility. LiOS public source remains proprietary. | [Official quickstart](https://developers.openai.com/siwc/quickstart.md) | Identity scopes alone do not authorize inference or provide API resources; separate consent and eligibility apply. | disabled pending applicable client registration/provider approval |
| OpenAI | Codex CLI login / `auth.json` reuse | Unclear | developers.openai.com/codex/auth | Workspace settings | disable; ask-owner |
| Anthropic | API key | Yes | code.claude.com/docs/en/legal-and-compliance | Commercial terms | enable |
| Anthropic | Claude.ai OAuth / Free-Pro-Max credentials | **No** | same page | Consumer terms | **disable** |
| Anthropic | User-authenticated, unmodified Claude Code binary | Official docs conditionally permit running the unmodified binary in products under commercial terms with each user's own authentication; this does not permit collecting or intermediating Claude subscription tokens. Exact LiOS deployment and CLI integration remain unreviewed. | [Official legal/authentication conditions](https://code.claude.com/docs/en/legal-and-compliance) | User authenticates through Anthropic's own flow; no reselling, proxying account credentials or altered authentication. | deferred pending full applicable terms and deployment review |
| Google | Gemini API key, paid tier | Yes | ai.google.dev/gemini-api/terms | Not used to improve products | enable |
| Google | Gemini API key, free tier | Yes, not EEA/CH/UK | same page | Content used to improve products; human review | enable with banner; block confidential and licensed-data work |
| Google | Gemini CLI / Code Assist Google login | **No** (names OpenClaw) | geminicli.com/docs/resources/tos-privacy | n/a | **disable** |
| Google | Vertex AI | Yes | Google Cloud terms | Cloud privacy notice | enable |
| GitHub Copilot | OAuth/App user token via Copilot SDK | Yes | docs.github.com Copilot SDK auth | Product-specific terms (not read) | enable (opt-in) |
| GitHub Copilot | Reusing stored CLI/IDE tokens | Unclear | same | n/a | disable |
| Mistral | API key | Yes (no key transfer; no Vibe integration without authorization) | legal.mistral.ai commercial terms | Training default on free plan unverified | enable |
| Mistral | Vibe / Le Chat consumer login | No / unclear | same | Not opted out by default | disable |
| Ollama | Loopback local daemon | API use is documented, but a loopback daemon can also forward to cloud models. | [Official authentication and cloud-through-local examples](https://docs.ollama.com/api/authentication.md) | Local endpoint is not proof of local execution, zero cost or no external transmission; verify the actual model and route first. | explicit connection; no local/free/privacy guarantees for remote or unknown execution |
| Ollama | Cloud with owner API key | Yes via key | ollama.com/terms | No training on inputs or outputs | enable (owner key) |
| OpenRouter | OAuth PKCE user-controlled key | Yes | openrouter.ai/docs/guides/overview/auth/oauth.md | Depends on upstream; free models highest risk | enable; strictest data policy; warn on free |
| xAI | API key | Yes | docs.x.ai/developers/faq/security.md | No training without permission; 30-day logs | enable |
| xAI | Grok consumer account / CLI | Unclear | x.ai/terms-of-service | Model-improvement toggle | disable |

## Required profile model
Proposed credential kinds: `api_key`, `oauth_siwc`, `oauth_copilot`, `oauth_openrouter`, `local`, `gateway`, `native_cli`; these are not claims that each route is implemented. Use existing GM-22 profile/vault authorities. Track applicable policy, data-use restrictions and spend consent for each exact profile/model. Never collect or reuse forbidden consumer tokens. Licensed/confidential data requires applicable source permissions and an eligible destination; a user override cannot manufacture a missing licence. A loopback endpoint does not exempt a cloud-backed model from transmission/cost policy.

## Gaps in this research
Mistral consumer terms, Copilot general terms, xAI Enterprise terms and the Mistral free-plan training default were not confirmed. OpenAI's SIWC `ext_agent_host_id` requirement is not yet mapped to LiOS code.

## OpenClaw donor findings (pin c074824a27c96d3983043f9eeb33823cd1772d8c, v2026.9.7, MIT)
OpenClaw is not vendored; no AI-access file is imported yet (imports live in `src/server/{acp,exec,computer,browser-runtime-pack}`). Candidate mechanisms to reuse or adapt, each needing the standard provenance header and ported tests:
- **Auth profiles** (`src/agents/auth-profiles/types.ts`, read): credential union `api_key | token | oauth` with SecretRef indirection; closed failure-reason set; per-profile usage stats (cooldownUntil, blockedUntil, disabledUntil, errorCount); per-provider `order` and `lastGood`.
- **Ordering and eligibility** (`order.ts`, read): stored order over config order; a session pin that does not drop failover candidates.
- **Cooldown state machine** (`usage-failure-state.ts`, `model-fallback-cooldown.ts`, read): transient 30s/60s/5min; billing capped exponential 10min to 24h; auth_permanent 10min to 1h; persistent auth failures skip the provider.
- **Reuse the state machine only.** Do not adopt the WHAM usage probe against a private consumer endpoint (directive sections 6 and 20).
- Unread (verify before relying): store/repair/doctor, CLI backends, OAuth managers, model catalog.
