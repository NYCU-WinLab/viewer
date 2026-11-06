// Reads Keycloak with the viewer client's own service account, which holds
// only realm-management view-users: it can look members up, never change
// them. Members change their account in Keycloak's account console.

const issuer = () => process.env.KEYCLOAK_ISSUER!
const timeout = () => AbortSignal.timeout(5000)
let cached: { token: string; expires: number } | null = null

async function adminToken() {
  if (cached && cached.expires > Date.now() + 10_000) return cached.token
  const response = await fetch(`${issuer()}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.KEYCLOAK_CLIENT_ID!,
      client_secret: process.env.KEYCLOAK_CLIENT_SECRET!,
    }),
    cache: "no-store",
    signal: timeout(),
  })
  if (!response.ok) throw new Error(`Keycloak token ${response.status}`)
  const body = (await response.json()) as {
    access_token: string
    expires_in: number
  }
  cached = {
    token: body.access_token,
    expires: Date.now() + body.expires_in * 1000,
  }
  return cached.token
}

export type KeycloakUser = {
  username: string
  enabled?: boolean
  email?: string
  firstName?: string
  lastName?: string
  attributes?: Record<string, string[]>
}

/** One member's Keycloak record by their Keycloak id (the OIDC sub), or
 * null when Keycloak no longer has the account. */
export async function findKeycloakUser(
  sub: string
): Promise<KeycloakUser | null> {
  const url = `${issuer().replace("/realms/", "/admin/realms/")}/users/${encodeURIComponent(sub)}`
  const get = async () =>
    fetch(url, {
      headers: { authorization: `Bearer ${await adminToken()}` },
      cache: "no-store",
      signal: timeout(),
    })
  let response = await get()
  // A token Keycloak dropped early (restart, revocation): fetch a new one once.
  if (response.status === 401) {
    cached = null
    response = await get()
  }
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Keycloak user ${response.status}`)
  return (await response.json()) as KeycloakUser
}

export type LabMember = {
  /** The Keycloak id, which is the OIDC sub. */
  sub: string
  username: string
  email: string | null
  /** As sign-in names them: chinese_name, else first and last name. */
  name: string
}

const LAB_MEMBERS_TTL_MS = 10 * 60 * 1000
let labCache: { members: LabMember[]; at: number } | null = null
// After a failure, callers fall back at once for a minute instead of each
// waiting out the timeout.
const LAB_RETRY_MS = 60 * 1000
let labFailedAt = 0

async function adminGet<T>(path: string): Promise<T> {
  const url = `${issuer().replace("/realms/", "/admin/realms/")}${path}`
  const get = async () =>
    fetch(url, {
      headers: { authorization: `Bearer ${await adminToken()}` },
      cache: "no-store",
      signal: timeout(),
    })
  let response = await get()
  if (response.status === 401) {
    cached = null
    response = await get()
  }
  if (!response.ok) throw new Error(`Keycloak ${path} ${response.status}`)
  return (await response.json()) as T
}

/** Everyone in the realm's /lab-member groups (cohorts and statuses, alumni
 * included), as portal reads them. Cached for 10 minutes. */
export async function labMembers(): Promise<LabMember[]> {
  if (labCache && Date.now() - labCache.at < LAB_MEMBERS_TTL_MS)
    return labCache.members
  if (Date.now() - labFailedAt < LAB_RETRY_MS)
    throw new Error("Keycloak 暫時連不上，稍後再試")
  try {
    labCache = { members: await fetchLabMembers(), at: Date.now() }
  } catch (error) {
    labFailedAt = Date.now()
    throw error
  }
  return labCache.members
}

async function fetchLabMembers() {
  const root = await adminGet<{ id: string }>("/group-by-path/lab-member")
  const groups = await adminGet<{ id: string }[]>(
    `/groups/${root.id}/children?max=200&briefRepresentation=true`
  )
  const bySub = new Map<string, LabMember>()
  for (const group of groups) {
    const people = await adminGet<(KeycloakUser & { id: string })[]>(
      `/groups/${group.id}/members?max=1000&briefRepresentation=false`
    )
    for (const person of people) {
      if (person.enabled === false || bySub.has(person.id)) continue
      const name =
        person.attributes?.chinese_name?.[0]?.trim() ||
        [person.firstName, person.lastName].filter(Boolean).join(" ").trim() ||
        person.username
      bySub.set(person.id, {
        sub: person.id,
        username: person.username,
        email: person.email ?? null,
        name,
      })
    }
  }
  return [...bySub.values()]
}
