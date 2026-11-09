import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"

import { accessTo, atLeast, requireAccess } from "@/lib/actions/access"
import { type Actor, defineAction } from "@/lib/actions/define"
import { MAX_DOCUMENT_BYTES, storeVersion } from "@/lib/actions/documents"
import { db } from "@/lib/db"
import { documents, documentVersions, nextcloudTokens } from "@/lib/db/schema"
import {
  canLinkNextcloud,
  downloadMemberFile,
  exchangeCode,
  listMemberFolder,
  type NextcloudToken,
  refreshToken,
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
 * the refresh token on each use, so the row stays locked meanwhile. */
async function tokenOf(actor: Actor): Promise<NextcloudToken> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(nextcloudTokens)
      .where(eq(nextcloudTokens.userId, actor.userId))
      .for("update")
    if (!row) throw new Error("還沒連結 Nextcloud")
    if (row.expiresAt.getTime() > Date.now())
      return {
        accessToken: unseal(row.accessToken),
        refreshToken: unseal(row.refreshToken),
        expiresAt: row.expiresAt,
        user: row.nextcloudUser,
      }
    let fresh: NextcloudToken
    try {
      fresh = await refreshToken(unseal(row.refreshToken))
    } catch {
      await tx
        .delete(nextcloudTokens)
        .where(eq(nextcloudTokens.userId, actor.userId))
      throw new Error("Nextcloud 連結已失效，請重新連結")
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
    const token = await exchangeCode(code)
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
    "Imports a PDF, Word or PowerPoint file from the member's Nextcloud by path. With documentId it becomes the next version of that document (needs edit access). Without it, a file imported before opens the document it became, with a new version when the file has changed and the member may edit; otherwise it becomes a new document. Returns the document id, its version and unchanged when nothing new was stored.",
  kind: "mutation",
  input: z.object({ path, documentId: id.optional() }),
  run: async (actor, input) => {
    const fileName = input.path.split("/").pop() ?? ""
    if (!KINDS.test(fileName))
      throw new Error("只能匯入 PDF、Word 或 PowerPoint")
    if (input.documentId) await requireAccess(actor, input.documentId, "edit")
    const token = await tokenOf(actor)
    const file = await downloadMemberFile(token, input.path, MAX_DOCUMENT_BYTES)
    const source = { user: token.user, path: input.path, etag: file.etag }

    let target = input.documentId
    if (!target) {
      // The document this file became before, if the member can open it.
      const earlier = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.nextcloudUser, token.user),
            eq(documents.nextcloudPath, input.path)
          )
        )
        .orderBy(desc(documents.createdAt))
      for (const doc of earlier) {
        const access = await accessTo(actor, doc.id)
        if (!access) continue
        const [latest] = await db
          .select({
            number: documentVersions.number,
            etag: documentVersions.nextcloudEtag,
          })
          .from(documentVersions)
          .where(eq(documentVersions.documentId, doc.id))
          .orderBy(desc(documentVersions.number))
          .limit(1)
        if (
          !latest ||
          (file.etag && latest.etag === file.etag) ||
          !atLeast(access, "edit")
        )
          return { id: doc.id, version: latest?.number ?? 0, unchanged: true }
        target = doc.id
        break
      }
    }
    const stored = await storeVersion(actor, {
      body: file.body,
      fileName,
      documentId: target,
      nextcloud: source,
    })
    return { ...stored, unchanged: false }
  },
})
