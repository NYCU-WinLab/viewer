// Document files live in Nextcloud (WebDAV), under one folder of one
// account: <NEXTCLOUD_ROOT>/<document id>/<file>. The account may hold
// other apps' files, so nothing here ever reaches outside that folder.

function config() {
  const url = process.env.NEXTCLOUD_URL
  const user = process.env.NEXTCLOUD_USER
  const password = process.env.NEXTCLOUD_APP_PASSWORD
  const root = process.env.NEXTCLOUD_ROOT || "viewer"
  if (!url || !user || !password) throw new Error("Nextcloud 沒有設定")
  // Plain folder names only: nothing that reads as URL syntax or climbs up.
  if (
    !/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(root) ||
    root.split("/").some((part) => part === "." || part === "..")
  )
    throw new Error(`Bad NEXTCLOUD_ROOT: ${root}`)
  return {
    base: `${url.replace(/\/$/, "")}/remote.php/dav/files/${encodeURIComponent(user)}/${root}`,
    authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
  }
}

const segment = /^[A-Za-z0-9._-]+$/

/** The folder of one document, or a file in it. Rejects anything that
 * could climb out of the root folder. */
function path(documentId: string, file?: string) {
  if (!segment.test(documentId) || (file !== undefined && !segment.test(file)))
    throw new Error(`Bad Nextcloud path: ${documentId}/${file ?? ""}`)
  const { base } = config()
  return file ? `${base}/${documentId}/${file}` : `${base}/${documentId}/`
}

async function dav(method: string, url: string, init: RequestInit = {}) {
  return fetch(url, {
    ...init,
    method,
    headers: { authorization: config().authorization, ...init.headers },
  })
}

function fail(action: string, response: Response): never {
  throw new Error(`Nextcloud ${action} failed: ${response.status}`)
}

/** Stores files of one document, creating its folder first. */
export async function putDocumentFiles(
  documentId: string,
  files: { name: string; body: Uint8Array; type: string }[]
) {
  const folder = await dav("MKCOL", path(documentId))
  // 405: the folder is already there.
  if (!folder.ok && folder.status !== 405) fail("MKCOL", folder)
  for (const file of files) {
    const response = await dav("PUT", path(documentId, file.name), {
      body: file.body as BodyInit,
      headers: { "content-type": file.type },
    })
    if (!response.ok) fail("PUT", response)
  }
}

/** Streams one file, or null when it is not there. */
export async function getDocumentFile(documentId: string, file: string) {
  const response = await dav("GET", path(documentId, file))
  if (response.status === 404) return null
  if (!response.ok) fail("GET", response)
  return response
}

/** Deletes the document's folder with every file in it. */
export async function deleteDocumentFiles(documentId: string) {
  const response = await dav("DELETE", path(documentId))
  if (!response.ok && response.status !== 404) fail("DELETE", response)
}
