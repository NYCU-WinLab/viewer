-- Bound documents are shared in the viewer again: whoever Nextcloud last
-- let in keeps that access as a grant (a Nextcloud owner who is not the
-- document owner becomes an editor), only while the member is still linked
-- to the Nextcloud account that answered.
INSERT INTO "document_grants" ("document_id", "user_id", "role")
SELECT d."id", a."user_id", CASE a."access" WHEN 'owner' THEN 'edit' ELSE a."access" END
FROM "nextcloud_access" a
JOIN "documents" d ON d."nextcloud_file_id" = a."file_id"
JOIN "nextcloud_tokens" t ON t."user_id" = a."user_id" AND t."nextcloud_user" = a."nextcloud_user"
WHERE a."access" IS NOT NULL AND a."user_id" <> d."owner_id"
ON CONFLICT ("document_id", "user_id") DO UPDATE SET "role" = excluded."role"
WHERE array_position(ARRAY['view','comment','edit'], excluded."role") > array_position(ARRAY['view','comment','edit'], "document_grants"."role");--> statement-breakpoint
DROP TABLE "nextcloud_access" CASCADE;
