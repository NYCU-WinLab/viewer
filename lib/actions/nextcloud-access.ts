import { and, eq, inArray, sql } from "drizzle-orm"

import type { Access } from "@/lib/actions/access"
import type { Actor } from "@/lib/actions/define"
import { NotLinked, tokenOf } from "@/lib/actions/nextcloud-token"
import { db } from "@/lib/db"
import { nextcloudAccess } from "@/lib/db/schema"
import { memberFileAccess } from "@/lib/nextcloud"

// A document bound to a Nextcloud file is shared in Nextcloud, not here:
// whoever can read the file there may comment on it, whoever can write it
// may manage it, and its owner owns it. Nextcloud is asked with the
// member's own token; the answer is kept a minute in nextcloud_access.

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

/** Keeps what Nextcloud just said about the member's access to files. */
export async function rememberAccess(
  actor: Actor,
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
        access: entry.access === "view" ? "comment" : entry.access,
        checkedAt,
      }))
    )
    .onConflictDoUpdate({
      target: [nextcloudAccess.userId, nextcloudAccess.fileId],
      set: {
        access: sql`excluded.access`,
        checkedAt,
      },
    })
}

/** The member's access to each file by id, null for none. A member without
 * a working Nextcloud link has none. When Nextcloud cannot be reached, the
 * last answer stands, and unavailable says some files had none. */
export async function nextcloudAccessTo(actor: Actor, fileIds: string[]) {
  const ids = [...new Set(fileIds)]
  const result = new Map<string, Access | null>()
  if (ids.length === 0) return { access: result, unavailable: false }
  const cached = await db
    .select()
    .from(nextcloudAccess)
    .where(
      and(
        eq(nextcloudAccess.userId, actor.userId),
        inArray(nextcloudAccess.fileId, ids)
      )
    )
  const fresh = Date.now() - FRESH_MS
  const stale = new Set(ids)
  for (const row of cached) {
    result.set(row.fileId, row.access)
    if (row.checkedAt.getTime() > fresh) stale.delete(row.fileId)
  }
  if (stale.size === 0) return { access: result, unavailable: false }
  try {
    const token = await tokenOf(actor)
    const found = await memberFileAccess(token, [...stale])
    const entries = [...stale].map((fileId) => {
      const file = found.get(fileId)
      return {
        fileId,
        access: file ? accessFromNextcloud(token.user, file) : null,
      }
    })
    await rememberAccess(actor, entries)
    for (const entry of entries) result.set(entry.fileId, entry.access)
    return { access: result, unavailable: false }
  } catch (error) {
    if (error instanceof NotLinked) {
      for (const id of ids) result.set(id, null)
      return { access: result, unavailable: false }
    }
    const missing = [...stale].some((id) => !result.has(id))
    for (const id of stale) if (!result.has(id)) result.set(id, null)
    return { access: result, unavailable: missing }
  }
}
