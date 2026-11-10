import { runAction } from "@/lib/actions/define"
import { getMemberAvatar } from "@/lib/actions/members"
import { getSession } from "@/lib/auth/session"

// A member's avatar from portal, the same picture they have there, for
// anyone signed in (a guest sees who else has the document open). The
// browser keeps it but asks again every time, so a new picture shows once
// the 10-minute cache in lib/portal.ts runs out. A member with none gets a
// 404 for a minute: the initial shows.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const notFound = () =>
  new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "private, max-age=60" },
  })

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession()
  if (!session) return new Response("Unauthorized", { status: 401 })
  const { id } = await params
  if (!UUID.test(id)) return notFound()
  const avatar = await runAction(
    getMemberAvatar,
    { userId: session.user.id, via: "web" },
    { user_id: id }
  )
  if (!avatar) return notFound()
  const etag = `"${avatar.version}"`
  const headers = {
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  }
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers })
  return new Response(Buffer.from(avatar.base64, "base64"), {
    headers: { ...headers, "Content-Type": avatar.contentType },
  })
}
