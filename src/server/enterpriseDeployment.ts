import crypto from "node:crypto";
import { getEnterprisePolicy } from "./enterprisePolicyService";
import { getOrganizationCredential } from "./organizationCredentialVault";

export const ENTERPRISE_PRIVATE_DEPLOYMENT_CREDENTIAL = "enterprise_private_deployment_token";

export interface EnterpriseDeploymentReadiness {
  organizationId: number;
  mode: "local" | "hosted" | "private_cloud" | "isolated";
  policyStatus: "local_ready" | "external_setup_required" | "ready" | "blocked";
  configured: boolean;
  endpointOrigin: string | null;
  credentialConfigured: boolean;
  blockers: string[];
}

export interface EnterpriseDeploymentVerification extends EnterpriseDeploymentReadiness {
  verified: boolean;
  verifiedAt: string | null;
  statusCode: number | null;
  latencyMs: number | null;
  challengeMatched: boolean;
}

function endpointUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local && parsed.protocol === "http:")) return null;
    if (parsed.username || parsed.password || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function getEnterpriseDeploymentReadiness(organizationId: number): Promise<EnterpriseDeploymentReadiness> {
  const record = await getEnterprisePolicy(organizationId);
  if (!record) throw new Error("Organization not found.");
  const policy = record.policy.deployment;
  const endpoint = endpointUrl(policy.privateEndpointUrl);
  const token = await getOrganizationCredential(organizationId, ENTERPRISE_PRIVATE_DEPLOYMENT_CREDENTIAL);
  const blockers: string[] = [];

  if (policy.mode === "local") {
    return {
      organizationId,
      mode: policy.mode,
      policyStatus: policy.status,
      configured: true,
      endpointOrigin: null,
      credentialConfigured: false,
      blockers,
    };
  }

  if (policy.mode === "hosted") {
    const hosted = process.env.LIOS_HOME_PUBLIC_URL?.trim();
    if (!hosted) blockers.push("LIOS_HOME_PUBLIC_URL is not configured for a Home-hosted enterprise deployment.");
    return {
      organizationId,
      mode: policy.mode,
      policyStatus: policy.status,
      configured: blockers.length === 0,
      endpointOrigin: hosted ? endpointUrl(hosted)?.origin ?? null : null,
      credentialConfigured: false,
      blockers,
    };
  }

  if (!endpoint) blockers.push("A valid HTTPS private deployment health endpoint is required.");
  if (!token || token.length < 24) blockers.push("Private deployment verification credential is not configured.");
  if (policy.status === "blocked") blockers.push("Enterprise deployment policy is explicitly blocked.");

  return {
    organizationId,
    mode: policy.mode,
    policyStatus: policy.status,
    configured: blockers.length === 0,
    endpointOrigin: endpoint?.origin ?? null,
    credentialConfigured: Boolean(token && token.length >= 24),
    blockers,
  };
}

export async function verifyEnterpriseDeploymentEndpoint(
  organizationId: number,
  now = new Date(),
): Promise<EnterpriseDeploymentVerification> {
  const readiness = await getEnterpriseDeploymentReadiness(organizationId);
  if (readiness.mode === "local" || readiness.mode === "hosted") {
    return {
      ...readiness,
      verified: readiness.configured,
      verifiedAt: readiness.configured ? now.toISOString() : null,
      statusCode: null,
      latencyMs: 0,
      challengeMatched: readiness.configured,
    };
  }
  if (!readiness.configured) {
    return {
      ...readiness,
      verified: false,
      verifiedAt: null,
      statusCode: null,
      latencyMs: null,
      challengeMatched: false,
    };
  }

  const record = await getEnterprisePolicy(organizationId);
  const endpoint = endpointUrl(record!.policy.deployment.privateEndpointUrl);
  const token = await getOrganizationCredential(organizationId, ENTERPRISE_PRIVATE_DEPLOYMENT_CREDENTIAL);
  if (!endpoint || !token) throw new Error("Private deployment verification configuration changed during verification.");

  const challenge = crypto.randomBytes(24).toString("base64url");
  const timestamp = now.toISOString();
  const requestSignature = crypto.createHmac("sha256", token)
    .update(`${organizationId}:${timestamp}:${challenge}`)
    .digest("hex");
  const started = Date.now();

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-LiOS-Organization-Id": String(organizationId),
        "X-LiOS-Deployment-Timestamp": timestamp,
        "X-LiOS-Deployment-Challenge": challenge,
        "X-LiOS-Deployment-Signature-SHA256": requestSignature,
      },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return {
      ...readiness,
      verified: false,
      verifiedAt: null,
      statusCode: null,
      latencyMs: Date.now() - started,
      challengeMatched: false,
      blockers: [...readiness.blockers, "Private deployment endpoint could not be reached."],
    };
  }

  const latencyMs = Date.now() - started;
  const responseChallenge = response.headers.get("x-lios-deployment-challenge");
  const responseSignature = response.headers.get("x-lios-deployment-signature-sha256");
  const expectedResponseSignature = crypto.createHmac("sha256", token)
    .update(`ok:${organizationId}:${timestamp}:${challenge}`)
    .digest("hex");
  const challengeMatched = responseChallenge === challenge
    && typeof responseSignature === "string"
    && responseSignature.length === expectedResponseSignature.length
    && crypto.timingSafeEqual(Buffer.from(responseSignature), Buffer.from(expectedResponseSignature));
  const verified = response.ok && challengeMatched;

  return {
    ...readiness,
    verified,
    verifiedAt: verified ? now.toISOString() : null,
    statusCode: response.status,
    latencyMs,
    challengeMatched,
    blockers: verified
      ? readiness.blockers
      : [...readiness.blockers, response.ok ? "Private deployment challenge response was not authentic." : `Private deployment endpoint returned HTTP ${response.status}.`],
  };
}
