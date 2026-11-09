import { ImportNow } from "@/app/import/nextcloud/import-now"
import { EmbedPopup } from "@/components/embed-popup"
import { StatusPage } from "@/components/status-page"
import { runAction } from "@/lib/actions/define"
import { nextcloudStatus } from "@/lib/actions/nextcloud"
import { getSession } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

// The page Nextcloud shows in its frame (the winlab_viewer app):
// /embed/nextcloud?path=<path in the member's files>. It opens the file at
// once (importing it, or a new version when it changed) and goes to the
// document. Signing in and linking Nextcloud happen in a small window,
// since neither sign-in page may be framed.
export default async function EmbedNextcloud({
  searchParams,
}: PageProps<"/embed/nextcloud">) {
  const query = await searchParams
  const path = typeof query.path === "string" ? query.path : ""
  const session = await getSession()
  const page = (body: React.ReactNode) => (
    <main className="flex min-h-svh items-center justify-center p-4">
      {body}
    </main>
  )
  if (!path.startsWith("/")) return page(<StatusPage title="沒有指定檔案" />)
  if (!session || session.user.guestLinkId)
    return page(
      <StatusPage
        title="登入 Viewer 後打開這份檔案"
        action={
          <EmbedPopup
            href={`/sign-in?${new URLSearchParams({ next: "/embed/done" })}`}
            label="登入"
          />
        }
      />
    )
  const status = await runAction(
    nextcloudStatus,
    { userId: session.user.id, via: "web" },
    {}
  )
  if (!status.available)
    return page(<StatusPage title="Nextcloud 連結還沒設定" />)
  if (!status.linked)
    return page(
      <StatusPage
        title="連結 Nextcloud 後打開這份檔案"
        action={
          <EmbedPopup
            href={`/nextcloud/connect?${new URLSearchParams({ next: "/embed/done" })}`}
            label="連結 Nextcloud"
          />
        }
      />
    )
  return page(<ImportNow path={path} auto />)
}
