import { createHmac, randomBytes } from "node:crypto"

import { and, count, eq, gt, isNull, sql } from "drizzle-orm"
import { cookies } from "next/headers"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { guestLinks, session, user } from "@/lib/db/schema"

/** Guests one link may let in, so a leaked link cannot fill the table. */
const GUESTS_MAX = 50

// Signs a guest in: a user row for them (named as they typed, marked with
// their guest link) and a session that ends when the link does, set as
// Better Auth's own signed session cookie. Only joinAsGuest calls this,
// after it has checked the link.
export async function signInGuest(guest: {
  linkId: string
  name: string
  expiresAt: Date
}) {
  const id = crypto.randomUUID()
  const token = randomBytes(24).toString("base64url")
  await db.transaction(async (tx) => {
    // One join at a time per link, so the count below holds.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${"guest:" + guest.linkId}))`
    )
    const [{ guests }] = await tx
      .select({ guests: count() })
      .from(user)
      .where(eq(user.guestLinkId, guest.linkId))
    if (guests >= GUESTS_MAX) throw new Error("這個訪客連結的人數已滿")
    await tx.insert(user).values({
      id,
      name: guest.name,
      // users.email is unique and required; a guest has none.
      email: `${id}@guest.invalid`,
      emailVerified: false,
      guestLinkId: guest.linkId,
    })
    await tx.insert(session).values({
      token,
      userId: id,
      expiresAt: guest.expiresAt,
      updatedAt: new Date(),
    })
  })
  const context = await auth.$context
  // The same signature Better Auth checks: HMAC-SHA256, base64.
  const sign = (value: string) =>
    `${value}.${createHmac("sha256", context.secret).update(value).digest("base64")}`
  const jar = await cookies()
  const base = {
    httpOnly: true,
    secure: context.authCookies.sessionToken.attributes.secure,
    sameSite: "lax" as const,
    path: "/",
  }
  // A member's cached session must not outlive the switch to a guest.
  jar.set(context.authCookies.sessionData.name, "", { ...base, maxAge: 0 })
  jar.set(context.authCookies.sessionToken.name, sign(token), {
    ...base,
    expires: guest.expiresAt,
  })
  // Better Auth extends a session it reads (to 7 days) unless this cookie
  // says not to: a guest's session must end with the link.
  jar.set(context.authCookies.dontRememberToken.name, sign("true"), {
    ...base,
    expires: guest.expiresAt,
  })
}

/** Ends every session of the guests who came in through these links. */
export async function signOutGuests(linkIds: string[]) {
  for (const linkId of linkIds)
    await db
      .delete(session)
      .where(
        sql`${session.userId} in (select ${user.id} from ${user} where ${user.guestLinkId} = ${linkId})`
      )
}

/** Whether a guest's link still works; ends their sessions when not. */
export async function guestStillIn(userId: string, linkId: string) {
  const [link] = await db
    .select({ id: guestLinks.id })
    .from(guestLinks)
    .where(
      and(
        eq(guestLinks.id, linkId),
        isNull(guestLinks.revokedAt),
        gt(guestLinks.expiresAt, new Date())
      )
    )
  if (link) return true
  await db.delete(session).where(eq(session.userId, userId))
  return false
}
