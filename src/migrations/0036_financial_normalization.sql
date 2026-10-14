CREATE TABLE "financial_normalization_policies" (
  "id" text PRIMARY KEY,
  "organization_id" integer,
  "owner_user_id" integer NOT NULL,
  "symbol" text NOT NULL,
  "label" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "financial_normalization_policies" ADD CONSTRAINT "financial_normalization_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "financial_normalization_policies" ADD CONSTRAINT "financial_normalization_policies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE INDEX "finance_normalization_policy_owner_symbol_idx" ON "financial_normalization_policies" USING btree ("owner_user_id", "symbol");--> statement-breakpoint
CREATE INDEX "finance_normalization_policy_org_symbol_idx" ON "financial_normalization_policies" USING btree ("organization_id", "symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "finance_normalization_policy_owner_symbol_key" ON "financial_normalization_policies" USING btree ("owner_user_id", "symbol");--> statement-breakpoint
CREATE TABLE "financial_normalization_adjustments" (
  "id" text PRIMARY KEY,
  "policy_id" text NOT NULL,
  "metric_id" text NOT NULL,
  "kind" text NOT NULL,
  "amount" real NOT NULL,
  "period" text NOT NULL,
  "label" text NOT NULL,
  "rationale" text,
  "source" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "financial_normalization_adjustments" ADD CONSTRAINT "financial_normalization_adjustments_policy_id_financial_normalization_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."financial_normalization_policies"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "finance_normalization_adjustment_policy_idx" ON "financial_normalization_adjustments" USING btree ("policy_id");--> statement-breakpoint
ALTER TABLE "financial_normalization_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "finance_normalization_policy_owner_or_org" ON "financial_normalization_policies";--> statement-breakpoint
CREATE POLICY "finance_normalization_policy_owner_or_org" ON "financial_normalization_policies"
  FOR ALL
  USING (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
      OR organization_id = li_os_current_organization_id())
  WITH CHECK (owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::integer
      OR organization_id = li_os_current_organization_id());--> statement-breakpoint
ALTER TABLE "financial_normalization_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "finance_normalization_adjustment_via_policy" ON "financial_normalization_adjustments";--> statement-breakpoint
CREATE POLICY "finance_normalization_adjustment_via_policy" ON "financial_normalization_adjustments"
  FOR ALL
  USING (EXISTS (SELECT 1 FROM financial_normalization_policies p WHERE p.id = financial_normalization_adjustments.policy_id
      AND (p.owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::integer OR p.organization_id = li_os_current_organization_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM financial_normalization_policies p WHERE p.id = financial_normalization_adjustments.policy_id
      AND (p.owner_user_id = NULLIF(current_setting('app.current_user_id', true), '')::integer OR p.organization_id = li_os_current_organization_id())));
