# LiOS V4 P4 Enterprise Runtime Runbook

> **Superseded in part (2026-10-02).** This document was written for the earlier LiOS-hosted model. Since GM-07 a customer install contacts no LiOS service: identity is local, entitlement is a vendor-signed licence file, billing/credits/webhooks are gone from the product, and there is one auth stack and one web bundle. Where this text describes a hosted control plane, Paddle billing, a credit wallet, `LIOS_CONTROL_PLANE_URL`, `/api/client/auth/{login,logout,me,register}` or `/client-terminal/`, read `docs/technical/OPENCLAW_ASSIMILATION_BLUEPRINT.md` §40–§45 instead.

> **Authority:** `AGENTS.md`, `docs/LIOS_SUPER_INTELLIGENCE_EXECUTION_PLAN.md` and `SUPER_INTELLIGENCE_SHIPPING_POINT_CONTRACT.md` govern SI-01–SI-07 and SP-01–SP-07. S0–S10 are validation journeys; CP phases are historical. GM/TC/CA/P owners remain singular, P14 remains final release authority, and privileged `exec.*` stays blocked pending GM-11. V4/LV4 IDs are frozen historical evidence identifiers, not new task namespaces.

**Scope:** V4-24 Enterprise runtime hardening on top of the merged P0-P3 baseline.  
**Trust boundary:** Home owns `/api/auth/*`, local identity, the local trial clock and imported vendor-signed licence verification; identity, entitlement and data ownership are distinct. There is one auth stack and one build. Optional enterprise federation, policy, vault and private infrastructure are user/organization-operated, never a LiOS customer runtime.

## 1. What P4 implements

The recorded P4 baseline describes these security contracts. Current use is limited to supported user-operated enterprise deployments and requires exact-target evidence; this list is not fresh runtime certification:

- OIDC authorization-code SSO with PKCE, state, nonce, discovery and JWKS signature validation.
- SAML SP initiation with a deployment-owned hardened assertion-verification service.
- Browser-to-desktop one-time SSO authorization for the customer desktop.
- Domain/seat/license-aware enterprise user provisioning.
- Encrypted organization-vault custody for enterprise SSO/private-deployment secrets.
- Enterprise AI provider/model/external-data/approval/private-endpoint enforcement at the actual BYOAI invocation boundary.
- Enterprise legal hold enforced by scheduled retention, explicit organization purge and export-custody deletion.
- Private-cloud/isolated deployment verification through an authenticated nonce/timestamp/HMAC challenge.
- Admin-only runtime readiness, credential setup and verification surfaces.
- Regression tests for all of the above.

P4 does **not** fabricate production evidence. A real IdP, SAML verifier, private endpoint, signing material and live organization configuration remain deployment evidence.

## 2. Hosted configuration

Historical heading retained for links; current configuration is user-operated:

Desktop Local / Home does not require `DATABASE_URL`, a vendor vault or a control-plane URL. Use local protected secrets and Home authentication; a user-owned PostgreSQL/IdP/private service is an advanced deployment choice, not a normal-install prerequisite.

The earlier hosted deployment used `DATABASE_URL`, `SESSION_SECRET`, `LIMURIA_CREDENTIAL_STORE=organization`, `LIMURIA_HOSTED_VAULT_SECRET` and `LIOS_CONTROL_PLANE_PUBLIC_URL` (with `LIOS_PUBLIC_APP_URL` fallback). These names are historical configuration evidence, not instructions to provision a LiOS service or embed vendor URLs. For supported user-operated federation, bind callbacks to the user's actual Home/deployment origin and verify its current configuration contract.

Where the supported SAML integration is selected, its approved user/organization-operated verifier configuration was recorded as:

```text
LIOS_SAML_VERIFIER_URL=https://approved-saml-verifier.example.com/verify
```

Never place OIDC client secrets, SAML verifier secrets or private deployment tokens in the desktop build.

## 3. Organization SSO policy

Enterprise policy remains the source of truth for:

- `sso.mode`: `disabled | oidc | saml`
- `sso.status`: `not_configured | contract_only | ready | blocked`
- issuer
- client/entity ID
- authorization/SSO URL where applicable
- whether external provisioning is allowed
- permitted organization email domains
- seat limit

The user-operated organization vault's recorded P4 credential names are:

```text
enterprise_sso_client_secret
enterprise_saml_verifier_secret
enterprise_private_deployment_token
```

Admin APIs return only readiness booleans and blockers. They never return secret values.

## 4. OIDC security contract

LiOS:

1. discovers `/.well-known/openid-configuration` from the configured issuer;
2. rejects discovery issuer mismatch;
3. creates cryptographically random state, nonce and PKCE verifier;
4. uses S256 PKCE;
5. exchanges the authorization code only at the discovered token endpoint;
6. validates the ID-token signature against the discovered JWKS;
7. rejects `alg=none` and unsupported signing algorithms;
8. checks issuer, audience, authorized party when required, nonce, expiration and issue time;
9. provisions/updates a LiOS client identity only after successful validation;
10. rotates the LiOS session before login;
11. enforces organization, domain, seat and license state.

The optional OIDC client secret is encrypted in the organization vault. Public-client PKCE flows can operate without it when the configured IdP permits that model.

## 5. SAML security contract

LiOS generates an SP-initiated AuthnRequest without depending on the pre-redirect browser session for the HTTP-POST callback. This is deliberate: a SAML IdP commonly returns by cross-site POST, where a `SameSite=Lax` session cookie may be absent.

Each SAML start creates a ten-minute server-side `enterprise_saml_requests` row containing only organization ID, request ID, safe return path, optional desktop authorization linkage, lifecycle state and timestamps. RelayState carries only `version + request ID + expiry + HMAC`; the HMAC is produced with the organization's vaulted SAML verifier secret. The ACS authenticates RelayState, atomically claims the request, requires strict `InResponseTo`, and consumes the request once a signed assertion is accepted. Replays are rejected before a second verifier call. The generic CSRF middleware exempts only the exact numeric SAML ACS route because the ACS is intentionally cross-site and has these stronger protocol-specific controls.

LiOS deliberately does **not** implement XML-DSig validation with ad-hoc application code. The ACS sends the raw SAML response and expected issuer/audience/ACS/request ID to the approved verifier service. The request body is authenticated with:

```text
X-LiOS-SAML-Signature-SHA256 =
  HMAC-SHA256(organization_saml_verifier_secret, raw_json_body)
```

The verifier must validate, at minimum:

- XML signature and certificate trust;
- assertion/status success;
- issuer;
- audience;
- ACS/recipient;
- `InResponseTo` when present;
- NotBefore/NotOnOrAfter;
- replay prevention;
- subject/email identity.

It returns only the verified identity envelope required by LiOS. LiOS then applies its own organization/domain/seat/license policy.

## 6. Desktop SSO handoff

The desktop never receives an IdP token or SAML assertion.

Historical handoff protocol (not the normal Home sign-in path, and not a requirement to contact a vendor service):

1. User chose organization SSO using a work email.
2. The earlier deployment used `POST /api/client/auth/sso/device/start`; this legacy namespace does not replace Home `/api/auth/*`.
3. The federation service discovered the organization from an existing user or exact configured domain.
4. It created:
   - random request ID;
   - random one-time verifier returned once to the desktop;
   - SHA-256 verifier hash stored server-side;
   - ten-minute expiry.
5. Desktop opens the returned HTTPS verification URL in the system browser.
6. Browser completes OIDC/SAML.
7. The federation callback marked the request approved for the verified user.
8. Desktop polls using request ID + one-time verifier.
9. The first valid approved poll atomically moved `approved -> consumed`; the earlier hosted session/device/offline-lease projection is historical, not current Home entitlement authority.
10. Replay is rejected.

In a supported user-operated federation deployment, expired authorization rows must be removed by its verified lifecycle control. Raw verifiers must never be persisted. Do not infer the old hosted handoff is migrated or qualified merely from these contracts.

## 7. Enterprise AI runtime enforcement

A stored enterprise policy must be enforced at `invokeAIProvider` before external calls, under the selected Home/user-operated deployment authority. The earlier five-minute hosted projection and 24-hour outage reuse window are historical and are not vendor-contact prerequisites or permission to reuse stale policy. The renderer never receives enterprise secrets. Missing authoritative policy must fail closed for policy-governed AI; establish and verify policy through the user's supported deployment, not a LiOS control plane.

LiOS blocks a call when any applicable rule denies it:

- provider not allowed;
- model not allowed;
- `local_only` policy with a remote provider;
- organization data sent externally while `allowExternalData=false`;
- missing explicit per-call approval while `requireApproval=true`;
- `configured_private` mode when the runtime OpenAI-compatible endpoint does not match the approved private endpoint origin.

Organizations without a stored enterprise policy retain the standard BYOAI behavior.

## 8. Legal hold and export custody

When `retention.legalHold=true`:

- scheduled production expiry does not delete that organization's diagnostics, relay metadata, export custody receipts or deletion receipts;
- explicit operational metadata purge returns a durable `blocked` deletion receipt and deletes nothing;
- export custody tombstoning returns HTTP 423 / `enterprise_legal_hold`.

Ephemeral SSO device authorization tickets are security material, not business records, and are still removed after expiry.

Export bytes remain under user custody. Where a supported user-operated receipt store exists, it holds only format, byte size, artifact-name hash, file hash and lifecycle metadata; no central vendor receipt is required. Legal-hold precedence and HTTP 423 behavior above remain required for the applicable enterprise deletion paths, not proof that every Home topology implements those paths.

## 9. Private deployment verification

For `private_cloud` or `isolated` modes, configure the private health endpoint in enterprise policy and store `enterprise_private_deployment_token` in the organization vault.

LiOS sends:

```text
X-LiOS-Organization-Id
X-LiOS-Deployment-Timestamp
X-LiOS-Deployment-Challenge
X-LiOS-Deployment-Signature-SHA256
```

Request signature:

```text
HMAC-SHA256(token, organizationId + ":" + timestamp + ":" + challenge)
```

The endpoint must return the same challenge and:

```text
X-LiOS-Deployment-Signature-SHA256 =
  HMAC-SHA256(token, "ok:" + organizationId + ":" + timestamp + ":" + challenge)
```

A 2xx response without the authenticated challenge is **not** accepted as verified.

## 10. Acceptance evidence

Code acceptance requires the authoritative LiOS Quality Gate to pass:

- typecheck;
- server/client offline tests;
- trust/security contracts;
- provider contracts;
- deterministic Python suite;
- live PostgreSQL tenant isolation;
- production build;
- release preflight.

Production enterprise evidence is separate and must be dated:

- real OIDC login and desktop handoff;
- real SAML login when SAML is offered;
- external provisioning/seat/domain rejection cases;
- legal-hold deletion-block evidence;
- approved AI-provider and denied-provider evidence;
- private endpoint challenge verification where applicable;
- encrypted-vault configuration confirmation without exposing secret values.

These checks alone do not accept a Shipping Point. Applicable SP-01–SP-07 require a real MSJ, packaged/target execution, explicit unavailable/denied states without fake success, regression protection and exact commit/build/topology/check/outcome/limitations evidence. No Shipping Point is accepted by this document.

## 11. Rollback

P4 is additive. To roll back application code:

1. disable enterprise SSO policy (`sso.mode=disabled`) or mark it `blocked`;
2. disable private deployment policy if applicable;
3. deploy the previous green application release;
4. preserve migration `0060_enterprise_sso_device_authorization.sql`; do not drop the table during rollback;
5. allow short-lived device authorization rows to expire/purge;
6. do not delete organization policies, vault credentials, local customer workspaces or P3 retention evidence as part of an application rollback.

If identity configuration itself is compromised, rotate the relevant IdP/client/verifier/private-deployment secret before re-enabling the integration.
