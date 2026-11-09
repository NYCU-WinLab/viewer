import { redirect } from "next/navigation"

import { DocumentGrid } from "@/components/document-grid"
import { PageHeader } from "@/components/page-header"
import { UploadButton } from "@/components/upload-button"
import { ViewerShell } from "@/components/viewer-shell"
import { runAction } from "@/lib/actions/define"
import { listDocuments } from "@/lib/actions/documents"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

// The member's documents and the ones they can open through sharing or
// Nextcloud, newest change first, under 全部, 我的 and 共用給我 tabs.
export default async function Home() {
  const actor = await requireActor("/")
  // A guest has one document and no list.
  const me = await runAction(whoami, actor, {})
  if (me.guestDocumentId) redirect(`/d/${me.guestDocumentId}`)
  const documents = await runAction(listDocuments, actor, {})
  return (
    <ViewerShell layout="wide" actions={null}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <PageHeader title="文件" actions={<UploadButton variant="button" />} />
        <DocumentGrid documents={documents} />
      </div>
    </ViewerShell>
  )
}
