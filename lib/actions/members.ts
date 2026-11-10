import { and, eq, isNull, sql } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { account, user } from "@/lib/db/schema"
import { labMembers } from "@/lib/keycloak"
import { memberAvatar } from "@/lib/portal"

export const listMembers = defineAction({
  name: "list_members",
  title: "成員名單",
  description:
    "Every WinLab member (Keycloak /lab-member, alumni included) and everyone who has signed in to the viewer: id, name (Chinese), account name and email, sorted by name. The id works wherever a member id is asked for, even for members who never signed in.",
  kind: "query",
  input: z.object({}),
  run: async () => {
    const [rows, lab] = await Promise.all([
      db
        .select({
          id: user.id,
          name: user.name,
          username: user.username,
          email: user.email,
          sub: account.accountId,
        })
        .from(user)
        .leftJoin(
          account,
          and(eq(account.userId, user.id), eq(account.providerId, "keycloak"))
        )
        .where(isNull(user.guestLinkId)),
      // Without Keycloak, the list is who has signed in.
      labMembers().catch(() => []),
    ])
    const known = new Set(rows.map((row) => row.sub))
    const bySub = new Map(lab.map((member) => [member.sub, member]))
    const members = [
      ...rows.map(({ id, name, username, email, sub }) => ({
        id,
        name,
        username,
        // Named before they signed in: show Keycloak's email, not the
        // placeholder.
        email: email.endsWith("@keycloak.invalid")
          ? (bySub.get(sub ?? "")?.email ?? "")
          : email,
      })),
      // Members who never signed in go by their Keycloak id until they do.
      ...lab
        .filter((member) => !known.has(member.sub))
        .map((member) => ({
          id: member.sub,
          name: member.name,
          username: member.username,
          email: member.email ?? "",
        })),
    ]
    return members.sort((a, b) => a.name.localeCompare(b.name, "zh-TW"))
  },
})

export const getMemberAvatar = defineAction({
  name: "get_member_avatar",
  title: "成員頭像",
  description:
    "One member's avatar, the same picture they have on portal.winlab.tw, as base64 WebP (96px) with its version, or null when they have none or portal does not answer. user_id is a viewer member id.",
  kind: "query",
  // A guest sees the avatars of the others who have the document open.
  guests: true,
  input: z.object({ user_id: z.uuid() }),
  run: async (_actor, { user_id }) => {
    const [member] = await db
      .select({ username: user.username })
      .from(user)
      .where(and(eq(user.id, user_id), isNull(user.guestLinkId)))
      .limit(1)
    return member?.username ? memberAvatar(member.username) : null
  },
})

/** The viewer user for a member id from list_members. A lab member who
 * never signed in gets their user now, linked to their Keycloak account
 * the way sign-in links it, so their first sign-in lands on it. */
export async function memberUserId(id: string) {
  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    // A guest is never a member: no grants for them.
    .where(and(eq(user.id, id), isNull(user.guestLinkId)))
  if (existing) return existing.id
  const [linked] = await db
    .select({ userId: account.userId })
    .from(account)
    .where(and(eq(account.providerId, "keycloak"), eq(account.accountId, id)))
  if (linked) return linked.userId
  const member = (await labMembers()).find((m) => m.sub === id)
  if (!member) throw new Error("找不到這位成員")
  return db.transaction(async (tx) => {
    // Two admins naming the same new member at once: the second waits here
    // and finds the first one's user.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${id}))`)
    const [again] = await tx
      .select({ userId: account.userId })
      .from(account)
      .where(and(eq(account.providerId, "keycloak"), eq(account.accountId, id)))
    if (again) return again.userId
    const [created] = await tx
      .insert(user)
      .values({
        name: member.name,
        // users.email is unique and required. A placeholder, never the real
        // email: a real one held here would block whoever Keycloak gives it
        // to next. Their first sign-in sets the Keycloak email.
        email: `${member.sub}@keycloak.invalid`,
        emailVerified: false,
        username: member.username,
      })
      .returning({ id: user.id })
    await tx.insert(account).values({
      accountId: member.sub,
      providerId: "keycloak",
      userId: created.id,
      updatedAt: new Date(),
    })
    return created.id
  })
}
