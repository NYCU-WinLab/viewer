import {
  AppShell,
  BuildVersion,
  CornerLink,
  CornerTip,
} from "@/components/app-shell"
import { LiveRefresh } from "@/components/live-refresh"
import { UploadButton } from "@/components/upload-button"
import { getSession } from "@/lib/auth/session"
import { runningBuild } from "@/lib/build"

// The viewer's corners: the lab and the page in the breadcrumb, Upload in the
// top right (it opens over the page), the member's account next to the
// build in the bottom left.
export async function ViewerShell({
  page,
  layout,
  children,
}: {
  page?: { label: string; href: string; tip: string }
  layout?: "column" | "spotlight" | "wide"
  children: React.ReactNode
}) {
  const session = await getSession()
  return (
    <AppShell
      layout={layout}
      breadcrumb={[
        { label: "WinLab", href: "https://portal.winlab.tw", tip: "" },
        { label: "Viewer", href: "/", tip: "" },
        ...(page ? [page] : []),
      ]}
      actions={<UploadButton />}
      corners={{
        bottomLeft: (
          <>
            {session && (
              <CornerTip tip={session.user.email} corner="bottom-left">
                <CornerLink href="/profile" prefetch>
                  {session.user.name}
                </CornerLink>
              </CornerTip>
            )}
            <BuildVersion build={runningBuild()} />
          </>
        ),
      }}
    >
      <LiveRefresh />
      {children}
    </AppShell>
  )
}
