"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { CheckIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { comment, resolve, reword, uncomment, unmark } from "@/app/actions"
import type { Comment, Mark } from "@/components/reader/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const when = new Intl.DateTimeFormat("zh-TW", {
  timeZone: "Asia/Taipei",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

export function formatWhen(iso: string) {
  return when.format(new Date(iso))
}

const toolNames = { highlight: "螢光筆", box: "框選", pen: "原子筆" } as const

/** Runs a server action and toasts its error; true when it worked. */
async function attempt(result: Promise<{ error?: string }>) {
  const { error } = await result
  if (error) toast.error(error)
  return !error
}

// The sticky note of one mark, held next to it on the page: who marked it,
// the thread of comments and a box to add one. It opens when a mark is
// clicked or just drawn.
export function StickyNote({
  mark,
  anchor,
  canComment,
  canManage,
  onClose,
  onChanged,
}: {
  mark: Mark
  anchor: Element
  canComment: boolean
  /** Edit access: may delete anyone's mark. */
  canManage: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [draft, setDraft] = React.useState("")
  const [busy, setBusy] = React.useState(false)

  const send = async () => {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    if (await attempt(comment({ annotationId: mark.id, body }))) {
      setDraft("")
      onChanged()
    }
    setBusy(false)
  }

  return (
    <PopoverPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          anchor={anchor}
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={16}
          className="isolate z-40"
        >
          <PopoverPrimitive.Popup className="flex max-h-120 w-80 flex-col gap-3 overflow-y-auto rounded-menu border border-border bg-overlay p-4 text-body text-foreground shadow-md outline-hidden backdrop-blur-md duration-overlay data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            <header className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">
                  {mark.author ?? "已離開的成員"}
                  <span className="ml-2 text-muted-foreground">
                    {toolNames[mark.tool]}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {formatWhen(mark.createdAt)}
                  {mark.resolvedAt &&
                    `，${mark.resolvedBy ?? "有人"}標為已處理`}
                </p>
              </div>
              <div className="flex shrink-0">
                {canComment && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={mark.resolvedAt ? "重新打開" : "已處理"}
                          onClick={async () => {
                            if (
                              await attempt(
                                resolve({
                                  id: mark.id,
                                  resolved: !mark.resolvedAt,
                                })
                              )
                            )
                              onChanged()
                          }}
                        />
                      }
                    >
                      {mark.resolvedAt ? <RotateCcwIcon /> : <CheckIcon />}
                    </TooltipTrigger>
                    <TooltipContent>
                      {mark.resolvedAt ? "重新打開" : "已處理"}
                    </TooltipContent>
                  </Tooltip>
                )}
                {(mark.mine || canManage) && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="刪除標記"
                          onClick={async () => {
                            if (await attempt(unmark({ id: mark.id }))) {
                              onClose()
                              onChanged()
                            }
                          }}
                        />
                      }
                    >
                      <Trash2Icon />
                    </TooltipTrigger>
                    <TooltipContent>刪除標記</TooltipContent>
                  </Tooltip>
                )}
              </div>
            </header>
            {mark.quote?.exact && (
              <blockquote className="line-clamp-3 border-l-2 border-warning pl-3 text-muted-foreground">
                {mark.quote.exact}
              </blockquote>
            )}
            {mark.comments.length > 0 && (
              <ol className="flex flex-col gap-3">
                {mark.comments.map((note) => (
                  <CommentItem
                    key={note.id}
                    note={note}
                    onChanged={onChanged}
                  />
                ))}
              </ol>
            )}
            {canComment && (
              <div className="flex flex-col gap-2">
                <Textarea
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (event.metaKey || event.ctrlKey)
                    )
                      send()
                  }}
                  placeholder={mark.comments.length ? "回覆" : "寫下你的想法"}
                  aria-label="留言"
                  disabled={busy}
                />
                <div className="flex justify-end">
                  <Button onClick={send} disabled={busy || !draft.trim()}>
                    留言
                  </Button>
                </div>
              </div>
            )}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

// One comment. Its author can rewrite or delete it; an edited one shows
// an Edited button, which opens its earlier wordings.
function CommentItem({
  note,
  onChanged,
}: {
  note: Comment
  onChanged: () => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState(note.body)
  const [history, setHistory] = React.useState(false)

  const save = async () => {
    if (await attempt(reword({ id: note.id, body: text }))) {
      setEditing(false)
      onChanged()
    }
  }

  return (
    <li className="flex flex-col gap-1">
      <p className="flex items-baseline gap-2">
        <span className="font-medium">{note.author ?? "已離開的成員"}</span>
        <span className="text-muted-foreground">
          {formatWhen(note.createdAt)}
        </span>
        {note.editedAt && (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setHistory(!history)}
          >
            已編輯
          </button>
        )}
      </p>
      {editing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="修改留言"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button onClick={save} disabled={!text.trim()}>
              儲存
            </Button>
          </div>
        </div>
      ) : (
        <p className="break-words whitespace-pre-wrap">{note.body}</p>
      )}
      {history && (
        <ol className="flex flex-col gap-1 border-l-2 border-border pl-3 text-muted-foreground">
          {note.revisions.map((revision, index) => (
            <li key={index}>
              <span className="line-through">{revision.body}</span>
              <span className="ml-2">{formatWhen(revision.replacedAt)} 前</span>
            </li>
          ))}
        </ol>
      )}
      {note.mine && !editing && (
        <div className={cn("flex gap-3 text-muted-foreground")}>
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => {
              setText(note.body)
              setEditing(true)
            }}
          >
            編輯
          </button>
          <button
            type="button"
            className="hover:text-destructive"
            onClick={async () => {
              if (await attempt(uncomment({ id: note.id }))) onChanged()
            }}
          >
            刪除
          </button>
        </div>
      )}
    </li>
  )
}
