import { AppShell } from "@/components/app-shell"
import { LiveRefresh } from "@/components/live-refresh"
import { UploadButton } from "@/components/upload-button"
import { runningBuild } from "@/lib/build"

// The viewer's corners: the lab and the page in the breadcrumb, Upload in the
// top right (it opens over the page), and the shell's default corners (the
// build in the bottom left). No account corner: sign-in is Keycloak's.
export function ViewerShell({
  page,
  layout,
  children,
}: {
  page?: { label: string; href: string; tip: string }
  layout?: "column" | "spotlight" | "wide"
  children: React.ReactNode
}) {
  return (
    <AppShell
      layout={layout}
      breadcrumb={[
        { label: "WinLab", href: "https://portal.winlab.tw", tip: "" },
        { label: "Viewer", href: "/", tip: "" },
        ...(page ? [page] : []),
      ]}
      actions={<UploadButton />}
      build={runningBuild()}
    >
      <LiveRefresh />
      {children}
    </AppShell>
  )
}
