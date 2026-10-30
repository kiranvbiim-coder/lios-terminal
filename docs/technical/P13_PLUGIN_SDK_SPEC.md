# P13 Plugin / SDK Ecosystem and Governed External Interoperability

Status: PRE-P14 source implementation/hardening is merged in the current baseline; packaged plugin journeys, full GM-20 convergence and release qualification are not established by that merge. Canonical task IDs are LIOS-P13-01 through LIOS-P13-09.

## Purpose

P13 lets LiOS add connector, tool, artifact-renderer and agent capabilities without rewriting Project, Conversation, Session or Artifact persistence. Extensions enter through the existing RuntimeRegistry and existing LiOS runtime contracts; there is no second plugin registry and no plugin-owned canonical state.

Execution follows `../LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` and `SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md`: SI phases are strategic execution milestones, SP-01–SP-07 require integrated shipping proof, S0–S10 are validation journeys, and CP references remain historical. P13/GM-20 retain singular skills/MCP/plugin authority; GM owns runtime, TC owns visible experience and P14 owns final release. The existing proxy/broker/MCP source is not proof of full agent planning/delegation, OpenClaw agent-core assimilation or all skills/MCP-stack convergence.

The earlier “executable merge gate pending” status is historical, not the current queue: source history records `b655e39d` (2026-09-23, PRE-P14 hardening/gate record) and `7b4c99a5` (2026-09-24, P13 sandbox repair). Those records do not independently establish packaged, live-provider or Shipping Point acceptance; no checks are newly exercised by this reconciliation.

## Public package and SDK contract

The versioned public manifest is defined in `src/shared/pluginSdk.ts`. It freezes plugin identity, semantic version, LiOS compatibility, SDK version, runtime kind, dependency ranges, permissions, connector/tool/artifact/agent contributions, integrity digest and optional Ed25519 signer metadata.

Artifact contributions declare the Artifact kinds they support. This lets LiOS create a safe declarative renderer projection without running plugin-supplied renderer code in the application process.

The developer SDK helpers remain:
- Connector SDK -> ConnectorAdapter.
- Tool SDK -> ToolAdapter.
- Artifact SDK -> ArtifactRendererAdapter.
- Agent SDK -> AgentAdapter.

Those helpers validate author-side adapters against the manifest, but installation does **not** require loading third-party adapter JavaScript into LiOS. Production installation parses package metadata through `definePluginPackageManifest`.

## Proxy-only runtime registration

`src/server/p13PluginManager.ts` never registers third-party executable functions into the canonical RuntimeRegistry.

Instead, LiOS constructs **LiOS-owned proxy adapters** from the validated manifest:
- Connector proxies forward governed operations to the plugin broker.
- Tool proxies forward `tool.invoke`.
- Agent proxies forward `agent.run` and cancellation.
- Artifact projections use LiOS-owned declarative `supports` logic from manifest-declared Artifact kinds.

Executable connector/tool/agent contributions require an isolated invocation broker. Declarative plugins may not smuggle executable connector/tool/agent behavior into the application process.

Installation and updates are transactional. Component collisions roll back cleanly. Removal unregisters LiOS proxies and disposes the plugin broker without rewriting canonical Project, Conversation, Session or Artifact state.

## Compatibility negotiation

LiOS checks min/max host versions and dependency ranges before activation. Supported dependency range forms are exact, caret, tilde, greater-than, greater-than-or-equal, less-than and less-than-or-equal semantic versions.

Missing or incompatible dependencies fail closed before registration. Updates validate reverse dependents and reject dependency cycles.

## Trust, signing, update and revocation

`src/server/p13PluginTrust.ts` hashes the canonical manifest with SHA-256 and binds the signed manifest digest to the observed SHA-256 package digest.

Executable or privileged plugins require a trusted Ed25519 publisher key. Keys and exact package digests can be revoked. Unknown signers, invalid signatures, unobserved or mismatched package digests and revoked packages cannot activate.

P13 does not create a public marketplace and does not silently auto-install third-party code.

## Privileged execution isolation

`src/server/p13PluginHost.ts` builds the Node sandbox launch plan.

The sandbox:
- runs outside the renderer and outside the LiOS application process;
- uses the Node Permission Model for filesystem access;
- denies direct child-process spawning;
- preloads a locked raw-network guard because Node permissions do not govern sockets;
- inherits only a small allowlist of non-secret operating-system environment variables;
- never inherits the full LiOS process environment;
- resolves the plugin install directory and entrypoint through real paths;
- rejects entrypoint symlinks that escape the install directory;
- resolves brokered filesystem paths through real paths and rejects symlink escapes from granted roots.

`src/server/p13PluginBroker.ts` reuses the existing P11 `LepSidecarSupervisor`. Executable Node plugins therefore use the existing LiOS Engine Protocol supervision, lifecycle, timeout, cancellation and sanitized-process model rather than introducing a second process supervisor.

The RuntimeRegistry sees only LiOS proxies. Plugin execution occurs through the broker.

P13's bounded plugin grants and sandbox do not replace SI-01.11 / GM-11 exact-operation authority for general host execution. Privileged interactive `exec.*` stays blocked until that authority, sandbox and trust receipts are proven. Plugin or MCP approval cannot authorize current-scope brokerage execution, copy trading or order writes.

## Network and credential boundary

Raw plugin network access remains denied.

`src/server/p13PluginNetworkBroker.ts` implements the bounded reverse HTTP(S) broker. Plugin code never receives unrestricted sockets. Each broker request is tied to an active supervised execution and declared component, host/port is re-authorized, DNS is resolved and pinned, private/special destinations are rejected, redirects are not silently followed, request/response sizes are bounded, protected/sensitive plugin-supplied headers are denied, and internal broker failures are returned as stable policy errors.

Credential-bearing requests use opaque secret handles resolved only inside LiOS after the destination has passed policy/DNS checks. Raw credentials are never placed in plugin environment variables, manifests or generic plugin IPC payloads.

## Governed LiOS MCP server mode

`src/server/p13McpServer.ts` exposes tools from the same RuntimeRegistry.

MCP exposure requires:
- explicit tool exposure;
- external data-rights approval;
- tenant/project scope;
- explicit user approval when policy requires it;
- no filesystem, secret or internal-state exposure through the exposure contract.

Tool execution errors are redacted at the external MCP boundary; arbitrary internal exception messages are not returned to MCP callers.

## Failure isolation

Compatibility, trust, permissions, broker presence and MCP exposure fail closed.

Failed installs unregister partial proxy state and dispose the candidate broker. Failed updates restore the previous proxy set and keep the previous working broker. Removal disposes the active broker.

A plugin can therefore fail without corrupting Project/Conversation/Session/Artifact state or causing third-party functions to execute inside LiOS core.

## P13 acceptance gate

The merged source must continue to satisfy the following retained subsystem gates; their presence or historical merge record is not proof that every target release has passed:

1. `npm run test:p13`
2. `npm run check`
3. real supervised-process broker proof passes;
4. raw plugin network access is denied;
5. environment secret noninheritance and symlink confinement tests pass;
6. bounded network/credential broker behavior required by shipped connector capabilities is implemented and tested;
7. the normal LiOS hardening workflow runs once at the final merge gate rather than being repeatedly polled.

The required outcome is that a governed connector, tool, artifact renderer or agent can be installed and removed without rewriting core Project, Conversation or Artifact state, while executable privilege, external exposure, compatibility, trust and data rights remain under LiOS control.

For an SP contribution, the canonical issue/PR must define a real Minimum Shippable Journey through governed installation → invocation/denial → result/receipt → removal/update failure recovery, on the applicable packaged/target environment. All five Shipping Point gates apply: real journey, target execution, no fake success, regression protection for accepted behavior, and exact evidence (commit/build, target/topology, journey, checks/outcomes, permission/data-rights/provenance evidence, limits, truth level and next dependency). No SP is marked accepted here. Full GM-20 skills/MCP/multi-agent convergence and P14 release proof require their own evidence beyond the P13 SDK seam.
