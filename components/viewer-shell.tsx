import { AppShell } from "@/components/app-shell"
import { LiveRefresh } from "@/components/live-refresh"
import { UploadButton } from "@/components/upload-button"

// The viewer's corners: the lab and the page in the breadcrumb, and the top
// right (Upload by default; a document shows who is reading it instead).
// The bottom corners stay empty: the reader's tool bar owns the bottom. No
// account corner: sign-in is Keycloak's.
export function ViewerShell({
  page,
  nav,
  layout,
  actions = <UploadButton />,
  children,
}: {
  page?: { label: string; href: string; tip: string }
  nav?: { label: string; href: string; tip: string; current?: boolean }[]
  layout?: "column" | "spotlight" | "wide"
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <AppShell
      layout={layout}
      nav={nav}
      breadcrumb={[
        { label: "WinLab", href: "https://portal.winlab.tw", tip: "" },
        { label: "Viewer", href: "/", tip: "" },
        ...(page ? [page] : []),
      ]}
      actions={actions}
      // An empty fragment would reach the client as null and bring the
      // defaults back, so the corners get an empty span.
      corners={{ bottomLeft: <span />, bottomRight: <span /> }}
    >
      <LiveRefresh />
      {children}
    </AppShell>
  )
}
