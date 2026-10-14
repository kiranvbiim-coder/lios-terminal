-- P4 session-independent SAML request state.
-- SAML HTTP-POST callbacks may not carry the pre-redirect browser session
-- cookie under SameSite=Lax. RelayState therefore references this short-lived
-- server-side row and is authenticated with the organization SAML verifier
-- secret. No SAML assertion, IdP token, password or customer data is stored.
CREATE TABLE "enterprise_saml_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "return_to" text NOT NULL,
  "device_request_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "claimed_at" timestamp,
  "consumed_at" timestamp,
  CONSTRAINT "enterprise_saml_requests_status_check" CHECK ("status" IN ('pending','processing','consumed','expired'))
);
--> statement-breakpoint
ALTER TABLE "enterprise_saml_requests" ADD CONSTRAINT "enterprise_saml_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "enterprise_saml_requests_org_idx" ON "enterprise_saml_requests" ("organization_id");
--> statement-breakpoint
CREATE INDEX "enterprise_saml_requests_status_idx" ON "enterprise_saml_requests" ("status");
--> statement-breakpoint
CREATE INDEX "enterprise_saml_requests_expires_idx" ON "enterprise_saml_requests" ("expires_at");
--> statement-breakpoint
ALTER TABLE "enterprise_saml_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "li_os_enterprise_saml_requests_tenant" ON "enterprise_saml_requests";
--> statement-breakpoint
CREATE POLICY "li_os_enterprise_saml_requests_tenant" ON "enterprise_saml_requests" FOR ALL
  USING ("organization_id" = li_os_current_organization_id())
  WITH CHECK ("organization_id" = li_os_current_organization_id());
