-- LV4-24: tenant-scoped enterprise governance policy envelope.
-- The JSON document is validated in shared/enterpriseContracts.ts. Provider
-- handshakes and private deployment remain explicit readiness states.
CREATE TABLE "organization_enterprise_policies" (
	"organization_id" integer PRIMARY KEY NOT NULL,
	"policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_enterprise_policies" ADD CONSTRAINT "organization_enterprise_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_enterprise_policies" ADD CONSTRAINT "organization_enterprise_policies_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "organization_enterprise_policy_updated_by_idx" ON "organization_enterprise_policies" USING btree ("updated_by_user_id");
--> statement-breakpoint
ALTER TABLE "organization_enterprise_policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "li_os_organization_enterprise_policies_tenant" ON "organization_enterprise_policies";
--> statement-breakpoint
CREATE POLICY "li_os_organization_enterprise_policies_tenant" ON "organization_enterprise_policies" FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());
