CREATE TABLE "sessions" (
	"sid" text PRIMARY KEY NOT NULL,
	"session_data" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL
);
