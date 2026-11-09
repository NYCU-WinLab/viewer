import { randomBytes } from "node:crypto"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { getSession } from "@/lib/auth/session"
import { authorizeUrl } from "@/lib/nextcloud"
import { safeNext } from "@/lib/safe-next"

// GET /nextcloud/connect?next=<path>: sends the member to Nextcloud to let
// the viewer read their files. A random state in a short-lived cookie ties
// the answer at /nextcloud/callback to this browser; next is where to
// return afterwards.
export async function GET(request: Request) {
  const next = safeNext(new URL(request.url).searchParams.get("next"))
  const session = await getSession()
  if (!session || session.user.guestLinkId)
    redirect(`/sign-in?next=${encodeURIComponent(next)}`)
  const state = randomBytes(24).toString("base64url")
  ;(await cookies()).set("nextcloud_state", `${state}|${next}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/nextcloud",
    maxAge: 600,
  })
  redirect(authorizeUrl(state))
}
