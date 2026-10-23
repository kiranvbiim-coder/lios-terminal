# GM20 MCP evidence release — D1 backend boundary

This document describes the **implemented draft-branch behavior**, not an accepted installed-desktop or SP/P14 feature.

## Separate authorities

1. **Tool execution** requires the existing GM-11a owner review (one-time or permitted Project), live run identity, L5 external-dispatch ledger, and the Project's explicitly allowlisted MCP tool.
2. **AI observation transmission** is a different consent and source-use decision. It is denied by default for all existing MCP connections, even after the tool executes successfully.
3. To opt in at source configuration level, the authenticated owner must explicitly set both `config.aiTransmission = "allow"` and `config.aiUsageRights = "cleared"`. The second field is the owner's assertion of lawful AI-use rights, **not** independent LiOS certification of licensing. No automatic migration enables either field.
4. The conversation must also allow resource references, choose a Project-capable source scope, and pass the existing BYOAI organization/provider transmission policy. An active Research Artifact's `only_refs` policy must explicitly include `mcp-server:source:<connection id>`.
5. The **current** source connection is checked twice, before building a model observation and again immediately before sending it to a model. Owner, org, Project, config revision, status, source rights, credential availability and active research selection all fail closed if changed. Credential rotation under the **same vault reference** also invalidates the earlier observation through an ephemeral HMAC generation marker whose key never enters the model, journal or receipt.

## Data custody

- Only one plain-text MCP content item, at most 4 KiB, without detected credentials or control characters, is eligible. Images, multiple items, error outputs and larger content are not model observations.
- The run holds selected material **ephemerally**. L2 ledger/checkpoint contains only generic success status and stable source refs, not the passage. The model sees a bounded, clearly labelled **untrusted data** frame with source ref and SHA-256 content hash, not a claim of verified fact.
- Identical captures are deduplicated, at most three admissions per review, at most 100 cumulative evidence refs across research and MCP.
- Stop, permission change, source removal/rotation or explicit transmission disablement prevents admission or causes a fail-closed pre-transmission refusal.

## Remaining acceptance

Joined GM-11a owner approval + real Project/Chat source + actual installed MCP + native cross-platform P14 tests are still required. Owner rights must be exposed through a separate, reviewed installation/consent flow by the UI/UX owner; no UI is added here. Model prompt-injection defenses are not mathematically absolute; MCP excerpts are always untrusted and no authorization authority is derived from their text.

**Current PR:** #121. **Do not merge** on code presence or source-only CI alone.
