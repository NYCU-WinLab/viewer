CREATE TABLE "nextcloud_access" (
	"user_id" uuid NOT NULL,
	"file_id" text NOT NULL,
	"nextcloud_user" text NOT NULL,
	"access" text,
	"checked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "nextcloud_access_user_id_file_id_pk" PRIMARY KEY("user_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "nextcloud_access" ADD CONSTRAINT "nextcloud_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;