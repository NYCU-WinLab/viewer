import { headers } from "next/headers"
import { redirect } from "next/navigation"

import type { Actor } from "@/lib/actions/define"
import { auth } from "@/lib/auth"
import { guestStillIn } from "@/lib/auth/guest"

/** The signed-in member's session, or null. Reads cookies, so server only. */
export async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() })
  // A guest whose link was revoked or ran out is signed out here.
  const linkId = session?.user.guestLinkId
  if (linkId && !(await guestStillIn(session.user.id, linkId))) return null
  return session
}

/** The member a page acts as; sends anyone signed out to /sign-in. */
export async function requireActor(next = "/"): Promise<Actor> {
  const session = await getSession()
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(next)}`)
  return { userId: session.user.id, via: "web" }
}
