CREATE TABLE "guest_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"role" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guest_links_secretHash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "guest_link_id" uuid;--> statement-breakpoint
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_links" ADD CONSTRAINT "guest_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guest_links_document_id_index" ON "guest_links" USING btree ("document_id");