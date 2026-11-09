import Link from "next/link"
import { redirect } from "next/navigation"

import { EmptyState } from "@/components/empty-state"
import { PageHeader } from "@/components/page-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
    { label: "全部", href: "/", on: !show },
    { label: "我的", href: "/?show=mine", on: show === "mine" },
    { label: "共用給我", href: "/?show=shared", on: show === "shared" },
  ]
  return (
    <ViewerShell>
      <div className="flex flex-col gap-8">
        <PageHeader title="文件" />
        <nav aria-label="篩選" className="flex gap-6">
          {filters.map((filter) => (
            <Link
              key={filter.href}
              href={filter.href}
              aria-current={filter.on ? "page" : undefined}
              className="text-muted-foreground hover:text-foreground aria-[current=page]:text-primary"
            >
              {filter.label}
            </Link>
          ))}
        </nav>
        {documents.length === 0 ? (
          <EmptyState noun="文件" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名稱</TableHead>
                <TableHead>類型</TableHead>
                <TableHead>擁有者</TableHead>
                <TableHead>權限</TableHead>
                <TableHead className="text-right">未處理</TableHead>
                <TableHead className="text-right">更新</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc) => (
                <TableRow key={doc.id}>
                  <TableCell>
                    <Link
                      href={`/d/${doc.id}`}
                      prefetch
                      className="font-medium hover:text-primary"
                    >
                      {doc.name}
                    </Link>
                    {doc.latestVersion > 1 && (
                      <span className="ml-2 text-muted-foreground">
                        v{doc.latestVersion}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{kinds[doc.kind]}</TableCell>
                  <TableCell>{doc.ownerName}</TableCell>
                  <TableCell>{roles[doc.access]}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {doc.openMarks || ""}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {when.format(new Date(doc.updatedAt))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </ViewerShell>
  )
}
