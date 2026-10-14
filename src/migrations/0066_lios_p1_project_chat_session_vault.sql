ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "legacy_workspace_id" text;--> statement-breakpoint

CREATE TYPE "public"."project_chat_scope" AS ENUM('project', 'quick');--> statement-breakpoint
CREATE TYPE "public"."project_chat_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."project_resource_context_mode" AS ENUM('project', 'on_demand', 'excluded');--> statement-breakpoint
CREATE TYPE "public"."project_session_status" AS ENUM('active', 'archived');--> statement-breakpoint

CREATE TABLE "project_chats" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "project_id" integer,
  "owner_user_id" integer NOT NULL,
  "organization_id" integer,
  "scope" "project_chat_scope" NOT NULL,
  "title" text NOT NULL,
  "pinned" boolean DEFAULT false NOT NULL,
  "status" "project_chat_status" DEFAULT 'active' NOT NULL,
  "last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "project_chats_scope_project_ck" CHECK (
    ("scope" = 'project' AND "project_id" IS NOT NULL)
    OR ("scope" = 'quick' AND "project_id" IS NULL)
  )
);--> statement-breakpoint

CREATE TABLE "project_chat_messages" (
  "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  "chat_id" integer NOT NULL,
  "role" text NOT NULL,
  "content" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_chat_messages_role_ck" CHECK ("role" IN ('user','assistant','system'))
);--> statement-breakpoint

CREATE TABLE "project_resources" (
  "id" text PRIMARY KEY,
  "project_id" integer NOT NULL,
  "owner_user_id" integer NOT NULL,
  "organization_id" integer,
  "kind" text NOT NULL,
  "label" text NOT NULL,
  "resource_ref" text,
  "context_mode" "project_resource_context_mode" DEFAULT 'project' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE "project_sessions" (
  "id" text PRIMARY KEY,
  "project_id" integer NOT NULL,
  "chat_id" integer,
  "parent_session_id" text,
  "owner_user_id" integer NOT NULL,
  "organization_id" integer,
  "name" text NOT NULL,
  "status" "project_session_status" DEFAULT 'active' NOT NULL,
  "workspace_state" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone
);--> statement-breakpoint

ALTER TABLE "project_chats" ADD CONSTRAINT "project_chats_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_chats" ADD CONSTRAINT "project_chats_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_chats" ADD CONSTRAINT "project_chats_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "project_chat_messages" ADD CONSTRAINT "project_chat_messages_chat_id_project_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."project_chats"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "project_resources" ADD CONSTRAINT "project_resources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_resources" ADD CONSTRAINT "project_resources_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_resources" ADD CONSTRAINT "project_resources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint

ALTER TABLE "project_sessions" ADD CONSTRAINT "project_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD CONSTRAINT "project_sessions_chat_id_project_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."project_chats"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD CONSTRAINT "project_sessions_parent_session_id_project_sessions_id_fk" FOREIGN KEY ("parent_session_id") REFERENCES "public"."project_sessions"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD CONSTRAINT "project_sessions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "project_sessions" ADD CONSTRAINT "project_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade;--> statement-breakpoint

CREATE UNIQUE INDEX "projects_owner_legacy_workspace_unique" ON "projects" ("owner_user_id","legacy_workspace_id");--> statement-breakpoint
CREATE INDEX "project_chats_owner_scope_idx" ON "project_chats" ("owner_user_id","scope","status","last_activity_at");--> statement-breakpoint
CREATE INDEX "project_chats_project_idx" ON "project_chats" ("project_id","status","last_activity_at");--> statement-breakpoint
CREATE INDEX "project_chats_org_idx" ON "project_chats" ("organization_id");--> statement-breakpoint
CREATE INDEX "project_chat_messages_chat_idx" ON "project_chat_messages" ("chat_id","created_at");--> statement-breakpoint
CREATE INDEX "project_resources_project_idx" ON "project_resources" ("project_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "project_resources_owner_idx" ON "project_resources" ("owner_user_id");--> statement-breakpoint
CREATE INDEX "project_resources_org_idx" ON "project_resources" ("organization_id");--> statement-breakpoint
CREATE INDEX "project_sessions_project_idx" ON "project_sessions" ("project_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "project_sessions_parent_idx" ON "project_sessions" ("parent_session_id");--> statement-breakpoint
CREATE INDEX "project_sessions_chat_idx" ON "project_sessions" ("chat_id");--> statement-breakpoint
CREATE INDEX "project_sessions_owner_idx" ON "project_sessions" ("owner_user_id");
