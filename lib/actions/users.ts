import { eq } from "drizzle-orm"
import { z } from "zod"

import { defineAction } from "@/lib/actions/define"
import { db } from "@/lib/db"
import { guestLinks, user } from "@/lib/db/schema"

export const whoami = defineAction({
  name: "whoami",
  title: "我是誰",
  description:
    "The signed-in member: id, name (Chinese name from Keycloak), email and lab account username. Call it first to know who you act as. For a guest (in through a guest link), guestDocumentId is the one document they may open; null for members.",
  kind: "query",
  guests: true,
  input: z.object({}),
  run: async (actor) => {
    const [member] = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        guestDocumentId: guestLinks.documentId,
      })
      .from(user)
      .leftJoin(guestLinks, eq(guestLinks.id, user.guestLinkId))
      .where(eq(user.id, actor.userId))
    if (!member) throw new Error("找不到這個成員")
    return member
  },
})
