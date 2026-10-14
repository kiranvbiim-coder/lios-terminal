-- LV4-03-06: which billing provider an organization's providerCustomerId
-- actually belongs to -- needed to call the right provider's API for
-- customer portal handoff (and any future multi-provider operation).
-- See schema.ts's doc comment for the full rationale.
ALTER TABLE "organization_licenses" ADD COLUMN "provider" text;