CREATE TABLE "financial_custom_metrics" (
  "id" text PRIMARY KEY,
  "organization_id" integer,
  "owner_user_id" integer NOT NULL,
  "label" text NOT NULL,
  "unit" text NOT NULL,
  "formula" text NOT NULL,
  "dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "financial_custom_metrics" ADD CONSTRAINT "financial_custom_metrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "financial_custom_metrics" ADD CONSTRAINT "financial_custom_metrics_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "finance_custom_metric_owner_idx" ON "financial_custom_metrics" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "finance_custom_metric_org_idx" ON "financial_custom_metrics" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "financial_custom_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "finance_custom_metric_owner_or_org" ON "financial_custom_metrics";--> statement-breakpoint
CREATE POLICY "finance_custom_metric_owner_or_org" ON "financial_custom_metrics"
  FOR ALL
  USING (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
      OR organization_id = li_os_current_organization_id())
  WITH CHECK (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
      OR organization_id = li_os_current_organization_id());
