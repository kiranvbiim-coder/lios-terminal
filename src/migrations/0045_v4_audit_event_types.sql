-- Add the two client_audit_event_type values the V4 commercial-runtime
-- routes emit: consulting-interest selection (software/consulting
-- separation) and trial-status polling.
ALTER TYPE "public"."client_audit_event_type" ADD VALUE IF NOT EXISTS 'consulting_service_selected';
--> statement-breakpoint
ALTER TYPE "public"."client_audit_event_type" ADD VALUE IF NOT EXISTS 'trial_status_checked';
