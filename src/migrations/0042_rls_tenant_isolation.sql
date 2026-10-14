-- LIOS Phase 2E/2F: guarded PostgreSQL tenant RLS.
-- This migration journals the existing tenant policy contract so hosted startup applies it.
-- The application must set transaction-local app.current_organization before tenant queries.

CREATE OR REPLACE FUNCTION li_os_current_organization_id()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_organization', true), '')::integer
$$;
--> statement-breakpoint

ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_datasets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE decision_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE credit_wallets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE client_audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS li_os_portfolios_tenant ON portfolios;
--> statement-breakpoint
CREATE POLICY li_os_portfolios_tenant ON portfolios FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());
--> statement-breakpoint
DROP POLICY IF EXISTS li_os_client_datasets_tenant ON client_datasets;
--> statement-breakpoint
CREATE POLICY li_os_client_datasets_tenant ON client_datasets FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());
--> statement-breakpoint
DROP POLICY IF EXISTS li_os_decision_records_tenant ON decision_records;
--> statement-breakpoint
CREATE POLICY li_os_decision_records_tenant ON decision_records FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());
--> statement-breakpoint
DROP POLICY IF EXISTS li_os_credit_wallets_tenant ON credit_wallets;
--> statement-breakpoint
CREATE POLICY li_os_credit_wallets_tenant ON credit_wallets FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());
--> statement-breakpoint
DROP POLICY IF EXISTS li_os_client_audit_events_tenant ON client_audit_events;
--> statement-breakpoint
CREATE POLICY li_os_client_audit_events_tenant ON client_audit_events FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());
--> statement-breakpoint
DROP POLICY IF EXISTS li_os_engagements_tenant ON engagements;
--> statement-breakpoint
CREATE POLICY li_os_engagements_tenant ON engagements FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());
--> statement-breakpoint

ALTER TABLE workstreams ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deliverables ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workstream_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE engagement_agreements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE engagement_payments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS li_os_workstreams_tenant ON workstreams;
--> statement-breakpoint
CREATE POLICY li_os_workstreams_tenant ON workstreams FOR ALL
  USING (EXISTS (SELECT 1 FROM engagements e WHERE e.id = workstreams.engagement_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM engagements e WHERE e.id = workstreams.engagement_id AND e.organization_id = li_os_current_organization_id()));
--> statement-breakpoint
DROP POLICY IF EXISTS li_os_deliverables_tenant ON deliverables;
--> statement-breakpoint
CREATE POLICY li_os_deliverables_tenant ON deliverables FOR ALL
  USING (EXISTS (SELECT 1 FROM workstreams w JOIN engagements e ON e.id = w.engagement_id WHERE w.id = deliverables.workstream_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM workstreams w JOIN engagements e ON e.id = w.engagement_id WHERE w.id = deliverables.workstream_id AND e.organization_id = li_os_current_organization_id()));
--> statement-breakpoint
DROP POLICY IF EXISTS li_os_meetings_tenant ON meetings;
--> statement-breakpoint
CREATE POLICY li_os_meetings_tenant ON meetings FOR ALL
  USING (EXISTS (SELECT 1 FROM engagements e WHERE e.id = meetings.engagement_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM engagements e WHERE e.id = meetings.engagement_id AND e.organization_id = li_os_current_organization_id()));
--> statement-breakpoint
DROP POLICY IF EXISTS li_os_workstream_comments_tenant ON workstream_comments;
--> statement-breakpoint
CREATE POLICY li_os_workstream_comments_tenant ON workstream_comments FOR ALL
  USING (EXISTS (SELECT 1 FROM workstreams w JOIN engagements e ON e.id = w.engagement_id WHERE w.id = workstream_comments.workstream_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM workstreams w JOIN engagements e ON e.id = w.engagement_id WHERE w.id = workstream_comments.workstream_id AND e.organization_id = li_os_current_organization_id()));
--> statement-breakpoint
DROP POLICY IF EXISTS li_os_engagement_agreements_tenant ON engagement_agreements;
--> statement-breakpoint
CREATE POLICY li_os_engagement_agreements_tenant ON engagement_agreements FOR ALL
  USING (EXISTS (SELECT 1 FROM engagements e WHERE e.id = engagement_agreements.engagement_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM engagements e WHERE e.id = engagement_agreements.engagement_id AND e.organization_id = li_os_current_organization_id()));
--> statement-breakpoint
DROP POLICY IF EXISTS li_os_engagement_payments_tenant ON engagement_payments;
--> statement-breakpoint
CREATE POLICY li_os_engagement_payments_tenant ON engagement_payments FOR ALL
  USING (EXISTS (SELECT 1 FROM engagements e WHERE e.id = engagement_payments.engagement_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM engagements e WHERE e.id = engagement_payments.engagement_id AND e.organization_id = li_os_current_organization_id()));
--> statement-breakpoint

-- Private persona state is user-scoped even when the user belongs to a tenant.
CREATE OR REPLACE FUNCTION li_os_current_user_id()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::integer
$$;
--> statement-breakpoint
ALTER TABLE user_persona_preferences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS li_os_user_persona_preferences_owner ON user_persona_preferences;
--> statement-breakpoint
CREATE POLICY li_os_user_persona_preferences_owner ON user_persona_preferences FOR ALL
  USING (user_id = li_os_current_user_id())
  WITH CHECK (user_id = li_os_current_user_id());
