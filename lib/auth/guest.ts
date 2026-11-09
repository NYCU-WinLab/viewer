import { createHmac, randomBytes } from "node:crypto"

import { cookies } from "next/headers"

import { auth } from "@/lib/auth"
import { db } from "@/lib/db"
import { session, user } from "@/lib/db/schema"

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
  // The same signature Better Auth checks: HMAC-SHA256 of the token, base64.
  const signature = createHmac("sha256", context.secret)
    .update(token)
    .digest("base64")
  const jar = await cookies()
  // A member's cached session must not outlive the switch to a guest.
  jar.delete(context.authCookies.sessionData.name)
  const { name, attributes } = context.authCookies.sessionToken
  jar.set(name, `${token}.${signature}`, {
    httpOnly: true,
    secure: attributes.secure,
    sameSite: "lax",
    path: "/",
    expires: guest.expiresAt,
  })
}
