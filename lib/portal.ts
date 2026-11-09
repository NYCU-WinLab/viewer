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
