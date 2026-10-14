ALTER TABLE "consensus_snapshots" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "consensus_snapshots" ADD COLUMN "retrieved_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "consensus_snapshots" ADD COLUMN "available_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint

UPDATE "consensus_snapshots"
SET "retrieved_at" = "created_at",
    "available_at" = "created_at";--> statement-breakpoint

CREATE INDEX "consensus_snapshot_asof_idx"
ON "consensus_snapshots" USING btree ("symbol", "metric", "fiscal_period", "available_at");
