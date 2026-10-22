# BYOAI provider access terms matrix

**Status:** research evidence, read 2026-10-22 from provider primary pages. Not legal advice; re-verify before shipping any route. Subordinate to `OPENCLAW_AI_ACCESS_ASSIMILATION_DIRECTIVE.md` (GM-12/GM-22). Community claims (including OpenClaw docs) do not set LiOS defaults; only the provider's own text does.

Defaults: **enable** = ship on; **ask-owner** = off until the owner opts in with a visible warning; **disable** = hard-block, runtime must refuse to store or accept the credential.

| Provider | Route | Third-party app permitted? | Source | Data caveat | LiOS default |
|---|---|---|---|---|---|
| OpenAI | API key | Yes | developers.openai.com/api/docs/guides/your-data | No training unless opted in; abuse logs up to 30 days | enable |
| OpenAI | Sign in with ChatGPT (OAuth PKCE) | Yes for open-source / locally hosted apps; paid or remotely hosted need OpenAI approval | developers.openai.com/siwc/quickstart.md | Follows user's ChatGPT workspace retention | ask-owner (local Home only) |
| OpenAI | Codex CLI login / `auth.json` reuse | Unclear | developers.openai.com/codex/auth | Workspace settings | disable; ask-owner |
| Anthropic | API key | Yes | code.claude.com/docs/en/legal-and-compliance | Commercial terms | enable |
| Anthropic | Claude.ai OAuth / Free-Pro-Max credentials | **No** | same page | Consumer terms | **disable** |
| Anthropic | User's own unmodified Claude Code binary | Unclear | same page | Plan terms | disable; ask-owner |
| Google | Gemini API key, paid tier | Yes | ai.google.dev/gemini-api/terms | Not used to improve products | enable |
| Google | Gemini API key, free tier | Yes, not EEA/CH/UK | same page | Content used to improve products; human review | enable with banner; block confidential and licensed-data work |
| Google | Gemini CLI / Code Assist Google login | **No** (names OpenClaw) | geminicli.com/docs/resources/tos-privacy | n/a | **disable** |
| Google | Vertex AI | Yes | Google Cloud terms | Cloud privacy notice | enable |
| GitHub Copilot | OAuth/App user token via Copilot SDK | Yes | docs.github.com Copilot SDK auth | Product-specific terms (not read) | enable (opt-in) |
| GitHub Copilot | Reusing stored CLI/IDE tokens | Unclear | same | n/a | disable |
| Mistral | API key | Yes (no key transfer; no Vibe integration without authorization) | legal.mistral.ai commercial terms | Training default on free plan unverified | enable |
| Mistral | Vibe / Le Chat consumer login | No / unclear | same | Not opted out by default | disable |
| Ollama | Local daemon | Yes | docs.ollama.com | Nothing leaves machine | enable |
| Ollama | Cloud with owner API key | Yes via key | ollama.com/terms | No training on inputs or outputs | enable (owner key) |
| OpenRouter | OAuth PKCE user-controlled key | Yes | openrouter.ai/docs/guides/overview/auth/oauth.md | Depends on upstream; free models highest risk | enable; strictest data policy; warn on free |
| xAI | API key | Yes | docs.x.ai/developers/faq/security.md | No training without permission; 30-day logs | enable |
| xAI | Grok consumer account / CLI | Unclear | x.ai/terms-of-service | Model-improvement toggle | disable |

## Required profile model
Credential kinds: `api_key`, `oauth_siwc`, `oauth_copilot`, `oauth_openrouter`, `local`, `gateway`, `native_cli`. Each profile carries `policyStatus` (permitted | ask-owner | forbidden), `dataUse` (trains | human-review | no-train | unknown), and a spend cap. Hard-block the `anthropic_oauth` and `gemini_cli_oauth` kinds. Block licensed-data and confidential workflows on `trains` or `unknown` profiles unless the owner overrides.

## Gaps in this research
Mistral consumer terms, Copilot general terms, xAI Enterprise terms and the Mistral free-plan training default were not confirmed. OpenAI's SIWC `ext_agent_host_id` requirement is not yet mapped to LiOS code.

## OpenClaw donor findings (pin c074824a27c96d3983043f9eeb33823cd1772d8c, v2026.9.7, MIT)
OpenClaw is not vendored; no AI-access file is imported yet (imports live in `src/server/{acp,exec,computer,browser-runtime-pack}`). Candidate mechanisms to reuse or adapt, each needing the standard provenance header and ported tests:
- **Auth profiles** (`src/agents/auth-profiles/types.ts`, read): credential union `api_key | token | oauth` with SecretRef indirection; closed failure-reason set; per-profile usage stats (cooldownUntil, blockedUntil, disabledUntil, errorCount); per-provider `order` and `lastGood`.
- **Ordering and eligibility** (`order.ts`, read): stored order over config order; a session pin that does not drop failover candidates.
- **Cooldown state machine** (`usage-failure-state.ts`, `model-fallback-cooldown.ts`, read): transient 30s/60s/5min; billing capped exponential 10min to 24h; auth_permanent 10min to 1h; persistent auth failures skip the provider.
- **Reuse the state machine only.** Do not adopt the WHAM usage probe against a private consumer endpoint (directive sections 6 and 20).
- Unread (verify before relying): store/repair/doctor, CLI backends, OAuth managers, model catalog.
