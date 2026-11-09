import { ViewerShell } from "@/components/viewer-shell"
import { StatusPage } from "@/components/status-page"
import { getConsentRequest } from "@/lib/auth/consent"
import { runAction } from "@/lib/actions/define"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"

import { ConsentActions } from "./consent-actions"

export const dynamic = "force-dynamic"

export default async function Consent({ searchParams }: PageProps<"/consent">) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of [value].flat())
      if (item !== undefined) params.append(key, item)
  }
  const query = params.toString()
  const actor = await requireActor(`/consent?${query}`)
  // Agents act for lab members; a guest has nothing to hand them.
  if ((await runAction(whoami, actor, {})).guestDocumentId)
    return (
      <ViewerShell layout="spotlight">
        <StatusPage title="訪客不能授權" />
      </ViewerShell>
    )
  const request = await getConsentRequest(query)

  if (!request) {
    return (
      <ViewerShell layout="spotlight">
        <StatusPage title="授權連結已失效" />
      </ViewerShell>
    )
  }

  return (
    <ViewerShell layout="spotlight">
      <StatusPage
        title={`允許 ${request.name}${request.host ? `（${request.host}）` : ""} 以你的身分操作？`}
        action={<ConsentActions />}
      />
    </ViewerShell>
  )
}
