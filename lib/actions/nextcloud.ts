import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm"
import { z } from "zod"

import { accessTo, requireAccess } from "@/lib/actions/access"
import { type Actor, defineAction } from "@/lib/actions/define"
import { MAX_DOCUMENT_BYTES, storeVersion } from "@/lib/actions/documents"
import { db } from "@/lib/db"
import {
  documentGrants,
  documents,
  documentVersions,
  nextcloudTokens,
} from "@/lib/db/schema"
import {
  canLinkNextcloud,
  downloadMemberFile,
  exchangeCode,
  listMemberFolder,
  memberFileInfo,
  type NextcloudToken,
  refreshToken,
  TokenRevoked,
} from "@/lib/nextcloud"
import { seal, unseal } from "@/lib/seal"

// A member's own Nextcloud files: link the account once (OAuth 2 through
// /nextcloud/connect), then browse folders and import a PDF, Word or
// PowerPoint file as a document. Importing the same file again adds a
// version to the document it became, when the file has changed.

const KINDS = /\.(pdf|docx|pptx)$/i
const path = z.string().min(1).max(2000).startsWith("/")
const id = z.uuid().transform((value) => value.toLowerCase())

/** The member's token, refreshed when it has expired. Nextcloud rotates
 * the refresh token on each use, so the row stays locked meanwhile. A
 * refresh Nextcloud refuses unlinks the member (the delete commits before
 * the error); a timeout or server error keeps the link for the next try. */
async function tokenOf(actor: Actor): Promise<NextcloudToken> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(nextcloudTokens)
      .where(eq(nextcloudTokens.userId, actor.userId))
      .for("update")
    if (!row) throw new Error("還沒連結 Nextcloud")
    // Tokens sealed under an older BETTER_AUTH_SECRET cannot be opened:
    // the member links again.
    let saved: { access: string; refresh: string }
    try {
      saved = {
        access: unseal(row.accessToken),
        refresh: unseal(row.refreshToken),
      }
    } catch {
      await tx
        .delete(nextcloudTokens)
        .where(eq(nextcloudTokens.userId, actor.userId))
      return null
    }
    if (row.expiresAt.getTime() > Date.now())
      return {
        accessToken: saved.access,
        refreshToken: saved.refresh,
        expiresAt: row.expiresAt,
        user: row.nextcloudUser,
      }
    let fresh: NextcloudToken
    try {
      fresh = await refreshToken(saved.refresh)
    } catch (error) {
      if (!(error instanceof TokenRevoked))
        throw new Error("暫時連不上 Nextcloud，請稍後再試")
      await tx
        .delete(nextcloudTokens)
        .where(eq(nextcloudTokens.userId, actor.userId))
      return null
    }
    await tx
      .update(nextcloudTokens)
      .set({
        accessToken: seal(fresh.accessToken),
        refreshToken: seal(fresh.refreshToken),
        expiresAt: fresh.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(nextcloudTokens.userId, actor.userId))
    return fresh
  })
  if (!result) throw new Error("Nextcloud 連結已失效，請重新連結")
  return result
}

export const nextcloudStatus = defineAction({
  name: "nextcloud_status",
  title: "Nextcloud 連結狀態",
  description:
    "Whether the member has linked their Nextcloud account (and which Nextcloud user it is), and whether the viewer can link one at all.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const [row] = await db
      .select({ user: nextcloudTokens.nextcloudUser })
      .from(nextcloudTokens)
      .where(eq(nextcloudTokens.userId, actor.userId))
    return {
      available: canLinkNextcloud(),
      linked: !!row,
      user: row?.user ?? null,
    }
  },
})

export const linkNextcloud = defineAction({
  name: "link_nextcloud",
  title: "連結 Nextcloud",
  description:
    "Finishes linking the member's Nextcloud account with the code Nextcloud returned to /nextcloud/callback.",
  kind: "mutation",
  mcpExcludedBecause:
    "the code comes from Nextcloud's sign-in page in the member's browser; an agent starts linking by sending the member to /nextcloud/connect",
  input: z.object({ code: z.string().min(1).max(500) }),
  run: async (actor, { code }) => {
    const token = await exchangeCode(code).catch((error) => {
      if (error instanceof TokenRevoked)
        throw new Error("Nextcloud 沒有授權，請再試一次")
      throw error
    })
    const values = {
      nextcloudUser: token.user,
      accessToken: seal(token.accessToken),
      refreshToken: seal(token.refreshToken),
      expiresAt: token.expiresAt,
      updatedAt: new Date(),
    }
    await db
      .insert(nextcloudTokens)
      .values({ userId: actor.userId, ...values })
      .onConflictDoUpdate({ target: nextcloudTokens.userId, set: values })
    return { user: token.user }
  },
})

export const unlinkNextcloud = defineAction({
  name: "unlink_nextcloud",
  title: "解除 Nextcloud 連結",
  description:
    "Forgets the member's Nextcloud tokens. Documents already imported stay.",
  kind: "mutation",
  input: z.object({}),
  run: async (actor) => {
    await db
      .delete(nextcloudTokens)
      .where(eq(nextcloudTokens.userId, actor.userId))
    return { unlinked: true }
  },
})

export const listNextcloudFiles = defineAction({
  name: "list_nextcloud_files",
  title: "Nextcloud 檔案",
  description:
    'One folder of the member\'s own Nextcloud files ("/" is the top): its folders and the PDF, Word and PowerPoint files the viewer can import, with path, size and when each changed. Needs a linked Nextcloud account (nextcloud_status).',
  kind: "query",
  input: z.object({ path: path.default("/") }),
  run: async (actor, input) => {
    const token = await tokenOf(actor)
    const entries = await listMemberFolder(token, input.path)
    return entries.filter((entry) => entry.folder || KINDS.test(entry.name))
  },
})

export const importNextcloudFile = defineAction({
  name: "import_nextcloud_file",
  title: "從 Nextcloud 匯入",
  description:
    "Opens a PDF, Word or PowerPoint file from the member's Nextcloud by path as a document. A file is bound to one document by its Nextcloud file id, so a rename, a move or another member opening the same shared file finds that document; a member who can read the file there and cannot see the document yet gets comment access to it. When the file changed since its last import, its new content becomes the next version first. With documentId the file becomes the next version of that document instead (needs edit access). Returns the document id, its version and unchanged when nothing new was stored.",
  kind: "mutation",
  input: z.object({ path, documentId: id.optional() }),
  run: async (actor, input) => {
    const fileName = input.path.split("/").pop() ?? ""
    if (!KINDS.test(fileName))
      throw new Error("只能匯入 PDF、Word 或 PowerPoint")
    if (input.documentId) await requireAccess(actor, input.documentId, "edit")
    const token = await tokenOf(actor)
    const info = await memberFileInfo(token, input.path)
    if (info.size > MAX_DOCUMENT_BYTES) throw new Error("檔案太大")
    const source = {
      user: token.user,
      path: input.path,
      etag: info.etag,
      fileId: info.fileId,
    }
    const store = async (documentId?: string) => {
      const file = await downloadMemberFile(
        token,
        input.path,
        MAX_DOCUMENT_BYTES
      )
      const stored = await storeVersion(actor, {
        body: file.body,
        fileName,
        documentId,
        nextcloud: { ...source, etag: file.etag || info.etag },
      })
      return { ...stored, unchanged: false }
    }
    if (input.documentId) return store(input.documentId)

    // One import of a file at a time, so two members opening it together
    // add one version, not two.
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${"nextcloud:" + info.fileId}))`
      )
      // The document this file became: by its Nextcloud id, or (imported
      // before ids were kept) by this member's path.
      const [doc] = await tx
        .select({ id: documents.id, fileId: documents.nextcloudFileId })
        .from(documents)
        .where(
          or(
            eq(documents.nextcloudFileId, info.fileId),
            and(
              isNull(documents.nextcloudFileId),
              eq(documents.nextcloudUser, token.user),
              eq(documents.nextcloudPath, input.path)
            )
          )
        )
        .orderBy(desc(documents.createdAt))
        .limit(1)
      if (!doc) return store()
      if (!doc.fileId)
        await tx
          .update(documents)
          .set({ nextcloudFileId: info.fileId })
          .where(eq(documents.id, doc.id))
      // Reading the file in Nextcloud is the right to read it here.
      if (!(await accessTo(actor, doc.id)))
        await tx
          .insert(documentGrants)
          .values({ documentId: doc.id, userId: actor.userId, role: "comment" })
          .onConflictDoNothing()
      // The newest version that came from Nextcloud tells whether the file
      // changed; a version uploaded by hand in between does not count.
      const [latest] = await tx
        .select({
          number: documentVersions.number,
          etag: documentVersions.nextcloudEtag,
        })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, doc.id),
            isNotNull(documentVersions.nextcloudEtag)
          )
        )
        .orderBy(desc(documentVersions.number))
        .limit(1)
      if (latest && info.etag && latest.etag === info.etag) {
        const [current] = await tx
          .select({ number: documents.latestVersion })
          .from(documents)
          .where(eq(documents.id, doc.id))
        return { id: doc.id, version: current.number, unchanged: true }
      }
      return store(doc.id)
    })
  },
})
