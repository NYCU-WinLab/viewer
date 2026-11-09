ALTER TABLE "documents" ADD COLUMN "nextcloud_file_id" text;--> statement-breakpoint
CREATE INDEX "documents_nextcloud_file_id_index" ON "documents" USING btree ("nextcloud_file_id");