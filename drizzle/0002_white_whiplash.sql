CREATE TABLE "nextcloud_tokens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"nextcloud_user" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_versions" ADD COLUMN "nextcloud_etag" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "nextcloud_user" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "nextcloud_path" text;--> statement-breakpoint
ALTER TABLE "nextcloud_tokens" ADD CONSTRAINT "nextcloud_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_nextcloud_user_nextcloud_path_index" ON "documents" USING btree ("nextcloud_user","nextcloud_path");