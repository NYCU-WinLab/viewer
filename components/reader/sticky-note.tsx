"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import * as React from "react"
import { toast } from "sonner"

import {
  askClaudeInNote,
  comment,
  resolve,
  reword,
  uncomment,
  unmark,
} from "@/app/actions"
import { useRecord } from "@/components/reader/history"
import {
  type Mentionable,
  WithMentions,
  mentionables,
  useMentions,
} from "@/components/reader/mentions"
import type { Comment, Mark } from "@/components/reader/types"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
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

/** Runs a server action and toasts its error; true when it worked. */
async function attempt(result: Promise<{ error?: string }>) {
  const { error } = await result
  if (error) toast.error(error)
  return !error
}

/** Sets CSS custom properties on an element (the token check allows no
 * inline style attribute). */
function vars(values: Record<string, number>) {
  return (element: HTMLElement | null) => {
    for (const [name, value] of Object.entries(values))
      element?.style.setProperty(name, String(value))
  }
}

type Layer =
  | { kind: "comment"; id: string; note: Comment; paper: number }
  | { kind: "draft"; id: "draft"; paper: number }
  | { kind: "empty"; id: "empty"; paper: number }
  | { kind: "claude"; id: "claude"; paper: number }

// The sticky notes of one mark, next to it: one square of paper per
// comment, each writer in their own color, the newest stuck on top of the
// others, a little up and to the right. Clicking a note underneath lifts it
// to the front; clicking it again (or another note) drops it back. A mark
// without notes opens a blank one, ready to type: Enter sticks the words
// on (Shift+Enter is a new line), and closing keeps what was typed. Every
// other action (another note, edit, history, delete, resolve) is in the
// note's menu: a right click, or a long press on a touch screen.
export function StickyNote({
  mark,
  anchor,
  canComment,
  canManage,
  onClose,
  onChanged,
  ask,
  people = [],
}: {
  mark: Mark
  anchor: Element
  canComment: boolean
  /** Edit access: may delete anyone's mark. */
  canManage: boolean
  onClose: () => void
  onChanged: () => void
  /** What Claude is shown of the mark; absent when Claude is not set up.
   * A note that mentions @Claude then gets its reply. */
  ask?: () => { context: string; image?: string }
  /** Names of the others who can open the document, to mention. */
  people?: string[]
}) {
  const mentions = mentionables(people, !!ask)
  const record = useRecord()
  const [writing, setWriting] = React.useState(
    canComment && mark.comments.length === 0
  )
  const [draft, setDraft] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  /** The note count the sent draft waits for, so it stays until its
   * comment arrives. */
  const [waitFor, setWaitFor] = React.useState(0)
  const [sent, setSent] = React.useState("")
  const [raised, setRaised] = React.useState<string | null>(null)
  /** The note count Claude's reply brings, while it is on its way. */
  const [claudeAt, setClaudeAt] = React.useState(0)

  // Writers get papers in the order they first wrote: yellow, coral, blue,
  // green, lilac, orange.
  const papers = new Map<string, number>()
  const paperOf = (author: string) => {
    if (!papers.has(author)) papers.set(author, papers.size % 6)
    return papers.get(author)!
  }
  const layers: Layer[] = mark.comments.map((note) => ({
    kind: "comment",
    id: note.id,
    note,
    paper: paperOf(note.authorId ?? note.id),
  }))
  const mine = mark.comments.find((note) => note.mine)
  const showDraft = writing || mark.comments.length < waitFor
  if (showDraft)
    layers.push({
      kind: "draft",
      id: "draft",
      paper: mine ? paperOf(mine.authorId ?? mine.id) : papers.size % 6,
    })
  if (mark.comments.length < claudeAt)
    layers.push({ kind: "claude", id: "claude", paper: papers.size % 6 })
  if (layers.length === 0) layers.push({ kind: "empty", id: "empty", paper: 0 })

  const send = async () => {
    const body = draft.trim()
    if (!body || busy) return true
    setBusy(true)
    const result = await comment({ annotationId: mark.id, body })
    if (result.error) toast.error(result.error)
    const ok = !result.error
    if (result.data) {
      record({
        kind: "comment",
        id: result.data.id,
        annotationId: mark.id,
        body,
      })
      setSent(body)
      setDraft("")
      setWaitFor(mark.comments.length + 1)
      setWriting(false)
      onChanged()
      if (ask && /@claude\b/i.test(body)) {
        const count = mark.comments.length + 2
        setClaudeAt(count)
        askClaudeInNote({ annotationId: mark.id, ...ask() }).then((reply) => {
          if (reply.error) {
            toast.error(reply.error)
            setClaudeAt(0)
          } else onChanged()
        })
      }
    }
    setBusy(false)
    return ok
  }

  const close = async () => {
    if (await send()) onClose()
  }

  const markActions = (
    <MarkActions
      mark={mark}
      canComment={canComment}
      canManage={canManage}
      onDeleted={onClose}
      onChanged={onChanged}
    />
  )

  return (
    <PopoverPrimitive.Root
      open
      onOpenChange={(open, details) => {
        // A click in a note's menu is not a click outside the notes.
        const target = details.event?.target
        if (
          target instanceof Element &&
          target.closest("[data-slot=context-menu-content], [data-mentions]")
        )
          return
        if (!open) close()
      }}
    >
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
            className="outline-hidden duration-overlay data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
          >
            <div
              ref={vars({ "--n": layers.length })}
              className="grid note-stack"
            >
              {layers.map((layer, index) => {
                const top = index === layers.length - 1
                return (
                  <div
                    key={layer.id}
                    ref={vars({ "--i": index })}
                    data-paper={layer.paper}
                    data-raised={raised === layer.id ? "" : undefined}
                    className="note-layer col-start-1 row-start-1 duration-spring"
                    onClick={() =>
                      setRaised((now) =>
                        now === layer.id || top ? null : layer.id
                      )
                    }
                  >
                    {layer.kind === "comment" ? (
                      <CommentNote
                        note={layer.note}
                        annotationId={mark.id}
                        canComment={canComment && !showDraft}
                        onAdd={() => {
                          setRaised(null)
                          setWriting(true)
                        }}
                        onChanged={onChanged}
                      >
                        {markActions}
                      </CommentNote>
                    ) : (
                      <ContextMenu>
                        <ContextMenuTrigger
                          render={<Paper />}
                          className={cn(
                            layer.kind === "empty" && "text-note-foreground/60"
                          )}
                        >
                          {layer.kind === "draft" ? (
                            <NoteText
                              autoFocus
                              value={writing ? draft : sent}
                              disabled={busy || !writing}
                              onChange={setDraft}
                              onEnter={send}
                              label="留言"
                              placeholder={ask ? "@Claude 會回覆" : undefined}
                              mentions={mentions}
                            />
                          ) : layer.kind === "claude" ? (
                            <p className="m-auto animate-pulse">
                              Claude 回覆中
                            </p>
                          ) : (
                            <p className="m-auto">沒有留言</p>
                          )}
                        </ContextMenuTrigger>
                        {((canComment && mark.resolvable) ||
                          mark.mine ||
                          canManage) && (
                          <ContextMenuContent>{markActions}</ContextMenuContent>
                        )}
                      </ContextMenu>
                    )}
                  </div>
                )
              })}
            </div>
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

/** The mark's own menu items: resolve or reopen it, delete it. Shared by
 * the sticky notes' menu and the mark's (right click on the mark). */
export function MarkActions({
  mark,
  canComment,
  canManage,
  onDeleted,
  onChanged,
}: {
  mark: Mark
  canComment: boolean
  canManage: boolean
  onDeleted?: () => void
  onChanged: () => void
}) {
  const record = useRecord()
  return (
    <>
      {canComment && mark.resolvable && (
        <ContextMenuItem
          onClick={async () => {
            const resolved = !mark.resolvedAt
            if (await attempt(resolve({ id: mark.id, resolved }))) {
              record({ kind: "resolve", id: mark.id, resolved })
              onChanged()
            }
          }}
        >
          {mark.resolvedAt ? "重新打開" : "已處理"}
        </ContextMenuItem>
      )}
      {/* Without edit access, a mark goes only while every note on it is
          its author's own: deleting it would take other members' replies. */}
      {(canManage ||
        (mark.mine && mark.comments.every((note) => note.mine))) && (
        <ContextMenuItem
          variant="destructive"
          onClick={async () => {
            if (await attempt(unmark({ id: mark.id }))) {
              const notes = mark.comments.filter((note) => note.mine)
              record({
                kind: "unmark",
                id: mark.id,
                draft: {
                  tool: mark.tool,
                  page: mark.page,
                  geometry: mark.geometry,
                  quote: mark.quote ?? undefined,
                },
                resolved: !!mark.resolvedAt,
                notes: notes.map(({ id, body }) => ({ id, body })),
                lost: mark.comments.length - notes.length,
              })
              onDeleted?.()
              onChanged()
            }
          }}
        >
          刪除標記
        </ContextMenuItem>
      )}
    </>
  )
}

/** A square of paper; its color comes from the layer's data-paper. */
function Paper({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "paper-note flex size-64 flex-col gap-2 p-4 text-body text-note-foreground select-none",
        className
      )}
      {...props}
    />
  )
}

/** Typing on the paper: centered, growing with the words. */
function NoteText({
  value,
  onChange,
  onEnter,
  onEscape,
  label,
  disabled,
  autoFocus,
  placeholder,
  mentions = [],
}: {
  value: string
  onChange: (value: string) => void
  onEnter: () => void
  onEscape?: () => void
  label: string
  disabled?: boolean
  autoFocus?: boolean
  /** A hint on the empty paper. */
  placeholder?: string
  /** Who @ can mention; none turns the list off. */
  mentions?: Mentionable[]
}) {
  const box = React.useRef<HTMLTextAreaElement>(null)
  const mention = useMentions(box, mentions, onChange)
  // Focus without scrolling: the note sits next to its mark, and a scroll
  // would move the mark away from the reader.
  React.useEffect(() => {
    if (!autoFocus) return
    const timer = setTimeout(() => box.current?.focus({ preventScroll: true }))
    return () => clearTimeout(timer)
  }, [autoFocus])
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
      <textarea
        ref={box}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          mention.update()
        }}
        onSelect={mention.update}
        onKeyDown={(event) => {
          if (mention.onKey(event)) return
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault()
            onEnter()
          }
          if (event.key === "Escape" && onEscape) {
            event.stopPropagation()
            onEscape()
          }
        }}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "field-sizing-content max-h-full w-full resize-none bg-transparent text-center outline-none select-text placeholder:text-note-foreground/50",
          value.length <= 12 && "text-title"
        )}
      />
      {mention.list}
    </div>
  )
}

// One comment on its own paper, signed at the bottom. Its menu holds
// another note, edit, history and delete (the author's own), then the
// mark's actions.
function CommentNote({
  note,
  annotationId,
  canComment,
  onAdd,
  onChanged,
  children,
}: {
  note: Comment
  annotationId: string
  canComment: boolean
  onAdd: () => void
  onChanged: () => void
  /** The mark's menu items. */
  children: React.ReactNode
}) {
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState(note.body)
  const [history, setHistory] = React.useState(false)
  const record = useRecord()

  const save = async () => {
    if (!text.trim()) return
    if (text === note.body) return setEditing(false)
    if (await attempt(reword({ id: note.id, body: text }))) {
      record({
        kind: "reword",
        id: note.id,
        before: note.body,
        after: text.trim(),
      })
      setEditing(false)
      onChanged()
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<Paper />}>
        {editing ? (
          <NoteText
            autoFocus
            value={text}
            onChange={setText}
            onEnter={save}
            onEscape={() => setEditing(false)}
            label="修改留言"
          />
        ) : history ? (
          <ol className="flex min-h-0 flex-1 flex-col justify-center gap-1 overflow-y-auto text-center text-note-foreground/60">
            {note.revisions.map((revision, index) => (
              <li key={index}>
                <span className="line-through">{revision.body}</span>
                <span className="ml-2">{formatWhen(revision.replacedAt)}</span>
              </li>
            ))}
            <li className="text-note-foreground">{note.body}</li>
          </ol>
        ) : (
          <div className="flex min-h-0 flex-1 overflow-y-auto">
            <p
              className={cn(
                "m-auto text-center break-words whitespace-pre-wrap",
                note.body.length <= 12 && "text-title"
              )}
            >
              <WithMentions text={note.body} />
            </p>
          </div>
        )}
        <p
          className="text-center text-note-foreground/60"
          title={formatWhen(note.createdAt)}
        >
          {note.author ?? "已離開的成員"}
          {note.editedAt && "，已編輯"}
        </p>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {canComment && (
          <ContextMenuItem onClick={onAdd}>新增便利貼</ContextMenuItem>
        )}
        {note.mine && (
          <ContextMenuItem
            onClick={() => {
              setText(note.body)
              setHistory(false)
              setEditing(true)
            }}
          >
            編輯
          </ContextMenuItem>
        )}
        {note.editedAt && (
          <ContextMenuItem onClick={() => setHistory(!history)}>
            {history ? "收起修改紀錄" : "修改紀錄"}
          </ContextMenuItem>
        )}
        {note.mine && (
          <ContextMenuItem
            variant="destructive"
            onClick={async () => {
              if (await attempt(uncomment({ id: note.id }))) {
                record({
                  kind: "uncomment",
                  id: note.id,
                  annotationId,
                  body: note.body,
                })
                onChanged()
              }
            }}
          >
            刪除留言
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        {children}
      </ContextMenuContent>
    </ContextMenu>
  )
}
