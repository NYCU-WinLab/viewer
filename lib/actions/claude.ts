import { asc, eq } from "drizzle-orm"
import { z } from "zod"

import { requireAccess } from "@/lib/actions/access"
import { listAnnotations } from "@/lib/actions/annotations"
import { defineAction } from "@/lib/actions/define"
import { explain, replyInNote, summarize } from "@/lib/anthropic"
import { db } from "@/lib/db"
import { annotations, comments, documents, user } from "@/lib/db/schema"

// Lowercase, matching how ids are stored and named in Nextcloud.
const uuid = z.uuid().transform((value) => value.toLowerCase())

/** A JPEG the reader cut from a page, base64 without the data: prefix;
 * small enough for a server action's 1 MB body. */
const image = z
  .string()
  .max(900_000, "圖太大")
  .regex(/^[A-Za-z0-9+/]+=*$/, "圖的格式不對")

const context = z.string().max(4000)

/** Claude writes its sticky notes as this user, made on first use. It
 * cannot sign in: sign-in goes through Keycloak, which has no such
 * account. */
export const CLAUDE_EMAIL = "claude@viewer.invalid"

async function claudeUser() {
  await db
    .insert(user)
    .values({ name: "Claude", email: CLAUDE_EMAIL, emailVerified: true })
    .onConflictDoNothing({ target: user.email })
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, CLAUDE_EMAIL))
  return row.id
}

/** Runs a Claude call; the cause goes to the log, the reader only learns
 * that it failed. */
async function claude<T>(name: string, failed: string, call: () => Promise<T>) {
  try {
    return await call()
  } catch (error) {
    console.error(name, error)
    throw new Error(failed)
  }
}

const notOnMcp =
  "An agent reads and explains by itself; this only asks a model on behalf of a person reading the page."

export const explainText = defineAction({
  name: "explain_text",
  title: "解釋",
  description:
    "Explains text selected in a document, or a figure, table or formula cut from a page as an image, in Traditional Chinese, read in the text around it.",
  kind: "query",
  guests: true,
  mcpExcludedBecause: notOnMcp,
  input: z
    .object({
      id: uuid,
      text: z.string().trim().max(2000, "選的文字太長").default(""),
      context,
      image: image.optional(),
    })
    .refine((input) => input.text || input.image, "沒有要解釋的東西"),
  run: async (actor, { id, ...input }) => {
    await requireAccess(actor, id, "view")
    return claude("explain_text", "解釋失敗", () => explain(input))
  },
})

export const askClaude = defineAction({
  name: "ask_claude",
  title: "請 Claude 回覆",
  description:
    "Claude reads a mark's sticky note thread (the marked text or image and the page's text around it) and adds its reply as a comment by Claude. Needs comment access.",
  kind: "mutation",
  guests: true,
  mcpExcludedBecause:
    "An agent can write its own comment with add_comment; this asks a model on behalf of a person who mentioned @Claude.",
  input: z.object({
    annotationId: uuid,
    context,
    image: image.optional(),
  }),
  run: async (actor, input) => {
    const [mark] = await db
      .select({
        documentId: annotations.documentId,
        document: documents.name,
        page: annotations.page,
        quote: annotations.quote,
      })
      .from(annotations)
      .innerJoin(documents, eq(documents.id, annotations.documentId))
      .where(eq(annotations.id, input.annotationId))
    if (!mark) throw new Error("找不到這個標記")
    await requireAccess(actor, mark.documentId, "comment")
    const thread = await db
      .select({ author: user.name, body: comments.body })
      .from(comments)
      .leftJoin(user, eq(user.id, comments.authorId))
      .where(eq(comments.annotationId, input.annotationId))
      .orderBy(asc(comments.createdAt))
    const body = await claude("ask_claude", "Claude 回覆失敗", () =>
      replyInNote({
        document: mark.document,
        page: mark.page,
        quote: mark.quote?.exact,
        context: input.context,
        image: input.image,
        thread: thread.map((note) => ({
          author: note.author ?? "已離開的成員",
          body: note.body,
        })),
      })
    )
    const [note] = await db
      .insert(comments)
      .values({
        annotationId: input.annotationId,
        authorId: await claudeUser(),
        body,
      })
      .returning({ id: comments.id })
    return { id: note.id }
  },
})

export const summarizeNotes = defineAction({
  name: "summarize_notes",
  title: "便利貼摘要",
  description:
    "Sums up every sticky note on one version of a document in Traditional Chinese: what the notes are about, and the open questions with the id of the mark each is on.",
  kind: "query",
  guests: true,
  mcpExcludedBecause:
    "An agent reads list_annotations and sums it up by itself; this asks a model on behalf of a person reading the page.",
  input: z.object({ id: uuid, version: z.number().int().positive() }),
  run: async (actor, input) => {
    const marks = (await listAnnotations.run(actor, input)).filter(
      (mark) => mark.comments.length > 0
    )
    if (marks.length === 0) throw new Error("還沒有便利貼")
    const [document] = await db
      .select({ name: documents.name })
      .from(documents)
      .where(eq(documents.id, input.id))
    const result = await claude("summarize_notes", "摘要失敗", () =>
      summarize({
        document: document.name,
        marks: marks.slice(0, 300).map((mark) => ({
          page: mark.page,
          resolved: Boolean(mark.resolvedAt),
          quote: mark.quote?.exact.slice(0, 500),
          thread: mark.comments.map((note) => ({
            author: note.author ?? "已離開的成員",
            body: note.body.slice(0, 1000),
          })),
        })),
      })
    )
    return {
      summary: result.summary,
      open: result.open.map((item) => ({
        markId: marks[item.mark - 1].id,
        question: item.question,
      })),
    }
  },
})
