import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { z } from "zod"

import { requireAccess } from "@/lib/actions/access"
import { defineAction } from "@/lib/actions/define"
import {
  accessFromNextcloud,
  rememberAccess,
} from "@/lib/actions/nextcloud-access"
import { tokenOf } from "@/lib/actions/nextcloud-token"
import {
  MAX_DOCUMENT_BYTES,
  storeVersion,
  type Tx,
} from "@/lib/actions/documents"
import { db } from "@/lib/db"
import {
  documents,
  documentVersions,
  nextcloudAccess,
  nextcloudTokens,
} from "@/lib/db/schema"
import {
  canLinkNextcloud,
  downloadMemberFile,
  exchangeCode,
  listMemberFolder,
  memberFileInfo,
  TokenRevoked,
} from "@/lib/nextcloud"
import { seal } from "@/lib/seal"

// A member's own Nextcloud files: link the account once (OAuth 2 through
// /nextcloud/connect), then browse folders and import a PDF, Word or
// PowerPoint file as a document. Importing the same file again adds a
// version to the document it became, when the file has changed.

const KINDS = /\.(pdf|docx|pptx)$/i
const path = z.string().min(1).max(2000).startsWith("/")
const id = z.uuid().transform((value) => value.toLowerCase())

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
    // Another Nextcloud account may see other files: forget what the old
    // link was allowed.
    await db.transaction(async (tx) => {
      await tx
        .insert(nextcloudTokens)
        .values({ userId: actor.userId, ...values })
        .onConflictDoUpdate({ target: nextcloudTokens.userId, set: values })
      await tx
        .delete(nextcloudAccess)
        .where(eq(nextcloudAccess.userId, actor.userId))
    })
    return { user: token.user }
  },
})

export const unlinkNextcloud = defineAction({
  name: "unlink_nextcloud",
  title: "解除 Nextcloud 連結",
  description:
    "Forgets the member's Nextcloud tokens. Documents already imported stay, but the member loses the documents they could open through Nextcloud until they link again.",
  kind: "mutation",
  input: z.object({}),
  run: async (actor) => {
    await db.transaction(async (tx) => {
      await tx
        .delete(nextcloudTokens)
        .where(eq(nextcloudTokens.userId, actor.userId))
      await tx
        .delete(nextcloudAccess)
        .where(eq(nextcloudAccess.userId, actor.userId))
    })
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
    "Opens a PDF, Word or PowerPoint file from the member's Nextcloud by path as a document. A file is bound to one document by its Nextcloud file id, so a rename, a move or another member opening the same shared file finds that document. Such a document is shared in Nextcloud only: reading the file there gives comment access, writing it edit, owning it owner. When the file changed since its last import, its new content becomes the next version first. With documentId the file becomes the next version of that document instead (needs edit access). Returns the document id, its version and unchanged when nothing new was stored.",
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
    // Nextcloud just showed the file to this member: their access to its
    // document is what they may do with it there, from now on.
    await rememberAccess(actor, [
      { fileId: info.fileId, access: accessFromNextcloud(token.user, info) },
    ])
    const source = {
      user: token.user,
      path: input.path,
      etag: info.etag,
      fileId: info.fileId,
    }
    const store = async (documentId?: string, within?: Tx) => {
      const file = await downloadMemberFile(
        token,
        input.path,
        MAX_DOCUMENT_BYTES,
        info.etag || undefined
      )
      const stored = await storeVersion(actor, {
        body: file.body,
        fileName,
        documentId,
        within,
        nextcloud: { ...source, etag: file.etag || info.etag },
      })
      return { ...stored, unchanged: false }
    }
    if (input.documentId) return store(input.documentId)

    // One import of a file at a time, so members opening it together add
    // one version, not one each. A member who finds it busy waits without
    // holding a connection, and everything below runs on the one
    // transaction that holds the lock.
    for (let attempt = 0; attempt < 120; attempt++) {
      const result = await db.transaction(async (tx) => {
        const [{ locked }] = (
          await tx.execute<{ locked: boolean }>(
            sql`select pg_try_advisory_xact_lock(hashtext(${"nextcloud:" + info.fileId})) as locked`
          )
        ).rows
        if (!locked) return null
        return importLocked(tx)
      })
      if (result) return result
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error("這份檔案正在匯入，請稍後再打開")

    async function importLocked(tx: Tx) {
      // The document this file became: by its Nextcloud id, else (imported
      // before ids were kept) by this member's path.
      const [byId] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.nextcloudFileId, info.fileId))
        .orderBy(desc(documents.createdAt))
        .limit(1)
      const [byPath] = byId
        ? []
        : await tx
            .select({ id: documents.id })
            .from(documents)
            .where(
              and(
                isNull(documents.nextcloudFileId),
                eq(documents.nextcloudUser, token.user),
                eq(documents.nextcloudPath, input.path)
              )
            )
            .orderBy(desc(documents.createdAt))
            .limit(1)
      const doc = byId ?? byPath
      if (!doc) return store(undefined, tx)
      if (byPath)
        await tx
          .update(documents)
          .set({ nextcloudFileId: info.fileId })
          .where(eq(documents.id, doc.id))
      // The newest version that came from Nextcloud tells whether the file
      // changed; a version uploaded by hand in between does not count.
      const [latest] = await tx
        .select({ etag: documentVersions.nextcloudEtag })
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
      return store(doc.id, tx)
    }
  },
})
