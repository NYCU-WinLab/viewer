"use server"

import { redirect } from "next/navigation"

import { errorMessage, runAction } from "@/lib/actions/define"
import { joinAsGuest } from "@/lib/actions/guests"

// Signs the guest in and opens the document; an error comes back for a
// toast.
export async function join(input: { secret: string; name: string }) {
  let documentId: string
  try {
    ;({ documentId } = await runAction(
      joinAsGuest,
      { userId: "", via: "web" },
      input
    ))
  } catch (error) {
    return { error: errorMessage(error) }
  }
  redirect(`/d/${documentId}`)
}
