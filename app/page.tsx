import Link from "next/link"
import { redirect } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { ViewerShell } from "@/components/viewer-shell"
import { runAction } from "@/lib/actions/define"
import { listDocuments } from "@/lib/actions/documents"
import { whoami } from "@/lib/actions/users"
import { requireActor } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

const kinds = { pdf: "PDF", docx: "Word", pptx: "PowerPoint" } as const
const roles = {
  owner: "擁有者",
  edit: "可管理",
  comment: "可註解",
  view: "僅檢視",
} as const

const when = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

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
    { label: "共用給我", href: "/?show=shared", tip: "", current: show === "shared" },
  ]
  return (
    <ViewerShell
      layout="wide"
      nav={filters}
    >
      <div className="mx-auto w-full max-w-6xl">
        <h1 className="sr-only">文件</h1>
        {documents.length === 0 ? (
          <EmptyState noun="文件" />
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {documents.map((doc) => (
              <li key={doc.id}>
                <Link
                  href={`/d/${doc.id}`}
                  prefetch
                  className="flex flex-col gap-3 rounded-menu p-3 transition-colors duration-state outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <div className="relative aspect-4/3 overflow-hidden rounded-menu bg-muted">
                    {/* eslint-disable-next-line @next/next/no-img-element -- a member-only route, not an optimizable asset */}
                    <img
                      src={`/files/${doc.id}/${doc.latestVersion}/cover`}
                      alt=""
                      loading="lazy"
                      className="size-full object-contain"
                    />
                    {doc.openMarks > 0 && (
                      <Badge className="absolute top-2 right-2">
                        {doc.openMarks} 未處理
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="truncate font-medium">
                      {doc.name}
                      {doc.latestVersion > 1 && (
                        <span className="ml-2 font-normal text-muted-foreground">
                          v{doc.latestVersion}
                        </span>
                      )}
                    </span>
                    <span className="flex gap-3 text-muted-foreground">
                      <span>{kinds[doc.kind]}</span>
                      <span>
                        {doc.access === "owner"
                          ? roles.owner
                          : `${doc.ownerName}，${roles[doc.access]}`}
                      </span>
                      <span className="ml-auto tabular-nums">
                        {when.format(new Date(doc.updatedAt))}
                      </span>
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ViewerShell>
  )
}
