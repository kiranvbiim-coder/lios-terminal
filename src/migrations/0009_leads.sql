CREATE TABLE "leads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "leads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"email" text NOT NULL,
	"company" text,
	"message" text,
	"source" text DEFAULT 'experience_center' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
