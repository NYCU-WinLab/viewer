import { and, eq, gt, isNull } from "drizzle-orm"

import type { Actor } from "@/lib/actions/define"
import { db } from "@/lib/db"
import {
  documentGrants,
  documents,
  guestLinks,
  type Role,
  user,
} from "@/lib/db/schema"

export type Access = Role | "owner"

const rank: Record<Access, number> = { view: 1, comment: 2, edit: 3, owner: 4 }

/** What the member may do with a document, or null when they may not see
 * it at all (missing documents look the same, so ids leak nothing). */
export async function accessTo(
  actor: Actor,
  documentId: string
): Promise<Access | null> {
  const [row] = await db
    .select({ ownerId: documents.ownerId, role: documentGrants.role })
    .from(documents)
    .leftJoin(
      documentGrants,
      and(
        eq(documentGrants.documentId, documents.id),
        eq(documentGrants.userId, actor.userId)
      )
    )
    .where(eq(documents.id, documentId))
    .limit(1)
  if (!row) return null
  if (row.ownerId === actor.userId) return "owner"
  if (row.role) return row.role
  // A guest: their link's role, while the link is active and is for this
  // document. Guests never own documents or hold grants.
  const [guest] = await db
    .select({ role: guestLinks.role })
    .from(user)
    .innerJoin(guestLinks, eq(guestLinks.id, user.guestLinkId))
    .where(
      and(
        eq(user.id, actor.userId),
        eq(guestLinks.documentId, documentId),
        isNull(guestLinks.revokedAt),
        gt(guestLinks.expiresAt, new Date())
      )
    )
  return guest?.role ?? null
}

/** The one check every document action starts with: at least `needed`,
 * or it fails as if the document were not there. */
export async function requireAccess(
  actor: Actor,
  documentId: string,
  needed: Access
) {
  const access = await accessTo(actor, documentId)
  if (!access) throw new Error("找不到這份文件")
  if (rank[access] < rank[needed])
    throw new Error(
      needed === "comment"
        ? "你只能檢視這份文件"
        : needed === "edit"
          ? "你沒有編輯這份文件的權限"
          : "只有擁有者可以這樣做"
    )
  return access
}

export function atLeast(access: Access, needed: Access) {
  return rank[access] >= rank[needed]
}
