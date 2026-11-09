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

// A member's own files, through Nextcloud's OAuth 2 app: the viewer is an
// OAuth client (NEXTCLOUD_OAUTH_CLIENT_ID and _SECRET, made with
// `occ oauth2:add-client`), each member authorizes it once, and their
// token reads only what they can read. Paths are relative to the member's
// own files, "/" being the top.

function oauth() {
  const url = process.env.NEXTCLOUD_URL
  const clientId = process.env.NEXTCLOUD_OAUTH_CLIENT_ID
  const clientSecret = process.env.NEXTCLOUD_OAUTH_CLIENT_SECRET
  const site = process.env.BETTER_AUTH_URL
  if (!url || !clientId || !clientSecret || !site)
    throw new Error("Nextcloud 連結還沒設定")
  return {
    base: url.replace(/\/$/, ""),
    clientId,
    clientSecret,
    redirectUri: `${site.replace(/\/$/, "")}/nextcloud/callback`,
  }
}

export const canLinkNextcloud = () =>
  !!process.env.NEXTCLOUD_OAUTH_CLIENT_ID &&
  !!process.env.NEXTCLOUD_OAUTH_CLIENT_SECRET

/** Where to send the member to authorize the viewer. */
export function authorizeUrl(state: string) {
  const { base, clientId, redirectUri } = oauth()
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  })
  return `${base}/apps/oauth2/authorize?${query}`
}

export type NextcloudToken = {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  user: string
}

async function token(params: Record<string, string>): Promise<NextcloudToken> {
  const { base, clientId, clientSecret, redirectUri } = oauth()
  const response = await fetch(`${base}/apps/oauth2/api/v1/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      ...params,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) fail("token", response)
  const body = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    user_id?: string
  }
  if (!body.access_token || !body.refresh_token || !body.user_id)
    throw new Error("Nextcloud token answer is missing fields")
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    // A minute early, so a token is never used in its last seconds.
    expiresAt: new Date(Date.now() + ((body.expires_in ?? 3600) - 60) * 1000),
    user: body.user_id,
  }
}

export const exchangeCode = (code: string) =>
  token({ grant_type: "authorization_code", code })

export const refreshToken = (refresh: string) =>
  token({ grant_type: "refresh_token", refresh_token: refresh })

/** A path in the member's files, as URL segments; refuses anything that
 * climbs up or is not plain text. */
function memberPath(path: string) {
  if (
    path.length > 2000 ||
    /[\u0000-\u001f\u007f\\]/.test(path) ||
    !path.startsWith("/")
  )
    throw new Error("路徑不對")
  const parts = path.split("/").filter(Boolean)
  if (parts.some((part) => part === "." || part === ".."))
    throw new Error("路徑不對")
  return parts.map(encodeURIComponent).join("/")
}

function memberUrl(user: string, path: string) {
  const { base } = oauth()
  const rest = memberPath(path)
  return `${base}/remote.php/dav/files/${encodeURIComponent(user)}/${rest}`
}

export type NextcloudEntry = {
  name: string
  path: string
  folder: boolean
  size: number
  modified: string
  type: string
}

const tag = (xml: string, name: string) =>
  new RegExp(
    `<(?:\\w+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${name}>`
  ).exec(xml)?.[1] ?? ""

const unescapeXml = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")

/** One folder of the member's files: folders first, then files, by name. */
export async function listMemberFolder(
  token: NextcloudToken,
  path: string
): Promise<NextcloudEntry[]> {
  const url = memberUrl(token.user, path)
  const response = await fetch(url.endsWith("/") ? url : `${url}/`, {
    method: "PROPFIND",
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      depth: "1",
      "content-type": "application/xml",
    },
    body: `<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/></d:prop></d:propfind>`,
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) throw new Error("找不到這個資料夾")
  if (!response.ok) fail("PROPFIND", response)
  const xml = await response.text()
  const prefix = `/remote.php/dav/files/${encodeURIComponent(token.user)}`
  const entries: NextcloudEntry[] = []
  for (const block of xml.split(/<(?:\w+:)?response>/).slice(1)) {
    const href = decodeURIComponent(unescapeXml(tag(block, "href")))
    const at = href.indexOf(decodeURIComponent(prefix))
    if (at < 0) continue
    const own = href.slice(at + decodeURIComponent(prefix).length) || "/"
    const clean = own.replace(/\/$/, "") || "/"
    if (clean === (path.replace(/\/$/, "") || "/")) continue
    const folder = /<(?:\w+:)?collection\s*\/>/.test(tag(block, "resourcetype"))
    entries.push({
      name: clean.split("/").pop() ?? clean,
      path: clean,
      folder,
      size: Number(tag(block, "getcontentlength")) || 0,
      modified: new Date(tag(block, "getlastmodified")).toISOString(),
      type: tag(block, "getcontenttype"),
    })
  }
  return entries.sort(
    (a, b) =>
      Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name)
  )
}

/** Downloads one of the member's files, up to maxBytes, with its ETag. */
export async function downloadMemberFile(
  token: NextcloudToken,
  path: string,
  maxBytes: number
) {
  const response = await fetch(memberUrl(token.user, path), {
    headers: { authorization: `Bearer ${token.accessToken}` },
    signal: AbortSignal.timeout(120_000),
  })
  if (response.status === 404) throw new Error("找不到這個檔案")
  if (!response.ok || !response.body) fail("GET", response)
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw new Error("檔案太大")
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error("檔案太大")
    }
    chunks.push(value)
  }
  return {
    body: new Uint8Array(Buffer.concat(chunks)),
    etag: (response.headers.get("etag") ?? "").replace(/"/g, ""),
  }
}
