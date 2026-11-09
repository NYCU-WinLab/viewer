import { notFound } from "next/navigation"

import { DocumentActions } from "@/components/reader/document-actions"
import { PresenceProvider, Viewers } from "@/components/reader/presence"
import { Reader } from "@/components/reader/reader"
import { ViewerShell } from "@/components/viewer-shell"
import { atLeast } from "@/lib/actions/access"
import { listAnnotations } from "@/lib/actions/annotations"
import { runAction } from "@/lib/actions/define"
import { getDocument } from "@/lib/actions/documents"
import { getSession, requireActor } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

// One document, read and marked together. ?v=<n> opens an older version;
// without it, the newest.
export default async function DocumentPage({
  params,
  searchParams,
}: PageProps<"/d/[id]">) {
  const { id } = await params
  const { v } = (await searchParams) as { v?: string }
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound()
  const actor = await requireActor(`/d/${id}`)
  const doc = await runAction(getDocument, actor, { id })
  if (!doc || doc.latestVersion === 0) notFound()
  const asked = Number(v)
  const version = doc.versions.some((x) => x.number === asked)
    ? asked
    : doc.latestVersion
  const marks = await runAction(listAnnotations, actor, { id, version })
  const session = await getSession()
  const me = {
    userId: actor.userId,
    name: session?.user.name ?? "",
    image: session?.user.image ?? null,
  }

  return (
    <PresenceProvider documentId={id} me={me}>
      <ViewerShell
        layout="wide"
        page={{ label: doc.name, href: `/d/${id}`, tip: doc.ownerName }}
        actions={<Viewers />}
      >
        <Reader
          key={version}
          documentId={id}
          version={version}
          marks={marks}
          canComment={atLeast(doc.access, "comment")}
          canManage={atLeast(doc.access, "edit")}
          actions={
            <DocumentActions
              documentId={id}
              version={version}
              versions={doc.versions}
              canEdit={atLeast(doc.access, "edit")}
              isOwner={doc.access === "owner"}
            />
          }
        />
      </ViewerShell>
    </PresenceProvider>
  )
}
