-- LIOS Phase 2E: guarded PostgreSQL tenant RLS.
--
-- This migration is intentionally fail-closed for the hosted deployment path.
-- It only applies to tables that already carry organization_id. Child tables
-- will receive policies after their ownership chain has been migrated.
--
-- The application must set transaction-local app.current_organization before
-- querying tenant data (see src/server/tenantDb.ts).

CREATE OR REPLACE FUNCTION li_os_current_organization_id()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.current_organization', true), '')::integer
$$;

-- Direct tenant tables. Policies are deliberately explicit for SELECT/INSERT/
-- UPDATE/DELETE so future privilege changes do not broaden access implicitly.

ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE engagements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS li_os_portfolios_tenant ON portfolios;
CREATE POLICY li_os_portfolios_tenant ON portfolios
  FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());

DROP POLICY IF EXISTS li_os_client_datasets_tenant ON client_datasets;
CREATE POLICY li_os_client_datasets_tenant ON client_datasets
  FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());

DROP POLICY IF EXISTS li_os_decision_records_tenant ON decision_records;
CREATE POLICY li_os_decision_records_tenant ON decision_records
  FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());

DROP POLICY IF EXISTS li_os_credit_wallets_tenant ON credit_wallets;
CREATE POLICY li_os_credit_wallets_tenant ON credit_wallets
  FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());

DROP POLICY IF EXISTS li_os_client_audit_events_tenant ON client_audit_events;
CREATE POLICY li_os_client_audit_events_tenant ON client_audit_events
  FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());

DROP POLICY IF EXISTS li_os_engagements_tenant ON engagements;
CREATE POLICY li_os_engagements_tenant ON engagements
  FOR ALL
  USING (organization_id = li_os_current_organization_id())
  WITH CHECK (organization_id = li_os_current_organization_id());

-- Do not enable RLS on users/organizations here. Those tables are used by
-- authentication/bootstrap and require a separate service-role strategy.
-- Do not add FORCE ROW LEVEL SECURITY yet: deployment must first confirm the
-- application role is not the table owner and that all migrations/bootstrap
-- paths use an explicit service role where required.
