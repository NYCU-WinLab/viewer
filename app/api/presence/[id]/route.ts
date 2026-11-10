import { z } from "zod"

import { onChange } from "@/lib/actions/changes"
import { runAction } from "@/lib/actions/define"
import { getDocument } from "@/lib/actions/documents"
import { getSession } from "@/lib/auth/session"
import { avatarUrl } from "@/lib/portal"
import { type PresenceEvent, join, move } from "@/lib/presence"

// GET: join the document's room as a server-sent event stream. The first
// event names this tab's connection id; then every join, leave and cursor
// move in the room follows. Only members who may open the document join.
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/presence/[id]">
) {
  const { id } = await params
  const session = await getSession()
  if (!session) return new Response(null, { status: 401 })
  const parsed = z.uuid().safeParse(id)
  const actor = { userId: session.user.id, via: "web" as const }
  const allowed = async () =>
    parsed.success
      ? runAction(getDocument, actor, { id: parsed.data.toLowerCase() }).catch(
          () => null
        )
      : null
  const doc = await allowed()
  if (!doc) return new Response(null, { status: 404 })

  const encoder = new TextEncoder()
  let stop = () => {}
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: PresenceEvent | { type: "hello"; conn: string }) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
          )
        } catch {
          stop()
        }
      }
      controller.enqueue(encoder.encode("retry: 3000\n\n"))
      let conn = ""
      // Events can arrive while join runs; hold them until hello is out.
      const early: PresenceEvent[] = []
      const room = join(
        doc.id,
        {
          userId: session.user.id,
          name: session.user.name,
          image: avatarUrl(session.user),
        },
        (event) => (conn ? send(event) : early.push(event))
      )
      conn = room.conn
      send({ type: "hello", conn })
      early.forEach(send)
      // Keeps proxies from closing a quiet connection.
      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"))
        } catch {
          stop()
        }
      }, 25_000)
      // Access can end while the stream is open (a share removed, a guest
      // link revoked or run out): look again on every change that could
      // end it and every 30 seconds, and close the stream when it has.
      const close = () => {
        stop()
        try {
          controller.close()
        } catch {}
      }
      const recheck = async () => {
        if (!(await allowed())) close()
      }
      const offChange = await onChange((action) => {
        if (
          action === "revoke_guest_link" ||
          action === "unshare_document" ||
          action === "delete_document"
        )
          recheck()
      }).catch(() => () => {})
      const watch = setInterval(recheck, 30_000)
      stop = () => {
        clearInterval(ping)
        clearInterval(watch)
        offChange()
        room.leave()
      }
      request.signal.addEventListener("abort", close)
    },
    cancel() {
      stop()
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  })
}

const fraction = z.number().min(0).max(1)
const body = z.object({
  conn: z.uuid(),
  cursor: z
    .object({ page: z.number().int().positive(), x: fraction, y: fraction })
    .nullable(),
})

// POST: move this tab's cursor. The connection id, handed out only on the
// signed-in stream above, is the proof; this runs many times a second, so
// it skips the session lookup.
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return new Response(null, { status: 400 })
  const ok = move(parsed.data.conn, parsed.data.cursor)
  return new Response(null, { status: ok ? 204 : 410 })
}
