import { z } from "zod";

export const liosUserRoleSchema = z.enum([
  "internal_admin",
  "internal_analyst",
  "internal_compliance",
  "client_admin",
  "client_user",
]);

export const liosAudienceSchema = z.enum(["internal", "client"]);

export const identityPrincipalSchema = z.object({
  version: z.literal(1),
  kind: z.literal("human"),
  userId: z.number().int().positive(),
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1),
  role: liosUserRoleSchema,
  audience: liosAudienceSchema,
  organizationId: z.number().int().positive().nullable(),
}).superRefine((principal, ctx) => {
  const clientRole = principal.role === "client_admin" || principal.role === "client_user";
  if (clientRole && principal.audience !== "client") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Client roles require the client audience.", path: ["audience"] });
  }
  if (!clientRole && principal.audience !== "internal") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Internal roles require the internal audience.", path: ["audience"] });
  }
  if (clientRole && principal.organizationId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Client principals require an organization.", path: ["organizationId"] });
  }
  if (!clientRole && principal.organizationId !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Internal principals cannot inherit a client organization implicitly.", path: ["organizationId"] });
  }
});

export const organizationIdentitySchema = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1),
  lifecycleStage: z.enum(["trial", "client", "churned"]),
  status: z.string().trim().min(1),
});

export const deviceIdentitySchema = z.object({
  fingerprintHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["authorized", "pending", "revoked"]).nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
});

export const ownershipScopeSchema = z.object({
  ownerUserId: z.number().int().positive(),
  organizationId: z.number().int().positive().nullable(),
});

export const entitlementGrantSchema = z.object({
  featureKey: z.string().trim().min(1).max(200),
  active: z.boolean(),
  limitValue: z.number().finite().nullable(),
  expiresAt: z.string().datetime().nullable(),
  source: z.enum(["license", "plan", "override", "offline_lease", "compatibility"]),
});

export const accessModeSchema = z.enum(["online", "offline"]);

export const effectiveAccessSnapshotSchema = z.object({
  version: z.literal(1),
  mode: accessModeSchema,
  principal: identityPrincipalSchema,
  organization: organizationIdentitySchema.nullable(),
  device: deviceIdentitySchema.nullable(),
  deviceAccess: z.object({
    allowed: z.boolean(),
    reason: z.string().trim().min(1),
  }),
  license: z.object({
    status: z.string().trim().min(1).nullable(),
    reason: z.string().trim().min(1),
    canAuthenticate: z.boolean(),
    canUseEntitledFeatures: z.boolean(),
    offlineAllowed: z.boolean(),
    expiresAt: z.string().datetime().nullable(),
  }),
  entitlementMode: z.enum(["unrestricted", "allowlist"]),
  entitlements: z.array(entitlementGrantSchema),
  evaluatedAt: z.string().datetime(),
  degradedReason: z.string().trim().min(1).nullable(),
});

export const authSessionStateSchema = z.object({
  version: z.literal(1),
  state: z.enum([
    "signed_out",
    "restoring",
    "authenticated_online",
    "authenticated_offline",
    "reauth_required",
    "revoked",
  ]),
  principal: identityPrincipalSchema.nullable(),
  restoredAt: z.string().datetime().nullable(),
  reason: z.string().trim().min(1).nullable(),
}).superRefine((session, ctx) => {
  const authenticated = session.state === "authenticated_online" || session.state === "authenticated_offline";
  if (authenticated && session.principal === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Authenticated session states require a principal.", path: ["principal"] });
  }
  if ((session.state === "signed_out" || session.state === "restoring") && session.principal !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Signed-out/restoring states cannot carry an authenticated principal.", path: ["principal"] });
  }
});

export const desktopOidcProviderSchema = z.object({
  id: z.string().trim().min(1).max(80),
  authorizationEndpoint: z.string().url(),
  tokenEndpoint: z.string().url(),
  clientId: z.string().trim().min(1),
  scopes: z.array(z.string().trim().min(1)).min(1),
  redirectUri: z.string().url(),
});

export const desktopOidcStartResultSchema = z.object({
  requestId: z.string().uuid(),
  providerId: z.string().trim().min(1),
  authorizationUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

export const desktopOidcCallbackSchema = z.object({
  requestId: z.string().uuid(),
  state: z.string().min(32).max(512),
  code: z.string().min(1).max(4096),
});

export type IdentityPrincipal = z.infer<typeof identityPrincipalSchema>;
export type OrganizationIdentity = z.infer<typeof organizationIdentitySchema>;
export type DeviceIdentity = z.infer<typeof deviceIdentitySchema>;
export type OwnershipScope = z.infer<typeof ownershipScopeSchema>;
export type EntitlementGrant = z.infer<typeof entitlementGrantSchema>;
export type EffectiveAccessSnapshot = z.infer<typeof effectiveAccessSnapshotSchema>;
export type AuthSessionState = z.infer<typeof authSessionStateSchema>;
export type DesktopOidcProvider = z.infer<typeof desktopOidcProviderSchema>;
export type DesktopOidcStartResult = z.infer<typeof desktopOidcStartResultSchema>;
export type DesktopOidcCallback = z.infer<typeof desktopOidcCallbackSchema>;

export function principalFromUser(user: {
  id: number;
  email: string;
  name: string;
  role: z.infer<typeof liosUserRoleSchema>;
  organizationId: number | null;
}): IdentityPrincipal {
  const client = user.role === "client_admin" || user.role === "client_user";
  return identityPrincipalSchema.parse({
    version: 1,
    kind: "human",
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    audience: client ? "client" : "internal",
    organizationId: user.organizationId,
  });
}

export function ownershipScopeForPrincipal(principal: IdentityPrincipal): OwnershipScope {
  return ownershipScopeSchema.parse({
    ownerUserId: principal.userId,
    organizationId: principal.organizationId,
  });
}

export function ownershipMatches(
  scope: OwnershipScope,
  resource: { ownerUserId: number; organizationId: number | null },
): boolean {
  return resource.ownerUserId === scope.ownerUserId && resource.organizationId === scope.organizationId;
}

export function featureIsEntitled(snapshot: EffectiveAccessSnapshot, featureKey: string, now = new Date()): boolean {
  if (!snapshot.license.canUseEntitledFeatures) return false;
  if (!snapshot.deviceAccess.allowed) return false;
  if (snapshot.device?.leaseExpiresAt && Date.parse(snapshot.device.leaseExpiresAt) < now.getTime()) return false;
  if (snapshot.entitlementMode === "unrestricted") return true;
  return snapshot.entitlements.some((grant) => {
    if (!grant.active) return false;
    if (grant.featureKey !== "*" && grant.featureKey !== featureKey) return false;
    return !grant.expiresAt || Date.parse(grant.expiresAt) >= now.getTime();
  });
}
