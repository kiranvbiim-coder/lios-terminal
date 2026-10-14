import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Canonical PostgreSQL enum declarations for the LiOS shared database schema.
 *
 * Keep table definitions in schema.ts (and future domain schema modules) and
 * import enums from here. This module intentionally has no table imports so it
 * cannot create schema dependency cycles.
 */

export const userRoleEnum = pgEnum("user_role", [
  "internal_admin",
  "internal_analyst",
  "internal_compliance",
  "client_admin",
  "client_user",
]);

export const contentTypeEnum = pgEnum("content_type", [
  "note",
  "brief",
  "trade_idea",
  "report",
]);

export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "pending_review",
  "approved",
  "published",
  "suppressed",
]);

export const contentVisibilityEnum = pgEnum("content_visibility", [
  "all_clients",
  "specific_orgs",
]);

export const assetClassEnum = pgEnum("asset_class", [
  "equity",
  "etf",
  "fund",
  "bond",
  "index",
  "commodity",
  "forex",
  "crypto",
]);

export const organizationLifecycleStageEnum = pgEnum("organization_lifecycle_stage", [
  "trial",
  "client",
  "churned",
]);

export const platformPlanTierEnum = pgEnum("platform_plan_tier", [
  "trial",
  "starter",
  "pro",
  "enterprise",
]);

export const licenseLifecycleStatusEnum = pgEnum("license_lifecycle_status", [
  "active",
  "grace",
  "billing_hold",
  "suspended",
  "security_locked",
  "terminated",
]);

export const licenseEntitlementTypeEnum = pgEnum("license_entitlement_type", [
  "domain",
  "data_source",
  "engine",
  "export",
  "ai",
  "connector",
  "support",
  "admin",
]);

export const billingWebhookEventStatusEnum = pgEnum("billing_webhook_event_status", ["mapped", "unmapped"]);

export const deviceAuthorizationStatusEnum = pgEnum("device_authorization_status", [
  "authorized",
  "pending",
  "revoked",
]);

export const sessionControlTypeEnum = pgEnum("session_control_type", [
  "force_logout",
  "force_reauth",
]);

export const sessionControlScopeEnum = pgEnum("session_control_scope", [
  "organization",
  "user",
  "session",
  "global",
]);

export const tradingSessionTypeEnum = pgEnum("trading_session_type", ["pre_market", "regular", "post_market"]);

export const exchangeHolidayStatusEnum = pgEnum("exchange_holiday_status", ["closed", "early_close"]);

export const corporateActionTypeEnum = pgEnum("corporate_action_type", [
  "dividend",
  "special_dividend",
  "split",
  "reverse_split",
  "rights_issue",
  "bonus_issue",
  "merger",
  "acquisition",
  "spin_off",
  "ticker_change",
  "exchange_migration",
  "delisting",
  "relisting",
  "security_replacement",
]);

export const corporateActionLegRoleEnum = pgEnum("corporate_action_leg_role", [
  "subject",
  "acquirer",
  "target",
  "successor",
  "replacement",
  "spinoff",
]);

export const projectStatusEnum = pgEnum("project_status", [
  "active",
  "archived",
]);

export const projectChatScopeEnum = pgEnum("project_chat_scope", ["project", "quick"]);

export const projectChatStatusEnum = pgEnum("project_chat_status", ["active", "archived"]);

export const projectResourceContextModeEnum = pgEnum("project_resource_context_mode", ["project", "on_demand", "excluded"]);

export const projectSessionStatusEnum = pgEnum("project_session_status", ["active", "archived"]);

export const sourceConnectionTypeEnum = pgEnum("source_connection_type", [
  "public_api",
  "keyed_api",
  "file",
  "database",
  "private_api",
  "cloud_storage",
  "sidecar",
  "local_model",
  "mcp",
]);

export const sourceConnectionStatusEnum = pgEnum("source_connection_status", [
  "configured",
  "healthy",
  "degraded",
  "unreachable",
  "invalid",
]);

export const instrumentRelationshipTypeEnum = pgEnum("instrument_relationship_type", [
  "adr_gdr",
  "related_instrument",
  "succession",
]);

export const quantWorkspaceEnum = pgEnum("quant_workspace", [
  "dataset", "statistics", "econometrics", "forecasting", "risk", "portfolio",
  "derivatives", "backtest", "ml", "results", "registry",
]);

export const quantExperimentStatusEnum = pgEnum("quant_experiment_status", ["active", "archived"]);

export const quantRunStatusEnum = pgEnum("quant_run_status", ["queued", "running", "succeeded", "failed", "cancelled", "timed_out"]);

export const calculationJobStatusEnum = pgEnum("calculation_job_status", [
  "queued", "running", "succeeded", "failed", "cancelled",
]);

export const researchInvestigationStatusEnum = pgEnum("research_investigation_status", [
  "draft",
  "active",
  "review",
  "completed",
  "archived",
]);

export const researchEvidenceTypeEnum = pgEnum("research_evidence_type", [
  "filing",
  "news",
  "official_data",
  "market_data",
  "model_output",
  "uploaded_document",
  "internal_note",
  "claim",
]);

export const researchEvidenceKindEnum = pgEnum("research_evidence_kind", [
  "fact",
  "claim",
  "calculation",
  "interpretation",
  "counterargument",
  "unknown",
]);

export const researchRelationshipTypeEnum = pgEnum("research_relationship_type", [
  "supports",
  "contradicts",
  "supersedes",
  "derived_from",
  "affects",
  "cites",
]);

export const consensusMetricEnum = pgEnum("consensus_metric", [
  "revenue", "ebitda", "ebit", "eps", "free_cash_flow", "gross_margin",
  "operating_margin", "net_margin", "capex", "price_target", "recommendation_score",
]);

export const consensusSourceTypeEnum = pgEnum("consensus_source_type", [
  "licensed_provider", "user_supplied", "manual",
]);

export const consensusBenchmarkKindEnum = pgEnum("consensus_benchmark_kind", [
  "company_guidance", "reported_actual", "limuria_model",
]);

export const brainDecisionTypeEnum = pgEnum("brain_decision_type", [
  "investment", "policy", "portfolio", "risk", "supply_chain", "consulting", "general_research",
]);

export const brainRunStatusEnum = pgEnum("brain_run_status", [
  "planned", "running", "paused", "awaiting_approval", "completed", "incomplete", "failed", "rejected",
]);

export const brainTaskStatusEnum = pgEnum("brain_task_status", [
  "pending", "running", "completed", "incomplete", "failed", "blocked", "awaiting_approval", "rejected",
]);

export const brainAgentRoleEnum = pgEnum("brain_agent_role", [
  "planner", "research", "financial_analyst", "portfolio", "risk", "economist", "policy",
  "supply_chain", "consulting", "red_team", "verification", "decision_judge", "human",
]);

export const brainApprovalStatusEnum = pgEnum("brain_approval_status", ["pending", "approved", "rejected"]);

export const decisionCaseStatusEnum = pgEnum("decision_case_status", [
  "draft", "review", "approved", "rejected", "superseded", "expired",
]);

export const decisionMaterialityEnum = pgEnum("decision_materiality", ["routine", "material", "critical"]);

export const decisionApprovalOutcomeEnum = pgEnum("decision_approval_outcome", ["approved", "rejected", "waived"]);

export const decisionMonitorStatusEnum = pgEnum("decision_monitor_status", ["active", "breached", "acknowledged", "disabled"]);

export const engagementModelEnum = pgEnum("engagement_model", [
  "strategy", // Limuria Strategy(tm) -- fixed-scope, fixed-timeline project consulting
  "one",      // Limuria One(tm) -- Consulting-as-a-Service, subscription/continuous advisory
  "vantage",  // Limuria Vantage(tm) -- enterprise & executive partnership
]);

export const engagementStatusEnum = pgEnum("engagement_status", [
  "proposed",     // Discovery Meeting / Proposal & Commercials stage
  "negotiating",  // scope or commercials under discussion
  "agreed",       // terms agreed, Agreement & NDA in progress
  "active",       // Workspace Provisioned, service delivery underway
  "completed",    // Strategy-style engagements: work finished
  "archived",     // post-completion archive (or a lapsed One/Vantage relationship)
  // A prospect who walked away before signing -- kept distinct from
  // "archived" (a real past client relationship ending) so a conversion-rate
  // report doesn't conflate the two. Added for the trial-to-contract funnel.
  "declined",
]);

export const engagementAgreementStatusEnum = pgEnum("engagement_agreement_status", [
  "draft",
  "sent",
  "signed",
  "void",
]);

export const engagementPaymentStatusEnum = pgEnum("engagement_payment_status", [
  "pending",
  "succeeded",
  "failed",
  "refunded",
]);

export const workstreamStatusEnum = pgEnum("workstream_status", [
  "not_started",
  "in_progress",
  "blocked",
  "completed",
]);

export const deliverableStatusEnum = pgEnum("deliverable_status", [
  "draft",
  "data_validation",
  "calculation_validation",
  "assumption_validation",
  "citation_validation",
  "consultant_review",
  "senior_review",
  "approved_for_delivery",
  "delivered",
]);

export const deliverableGateActionEnum = pgEnum("deliverable_gate_action", ["advance", "reject"]);

export const meetingStatusEnum = pgEnum("meeting_status", [
  "scheduled",
  "completed",
  "cancelled",
]);

export const decisionRecordStatusEnum = pgEnum("decision_record_status", ["open", "resolved"]);

export const requestStatusEnum = pgEnum("request_status", [
  "pending",
  "assigned",
  "quoted",
  "accepted",
  "in_progress",
  "completed",
  "escalated",
  "resolved",
]);

export const consultingRequestPackEnum = pgEnum("consulting_request_pack", [
  "investment_decision",
  "market_entry",
  "ma_intelligence",
]);

export const consultingQuoteStatusEnum = pgEnum("consulting_quote_status", [
  "proposed",
  "accepted",
  "declined",
  "superseded",
]);

export const creditTransactionTypeEnum = pgEnum("credit_transaction_type", [
  "grant",      // admin-issued credits (initial allotment, top-up)
  "debit",      // consumed by a billable terminal action
  "adjustment", // manual correction (e.g. correcting a metering bug)
  "refund",     // reversal of a prior debit
]);

export const clientAuditEventTypeEnum = pgEnum("client_audit_event_type", [
  "login",
  "logout",
  "watchlist_add",
  "watchlist_remove",
  "alert_add",
  "alert_remove",
  "quote_accepted",
  "quote_declined",
  "csv_export",
  // Trial-to-Contract funnel events (see BUILD_PLAN).
  "trial_started",
  "tier_selected",
  "agreement_signed",
  "payment_completed",
  "engagement_activated",
  // Decision Memory (Major Bet)
  "decision_logged",
  "decision_resolved",
  // BYOD (Major Bet)
  "dataset_uploaded",
  "dataset_deleted",
  // Commercial-runtime and consulting-interest events remain distinct from
  // software-product lifecycle events.
  "consulting_service_selected",
  "trial_status_checked",
]);
