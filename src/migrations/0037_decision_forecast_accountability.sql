ALTER TABLE "decision_records" ADD COLUMN "metric" text;--> statement-breakpoint
ALTER TABLE "decision_records" ADD COLUMN "forecast_value" real;--> statement-breakpoint
ALTER TABLE "decision_records" ADD COLUMN "actual_value" real;