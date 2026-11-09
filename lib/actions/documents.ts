import { readFile, rm } from "node:fs/promises"

import { and, desc, eq, inArray, or, sql } from "drizzle-orm"
import { z } from "zod"

import { accessTo, requireAccess } from "@/lib/actions/access"
import { memberUserId } from "@/lib/actions/members"
import { type Actor, defineAction } from "@/lib/actions/define"
import { toPdf } from "@/lib/convert"
import { db } from "@/lib/db"
import {
  annotations,
  documentGrants,
  documents,
  documentVersions,
  type DocumentKind,
  user,
} from "@/lib/db/schema"
import { deleteDocumentFiles, putDocumentFiles } from "@/lib/nextcloud"

export const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024

// Lowercase, so one document never maps to two Nextcloud folders.
const id = z.uuid("文件 id 格式不對").transform((value) => value.toLowerCase())

/** The kind of an upload, from its name; anything else is refused. */
export function kindOf(fileName: string): DocumentKind {
  const extension = fileName.split(".").pop()?.toLowerCase()
  if (extension === "pdf" || extension === "docx" || extension === "pptx")
    return extension
  throw new Error("只收 PDF、Word(.docx)和 PowerPoint(.pptx)")
}

/** The name a document gets from its first file: the file name without
 * its extension. */
function baseName(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "未命名文件"
}

export function originalFile(number: number, kind: DocumentKind) {
  return `v${number}.${kind}`
}

export function pdfFile(number: number) {
  return `v${number}.pdf`
}

export const listDocuments = defineAction({
  name: "list_documents",
  title: "文件清單",
  description:
    "Documents the member can open: their own and those shared with them, newest change first. Each has id, name, owner name, the member's access (owner, edit, comment or view), the latest version number and file kind (pdf, docx, pptx), and how many marks are still open.",
  kind: "query",
  input: z.object({}),
  run: async (actor) => {
    const rows = await db
      .select({
        id: documents.id,
        name: documents.name,
        ownerId: documents.ownerId,
        ownerName: user.name,
        role: documentGrants.role,
        latestVersion: documents.latestVersion,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .innerJoin(user, eq(user.id, documents.ownerId))
      .leftJoin(
        documentGrants,
        and(
          eq(documentGrants.documentId, documents.id),
          eq(documentGrants.userId, actor.userId)
        )
      )
      .where(
        and(
          sql`${documents.latestVersion} > 0`,
          or(
            eq(documents.ownerId, actor.userId),
            eq(documentGrants.userId, actor.userId)
          )
        )
      )
      .orderBy(desc(documents.updatedAt))
    if (rows.length === 0) return []
    const ids = rows.map((row) => row.id)
    const [kinds, open] = await Promise.all([
      db
        .select({
          documentId: documentVersions.documentId,
          number: documentVersions.number,
          kind: documentVersions.kind,
        })
        .from(documentVersions)
        .where(inArray(documentVersions.documentId, ids)),
      db
        .select({
          documentId: annotations.documentId,
          count: sql<number>`count(*)::int`,
        })
        .from(annotations)
        .where(
          and(
            inArray(annotations.documentId, ids),
            sql`${annotations.resolvedAt} is null`
          )
        )
        .groupBy(annotations.documentId),
    ])
    const openBy = new Map(open.map((row) => [row.documentId, row.count]))
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      ownerName: row.ownerName,
      access: row.ownerId === actor.userId ? ("owner" as const) : row.role!,
      latestVersion: row.latestVersion,
      kind:
        kinds.find(
          (k) => k.documentId === row.id && k.number === row.latestVersion
        )?.kind ?? "pdf",
      openMarks: openBy.get(row.id) ?? 0,
      updatedAt: row.updatedAt.toISOString(),
    }))
  },
})

export const getDocument = defineAction({
  name: "get_document",
  title: "文件",
  description:
    "One document: name, owner, the member's access, and every version (number, kind, file name, size, who uploaded it, when), newest last. Returns null when it does not exist or the member may not open it.",
  kind: "query",
  guests: true,
  input: z.object({ id }),
  run: async (actor, { id }) => {
    const access = await accessTo(actor, id)
    if (!access) return null
    const [doc] = await db
      .select({
        id: documents.id,
        name: documents.name,
        ownerId: documents.ownerId,
        ownerName: user.name,
        latestVersion: documents.latestVersion,
      })
      .from(documents)
      .innerJoin(user, eq(user.id, documents.ownerId))
      .where(eq(documents.id, id))
    const versions = await db
      .select({
        id: documentVersions.id,
        number: documentVersions.number,
        kind: documentVersions.kind,
        fileName: documentVersions.fileName,
        size: documentVersions.size,
        uploadedBy: user.name,
        createdAt: documentVersions.createdAt,
      })
      .from(documentVersions)
      .leftJoin(user, eq(user.id, documentVersions.uploadedBy))
      .where(eq(documentVersions.documentId, id))
      .orderBy(documentVersions.number)
    return {
      ...doc,
      access,
      versions: versions.map((v) => ({
        ...v,
        createdAt: v.createdAt.toISOString(),
      })),
    }
  },
})

export const uploadDocument = defineAction({
  name: "upload_document",
  title: "上傳文件",
  description:
    "Takes an uploaded file from the server's temp folder: a new document, or with documentId a new version of one the member may edit.",
  kind: "mutation",
  mcpExcludedBecause:
    "it reads a file the upload route wrote on the server; an agent has no such file",
  input: z.object({
    file: z.string(),
    fileName: z.string().min(1).max(255),
    documentId: id.optional(),
  }),
  run: async (actor, input) => {
    try {
      if (input.documentId) await requireAccess(actor, input.documentId, "edit")
      const body = new Uint8Array(await readFile(input.file))
      return await storeVersion(actor, {
        body,
        fileName: input.fileName,
        documentId: input.documentId,
      })
    } finally {
      await rm(input.file, { force: true })
    }
  },
})

/**
 * Stores a file as a new document, or with documentId as the next version
 * of one (the caller has checked edit access). docx and pptx become PDF
 * first. A file from Nextcloud keeps where it came from, so importing it
 * again finds this document. Used by upload_document and
 * import_nextcloud_file.
 */
export async function storeVersion(
  actor: Actor,
  input: {
    body: Uint8Array
    fileName: string
    documentId?: string
    nextcloud?: { user: string; path: string; etag: string }
  }
) {
  const { body } = input
  const kind = kindOf(input.fileName)
  if (body.byteLength > MAX_DOCUMENT_BYTES) throw new Error("檔案太大")
  const pdf = kind === "pdf" ? body : await toPdf(kind, body)

  // A new document gets its row first (with no version yet, so nobody
  // lists it), then the files, then the version.
  const documentId =
    input.documentId ??
    (
      await db
        .insert(documents)
        .values({
          name: baseName(input.fileName),
          ownerId: actor.userId,
          nextcloudUser: input.nextcloud?.user,
          nextcloudPath: input.nextcloud?.path,
        })
        .returning({ id: documents.id })
    )[0].id
  try {
    return await db.transaction(async (tx) => {
      const [doc] = await tx
        .update(documents)
        .set({
          latestVersion: sql`${documents.latestVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId))
        .returning({ number: documents.latestVersion })
      await putDocumentFiles(documentId, [
        ...(kind === "pdf"
          ? []
          : [
              {
                name: originalFile(doc.number, kind),
                body,
                type: "application/octet-stream",
              },
            ]),
        { name: pdfFile(doc.number), body: pdf, type: "application/pdf" },
      ])
      await tx.insert(documentVersions).values({
        documentId,
        number: doc.number,
        kind,
        fileName: input.fileName,
        size: body.byteLength,
        nextcloudEtag: input.nextcloud?.etag,
        uploadedBy: actor.userId,
      })
      return { id: documentId, version: doc.number }
    })
  } catch (error) {
    if (!input.documentId) {
      await db.delete(documents).where(eq(documents.id, documentId))
      await deleteDocumentFiles(documentId).catch(() => {})
    }
    throw error
  }
}

export const renameDocument = defineAction({
  name: "rename_document",
  title: "重新命名文件",
  description:
    "Renames a document (the name shown in lists and the breadcrumb). Needs edit access; the file and its versions stay as they are.",
  kind: "mutation",
  input: z.object({
    id,
    name: z.string().trim().min(1, "名稱不能空白").max(200),
  }),
  run: async (actor, { id, name }) => {
    await requireAccess(actor, id, "edit")
    await db
      .update(documents)
      .set({ name, updatedAt: new Date() })
      .where(eq(documents.id, id))
    return { id, name }
  },
})

export const deleteDocument = defineAction({
  name: "delete_document",
  title: "刪除文件",
  description:
    "Deletes a document the member owns, with every version, mark and comment. Cannot be undone.",
  kind: "mutation",
  input: z.object({ id }),
  run: async (actor, { id }) => {
    await requireAccess(actor, id, "owner")
    await db.delete(documents).where(eq(documents.id, id))
    await deleteDocumentFiles(id)
    return { id }
  },
})

export const listShares = defineAction({
  name: "list_document_shares",
  title: "文件共用名單",
  description:
    "Who a document is shared with and their role (view, comment or edit), for a member who may edit it.",
  kind: "query",
  input: z.object({ id }),
  run: async (actor, { id }) => {
    await requireAccess(actor, id, "edit")
    return db
      .select({
        userId: documentGrants.userId,
        name: user.name,
        email: user.email,
        role: documentGrants.role,
      })
      .from(documentGrants)
      .innerJoin(user, eq(user.id, documentGrants.userId))
      .where(eq(documentGrants.documentId, id))
      .orderBy(user.name)
  },
})

const role = z.enum(["view", "comment", "edit"])

export const shareDocument = defineAction({
  name: "share_document",
  title: "共用文件",
  description:
    "Shares a document with a lab member (id from list_members) as view, comment or edit, or changes their role. Needs edit access; only the owner can hand out edit or change an editor's role.",
  kind: "mutation",
  input: z.object({ id, memberId: z.string().min(1), role }),
  run: async (actor, input) => {
    const access = await requireAccess(actor, input.id, "edit")
    if (input.role === "edit" && access !== "owner")
      throw new Error("只有擁有者可以給編輯權限")
    const userId = await memberUserId(input.memberId)
    await db.transaction(async (tx) => {
      // Locks the document's row, so two shares cannot race past the check.
      const [doc] = await tx
        .select({ ownerId: documents.ownerId })
        .from(documents)
        .where(eq(documents.id, input.id))
        .for("update")
      if (doc.ownerId === userId) throw new Error("擁有者本來就有全部權限")
      const [current] = await tx
        .select({ role: documentGrants.role })
        .from(documentGrants)
        .where(
          and(
            eq(documentGrants.documentId, input.id),
            eq(documentGrants.userId, userId)
          )
        )
      if (current?.role === "edit" && access !== "owner")
        throw new Error("只有擁有者可以變更編輯者")
      await tx
        .insert(documentGrants)
        .values({
          documentId: input.id,
          userId,
          role: input.role,
          grantedBy: actor.userId,
        })
        .onConflictDoUpdate({
          target: [documentGrants.documentId, documentGrants.userId],
          set: { role: input.role, grantedBy: actor.userId },
        })
    })
    return { id: input.id, userId, role: input.role }
  },
})

export const unshareDocument = defineAction({
  name: "unshare_document",
  title: "取消共用",
  description:
    "Stops sharing a document with a member (userId from list_document_shares). Needs edit access; only the owner can remove an editor.",
  kind: "mutation",
  input: z.object({
    id,
    userId: z.uuid().transform((value) => value.toLowerCase()),
  }),
  run: async (actor, input) => {
    const access = await requireAccess(actor, input.id, "edit")
    const where = and(
      eq(documentGrants.documentId, input.id),
      eq(documentGrants.userId, input.userId)
    )
    await db.transaction(async (tx) => {
      await tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, input.id))
        .for("update")
      const [grant] = await tx
        .select({ role: documentGrants.role })
        .from(documentGrants)
        .where(where)
      if (grant?.role === "edit" && access !== "owner")
        throw new Error("只有擁有者可以移除編輯者")
      await tx.delete(documentGrants).where(where)
    })
    return { id: input.id, userId: input.userId }
  },
})

export const getDocumentPdf = defineAction({
  name: "get_document_pdf",
  title: "文件 PDF",
  description: "Which stored PDF to stream for one version of a document.",
  kind: "query",
  guests: true,
  mcpExcludedBecause:
    "it names a file in storage for the /files route; agents read marks and comments instead",
  input: z.object({ id, version: z.number().int().positive() }),
  run: async (actor, { id, version }) => {
    if (!(await accessTo(actor, id))) return null
    const [row] = await db
      .select({ number: documentVersions.number })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, id),
          eq(documentVersions.number, version)
        )
      )
    return row ? { file: pdfFile(row.number) } : null
  },
})
