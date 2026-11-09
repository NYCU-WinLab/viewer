import { redirect } from "next/navigation"

import { DocumentGrid } from "@/components/document-grid"
import { EmptyState } from "@/components/empty-state"
import { ViewerShell } from "@/components/viewer-shell"
import { runAction } from "@/lib/actions/define"
import { listDocuments } from "@/lib/actions/documents"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

// The member's documents and the ones shared with them, newest change
// first. ?show=mine or ?show=shared narrows it.
export default async function Home({ searchParams }: PageProps<"/">) {
  const { show } = (await searchParams) as { show?: string }
  const actor = await requireActor("/")
  // A guest has one document and no list.
  const me = await runAction(whoami, actor, {})
  if (me.guestDocumentId) redirect(`/d/${me.guestDocumentId}`)
  const all = await runAction(listDocuments, actor, {})
  const documents = all.filter((doc) =>
    show === "mine"
      ? doc.access === "owner"
      : show === "shared"
        ? doc.access !== "owner"
        : true
  )
  const filters = [
    { label: "全部", href: "/", tip: "", current: !show },
    { label: "我的", href: "/?show=mine", tip: "", current: show === "mine" },
    {
      label: "共用給我",
      href: "/?show=shared",
      tip: "",
      current: show === "shared",
    },
  ]
  return (
    <ViewerShell layout="wide" nav={filters}>
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="sr-only">文件</h1>
        {documents.length === 0 ? (
          <EmptyState noun="文件" />
        ) : (
          <DocumentGrid documents={documents} />
        )}
      </div>
    </ViewerShell>
  )
}
