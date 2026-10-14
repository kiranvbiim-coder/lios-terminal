CREATE TYPE "public"."workstream_status" AS ENUM('not_started', 'in_progress', 'blocked', 'completed');--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_type" AS ENUM('grant', 'debit', 'adjustment', 'refund');--> statement-breakpoint
CREATE TABLE "workstreams" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "workstreams_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"engagement_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "workstream_status" DEFAULT 'not_started' NOT NULL,
	"owner_admin_id" integer,
	"sequence" integer DEFAULT 0 NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_wallets" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credit_wallets_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organization_id" integer NOT NULL,
	"balance" real DEFAULT 0 NOT NULL,
	"low_balance_threshold" real,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger_entries" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "credit_ledger_entries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"wallet_id" integer NOT NULL,
	"type" "credit_transaction_type" NOT NULL,
	"amount" real NOT NULL,
	"balance_after" real NOT NULL,
	"description" text NOT NULL,
	"related_entity_type" text,
	"related_entity_id" integer,
	"performed_by_user_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workstreams" ADD CONSTRAINT "workstreams_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workstreams" ADD CONSTRAINT "workstreams_owner_admin_id_users_id_fk" FOREIGN KEY ("owner_admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_wallets" ADD CONSTRAINT "credit_wallets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_wallet_id_credit_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."credit_wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_wallet_org_unique" ON "credit_wallets" USING btree ("organization_id");
