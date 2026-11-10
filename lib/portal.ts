// portal.winlab.tw: the lab's mail goes out through its send_invitation
// action, called with a service key (one that belongs to the lab, made by
// a portal admin on portal.winlab.tw/api-keys, allowed to send invitations).
// PORTAL_URL and PORTAL_SERVICE_KEY come from the environment; without the
// key, invitations are not mailed and the member copies the link instead.

const base = () => process.env.PORTAL_URL ?? "https://portal.winlab.tw"

export const canMail = () => !!process.env.PORTAL_SERVICE_KEY

/** A title portal accepts: one line of plain words, at most 80
 * characters, with no link, address, slash, colon or dotted word, so a
 * file name loses its extension and its other dots. */
export function invitationTitle(name: string) {
  const plain = name
    .normalize("NFKC")
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/[@:/\\.․。﹒．｡]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim()
  return plain || "一份文件"
}

/** portal's refusal in words: an input error comes as a JSON list of
 * issues, whose first message is the one to show. */
function reason(error?: string) {
  if (!error?.startsWith("[")) return error
  try {
    return (JSON.parse(error) as { message?: string }[])[0]?.message ?? error
  } catch {
    return error
  }
}

/** Mails an invitation to open url. Throws with portal's reason when it
 * refuses. */
export async function sendInvitation(input: {
  to: string
  url: string
  title: string
  access: "view" | "comment"
  expiresAt: Date
}) {
  const key = process.env.PORTAL_SERVICE_KEY
  if (!key) throw new Error("邀請信還沒設定")
  const response = await fetch(`${base()}/api/actions/send_invitation`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      to: input.to,
      url: input.url,
      title: invitationTitle(input.title),
      access: input.access,
      expiresAt: input.expiresAt.toISOString(),
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string
    } | null
    throw new Error(reason(body?.error) ?? `portal 回應 ${response.status}`)
  }
}

export type Avatar = { contentType: string; version: string; base64: string }

/** Avatars by username for 10 minutes, a miss included, so a busy room
 * asks portal once per member. */
const avatars = new Map<string, { at: number; avatar: Avatar | null }>()
const avatarTtl = 10 * 60 * 1000

/** A member's small avatar from portal (the same picture as on portal),
 * or null when they have none or portal does not answer in 3 seconds. A
 * failure is not cached, so the next view asks again. */
export async function memberAvatar(username: string): Promise<Avatar | null> {
  const hit = avatars.get(username)
  if (hit && Date.now() - hit.at < avatarTtl) return hit.avatar
  const key = process.env.PORTAL_SERVICE_KEY
  if (!key) return null
  try {
    const response = await fetch(`${base()}/api/actions/get_member_avatar`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ username, size: "small" }),
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return null
    const data = (await response.json()) as Partial<Avatar> | null
    const avatar =
      data && data.base64 && data.version
        ? {
            contentType: data.contentType ?? "image/webp",
            version: data.version,
            base64: data.base64,
          }
        : null
    avatars.set(username, { at: Date.now(), avatar })
    return avatar
  } catch {
    return null
  }
}

/** Where the page loads a member's avatar: portal's picture through
 * /avatars, for members with a lab account (guests have none). */
export const avatarUrl = (user: { id: string; username?: string | null }) =>
  user.username ? `/avatars/${user.id}` : null
