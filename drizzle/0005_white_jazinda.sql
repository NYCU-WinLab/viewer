-- Bound documents are shared in the viewer again: whoever Nextcloud last
-- let in keeps that access as a grant (a Nextcloud owner who is not the
-- document owner becomes an editor).
INSERT INTO "document_grants" ("document_id", "user_id", "role")
SELECT d."id", a."user_id", CASE a."access" WHEN 'owner' THEN 'edit' ELSE a."access" END
FROM "nextcloud_access" a
JOIN "documents" d ON d."nextcloud_file_id" = a."file_id"
WHERE a."access" IS NOT NULL AND a."user_id" <> d."owner_id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
DROP TABLE "nextcloud_access" CASCADE;
