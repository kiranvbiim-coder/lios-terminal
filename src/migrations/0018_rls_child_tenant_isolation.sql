-- LIOS Phase 2E/2F: indirect child-resource RLS.
-- Child resources inherit tenant ownership through their parent. Policies use
-- EXISTS checks against an already-RLS-protected tenant root.

ALTER TABLE workstreams ENABLE ROW LEVEL SECURITY;
ALTER TABLE deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE workstream_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_agreements ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagement_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS li_os_workstreams_tenant ON workstreams;
CREATE POLICY li_os_workstreams_tenant ON workstreams FOR ALL
  USING (EXISTS (SELECT 1 FROM engagements e WHERE e.id = workstreams.engagement_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM engagements e WHERE e.id = workstreams.engagement_id AND e.organization_id = li_os_current_organization_id()));

DROP POLICY IF EXISTS li_os_deliverables_tenant ON deliverables;
CREATE POLICY li_os_deliverables_tenant ON deliverables FOR ALL
  USING (EXISTS (SELECT 1 FROM workstreams w JOIN engagements e ON e.id = w.engagement_id WHERE w.id = deliverables.workstream_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM workstreams w JOIN engagements e ON e.id = w.engagement_id WHERE w.id = deliverables.workstream_id AND e.organization_id = li_os_current_organization_id()));

DROP POLICY IF EXISTS li_os_meetings_tenant ON meetings;
CREATE POLICY li_os_meetings_tenant ON meetings FOR ALL
  USING (EXISTS (SELECT 1 FROM engagements e WHERE e.id = meetings.engagement_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM engagements e WHERE e.id = meetings.engagement_id AND e.organization_id = li_os_current_organization_id()));

DROP POLICY IF EXISTS li_os_workstream_comments_tenant ON workstream_comments;
CREATE POLICY li_os_workstream_comments_tenant ON workstream_comments FOR ALL
  USING (EXISTS (SELECT 1 FROM workstreams w JOIN engagements e ON e.id = w.engagement_id WHERE w.id = workstream_comments.workstream_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM workstreams w JOIN engagements e ON e.id = w.engagement_id WHERE w.id = workstream_comments.workstream_id AND e.organization_id = li_os_current_organization_id()));

DROP POLICY IF EXISTS li_os_engagement_agreements_tenant ON engagement_agreements;
CREATE POLICY li_os_engagement_agreements_tenant ON engagement_agreements FOR ALL
  USING (EXISTS (SELECT 1 FROM engagements e WHERE e.id = engagement_agreements.engagement_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM engagements e WHERE e.id = engagement_agreements.engagement_id AND e.organization_id = li_os_current_organization_id()));

DROP POLICY IF EXISTS li_os_engagement_payments_tenant ON engagement_payments;
CREATE POLICY li_os_engagement_payments_tenant ON engagement_payments FOR ALL
  USING (EXISTS (SELECT 1 FROM engagements e WHERE e.id = engagement_payments.engagement_id AND e.organization_id = li_os_current_organization_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM engagements e WHERE e.id = engagement_payments.engagement_id AND e.organization_id = li_os_current_organization_id()));
