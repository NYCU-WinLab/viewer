import Link from "next/link"
import { redirect } from "next/navigation"

import { StatusPage } from "@/components/status-page"
import { Button } from "@/components/ui/button"
import { ViewerShell } from "@/components/viewer-shell"
import { runAction } from "@/lib/actions/define"
import { nextcloudStatus } from "@/lib/actions/nextcloud"
import { requireActor } from "@/lib/auth/session"

import { ImportNow } from "./import-now"

export const dynamic = "force-dynamic"

// Where Nextcloud's "在 Viewer 打開" lands: /import/nextcloud?path=<path in
// the member's files>. A member who has not linked Nextcloud links it
// first and comes back; then one click imports the file (or opens the
// document it became) and opens it.
export default async function ImportPage({
  searchParams,
}: PageProps<"/import/nextcloud">) {
  const query = await searchParams
  const path = typeof query.path === "string" ? query.path : ""
  const problem = typeof query.nextcloud === "string" ? query.nextcloud : ""
  const self = `/import/nextcloud?${new URLSearchParams({ path })}`
  const actor = await requireActor(self)
  if (!path.startsWith("/"))
    return (
      <ViewerShell layout="spotlight" actions={null}>
        <StatusPage title="沒有指定檔案" />
      </ViewerShell>
    )
  const status = await runAction(nextcloudStatus, actor, {})
  if (!status.available)
    return (
      <ViewerShell layout="spotlight" actions={null}>
        <StatusPage title="Nextcloud 連結還沒設定" />
      </ViewerShell>
    )
  if (!status.linked && !problem)
    redirect(`/nextcloud/connect?${new URLSearchParams({ next: self })}`)
  return (
    <ViewerShell layout="spotlight" actions={null}>
      {status.linked ? (
        <ImportNow path={path} />
      ) : (
        <StatusPage
          title={problem}
          action={
            <Button
              render={
                <Link
                  href={`/nextcloud/connect?${new URLSearchParams({ next: self })}`}
                />
              }
            >
              連結 Nextcloud
            </Button>
          }
        />
      )}
    </ViewerShell>
  )
}
