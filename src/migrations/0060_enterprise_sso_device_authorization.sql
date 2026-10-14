-- P4 enterprise SSO browser-to-desktop device authorization.
-- Persists only a one-time verifier hash and short-lived auth state. No IdP
-- tokens, raw assertions, passwords, provider credentials or workspace data.
CREATE TABLE "enterprise_sso_device_authorizations" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "verifier_hash" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "user_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "approved_at" timestamp,
  "consumed_at" timestamp,
  CONSTRAINT "enterprise_sso_device_status_check" CHECK ("status" IN ('pending','approved','consumed','expired'))
);
--> statement-breakpoint
ALTER TABLE "enterprise_sso_device_authorizations" ADD CONSTRAINT "enterprise_sso_device_authorizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "enterprise_sso_device_authorizations" ADD CONSTRAINT "enterprise_sso_device_authorizations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "enterprise_sso_device_org_idx" ON "enterprise_sso_device_authorizations" ("organization_id");
--> statement-breakpoint
CREATE INDEX "enterprise_sso_device_status_idx" ON "enterprise_sso_device_authorizations" ("status");
--> statement-breakpoint
CREATE INDEX "enterprise_sso_device_expires_idx" ON "enterprise_sso_device_authorizations" ("expires_at");
--> statement-breakpoint
ALTER TABLE "enterprise_sso_device_authorizations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "li_os_enterprise_sso_device_authorizations_tenant" ON "enterprise_sso_device_authorizations";
--> statement-breakpoint
CREATE POLICY "li_os_enterprise_sso_device_authorizations_tenant" ON "enterprise_sso_device_authorizations" FOR ALL
  USING ("organization_id" = li_os_current_organization_id())
  WITH CHECK ("organization_id" = li_os_current_organization_id());
