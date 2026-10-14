-- GM-03 (owner decision Q4): the generic vendor event relay is removed. Nothing writes these rows any more.
DROP TABLE IF EXISTS "event_relay_deliveries";
--> statement-breakpoint
ALTER TABLE "production_retention_policies" DROP COLUMN IF EXISTS "relay_days";
--> statement-breakpoint
UPDATE "data_deletion_receipts" SET "scope" = 'operational_diagnostics' WHERE "scope" = 'operational_diagnostics_and_relay';
