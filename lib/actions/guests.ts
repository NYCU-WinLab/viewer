import { createHash } from "node:crypto"

import { and, desc, eq, gt, isNull } from "drizzle-orm"
import { z } from "zod"

import { requireAccess } from "@/lib/actions/access"
import { defineAction } from "@/lib/actions/define"
import { signInGuest, signOutGuests } from "@/lib/auth/guest"
import { db } from "@/lib/db"
import { documents, guestLinks, user } from "@/lib/db/schema"

// Guest links: someone with edit access lets a person without a lab
// account into one document for a while, to read it (view) or also mark it
// and write sticky notes (comment). The secret in the link is the guest's
// password; the database keeps only its hash. Like meet.winlab.tw's guest
// links.

/** How long a link may work, in hours: an hour, a day or a week. */
export const GUEST_HOURS = [1, 24, 168] as const

const id = z.uuid().transform((value) => value.toLowerCase())
const secretOf = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "這個訪客連結無效")
const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex")
const url = (secret: string) => `${process.env.BETTER_AUTH_URL}/g/${secret}`

export const createGuestLink = defineAction({
  name: "create_guest_link",
  title: "產生訪客連結",
  description:
    "Makes a link that lets someone without a lab account open one document until it expires after hours (1, 24 or 168), as view (read only) or comment (also mark and write sticky notes). Needs edit access. label says who it is for. The secret in the returned url is the password: give the whole link to the guest only; it cannot be shown again.",
  kind: "mutation",
  input: z.object({
    id,
    role: z.enum(["view", "comment"]),
    hours: z.coerce
      .number()
      .refine(
        (h) => (GUEST_HOURS as readonly number[]).includes(h),
        "有效時間只能是 1、24 或 168 小時"
      ),
    label: z.string().trim().max(80, "對象最多 80 字").optional(),
  }),
  run: async (actor, input) => {
    await requireAccess(actor, input.id, "edit")
    const secret = Buffer.from(
      crypto.getRandomValues(new Uint8Array(32))
    ).toString("base64url")
    const expiresAt = new Date(Date.now() + input.hours * 3600 * 1000)
    const [link] = await db
      .insert(guestLinks)
      .values({
        documentId: input.id,
        secretHash: hash(secret),
        role: input.role,
        label: input.label ?? "",
        createdBy: actor.userId,
        expiresAt,
      })
      .returning({ id: guestLinks.id })
    return { id: link.id, url: url(secret), expiresAt }
  },
})

export const listGuestLinks = defineAction({
  name: "list_guest_links",
  title: "訪客連結列表",
  description:
    "A document's guest links, newest first, expired and revoked ones included: id, role, label, who made it, createdAt, expiresAt, revokedAt, active, and guests (the names typed on the way in). Needs edit access. The links themselves cannot be shown again.",
  kind: "query",
  input: z.object({ id }),
  run: async (actor, input) => {
    await requireAccess(actor, input.id, "edit")
    const links = await db
      .select({
        id: guestLinks.id,
        role: guestLinks.role,
        label: guestLinks.label,
        madeBy: user.name,
        createdAt: guestLinks.createdAt,
        expiresAt: guestLinks.expiresAt,
        revokedAt: guestLinks.revokedAt,
      })
      .from(guestLinks)
      .leftJoin(user, eq(user.id, guestLinks.createdBy))
      .where(eq(guestLinks.documentId, input.id))
      .orderBy(desc(guestLinks.createdAt))
      .limit(100)
    const guests = links.length
      ? await db
          .select({ linkId: user.guestLinkId, name: user.name })
          .from(user)
          .innerJoin(guestLinks, eq(guestLinks.id, user.guestLinkId))
          .where(eq(guestLinks.documentId, input.id))
          .orderBy(user.createdAt)
      : []
    const now = Date.now()
    return links.map((link) => ({
      ...link,
      madeBy: link.madeBy ?? "",
      createdAt: link.createdAt.toISOString(),
      expiresAt: link.expiresAt.toISOString(),
      revokedAt: link.revokedAt?.toISOString() ?? null,
      active: !link.revokedAt && link.expiresAt.getTime() > now,
      guests: guests.filter((g) => g.linkId === link.id).map((g) => g.name),
    }))
  },
})

export const revokeGuestLink = defineAction({
  name: "revoke_guest_link",
  title: "撤銷訪客連結",
  description:
    "Stops a guest link from working, by its id from list_guest_links: nobody new comes in, and guests who came in through it lose the document at once. Needs edit access to its document.",
  kind: "mutation",
  input: z.object({ linkId: id }),
  run: async (actor, input) => {
    const [link] = await db
      .select({ documentId: guestLinks.documentId })
      .from(guestLinks)
      .where(eq(guestLinks.id, input.linkId))
    if (!link) throw new Error("沒有這個訪客連結")
    await requireAccess(actor, link.documentId, "edit")
    await db
      .update(guestLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(guestLinks.id, input.linkId), isNull(guestLinks.revokedAt)))
    await signOutGuests([input.linkId])
    return { revoked: true }
  },
})

/** The active link behind a secret, or an error that says nothing more. */
async function activeLink(secret: string) {
  const [link] = await db
    .select({
      id: guestLinks.id,
      documentId: guestLinks.documentId,
      name: documents.name,
      expiresAt: guestLinks.expiresAt,
    })
    .from(guestLinks)
    .innerJoin(documents, eq(documents.id, guestLinks.documentId))
    .where(
      and(
        eq(guestLinks.secretHash, hash(secret)),
        isNull(guestLinks.revokedAt),
        gt(guestLinks.expiresAt, new Date())
      )
    )
  if (!link) throw new Error("這個訪客連結無效或已過期")
  return link
}

export const guestLinkInfo = defineAction({
  name: "guest_link_info",
  title: "訪客連結",
  description: "The document name behind an active guest link's secret.",
  kind: "query",
  mcpExcludedBecause:
    "it serves the guest page before anyone is signed in; agents list links with list_guest_links",
  guests: true,
  input: z.object({ secret: secretOf }),
  run: async (_actor, input) => {
    const link = await activeLink(input.secret)
    return { documentId: link.documentId, name: link.name }
  },
})

export const joinAsGuest = defineAction({
  name: "join_as_guest",
  title: "以訪客身分進入",
  description:
    "Signs a person in as a guest through an active guest link, under the name they give, and returns the document to open.",
  kind: "mutation",
  mcpExcludedBecause:
    "it sets a browser session cookie for someone without an account",
  guests: true,
  input: z.object({
    secret: secretOf,
    name: z.string().trim().min(1, "請輸入名字").max(40, "名字最多 40 字"),
  }),
  run: async (_actor, input) => {
    const link = await activeLink(input.secret)
    await signInGuest({
      linkId: link.id,
      name: `${input.name}（訪客）`,
      expiresAt: link.expiresAt,
    })
    return { documentId: link.documentId }
  },
})
