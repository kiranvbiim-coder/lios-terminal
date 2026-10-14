-- P3 production services and hosted control-plane operational metadata.
-- No raw BYOD/export bytes, prompts, notes, provider credentials, or crash
-- stacks are stored by these tables.
CREATE TABLE "production_retention_policies" (
  "scope" text PRIMARY KEY NOT NULL,
  "telemetry_days" integer DEFAULT 30 NOT NULL,
  "relay_days" integer DEFAULT 30 NOT NULL,
  "deletion_receipt_days" integer DEFAULT 365 NOT NULL,
  "export_receipt_days" integer DEFAULT 90 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by_user_id" integer
);
--> statement-breakpoint
CREATE TABLE "diagnostic_events" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "organization_id" integer,
  "user_id" integer,
  "category" text NOT NULL,
  "event_name" text NOT NULL,
  "severity" text NOT NULL,
  "app_version" text,
  "platform" text,
  "arch" text,
  "fingerprint" text,
  "details" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  CONSTRAINT "diagnostic_events_category_check" CHECK ("category" IN ('runtime','crash','performance')),
  CONSTRAINT "diagnostic_events_severity_check" CHECK ("severity" IN ('info','warning','error','fatal'))
);
--> statement-breakpoint
CREATE TABLE "data_deletion_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer,
  "requested_by_user_id" integer,
  "scope" text NOT NULL,
  "status" text NOT NULL,
  "reason" text,
  "counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "requested_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp,
  "expires_at" timestamp NOT NULL,
  CONSTRAINT "data_deletion_receipts_status_check" CHECK ("status" IN ('completed','partial','blocked'))
);
--> statement-breakpoint
CREATE TABLE "export_custody_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer,
  "user_id" integer,
  "format" text NOT NULL,
  "artifact_name_hash" text NOT NULL,
  "sha256" text NOT NULL,
  "byte_size" integer NOT NULL,
  "custody" text DEFAULT 'local_only' NOT NULL,
  "generated_at" timestamp NOT NULL,
  "registered_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL,
  "deleted_at" timestamp,
  CONSTRAINT "export_custody_receipts_format_check" CHECK ("format" IN ('pdf','xlsx','csv','json','zip','other')),
  CONSTRAINT "export_custody_receipts_custody_check" CHECK ("custody" = 'local_only'),
  CONSTRAINT "export_custody_receipts_byte_size_check" CHECK ("byte_size" >= 0)
);
--> statement-breakpoint
CREATE TABLE "event_relay_deliveries" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" integer,
  "event_type" text NOT NULL,
  "destination_origin" text,
  "payload_digest" text NOT NULL,
  "status" text NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "last_error" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "delivered_at" timestamp,
  "expires_at" timestamp NOT NULL,
  CONSTRAINT "event_relay_deliveries_status_check" CHECK ("status" IN ('queued','delivered','failed','disabled'))
);
--> statement-breakpoint
ALTER TABLE "production_retention_policies" ADD CONSTRAINT "production_retention_policies_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "diagnostic_events" ADD CONSTRAINT "diagnostic_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "diagnostic_events" ADD CONSTRAINT "diagnostic_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_deletion_receipts" ADD CONSTRAINT "data_deletion_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "data_deletion_receipts" ADD CONSTRAINT "data_deletion_receipts_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "export_custody_receipts" ADD CONSTRAINT "export_custody_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "export_custody_receipts" ADD CONSTRAINT "export_custody_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "event_relay_deliveries" ADD CONSTRAINT "event_relay_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "diagnostic_events_created_idx" ON "diagnostic_events" ("created_at");
--> statement-breakpoint
CREATE INDEX "diagnostic_events_expires_idx" ON "diagnostic_events" ("expires_at");
--> statement-breakpoint
CREATE INDEX "diagnostic_events_org_idx" ON "diagnostic_events" ("organization_id");
--> statement-breakpoint
CREATE INDEX "data_deletion_receipts_org_idx" ON "data_deletion_receipts" ("organization_id");
--> statement-breakpoint
CREATE INDEX "data_deletion_receipts_expires_idx" ON "data_deletion_receipts" ("expires_at");
--> statement-breakpoint
CREATE INDEX "export_custody_receipts_org_idx" ON "export_custody_receipts" ("organization_id");
--> statement-breakpoint
CREATE INDEX "export_custody_receipts_expires_idx" ON "export_custody_receipts" ("expires_at");
--> statement-breakpoint
CREATE INDEX "event_relay_deliveries_status_idx" ON "event_relay_deliveries" ("status");
--> statement-breakpoint
CREATE INDEX "event_relay_deliveries_expires_idx" ON "event_relay_deliveries" ("expires_at");
--> statement-breakpoint
CREATE INDEX "event_relay_deliveries_org_idx" ON "event_relay_deliveries" ("organization_id");

--> statement-breakpoint
ALTER TABLE "diagnostic_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "li_os_diagnostic_events_tenant" ON "diagnostic_events";
--> statement-breakpoint
CREATE POLICY "li_os_diagnostic_events_tenant" ON "diagnostic_events" FOR ALL
  USING ("organization_id" = li_os_current_organization_id())
  WITH CHECK ("organization_id" = li_os_current_organization_id());
--> statement-breakpoint
ALTER TABLE "export_custody_receipts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS "li_os_export_custody_receipts_tenant" ON "export_custody_receipts";
--> statement-breakpoint
CREATE POLICY "li_os_export_custody_receipts_tenant" ON "export_custody_receipts" FOR ALL
  USING ("organization_id" = li_os_current_organization_id())
  WITH CHECK ("organization_id" = li_os_current_organization_id());
