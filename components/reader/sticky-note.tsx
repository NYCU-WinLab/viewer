"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { CheckIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { comment, resolve, reword, uncomment, unmark } from "@/app/actions"
import type { Comment, Mark } from "@/components/reader/types"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

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

/** Runs a server action and toasts its error; true when it worked. */
async function attempt(result: Promise<{ error?: string }>) {
  const { error } = await result
  if (error) toast.error(error)
  return !error
}

// The sticky note of one mark: a square of yellow paper next to it. It
// opens blank and ready to type; Enter sticks the words on (Shift+Enter is a
// new line), and closing the note keeps what was typed. Earlier notes sit
// above, signed with a name only.
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
  const box = React.useRef<HTMLTextAreaElement>(null)

  // Focus the box without scrolling: the note sits next to its mark, and a
  // scroll would move the mark away from the reader.
  React.useEffect(() => {
    const timer = setTimeout(() => box.current?.focus({ preventScroll: true }))
    return () => clearTimeout(timer)
  }, [])

  const send = async () => {
    const body = draft.trim()
    if (!body || busy) return true
    setBusy(true)
    const ok = await attempt(comment({ annotationId: mark.id, body }))
    if (ok) {
      setDraft("")
      onChanged()
    }
    setBusy(false)
    return ok
  }

  const close = async () => {
    if (await send()) onClose()
  }

  return (
    <PopoverPrimitive.Root open onOpenChange={(open) => !open && close()}>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          anchor={anchor}
          side="right"
          align="start"
          sideOffset={12}
          collisionPadding={16}
          className="isolate z-40"
        >
          <PopoverPrimitive.Popup
            aria-label="便利貼"
            className="group/note flex max-h-120 min-h-56 w-64 flex-col gap-3 overflow-y-auto rounded-control bg-note p-4 text-body text-note-foreground shadow-md outline-hidden duration-overlay data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
          >
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
              <textarea
                ref={box}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    send()
                  }
                }}
                aria-label="留言"
                disabled={busy}
                className="field-sizing-content min-h-24 flex-1 resize-none bg-transparent outline-none"
              />
            )}
            <footer className="flex justify-end gap-1 opacity-0 transition-opacity duration-state group-hover/note:opacity-100 focus-within:opacity-100">
              {canComment && (
                <NoteButton
                  label={mark.resolvedAt ? "重新打開" : "已處理"}
                  onClick={async () => {
                    if (
                      await attempt(
                        resolve({ id: mark.id, resolved: !mark.resolvedAt })
                      )
                    )
                      onChanged()
                  }}
                >
                  {mark.resolvedAt ? <RotateCcwIcon /> : <CheckIcon />}
                </NoteButton>
              )}
              {(mark.mine || canManage) && (
                <NoteButton
                  label="刪除標記"
                  onClick={async () => {
                    if (await attempt(unmark({ id: mark.id }))) {
                      onClose()
                      onChanged()
                    }
                  }}
                >
                  <Trash2Icon />
                </NoteButton>
              )}
            </footer>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

function NoteButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            onClick={onClick}
            className="flex size-8 items-center justify-center rounded-control text-note-foreground/60 hover:bg-note-foreground/10 hover:text-note-foreground [&_svg]:size-4"
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
    <li className="group/comment flex flex-col gap-1">
      <p
        className="flex items-baseline gap-2 text-note-foreground/60"
        title={formatWhen(note.createdAt)}
      >
        <span>{note.author ?? "已離開的成員"}</span>
        {note.editedAt && (
          <button
            type="button"
            className="hover:text-note-foreground"
            onClick={() => setHistory(!history)}
          >
            已編輯
          </button>
        )}
      </p>
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="修改留言"
            className="field-sizing-content resize-none rounded-control bg-note-foreground/5 p-2 outline-none"
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
        <ol className="flex flex-col gap-1 border-l-2 border-note-foreground/20 pl-3 text-note-foreground/60">
          {note.revisions.map((revision, index) => (
            <li key={index}>
              <span className="line-through">{revision.body}</span>
              <span className="ml-2">{formatWhen(revision.replacedAt)} 前</span>
            </li>
          ))}
        </ol>
      )}
      {note.mine && !editing && (
        <div className="flex gap-3 text-note-foreground/60 opacity-0 transition-opacity duration-state group-hover/comment:opacity-100 focus-within:opacity-100">
          <button
            type="button"
            className="hover:text-note-foreground"
            onClick={() => {
              setText(note.body)
              setEditing(true)
            }}
          >
            編輯
          </button>
          <button
            type="button"
            className="hover:text-note-foreground"
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
