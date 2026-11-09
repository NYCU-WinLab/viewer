import { and, eq, gt, inArray, sql } from "drizzle-orm"

import type { Access } from "@/lib/actions/access"
import type { Actor } from "@/lib/actions/define"
import { NotLinked, tokenOf } from "@/lib/actions/nextcloud-token"
import { db } from "@/lib/db"
import { nextcloudAccess, nextcloudTokens } from "@/lib/db/schema"
import { memberFileAccess } from "@/lib/nextcloud"

// A document bound to a Nextcloud file is shared in Nextcloud, not here:
// whoever can read the file there may comment on it, whoever can write it
// may manage it, and its owner owns it. Nextcloud is asked with the
// member's own token; the answer counts for a minute (nextcloud_access).

const FRESH_MS = 60_000

/** The viewer access that Nextcloud permission letters give. A file on a
 * mounted team folder (M) reports every member as its owner, so there the
 * owner counts as an editor. */
export function accessFromNextcloud(
  member: string,
  file: { permissions: string; ownerId: string }
): "owner" | "edit" | "comment" {
  if (file.ownerId === member && !file.permissions.includes("M")) return "owner"
  return file.permissions.includes("W") ? "edit" : "comment"
}

/** Keeps what Nextcloud just said about the member's access to files,
 * tagged with the Nextcloud account that said it. */
export async function rememberAccess(
  actor: Actor,
  nextcloudUser: string,
  entries: { fileId: string; access: Access | null }[]
) {
  if (entries.length === 0) return
  const checkedAt = new Date()
  await db
    .insert(nextcloudAccess)
    .values(
      entries.map((entry) => ({
        userId: actor.userId,
        fileId: entry.fileId,
        nextcloudUser,
        access: entry.access === "view" ? "comment" : entry.access,
        checkedAt,
      }))
    )
    .onConflictDoUpdate({
      target: [nextcloudAccess.userId, nextcloudAccess.fileId],
      set: {
        nextcloudUser,
        access: sql`excluded.access`,
        checkedAt,
      },
    })
}

/** The member's access to each file by id, null for none. Only an answer
 * from the last minute counts, and only while the member is still linked
 * to the Nextcloud account that gave it (an answer that lands after an
 * unlink or a switch of account is ignored). Older ones are asked again;
 * when Nextcloud cannot answer, those files get no access and unavailable
 * is set, so nothing stale ever grants access. */
export async function nextcloudAccessTo(actor: Actor, fileIds: string[]) {
  const ids = [...new Set(fileIds)]
  const result = new Map<string, Access | null>()
  if (ids.length === 0) return { access: result, unavailable: false }
  const cached = await db
    .select({
      fileId: nextcloudAccess.fileId,
      access: nextcloudAccess.access,
    })
    .from(nextcloudAccess)
    .innerJoin(
      nextcloudTokens,
      and(
        eq(nextcloudTokens.userId, nextcloudAccess.userId),
        eq(nextcloudTokens.nextcloudUser, nextcloudAccess.nextcloudUser)
      )
    )
    .where(
      and(
        eq(nextcloudAccess.userId, actor.userId),
        inArray(nextcloudAccess.fileId, ids),
        gt(nextcloudAccess.checkedAt, new Date(Date.now() - FRESH_MS))
      )
    )
  for (const row of cached) result.set(row.fileId, row.access)
  const stale = ids.filter((id) => !result.has(id))
  if (stale.length === 0) return { access: result, unavailable: false }
  try {
    const token = await tokenOf(actor)
    const found = await memberFileAccess(token, stale)
    const entries = stale.map((fileId) => {
      const file = found.get(fileId)
      return {
        fileId,
        access: file ? accessFromNextcloud(token.user, file) : null,
      }
    })
    await rememberAccess(actor, token.user, entries)
    for (const entry of entries) result.set(entry.fileId, entry.access)
    return { access: result, unavailable: false }
  } catch (error) {
    for (const id of stale) result.set(id, null)
    return { access: result, unavailable: !(error instanceof NotLinked) }
  }
}
