import { eq } from "drizzle-orm"

import type { Actor } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { nextcloudTokens } from "@/lib/db/schema"
import {
  type NextcloudToken,
  refreshToken,
  TokenRevoked,
} from "@/lib/nextcloud"
import { seal, unseal } from "@/lib/seal"

/** The member has no working link to Nextcloud: never linked, or the link
 * stopped working and was removed. */
export class NotLinked extends Error {}

/** The member's token, refreshed when it has expired. Nextcloud rotates
 * the refresh token on each use, so the row stays locked meanwhile. A
 * refresh Nextcloud refuses unlinks the member (the delete commits before
 * the error); a timeout or server error keeps the link for the next try. */
export async function tokenOf(actor: Actor): Promise<NextcloudToken> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(nextcloudTokens)
      .where(eq(nextcloudTokens.userId, actor.userId))
      .for("update")
    if (!row) throw new NotLinked("還沒連結 Nextcloud")
    // Tokens sealed under an older BETTER_AUTH_SECRET cannot be opened:
    // the member links again.
    let saved: { access: string; refresh: string }
    try {
      saved = {
        access: unseal(row.accessToken),
        refresh: unseal(row.refreshToken),
      }
    } catch {
      await tx
        .delete(nextcloudTokens)
        .where(eq(nextcloudTokens.userId, actor.userId))
      return null
    }
    if (row.expiresAt.getTime() > Date.now())
      return {
        accessToken: saved.access,
        refreshToken: saved.refresh,
        expiresAt: row.expiresAt,
        user: row.nextcloudUser,
      }
    let fresh: NextcloudToken
    try {
      fresh = await refreshToken(saved.refresh)
    } catch (error) {
      if (!(error instanceof TokenRevoked))
        throw new Error("暫時連不上 Nextcloud，請稍後再試")
      await tx
        .delete(nextcloudTokens)
        .where(eq(nextcloudTokens.userId, actor.userId))
      return null
    }
    await tx
      .update(nextcloudTokens)
      .set({
        accessToken: seal(fresh.accessToken),
        refreshToken: seal(fresh.refreshToken),
        expiresAt: fresh.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(nextcloudTokens.userId, actor.userId))
    return fresh
  })
  if (!result) throw new NotLinked("Nextcloud 連結已失效，請重新連結")
  return result
}
