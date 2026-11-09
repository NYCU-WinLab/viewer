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

/** A date from WebDAV as ISO text; a missing or odd one becomes epoch, so
 * one entry cannot fail the whole folder. */
function lastModified(text: string) {
  const date = new Date(text)
  return (Number.isNaN(date.getTime()) ? new Date(0) : date).toISOString()
}

/** Nextcloud refused a refresh token: the link is gone for good (revoked,
 * or already rotated), unlike a timeout or a server error. */
export class TokenRevoked extends Error {}

/** The cookie that carries the OAuth state. On an https site a __Host-
 * cookie, which another *.winlab.tw site cannot set for this host. */
export function stateCookie() {
  const secure = (process.env.BETTER_AUTH_URL ?? "").startsWith("https://")
  return {
    name: secure ? "__Host-nextcloud_state" : "nextcloud_state",
    options: {
      httpOnly: true,
      secure,
      sameSite: "lax" as const,
      path: "/",
    },
  }
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
  if (response.status === 400 || response.status === 401) {
    // Nextcloud answers invalid_request (or invalid_grant) for a code or
    // refresh token it does not know; invalid_client is the viewer's own
    // configuration, which must not unlink anyone.
    const answer = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    if (answer?.error !== "invalid_client")
      throw new TokenRevoked(`Nextcloud token failed: ${response.status}`)
  }
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
  /** Nextcloud's id of the file, stable across renames and shares. */
  fileId: string
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

const PROPS = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:prop><d:resourcetype/><d:getcontentlength/><d:getlastmodified/><d:getcontenttype/><d:getetag/><oc:fileid/><oc:permissions/><oc:owner-id/></d:prop></d:propfind>`

/** One file of the member's: its Nextcloud id and ETag, without the
 * content, to tell whether it changed since the last import. */
export async function memberFileInfo(token: NextcloudToken, path: string) {
  const response = await fetch(memberUrl(token.user, path), {
    method: "PROPFIND",
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      depth: "0",
      "content-type": "application/xml",
    },
    body: PROPS,
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 404) throw new Error("找不到這個檔案")
  if (!response.ok) fail("PROPFIND", response)
  const xml = await response.text()
  if (/<(?:\w+:)?collection\s*\/>/.test(tag(xml, "resourcetype")))
    throw new Error("這是資料夾，不是檔案")
  const fileId = tag(xml, "fileid")
  if (!/^\d+$/.test(fileId)) throw new Error("Nextcloud 沒有回傳檔案編號")
  return {
    fileId,
    etag: unescapeXml(tag(xml, "getetag")).replace(/"/g, ""),
    size: Number(tag(xml, "getcontentlength")) || 0,
    permissions: tag(xml, "permissions"),
    ownerId: unescapeXml(tag(xml, "owner-id")),
  }
}

/** What the member may do with each of these files in Nextcloud, by file
 * id: its permission letters (G read, W write, M on a mounted team folder)
 * and its owner. A file the member cannot reach is missing from the map.
 * One SEARCH covers the member's own files, shares and team folders. */
export async function memberFileAccess(
  token: NextcloudToken,
  fileIds: string[]
) {
  const found = new Map<string, { permissions: string; ownerId: string }>()
  const ids = [...new Set(fileIds)].filter((id) => /^\d+$/.test(id))
  const { base } = oauth()
  const scope = `/files/${encodeURIComponent(token.user)}`
  for (let start = 0; start < ids.length; start += 200) {
    const terms = ids
      .slice(start, start + 200)
      .map(
        (id) =>
          `<d:eq><d:prop><oc:fileid/></d:prop><d:literal>${id}</d:literal></d:eq>`
      )
      .join("")
    const response = await fetch(`${base}/remote.php/dav/`, {
      method: "SEARCH",
      headers: {
        authorization: `Bearer ${token.accessToken}`,
        "content-type": "text/xml",
      },
      body: `<?xml version="1.0"?><d:searchrequest xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns"><d:basicsearch><d:select><d:prop><oc:fileid/><oc:permissions/><oc:owner-id/></d:prop></d:select><d:from><d:scope><d:href>${scope}</d:href><d:depth>infinity</d:depth></d:scope></d:from><d:where><d:or>${terms}<d:eq><d:prop><oc:fileid/></d:prop><d:literal>0</d:literal></d:eq></d:or></d:where><d:orderby/></d:basicsearch></d:searchrequest>`,
      signal: AbortSignal.timeout(15_000),
    })
    if (response.status === 401) throw new TokenRevoked("SEARCH")
    if (response.status !== 207) fail("SEARCH", response)
    const xml = await response.text()
    for (const part of xml.split(/<\/(?:\w+:)?response>/)) {
      const fileId = tag(part, "fileid")
      if (!fileId) continue
      found.set(fileId, {
        permissions: tag(part, "permissions"),
        ownerId: unescapeXml(tag(part, "owner-id")),
      })
    }
  }
  return found
}

/** Where a member manages a file's sharing in Nextcloud. */
export function nextcloudFileUrl(fileId: string) {
  const url = process.env.NEXTCLOUD_URL
  if (!url || !/^\d+$/.test(fileId)) return null
  return `${url.replace(/\/$/, "")}/f/${fileId}`
}

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
    body: PROPS,
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
      modified: lastModified(tag(block, "getlastmodified")),
      type: tag(block, "getcontenttype"),
      fileId: tag(block, "fileid"),
    })
  }
  return entries.sort(
    (a, b) =>
      Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name)
  )
}

/** Downloads one of the member's files, up to maxBytes, with its ETag.
 * With etag, only that content: a file changed or put in its place since
 * memberFileInfo is refused, so it never lands in the wrong document. */
export async function downloadMemberFile(
  token: NextcloudToken,
  path: string,
  maxBytes: number,
  etag?: string
) {
  const response = await fetch(memberUrl(token.user, path), {
    headers: {
      authorization: `Bearer ${token.accessToken}`,
      ...(etag ? { "if-match": `"${etag}"` } : {}),
    },
    signal: AbortSignal.timeout(120_000),
  })
  if (response.status === 412) throw new Error("檔案剛被改過，請再打開一次")
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
