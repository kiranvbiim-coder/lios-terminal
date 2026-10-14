CREATE TABLE "financial_metric_overrides" (
  "id" text PRIMARY KEY,
  "organization_id" integer,
  "owner_user_id" integer NOT NULL,
  "symbol" text NOT NULL,
  "metric_id" text NOT NULL,
  "value" real,
  "status" text DEFAULT 'manual' NOT NULL,
  "period" text DEFAULT 'CURRENT' NOT NULL,
  "scenario_id" text,
  "as_of" text NOT NULL,
  "published_at" text,
  "source" text NOT NULL,
  "source_url" text,
  "currency" text,
  "note" text,
  "confidence" real,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "financial_metric_overrides" ADD CONSTRAINT "financial_metric_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "financial_metric_overrides" ADD CONSTRAINT "financial_metric_overrides_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "finance_metric_override_owner_symbol_idx" ON "financial_metric_overrides" USING btree ("owner_user_id", "symbol");--> statement-breakpoint
CREATE INDEX "finance_metric_override_org_symbol_idx" ON "financial_metric_overrides" USING btree ("organization_id", "symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_metric_override_scope_key" ON "financial_metric_overrides" USING btree ("owner_user_id", "symbol", "metric_id", "period", "scenario_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION li_os_current_organization_id()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_organization', true), '')::integer
$$;--> statement-breakpoint
ALTER TABLE "financial_metric_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "finance_metric_override_owner_or_org" ON "financial_metric_overrides";--> statement-breakpoint
CREATE POLICY "finance_metric_override_owner_or_org" ON "financial_metric_overrides"
  FOR ALL
  USING (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
      OR organization_id = li_os_current_organization_id())
  WITH CHECK (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
      OR organization_id = li_os_current_organization_id());
