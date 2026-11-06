import { runAction } from "@/lib/actions/define"
import { getDocumentPdf } from "@/lib/actions/documents"
import { getSession } from "@/lib/auth/session"
import { getDocumentFile } from "@/lib/nextcloud"

// The PDF of one version, for the reader. Checks the session and access,
// then streams it from Nextcloud. A version's file never changes.
export async function GET(
  _request: Request,
  { params }: RouteContext<"/files/[id]/[version]">
) {
  const { id, version } = await params
  const number = Number(version)
  if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(number) || number < 1)
    return new Response("Not found", { status: 404 })
  const session = await getSession()
  if (!session) return new Response("Sign in first", { status: 401 })
  const found = await runAction(
    getDocumentPdf,
    { userId: session.user.id, via: "web" },
    { id, version: number }
  )
  if (!found) return new Response("Not found", { status: 404 })
  const response = await getDocumentFile(id, found.file)
  if (!response) return new Response("Not found", { status: 404 })
  const headers = new Headers({
    "content-type": "application/pdf",
    "cache-control": "private, max-age=31536000, immutable",
  })
  const length = response.headers.get("content-length")
  if (length) headers.set("content-length", length)
  return new Response(response.body, { headers })
}
