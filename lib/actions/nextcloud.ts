import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"
import { z } from "zod"

import { accessTo, requireAccess } from "@/lib/actions/access"
import { defineAction } from "@/lib/actions/define"
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
  nextcloudTokens,
  user,
} from "@/lib/db/schema"
import {
  canLinkNextcloud,
  downloadMemberFile,
  exchangeCode,
  listMemberFolder,
  memberFileById,
  memberFileInfo,
  TokenRevoked,
} from "@/lib/nextcloud"
import { seal } from "@/lib/seal"

// A member's own Nextcloud files: link the account once (OAuth 2 through
// /nextcloud/connect), then browse folders and import a PDF, Word or
// PowerPoint file as a document. Nextcloud only binds the file to its
// document at import; who may open the document is decided in the viewer
// like any other. A newer file becomes a version only when an editor
// checks and syncs it.

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
    "Forgets the member's Nextcloud tokens. Documents already imported stay, with the same access.",
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
    "Opens a PDF, Word or PowerPoint file from the member's Nextcloud by path as a document the member owns. A file is bound to one document by its Nextcloud file id: importing it again, after a rename or a move, opens that document when the member has access to it in the viewer, and is refused otherwise (its owner shares it with share_document). Importing never adds a version; check_nextcloud_version and sync_nextcloud_version do. With documentId the file becomes the next version of that document instead (needs edit access). Returns the document id, its version and unchanged when nothing new was stored.",
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
    if (input.documentId) {
      // Into a document bound to another file (or none), the version keeps
      // no ETag: only the bound file's own ETags tell whether it changed.
      const [target] = await db
        .select({ fileId: documents.nextcloudFileId })
        .from(documents)
        .where(eq(documents.id, input.documentId))
      if (target?.fileId !== info.fileId) {
        const file = await downloadMemberFile(
          token,
          input.path,
          MAX_DOCUMENT_BYTES,
          info.etag || undefined
        )
        const stored = await storeVersion(actor, {
          body: file.body,
          fileName,
          documentId: input.documentId,
        })
        return { ...stored, unchanged: false }
      }
      return store(input.documentId)
    }

    // One import of a file at a time, so members opening it together make
    // one document, not one each. A member who finds it busy waits without
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
      // Access is the viewer's: the file is already a document, and the
      // member opens it only when it is shared with them here. Nextcloud
      // just showed them the file, so naming its owner tells them nothing
      // they could not see there.
      if (!(await accessTo(actor, doc.id))) {
        const [owner] = await tx
          .select({ name: user.name })
          .from(documents)
          .innerJoin(user, eq(user.id, documents.ownerId))
          .where(eq(documents.id, doc.id))
        throw new Error(
          `這份檔案已經在 Viewer，請${owner?.name ?? "擁有者"}共用給你`
        )
      }
      const [current] = await tx
        .select({ number: documents.latestVersion })
        .from(documents)
        .where(eq(documents.id, doc.id))
      return { id: doc.id, version: current.number, unchanged: true }
    }
  },
})

/** The bound file's id and the ETag of its newest version that came from
 * Nextcloud (a version uploaded by hand in between does not count). */
async function boundFile(documentId: string, conn: Tx | typeof db = db) {
  const [doc] = await conn
    .select({ fileId: documents.nextcloudFileId })
    .from(documents)
    .where(eq(documents.id, documentId))
  if (!doc?.fileId) throw new Error("這份文件沒有綁定 Nextcloud 檔案")
  const [latest] = await conn
    .select({ etag: documentVersions.nextcloudEtag })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.documentId, documentId),
        isNotNull(documentVersions.nextcloudEtag)
      )
    )
    .orderBy(desc(documentVersions.number))
    .limit(1)
  return { fileId: doc.fileId, etag: latest?.etag ?? null }
}

/** The bound file in the member's Nextcloud; a refused token asks them to
 * link again instead of surfacing the WebDAV method. */
async function fileById(
  token: Awaited<ReturnType<typeof tokenOf>>,
  fileId: string
) {
  try {
    return await memberFileById(token, fileId)
  } catch (error) {
    if (error instanceof TokenRevoked)
      throw new Error("Nextcloud 連結已失效，請重新連結")
    throw error
  }
}

export const checkNextcloudVersion = defineAction({
  name: "check_nextcloud_version",
  title: "檢查 Nextcloud 版本",
  description:
    "For a document bound to a Nextcloud file: whether the file in Nextcloud still matches the document's last version from it. Asks Nextcloud with the member's own linked account. Returns status current, changed (sync_nextcloud_version stores it), or missing (the member cannot reach the file), with the file's path and when it changed. Needs edit access.",
  kind: "query",
  input: z.object({ id }),
  run: async (actor, { id }) => {
    await requireAccess(actor, id, "edit")
    const bound = await boundFile(id)
    const token = await tokenOf(actor)
    const file = await fileById(token, bound.fileId)
    if (!file) return { status: "missing" as const, path: null, modified: null }
    return {
      status:
        bound.etag && file.etag === bound.etag
          ? ("current" as const)
          : ("changed" as const),
      path: file.path,
      modified: file.modified,
    }
  },
})

export const syncNextcloudVersion = defineAction({
  name: "sync_nextcloud_version",
  title: "同步 Nextcloud 版本",
  description:
    "For a document bound to a Nextcloud file: stores the file's current content as the document's next version when it changed since the last one from Nextcloud. Uses the member's own linked account. Returns the version and unchanged when the file was already current. Needs edit access.",
  kind: "mutation",
  input: z.object({ id }),
  run: async (actor, { id }) => {
    await requireAccess(actor, id, "edit")
    const bound = await boundFile(id)
    const token = await tokenOf(actor)
    const file = await fileById(token, bound.fileId)
    if (!file) throw new Error("你的 Nextcloud 找不到這份檔案")
    const fileName = file.path.split("/").pop() ?? ""
    if (!KINDS.test(fileName))
      throw new Error("這份檔案已不是 PDF、Word 或 PowerPoint")
    if (file.size > MAX_DOCUMENT_BYTES) throw new Error("檔案太大")
    // One sync of a document at a time; a second one waits (at most 30
    // seconds, on this connection only) and then finds the file stored.
    return db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '30s'`)
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${"nextcloud:" + bound.fileId}))`
      )
      const again = await boundFile(id, tx)
      const [current] = await tx
        .select({ number: documents.latestVersion })
        .from(documents)
        .where(eq(documents.id, id))
      if (again.etag && again.etag === file.etag)
        return { id, version: current.number, unchanged: true }
      const body = await downloadMemberFile(
        token,
        file.path,
        MAX_DOCUMENT_BYTES,
        file.etag || undefined
      )
      const stored = await storeVersion(actor, {
        body: body.body,
        fileName,
        documentId: id,
        within: tx,
        nextcloud: {
          user: token.user,
          path: file.path,
          etag: body.etag || file.etag,
          fileId: bound.fileId,
        },
      })
      return { ...stored, unchanged: false }
    })
  },
})
