"use client"

import { FileTextIcon, FolderIcon } from "lucide-react"
import { usePathname } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import {
  importFromNextcloud,
  loadNextcloudFiles,
  loadNextcloudStatus,
} from "@/app/actions"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Entry = {
  name: string
  path: string
  folder: boolean
  size: number
  modified: string
}

const when = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "numeric",
  day: "numeric",
})

const megabytes = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`

// The member's Nextcloud files, one folder at a time: folders open, a
// PDF, Word or PowerPoint file imports (a new document, or with documentId
// the next version). Not linked yet: one button to link.
export function NextcloudPicker({
  documentId,
  onDone,
}: {
  documentId?: string
  onDone: (result: { id: string; version: number }) => void
}) {
  const here = usePathname()
  const [linked, setLinked] = React.useState<boolean | null>(null)
  const [available, setAvailable] = React.useState(true)
  const [folder, setFolder] = React.useState("/")
  const [entries, setEntries] = React.useState<Entry[] | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    loadNextcloudStatus().then((result) => {
      setAvailable(result.data?.available ?? false)
      setLinked(result.data?.linked ?? false)
    })
  }, [])

  React.useEffect(() => {
    if (!linked) return
    let current = true
    loadNextcloudFiles({ path: folder }).then((result) => {
      if (!current) return
      if (result.error) {
        toast.error(result.error)
        if (/重新連結|還沒連結/.test(result.error)) setLinked(false)
        setEntries([])
      } else setEntries(result.data ?? [])
    })
    return () => {
      current = false
    }
  }, [linked, folder])

  if (linked === null)
    return <p className="py-12 text-center text-muted-foreground">載入中…</p>
  if (!available)
    return (
      <p className="py-12 text-center text-muted-foreground">
        Nextcloud 連結還沒設定
      </p>
    )
  if (!linked)
    return (
      <div className="flex justify-center py-12">
        {/* A plain link: /nextcloud/connect is a route that leaves the site. */}
        <Button
          render={
            <a
              href={`/nextcloud/connect?${new URLSearchParams({ next: here })}`}
            />
          }
        >
          連結 Nextcloud
        </Button>
      </div>
    )

  const parts = folder.split("/").filter(Boolean)
  const go = (path: string) => {
    setEntries(null)
    setFolder(path)
  }
  const open = async (entry: Entry) => {
    if (entry.folder) return go(entry.path)
    setBusy(entry.path)
    const result = await importFromNextcloud({ path: entry.path, documentId })
    setBusy(null)
    if (!result.data) return toast.error(result.error ?? "匯入失敗")
    onDone(result.data)
  }

  return (
    <div className="flex flex-col gap-2">
      <nav
        aria-label="資料夾"
        className="flex flex-wrap items-center gap-1 text-muted-foreground"
      >
        <button
          type="button"
          className="rounded-control px-1 hover:text-foreground"
          onClick={() => go("/")}
        >
          Nextcloud
        </button>
        {parts.map((part, index) => (
          <React.Fragment key={index}>
            <span aria-hidden>/</span>
            <button
              type="button"
              className="rounded-control px-1 hover:text-foreground"
              onClick={() => go(`/${parts.slice(0, index + 1).join("/")}`)}
            >
              {part}
            </button>
          </React.Fragment>
        ))}
      </nav>
      <ul className="flex h-80 flex-col overflow-y-auto">
        {entries === null ? (
          <li className="py-12 text-center text-muted-foreground">載入中…</li>
        ) : entries.length === 0 ? (
          <li className="py-12 text-center text-muted-foreground">
            這裡沒有能匯入的檔案
          </li>
        ) : (
          entries.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => open(entry)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-control p-2 text-left hover:bg-muted disabled:opacity-50",
                  busy === entry.path && "bg-muted"
                )}
              >
                {entry.folder ? (
                  <FolderIcon className="shrink-0 text-muted-foreground" />
                ) : (
                  <FileTextIcon className="shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                <span className="shrink-0 text-muted-foreground">
                  {busy === entry.path
                    ? "轉檔中…"
                    : entry.folder
                      ? when.format(new Date(entry.modified))
                      : megabytes(entry.size)}
                </span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
