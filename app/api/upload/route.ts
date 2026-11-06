import { createWriteStream } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

import { errorMessage, runAction } from "@/lib/actions/define"
import { MAX_DOCUMENT_BYTES, uploadDocument } from "@/lib/actions/documents"
import { getSession } from "@/lib/auth/session"

const uploadDir = join(tmpdir(), "viewer-uploads")

// One file per request, as the raw body: PUT /api/upload?name=&documentId=
// (documentId for a new version). The body streams to a temp file, then
// upload_document converts and stores it.
export async function PUT(request: Request) {
  const session = await getSession()
  if (!session) return Response.json({ error: "請先登入" }, { status: 401 })
  if (!request.body)
    return Response.json({ error: "沒有檔案" }, { status: 400 })
  const params = new URL(request.url).searchParams

  await mkdir(uploadDir, { recursive: true })
  const file = join(uploadDir, crypto.randomUUID())
  let size = 0
  try {
    await pipeline(
      Readable.fromWeb(
        request.body as import("node:stream/web").ReadableStream
      ),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          size += chunk.length
          done(size > MAX_DOCUMENT_BYTES ? new Error("檔案太大") : null, chunk)
        },
      }),
      createWriteStream(file)
    )
    const result = await runAction(
      uploadDocument,
      { userId: session.user.id, via: "web" },
      {
        file,
        fileName: params.get("name") ?? "",
        documentId: params.get("documentId") || undefined,
      }
    )
    return Response.json(result)
  } catch (error) {
    await rm(file, { force: true })
    return Response.json({ error: errorMessage(error) }, { status: 400 })
  }
}
