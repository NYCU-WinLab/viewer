import { spawn } from "node:child_process"
import { Readable } from "node:stream"

import { runAction } from "@/lib/actions/define"
import { getDocumentPdf } from "@/lib/actions/documents"
import { getSession } from "@/lib/auth/session"
import { getDocumentFile } from "@/lib/nextcloud"

// The first page of one version as a JPEG, for the cover on the home page.
// Same checks and cache rule as the PDF route: access can change, so the
// browser revalidates (no-cache with an ETag) and a 304 skips the render.
// pdftoppm (poppler) draws the page; nothing is stored.
export async function GET(
  request: Request,
  { params }: RouteContext<"/files/[id]/[version]/cover">
) {
  const { version } = await params
  const id = (await params).id.toLowerCase()
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
  const etag = `"${id}-${number}-cover"`
  const cache = {
    "cache-control": "private, no-cache",
    etag,
    "x-content-type-options": "nosniff",
  }
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, { status: 304, headers: cache })
  const pdf = await getDocumentFile(id, found.file)
  if (!pdf?.body) return new Response("Not found", { status: 404 })
  const image = await firstPage(pdf.body).catch(() => null)
  if (!image) return new Response("Cannot draw the cover", { status: 422 })
  return new Response(new Uint8Array(image), {
    headers: { "content-type": "image/jpeg", ...cache },
  })
}

// Page 1 at 640 px on its long side. pdftoppm reads the PDF on stdin and
// writes the one page to stdout; 20 s is plenty for a page.
function firstPage(body: ReadableStream<Uint8Array>) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      "pdftoppm",
      ["-f", "1", "-l", "1", "-scale-to", "640", "-jpeg", "-"],
      { timeout: 20_000 }
    )
    const chunks: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    child.on("error", reject)
    child.on("close", (code) =>
      code === 0 && chunks.length
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`pdftoppm exited ${code}`))
    )
    // pdftoppm needs the whole file, and may close stdin early on a bad one.
    child.stdin.on("error", () => {})
    Readable.fromWeb(body as never).pipe(child.stdin)
  })
}
