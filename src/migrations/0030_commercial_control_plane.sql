CREATE TYPE "public"."platform_plan_tier" AS ENUM('personal', 'team', 'enterprise', 'trial');--> statement-breakpoint
CREATE TYPE "public"."license_lifecycle_status" AS ENUM('active', 'grace', 'billing_hold', 'suspended', 'security_locked', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."license_entitlement_type" AS ENUM('domain', 'data_source', 'engine', 'export', 'ai', 'connector', 'support', 'admin');--> statement-breakpoint
CREATE TYPE "public"."device_authorization_status" AS ENUM('authorized', 'pending', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."session_control_type" AS ENUM('force_logout', 'force_reauth');--> statement-breakpoint
CREATE TYPE "public"."session_control_scope" AS ENUM('organization', 'user', 'session', 'global');--> statement-breakpoint
CREATE TABLE "platform_plans" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"tier" "platform_plan_tier" NOT NULL,
	"seat_limit" integer,
	"device_limit" integer,
	"offline_grace_days" integer DEFAULT 7 NOT NULL,
	"feature_limits" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_plans_code_unique" UNIQUE("code")
);--> statement-breakpoint
CREATE TABLE "organization_licenses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"organization_id" integer NOT NULL,
	"plan_id" integer,
	"status" "license_lifecycle_status" DEFAULT 'active' NOT NULL,
	"seats_purchased" integer DEFAULT 1 NOT NULL,
	"billing_state" text DEFAULT 'current' NOT NULL,
	"trial_ends_at" timestamp,
	"grace_ends_at" timestamp,
	"offline_lease_issued_at" timestamp,
	"offline_lease_expires_at" timestamp,
	"offline_lease_public_key_id" text,
	"signed_lease_hash" text,
	"updated_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "license_entitlements" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"organization_license_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"feature_key" text NOT NULL,
	"entitlement_type" "license_entitlement_type" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"limit_value" real,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"expires_at" timestamp,
	"granted_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "authorized_devices" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"organization_id" integer NOT NULL,
	"user_id" integer,
	"device_fingerprint_hash" text NOT NULL,
	"device_label" text NOT NULL,
	"status" "device_authorization_status" DEFAULT 'authorized' NOT NULL,
	"lease_expires_at" timestamp,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	"revoked_at" timestamp,
	"revoked_by_user_id" integer,
	"revoke_reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);--> statement-breakpoint
CREATE TABLE "session_controls" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
	"control_type" "session_control_type" NOT NULL,
	"scope" "session_control_scope" NOT NULL,
	"organization_id" integer,
	"target_user_id" integer,
	"sid" text,
	"reason" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);--> statement-breakpoint
ALTER TABLE "organization_licenses" ADD CONSTRAINT "organization_licenses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "organization_licenses" ADD CONSTRAINT "organization_licenses_plan_id_platform_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."platform_plans"("id");--> statement-breakpoint
ALTER TABLE "organization_licenses" ADD CONSTRAINT "organization_licenses_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "license_entitlements" ADD CONSTRAINT "license_entitlements_organization_license_id_organization_licenses_id_fk" FOREIGN KEY ("organization_license_id") REFERENCES "public"."organization_licenses"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "license_entitlements" ADD CONSTRAINT "license_entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "license_entitlements" ADD CONSTRAINT "license_entitlements_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "authorized_devices" ADD CONSTRAINT "authorized_devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "authorized_devices" ADD CONSTRAINT "authorized_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "authorized_devices" ADD CONSTRAINT "authorized_devices_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "session_controls" ADD CONSTRAINT "session_controls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "session_controls" ADD CONSTRAINT "session_controls_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "session_controls" ADD CONSTRAINT "session_controls_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_license_org_unique" ON "organization_licenses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "organization_license_status_idx" ON "organization_licenses" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "license_entitlement_org_feature_unique" ON "license_entitlements" USING btree ("organization_id","feature_key");--> statement-breakpoint
CREATE INDEX "license_entitlement_license_idx" ON "license_entitlements" USING btree ("organization_license_id");--> statement-breakpoint
CREATE UNIQUE INDEX "authorized_device_org_fingerprint_unique" ON "authorized_devices" USING btree ("organization_id","device_fingerprint_hash");--> statement-breakpoint
CREATE INDEX "authorized_device_org_status_idx" ON "authorized_devices" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "authorized_device_user_idx" ON "authorized_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_control_scope_idx" ON "session_controls" USING btree ("scope","active");--> statement-breakpoint
CREATE INDEX "session_control_org_idx" ON "session_controls" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "session_control_user_idx" ON "session_controls" USING btree ("target_user_id");--> statement-breakpoint
CREATE INDEX "session_control_sid_idx" ON "session_controls" USING btree ("sid");