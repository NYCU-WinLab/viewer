import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { errorMessage, runAction } from "@/lib/actions/define"
import { linkNextcloud } from "@/lib/actions/nextcloud"
import { getSession } from "@/lib/auth/session"
import { stateCookie } from "@/lib/nextcloud"
import { safeNext } from "@/lib/safe-next"

// GET /nextcloud/callback?code=&state=: Nextcloud's answer. The state must
// match the cookie /nextcloud/connect set in this browser, for the member
// signed in now; then the code becomes the member's tokens
// (link_nextcloud) and the member goes back.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const jar = await cookies()
  const cookie = stateCookie()
  let saved: { state?: string; user?: string; next?: string } = {}
  try {
    saved = JSON.parse(jar.get(cookie.name)?.value ?? "{}") ?? {}
  } catch {}
  // Cleared with the same flags it was set with: a __Host- cookie only
  // takes a Secure answer.
  jar.set(cookie.name, "", { ...cookie.options, maxAge: 0 })
  const { state, user, next } = saved
  const session = await getSession()
  if (!session || session.user.guestLinkId) redirect("/sign-in")
  const back = safeNext(next)
  const fail = (reason: string) =>
    redirect(
      `${back}${back.includes("?") ? "&" : "?"}nextcloud=${encodeURIComponent(reason)}`
    )
  if (!state || state !== params.get("state") || user !== session.user.id)
    fail("連結逾時，請再試一次")
  const code = params.get("code")
  if (!code) fail("Nextcloud 沒有授權")
  let problem: string | null = null
  try {
    await runAction(
      linkNextcloud,
      { userId: session.user.id, via: "web" },
      { code }
    )
  } catch (error) {
    problem = errorMessage(error)
  }
  if (problem) fail(problem)
  redirect(back)
}
