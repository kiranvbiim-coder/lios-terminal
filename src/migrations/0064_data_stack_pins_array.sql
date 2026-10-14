-- data_stack_pins was originally shaped as an object ('{}') with no reader
-- or writer anywhere in the codebase -- P0.3 (docs/LIOS_V4_REAUDIT_2026-09-20.md)
-- gives it real, validated content: an array of pin records (see
-- shared/dataStackPins.ts). No legitimate pins existed before this change
-- (nothing ever wrote to the column), so normalizing any leftover '{}'
-- default rows to '[]' is safe and loses no user data.
ALTER TABLE "environment_setups" ALTER COLUMN "data_stack_pins" SET DEFAULT '[]'::jsonb;--> statement-breakpoint
UPDATE "environment_setups" SET "data_stack_pins" = '[]'::jsonb WHERE "data_stack_pins" = '{}'::jsonb;
