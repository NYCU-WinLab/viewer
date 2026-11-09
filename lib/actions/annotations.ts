import { and, asc, eq, inArray } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { z } from "zod"

import { requireAccess } from "@/lib/actions/access"
import { type Actor, defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import {
  annotations,
  commentRevisions,
  comments,
  documents,
  documentVersions,
  user,
} from "@/lib/db/schema"

// Lowercase, matching how ids are stored and named in Nextcloud.
const uuid = z.uuid().transform((value) => value.toLowerCase())

const fraction = z.number().min(0).max(1)
const rect = z.tuple([fraction, fraction, fraction, fraction])
const point = z.tuple([fraction, fraction])

const geometry = z.union([
  z.object({ rects: z.array(rect).min(1).max(200) }),
  z.object({ points: z.array(point).min(2).max(2000) }),
])

const quote = z.object({
  exact: z.string().max(5000),
  prefix: z.string().max(200),
  suffix: z.string().max(200),
})

const body = z.string().trim().min(1, "留言不能空白").max(5000)

/** The document an annotation belongs to, or a not-found error. */
async function documentOf(annotationId: string) {
  const [row] = await db
    .select({ documentId: annotations.documentId })
    .from(annotations)
    .where(eq(annotations.id, annotationId))
  if (!row) throw new Error("找不到這個標記")
  return row.documentId
}

const resolver = alias(user, "resolver")

export const listAnnotations = defineAction({
  name: "list_annotations",
  title: "標記與留言",
  description:
    "Every mark on one version of a document, in page order: id, tool (highlight, box, pen), page, geometry in page fractions, the quoted text if any, author, whether and by whom it was resolved, and its sticky note thread (each comment with author, body, times, and earlier wordings when edited).",
  kind: "query",
  input: z.object({ id: uuid, version: z.number().int().positive() }),
  run: async (actor, { id, version }) => {
    await requireAccess(actor, id, "view")
    const marks = await db
      .select({
        id: annotations.id,
        tool: annotations.tool,
        page: annotations.page,
        geometry: annotations.geometry,
        quote: annotations.quote,
        authorId: annotations.authorId,
        author: user.name,
        resolvedAt: annotations.resolvedAt,
        resolvedBy: resolver.name,
        createdAt: annotations.createdAt,
      })
      .from(annotations)
      .innerJoin(
        documentVersions,
        eq(documentVersions.id, annotations.versionId)
      )
      .leftJoin(user, eq(user.id, annotations.authorId))
      .leftJoin(resolver, eq(resolver.id, annotations.resolvedBy))
      .where(
        and(
          eq(annotations.documentId, id),
          eq(documentVersions.number, version)
        )
      )
      .orderBy(asc(annotations.page), asc(annotations.createdAt))
    const ids = marks.map((mark) => mark.id)
    const notes = ids.length
      ? await db
          .select({
            id: comments.id,
            annotationId: comments.annotationId,
            authorId: comments.authorId,
            author: user.name,
            body: comments.body,
            createdAt: comments.createdAt,
            editedAt: comments.editedAt,
          })
          .from(comments)
          .leftJoin(user, eq(user.id, comments.authorId))
          .where(inArray(comments.annotationId, ids))
          .orderBy(asc(comments.createdAt))
      : []
    const noteIds = notes.filter((n) => n.editedAt).map((n) => n.id)
    const revisions = noteIds.length
      ? await db
          .select({
            commentId: commentRevisions.commentId,
            body: commentRevisions.body,
            replacedAt: commentRevisions.replacedAt,
          })
          .from(commentRevisions)
          .where(inArray(commentRevisions.commentId, noteIds))
          .orderBy(asc(commentRevisions.replacedAt))
      : []
    return marks.map((mark) => ({
      ...mark,
      mine: mark.authorId === actor.userId,
      resolvedAt: mark.resolvedAt?.toISOString() ?? null,
      createdAt: mark.createdAt.toISOString(),
      comments: notes
        .filter((note) => note.annotationId === mark.id)
        .map((note) => ({
          id: note.id,
          authorId: note.authorId,
          author: note.author,
          mine: note.authorId === actor.userId,
          body: note.body,
          createdAt: note.createdAt.toISOString(),
          editedAt: note.editedAt?.toISOString() ?? null,
          revisions: revisions
            .filter((r) => r.commentId === note.id)
            .map((r) => ({
              body: r.body,
              replacedAt: r.replacedAt.toISOString(),
            })),
        })),
    }))
  },
})

export const addAnnotation = defineAction({
  name: "add_annotation",
  title: "新增標記",
  description:
    "Marks one page of a document version: highlight (rects over text, with its quote), box (one rect) or pen (a stroke of points). Coordinates are page fractions from the top left. An optional first comment starts its sticky note. Needs comment access.",
  kind: "mutation",
  input: z.object({
    id: uuid,
    version: z.number().int().positive(),
    tool: z.enum(["highlight", "box", "pen"]),
    page: z.number().int().positive(),
    geometry,
    quote: quote.optional(),
    comment: body.optional(),
  }),
  run: async (actor, input) => {
    await requireAccess(actor, input.id, "comment")
    if ("points" in input.geometry !== (input.tool === "pen"))
      throw new Error("pen 用 points，其他工具用 rects")
    const [version] = await db
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, input.id),
          eq(documentVersions.number, input.version)
        )
      )
    if (!version) throw new Error("找不到這個版本")
    return db.transaction(async (tx) => {
      const [mark] = await tx
        .insert(annotations)
        .values({
          documentId: input.id,
          versionId: version.id,
          authorId: actor.userId,
          tool: input.tool,
          page: input.page,
          geometry: input.geometry,
          quote: input.quote ?? null,
        })
        .returning({ id: annotations.id })
      if (input.comment)
        await tx.insert(comments).values({
          annotationId: mark.id,
          authorId: actor.userId,
          body: input.comment,
        })
      await tx
        .update(documents)
        .set({ updatedAt: new Date() })
        .where(eq(documents.id, input.id))
      return { id: mark.id }
    })
  },
})

export const deleteAnnotation = defineAction({
  name: "delete_annotation",
  title: "刪除標記",
  description:
    "Deletes a mark and its sticky note. Its author can, and anyone with edit access.",
  kind: "mutation",
  input: z.object({ id: uuid }),
  run: async (actor, { id }) => {
    const documentId = await documentOf(id)
    const access = await requireAccess(actor, documentId, "comment")
    const [mark] = await db
      .select({ authorId: annotations.authorId })
      .from(annotations)
      .where(eq(annotations.id, id))
    if (mark.authorId !== actor.userId && access === "comment")
      throw new Error("只能刪除自己的標記")
    await db.delete(annotations).where(eq(annotations.id, id))
    return { id }
  },
})

export const resolveAnnotation = defineAction({
  name: "resolve_annotation",
  title: "標記已處理",
  description:
    "Marks a mark as handled (resolved: true) or opens it again (false). Needs comment access.",
  kind: "mutation",
  input: z.object({ id: uuid, resolved: z.boolean() }),
  run: async (actor, { id, resolved }) => {
    await requireAccess(actor, await documentOf(id), "comment")
    await db
      .update(annotations)
      .set(
        resolved
          ? { resolvedAt: new Date(), resolvedBy: actor.userId }
          : { resolvedAt: null, resolvedBy: null }
      )
      .where(eq(annotations.id, id))
    return { id, resolved }
  },
})

export const addComment = defineAction({
  name: "add_comment",
  title: "留言",
  description: "Adds a comment to a mark's sticky note. Needs comment access.",
  kind: "mutation",
  input: z.object({ annotationId: uuid, body }),
  run: async (actor, input) => {
    await requireAccess(actor, await documentOf(input.annotationId), "comment")
    const [note] = await db
      .insert(comments)
      .values({ ...input, authorId: actor.userId })
      .returning({ id: comments.id })
    return { id: note.id }
  },
})

/** The comment, after checking the member may still comment on its
 * document and wrote it. */
async function ownComment(actor: Actor, commentId: string) {
  const [note] = await db
    .select({
      authorId: comments.authorId,
      body: comments.body,
      documentId: annotations.documentId,
    })
    .from(comments)
    .innerJoin(annotations, eq(annotations.id, comments.annotationId))
    .where(eq(comments.id, commentId))
  if (!note) throw new Error("找不到這則留言")
  await requireAccess(actor, note.documentId, "comment")
  if (note.authorId !== actor.userId) throw new Error("只能改自己的留言")
  return note
}

export const editComment = defineAction({
  name: "edit_comment",
  title: "修改留言",
  description:
    "Rewrites the member's own comment; the earlier wording is kept and shown as its history.",
  kind: "mutation",
  input: z.object({ id: uuid, body }),
  run: async (actor, input) => {
    const note = await ownComment(actor, input.id)
    if (note.body === input.body) return { id: input.id }
    await db.transaction(async (tx) => {
      await tx
        .insert(commentRevisions)
        .values({ commentId: input.id, body: note.body })
      await tx
        .update(comments)
        .set({ body: input.body, editedAt: new Date() })
        .where(eq(comments.id, input.id))
    })
    return { id: input.id }
  },
})

export const deleteComment = defineAction({
  name: "delete_comment",
  title: "刪除留言",
  description:
    "Deletes one of the member's own comments from a sticky note, with its earlier wordings. Other members' comments cannot be deleted.",
  kind: "mutation",
  input: z.object({ id: uuid }),
  run: async (actor, { id }) => {
    await ownComment(actor, id)
    await db.delete(comments).where(eq(comments.id, id))
    return { id }
  },
})
