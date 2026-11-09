"use client"

import { CheckIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import { remove, rename } from "@/app/actions"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { EmptyState } from "@/components/empty-state"
import { FormDialog, FormField } from "@/components/form-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export type GridDocument = {
  id: string
  name: string
  ownerName: string
  access: "owner" | "edit" | "comment" | "view"
  kind: "pdf" | "docx" | "pptx"
  latestVersion: number
  openMarks: number
  updatedAt: string
}

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

// The home page's cards, under 全部, 我的 and 共用給我 tabs. A right click (a long press on a phone) opens a
// card's menu; 選取 there, or a click with ⌘, Ctrl or Shift, starts a
// selection, and while one is open a click adds or drops a card. The bar
// at the bottom deletes what is selected; Esc clears it.
export function DocumentGrid({ documents }: { documents: GridDocument[] }) {
  const router = useRouter()
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [renaming, setRenaming] = React.useState<GridDocument | null>(null)
  const [deleting, setDeleting] = React.useState<GridDocument[] | null>(null)

  // Drop ids that left the list (deleted, or access removed).
  const visible = new Set(documents.map((doc) => doc.id))
  const chosen = documents.filter((doc) => selected.has(doc.id))
  const selecting = chosen.length > 0

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set([...current].filter((one) => visible.has(one)))
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  React.useEffect(() => {
    if (!selecting) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(new Set())
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selecting])

  const owned = chosen.filter((doc) => doc.access === "owner")

  const tabs = [
    { value: "all", label: "全部", list: documents },
    {
      value: "mine",
      label: "我的",
      list: documents.filter((doc) => doc.access === "owner"),
    },
    {
      value: "shared",
      label: "共用給我",
      list: documents.filter((doc) => doc.access !== "owner"),
    },
  ]

  const cards = (list: GridDocument[]) => (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {list.map((doc) => {
        const on = selected.has(doc.id)
        return (
          <li key={doc.id}>
            <ContextMenu>
              <ContextMenuTrigger
                render={
                  <Link
                    href={`/d/${doc.id}`}
                    prefetch
                    aria-selected={selecting ? on : undefined}
                    onClick={(event) => {
                      if (
                        selecting ||
                        event.metaKey ||
                        event.ctrlKey ||
                        event.shiftKey
                      ) {
                        event.preventDefault()
                        toggle(doc.id)
                      }
                    }}
                    className={cn(
                      "flex flex-col gap-3 rounded-menu p-3 transition-colors duration-state outline-none select-none hover:bg-muted focus-visible:bg-muted data-popup-open:bg-muted",
                      on && "bg-muted"
                    )}
                  />
                }
              >
                <div
                  className={cn(
                    "relative aspect-4/3 overflow-hidden rounded-menu bg-muted",
                    on && "outline-2 -outline-offset-2 outline-primary"
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- a member-only route, not an optimizable asset */}
                  <img
                    src={`/files/${doc.id}/${doc.latestVersion}/cover`}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="size-full object-contain"
                  />
                  {on && (
                    <span className="absolute top-2 left-2 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
                      <CheckIcon className="size-4" />
                    </span>
                  )}
                  <Badge
                    variant="outline"
                    className="absolute bottom-2 left-2 bg-background"
                  >
                    {kinds[doc.kind]}
                  </Badge>
                  {doc.openMarks > 0 && (
                    <Badge className="absolute top-2 right-2">
                      {doc.openMarks} 未處理
                    </Badge>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate font-medium">
                    {doc.name}
                    {doc.latestVersion > 1 && (
                      <span className="ml-2 font-normal text-muted-foreground">
                        v{doc.latestVersion}
                      </span>
                    )}
                  </span>
                  <span className="flex gap-3 whitespace-nowrap text-muted-foreground">
                    <span className="min-w-0 truncate">
                      {doc.access === "owner"
                        ? "我"
                        : `${doc.ownerName}，${roles[doc.access]}`}
                    </span>
                    <span className="ml-auto tabular-nums">
                      {when.format(new Date(doc.updatedAt))}
                    </span>
                  </span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => router.push(`/d/${doc.id}`)}>
                  打開
                </ContextMenuItem>
                <ContextMenuItem onClick={() => toggle(doc.id)}>
                  {on ? "取消選取" : "選取"}
                </ContextMenuItem>
                {doc.access !== "comment" && doc.access !== "view" && (
                  <ContextMenuItem onClick={() => setRenaming(doc)}>
                    重新命名
                  </ContextMenuItem>
                )}
                {doc.access === "owner" && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      variant="destructive"
                      onClick={() => setDeleting([doc])}
                    >
                      刪除
                    </ContextMenuItem>
                  </>
                )}
              </ContextMenuContent>
            </ContextMenu>
          </li>
        )
      })}
    </ul>
  )

  return (
    <>
      <Tabs defaultValue="all" onValueChange={() => setSelected(new Set())}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label} {tab.list.length}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="pt-6">
            {tab.list.length === 0 ? (
              <EmptyState noun="文件" />
            ) : (
              cards(tab.list)
            )}
          </TabsContent>
        ))}
      </Tabs>

      {selecting && (
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto flex w-fit items-center gap-4 rounded-full border border-border bg-overlay py-2 pr-2 pl-6 shadow-lg backdrop-blur-md">
          <span className="whitespace-nowrap tabular-nums">
            已選 {chosen.length} 份
          </span>
          <Button variant="ghost" onClick={() => setSelected(new Set())}>
            取消
          </Button>
          <Button
            variant="destructive"
            disabled={owned.length === 0}
            onClick={() => setDeleting(owned)}
          >
            {owned.length === chosen.length
              ? "刪除"
              : `刪除我擁有的 ${owned.length} 份`}
          </Button>
        </div>
      )}

      <FormDialog
        open={!!renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="重新命名"
        submitLabel="儲存"
        onSubmit={async (data) => {
          const result = await rename({
            id: renaming!.id,
            name: String(data.get("name") ?? ""),
          })
          if (result.error) {
            toast.error(result.error)
            throw new Error(result.error)
          }
          setRenaming(null)
        }}
      >
        <FormField label="名稱" required>
          <Input
            name="name"
            defaultValue={renaming?.name}
            autoFocus
            maxLength={200}
          />
        </FormField>
      </FormDialog>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={
          deleting?.length === 1
            ? `刪除「${deleting[0].name}」？`
            : `刪除 ${deleting?.length ?? 0} 份文件？`
        }
        confirmLabel="刪除"
        variant="destructive"
        onConfirm={async () => {
          const failed: string[] = []
          for (const doc of deleting ?? []) {
            const result = await remove({ id: doc.id })
            if (result.error) failed.push(`${doc.name}：${result.error}`)
          }
          setSelected(new Set())
          setDeleting(null)
          if (failed.length) toast.error(failed.join("\n"))
        }}
      />
    </>
  )
}
