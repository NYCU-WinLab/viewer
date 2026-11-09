import { redirect } from "next/navigation"

import { StatusPage } from "@/components/status-page"
import { ViewerShell } from "@/components/viewer-shell"
import { runAction } from "@/lib/actions/define"
import { guestLinkInfo } from "@/lib/actions/guests"
import { getSession } from "@/lib/auth/session"

import { GuestJoin } from "./guest-join"

export const dynamic = "force-dynamic"

// The way in for someone without a lab account. The secret in the link is
// their password. A member who opens it goes straight to the document.
export default async function GuestPage({ params }: PageProps<"/g/[secret]">) {
  const { secret } = await params
  let link: { documentId: string; name: string }
  try {
    link = await runAction(
      guestLinkInfo,
      { userId: "", via: "web" },
      { secret }
    )
  } catch {
    return (
      <ViewerShell layout="spotlight" actions={null}>
        <StatusPage title="這個訪客連結無效或已過期" />
      </ViewerShell>
    )
  }
  const session = await getSession()
  if (session && !session.user.guestLinkId) redirect(`/d/${link.documentId}`)
  return (
    <ViewerShell layout="spotlight" actions={null}>
      <GuestJoin secret={secret} name={link.name} />
    </ViewerShell>
  )
}
