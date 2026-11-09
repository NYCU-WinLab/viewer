import { randomBytes } from "node:crypto"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { getSession } from "@/lib/auth/session"
import { authorizeUrl, stateCookie } from "@/lib/nextcloud"
import { safeNext } from "@/lib/safe-next"

// GET /nextcloud/connect?next=<path>: sends the member to Nextcloud to let
// the viewer read their files. A random state in a short-lived cookie ties
// the answer at /nextcloud/callback to this browser and to this member;
// next is where to return afterwards.
export async function GET(request: Request) {
  const next = safeNext(new URL(request.url).searchParams.get("next"))
  const session = await getSession()
  if (!session || session.user.guestLinkId)
    redirect(`/sign-in?next=${encodeURIComponent(next)}`)
  const state = randomBytes(24).toString("base64url")
  const cookie = stateCookie()
  ;(await cookies()).set(
    cookie.name,
    JSON.stringify({ state, user: session.user.id, next }),
    { ...cookie.options, maxAge: 600 }
  )
  redirect(authorizeUrl(state))
}
