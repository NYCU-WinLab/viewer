"use client"

import {
  HighlighterIcon,
  MessageSquareTextIcon,
  MousePointer2Icon,
  PenLineIcon,
  SquareDashedIcon,
} from "lucide-react"
import { useRouter } from "next/navigation"
import type { PDFDocumentProxy } from "pdfjs-dist"
import * as React from "react"
import { toast } from "sonner"

import {
  comment as saveComment,
  mark as saveMark,
  uncomment,
  unmark,
} from "@/app/actions"
import { NoteSummary } from "@/components/reader/note-summary"
import { contextOf, cutPage } from "@/components/reader/page-cut"
import { PdfPage, noteCorner } from "@/components/reader/pdf-page"
import { usePresence } from "@/components/reader/presence"
import {
  type Picked,
  SelectionActions,
} from "@/components/reader/selection-actions"
import { StickyNote, formatWhen } from "@/components/reader/sticky-note"
import type { Draft, Mark, Mode } from "@/components/reader/types"
import { Button } from "@/components/ui/button"
import { Toolbar } from "@/components/ui/toolbar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const tools: {
  mode: Mode
  label: string
  key: string
  icon: React.ComponentType
}[] = [
  { mode: "read", label: "閱讀", key: "V", icon: MousePointer2Icon },
  { mode: "highlight", label: "螢光筆", key: "H", icon: HighlighterIcon },
  { mode: "box", label: "框選", key: "R", icon: SquareDashedIcon },
  { mode: "pen", label: "原子筆", key: "P", icon: PenLineIcon },
]

/** Something the reader just added, which Cmd+Z takes away again and
 * Shift+Cmd+Z puts back. */
type Step =
  | { kind: "mark"; id: string; draft: Draft }
  | { kind: "comment"; id: string; annotationId: string; body: string }

/** Where the selected text sits in its page, with a little context on each
 * side, so the mark can be found again in a newer version. */
function quoteOf(pageText: string, exact: string) {
  const at = pageText.indexOf(exact)
  if (at < 0) return { exact, prefix: "", suffix: "" }
  return {
    exact,
    prefix: pageText.slice(Math.max(0, at - 32), at),
    suffix: pageText.slice(at + exact.length, at + exact.length + 32),
  }
}

/** The selection grown to whole words, so a drag that stops inside a word
 * still translates the word. */
function wholeWords(pageText: string, at: number, exact: string) {
  if (at < 0) return exact
  const letter = /[\p{L}\p{N}'’-]/u
  let start = at
  let end = at + exact.length
  while (start > 0 && letter.test(pageText[start - 1])) start--
  while (end < pageText.length && letter.test(pageText[end])) end++
  return pageText.slice(start, end)
}

/** The selected lines on one page, as page fractions, one box per line. */
function selectionRects(range: Range, page: Element) {
  const box = page.getBoundingClientRect()
  const lines: [number, number, number, number][] = []
  for (const rect of Array.from(range.getClientRects())) {
    if (rect.width < 1 || rect.height < 1) continue
    const top = rect.top - box.top
    const line = lines.find(
      ([, y, , h]) => Math.abs(y * box.height - top) < rect.height / 2 && h > 0
    )
    const x = (rect.left - box.left) / box.width
    const y = top / box.height
    const w = rect.width / box.width
    const h = rect.height / box.height
    if (line) {
      const right = Math.max(line[0] + line[2], x + w)
      line[0] = Math.min(line[0], x)
      line[2] = right - line[0]
    } else lines.push([x, y, w, h])
  }
  const round = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4
  return lines.map(
    (line) => line.map(round) as [number, number, number, number]
  )
}

/** Whether a press lands on the buttons or what they opened. */
const inside = (target: EventTarget | null) =>
  target instanceof Element &&
  !!target.closest("[data-selection-actions], [data-slot=popover-content]")

/** A box's buttons, at its bottom right, with the page's text for
 * Claude. */
function boxPicked(
  markId: string,
  page: number,
  rect: [number, number, number, number]
) {
  return {
    page,
    x: rect[0] + rect[2],
    y: rect[1] + rect[3],
    text: "",
    context: contextOf(page),
    rect,
    markId,
  }
}

/** What Claude is shown of a mark when someone asks it in a sticky note:
 * the page's text around the mark, and a cut of the page for a box or a
 * pen stroke. */
function claudeSees(mark: Mark) {
  const text = mark.quote?.exact ?? ""
  if (mark.tool === "highlight") return { context: contextOf(mark.page, text) }
  const points =
    "rects" in mark.geometry
      ? mark.geometry.rects.flatMap(([x, y, w, h]) => [
          [x, y],
          [x + w, y + h],
        ])
      : mark.geometry.points
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  // A pen stroke circles or points at something: cut a margin around it.
  const pad = mark.tool === "pen" ? 0.05 : 0
  const left = Math.max(0, Math.min(...xs) - pad)
  const top = Math.max(0, Math.min(...ys) - pad)
  const right = Math.min(1, Math.max(...xs) + pad)
  const bottom = Math.min(1, Math.max(...ys) + pad)
  const image = cutPage(mark.page, [left, top, right - left, bottom - top])
  return { context: contextOf(mark.page), image: image ?? undefined }
}

// The whole document, page under page, with the tool bar floating at the
// bottom. Marks and their sticky notes come from the server and refresh
// live. Selecting text or drawing a box shows small buttons where it ends
// (sticky note, translate, explain); a pen stroke opens its sticky note.
export function Reader({
  documentId,
  version,
  marks,
  canComment,
  canManage,
  canAsk,
  people,
  actions,
}: {
  documentId: string
  version: number
  marks: Mark[]
  canComment: boolean
  canManage: boolean
  /** Claude is set up: translate, explain, reply in notes, sum up. */
  canAsk: boolean
  /** Names of the others who can open the document, to mention. */
  people: string[]
  /** More buttons for the tool bar: versions, sharing. */
  actions?: React.ReactNode
}) {
  const router = useRouter()
  const column = React.useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = React.useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = React.useState<{ width: number; height: number }[]>(
    []
  )
  const [width, setWidth] = React.useState(0)
  // The highlighter is in hand from the start, for anyone who may mark.
  const [mode, setMode] = React.useState<Mode>(
    canComment ? "highlight" : "read"
  )
  const presence = usePresence()
  const [selected, setSelected] = React.useState<string | null>(null)
  // The text just selected, with the mark the highlighter made of it or
  // the one a sticky note would need.
  const [picked, setPicked] = React.useState<
    (Picked & { markId?: string; draft?: Draft }) | null
  >(null)
  const [failed, setFailed] = React.useState(false)
  const [listOpen, setListOpen] = React.useState(false)

  // Load the PDF and every page's size, so pages hold their place before
  // they draw.
  React.useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    ;(async () => {
      const pdfjs = await import("pdfjs-dist")
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs"
      try {
        loaded = await pdfjs.getDocument({
          url: `/files/${documentId}/${version}`,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise
        const pages = await Promise.all(
          Array.from({ length: loaded.numPages }, async (_, index) => {
            const page = await loaded!.getPage(index + 1)
            const { width, height } = page.getViewport({ scale: 1 })
            return { width, height }
          })
        )
        if (cancelled) return
        setSizes(pages)
        setPdf(loaded)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()
    return () => {
      cancelled = true
      loaded?.destroy()
    }
  }, [documentId, version])

  // Pages follow the column's width.
  React.useEffect(() => {
    const element = column.current
    if (!element) return
    // The first width draws at once; later ones wait until the column
    // settles, so pages redraw once when the note list slides in or out.
    let timer: ReturnType<typeof setTimeout> | undefined
    let first = true
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width)
      clearTimeout(timer)
      if (first) setWidth(next)
      else timer = setTimeout(() => setWidth(next), 250)
      first = false
    })
    observer.observe(element)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  // The sticky note sits next to its mark; look for the mark until it is
  // drawn (a new one appears after the refresh that brings it).
  const [found, setFound] = React.useState<{
    id: string
    element: Element
  } | null>(null)
  React.useEffect(() => {
    if (!selected) return
    const timer = setInterval(() => {
      const element = document.querySelector(`[data-mark="${selected}"]`)
      if (element) {
        setFound({ id: selected, element })
        clearInterval(timer)
      }
    }, 50)
    return () => clearInterval(timer)
  }, [selected, marks])
  const anchor = found?.id === selected ? found.element : null
  // A deleted mark (by anyone) simply has no note to show.
  const selectedMark = marks.find((m) => m.id === selected) ?? null

  // What this reader added since opening the page, newest last, and what
  // they took back. A mark put back gets a new id: `moved` follows it.
  const done = React.useRef<Step[]>([])
  const undone = React.useRef<Step[]>([])
  const moved = React.useRef(new Map<string, string>())
  const now = (id: string) => {
    while (moved.current.has(id)) id = moved.current.get(id)!
    return id
  }

  /** Saves a mark and gives its id; a failure is toasted. A new mark
   * (not one put back) clears what was taken back. */
  const save = React.useCallback(
    async (draft: Draft, again?: boolean) => {
      if (!canComment) return
      const result = await saveMark({ id: documentId, version, ...draft })
      if (!result.data) {
        toast.error(result.error ?? "標記失敗")
        return
      }
      done.current.push({ kind: "mark", id: result.data.id, draft })
      if (!again) undone.current = []
      router.refresh()
      return result.data.id
    },
    [canComment, documentId, version, router]
  )

  /** Takes back the last mark or note this reader added. */
  const undo = async () => {
    const step = done.current.pop()
    if (!step) return
    const id = now(step.id)
    // Someone's note on the mark would go with it.
    if (
      step.kind === "mark" &&
      marks.find((m) => m.id === id)?.comments.length
    ) {
      done.current.push(step)
      return toast.error("這個標記已有留言")
    }
    const result =
      step.kind === "mark" ? await unmark({ id }) : await uncomment({ id })
    if (result.error) {
      done.current.push(step)
      return toast.error(result.error)
    }
    undone.current.push(step)
    if (step.kind === "mark") {
      if (selected === id) setSelected(null)
      setPicked(null)
    }
    router.refresh()
  }

  /** Puts back what was last taken back. */
  const redo = async () => {
    const step = undone.current.pop()
    if (!step) return
    if (step.kind === "mark") {
      const id = await save(step.draft, true)
      if (id) moved.current.set(now(step.id), id)
      else undone.current.push(step)
      return
    }
    const annotationId = now(step.annotationId)
    const result = await saveComment({ annotationId, body: step.body })
    if (!result.data) {
      undone.current.push(step)
      return toast.error(result.error ?? "留言失敗")
    }
    done.current.push({ ...step, id: result.data.id, annotationId })
    router.refresh()
  }
  const history = React.useRef({ undo, redo })
  React.useEffect(() => {
    history.current = { undo, redo }
  })
  // A pen stroke is drawn to say something: its note opens. A box shows
  // its buttons (sticky note, explain).
  const draw = React.useCallback(
    async (draft: Draft) => {
      const id = await save(draft)
      if (!id) return
      if (draft.tool === "box" && "rects" in draft.geometry)
        setPicked(boxPicked(id, draft.page, draft.geometry.rects[0]))
      else setSelected(id)
    },
    [save]
  )

  // When the pointer lifts on selected text, its buttons appear where it
  // ends. The highlighter marks the text first; reading leaves it selected.
  // A press anywhere else hides them, with any tool.
  React.useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!inside(event.target)) setPicked(null)
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [])
  React.useEffect(() => {
    if (mode !== "read" && mode !== "highlight") return
    const onUp = async (event: PointerEvent) => {
      if (inside(event.target)) return
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed || !selection.rangeCount) return
      const range = selection.getRangeAt(0)
      const start =
        range.startContainer instanceof Element
          ? range.startContainer
          : range.startContainer.parentElement
      const page = start?.closest("[data-page]")
      if (!page) return
      // One mark stays on one page: a selection running on is cut there.
      const end = page.querySelector(".textLayer")
      if (end && !end.contains(range.endContainer)) range.setEndAfter(end)
      const rects = selectionRects(range, page)
      const exact = range.toString().replace(/\s+/g, " ").trim()
      if (mode === "highlight") selection.removeAllRanges()
      if (!rects.length || !exact) return
      const pageText = (end?.textContent ?? "").replace(/\s+/g, " ")
      const draft: Draft = {
        tool: "highlight",
        page: Number(page.getAttribute("data-page")),
        geometry: { rects: rects.slice(0, 200) },
        quote: quoteOf(pageText, exact.slice(0, 5000)),
      }
      const markId = mode === "highlight" ? await save(draft) : undefined
      if (mode === "highlight" && !markId) return
      const last = rects[rects.length - 1]
      const at = pageText.indexOf(exact)
      setPicked({
        page: draft.page,
        x: last[0] + last[2],
        y: last[1] + last[3],
        text: wholeWords(pageText, at, exact).slice(0, 2000),
        // The paragraph around the selection, for the translator.
        context:
          at < 0
            ? exact.slice(0, 2000)
            : pageText.slice(Math.max(0, at - 800), at + exact.length + 800),
        markId,
        draft,
      })
    }
    document.addEventListener("pointerup", onUp)
    return () => document.removeEventListener("pointerup", onUp)
  }, [mode, save])

  /** The sticky note of the selection, on the mark it has or gets now. */
  const note = async () => {
    if (!picked) return
    const id = picked.markId ?? (picked.draft && (await save(picked.draft)))
    window.getSelection()?.removeAllRanges()
    setPicked(null)
    if (id) setSelected(id)
  }

  // V, H, R and P pick tools; Esc reads again and closes the note. Cmd+Z
  // (Ctrl+Z) takes back the last mark or note, Shift+Cmd+Z (Ctrl+Y) puts it
  // back; a field with words in it keeps its own undo.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const field =
        event.target instanceof HTMLElement
          ? event.target.closest("input, textarea, [contenteditable]")
          : null
      const typing =
        field && !(field instanceof HTMLTextAreaElement && field.value === "")
      const key = event.key.toLowerCase()
      const command = (event.metaKey || event.ctrlKey) && !event.altKey
      if (
        command &&
        !typing &&
        (key === "z" || (key === "y" && event.ctrlKey))
      ) {
        event.preventDefault()
        if (key === "y" || event.shiftKey) history.current.redo()
        else history.current.undo()
        return
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === "Escape") {
        setMode("read")
        setSelected(null)
        setPicked(null)
        return
      }
      const tool = tools.find((t) => t.key === event.key.toUpperCase())
      if (tool && (tool.mode === "read" || canComment)) setMode(tool.mode)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [canComment])

  const noted = marks.filter((m) => m.comments.length > 0)
  const open = noted.filter((m) => !m.resolvedAt).length

  const focus = (mark: Mark) => {
    const page = document.querySelector(`[data-page="${mark.page}"]`)
    const shape = page?.querySelector(`[data-mark="${mark.id}"]`)
    ;(shape ?? page)?.scrollIntoView({ behavior: "smooth", block: "center" })
    setSelected(mark.id)
  }

  /** A click on a mark: a highlight shows its buttons (sticky note,
   * translate, explain), a box its sticky note and explain buttons, a pen
   * stroke opens its sticky note. */
  const pick = (id: string) => {
    const mark = marks.find((m) => m.id === id)
    if (mark?.tool === "box" && "rects" in mark.geometry) {
      setSelected(null)
      return setPicked(boxPicked(id, mark.page, mark.geometry.rects[0]))
    }
    if (!mark || mark.tool !== "highlight") return setSelected(id)
    const [x, y] = noteCorner(mark)
    const last = "rects" in mark.geometry ? mark.geometry.rects.at(-1)! : null
    const text = mark.quote?.exact ?? ""
    const pageText = (
      document.querySelector(`[data-page="${mark.page}"] .textLayer`)
        ?.textContent ?? ""
    ).replace(/\s+/g, " ")
    const at = text ? pageText.indexOf(text) : -1
    setSelected(null)
    setPicked({
      page: mark.page,
      x,
      y: last ? last[1] + last[3] : y,
      text: text.slice(0, 2000),
      context:
        at < 0
          ? `${mark.quote?.prefix ?? ""}${text}${mark.quote?.suffix ?? ""}`.slice(
              0,
              4000
            )
          : pageText.slice(Math.max(0, at - 800), at + text.length + 800),
      markId: mark.id,
    })
  }

  // My pointer, as a page and a point in page fractions, for the others.
  const track = (event: React.PointerEvent) => {
    if (!presence) return
    const page = (event.target as Element).closest("[data-page]")
    if (!page) return presence.move(null)
    const box = page.getBoundingClientRect()
    const round = (value: number) =>
      Math.round(Math.min(1, Math.max(0, value)) * 1e4) / 1e4
    presence.move({
      page: Number(page.getAttribute("data-page")),
      x: round((event.clientX - box.left) / box.width),
      y: round((event.clientY - box.top) / box.height),
    })
  }
  const others = (presence?.viewers ?? []).filter(
    (v): v is typeof v & { cursor: NonNullable<typeof v.cursor> } =>
      v.userId !== presence?.me.userId && v.cursor !== null
  )

  return (
    <div className="flex items-start gap-6 pb-24">
      <div
        ref={column}
        onPointerMove={track}
        onPointerLeave={() => presence?.move(null)}
        className="mx-auto flex w-full max-w-5xl min-w-0 flex-1 flex-col gap-6"
      >
        {failed && (
          <p className="text-center text-destructive">這份文件打不開</p>
        )}
        {!pdf && !failed && (
          <p className="text-center text-muted-foreground">載入中</p>
        )}
        {pdf &&
          width > 0 &&
          sizes.map((size, index) => (
            <PdfPage
              key={index}
              pdf={pdf}
              number={index + 1}
              size={size}
              width={width}
              marks={marks.filter((m) => m.page === index + 1)}
              mode={mode}
              selected={selected}
              onSelect={pick}
              onNote={(id) => {
                setPicked(null)
                setSelected(id)
              }}
              onDraft={draw}
              cursors={others.filter((v) => v.cursor.page === index + 1)}
              canComment={canComment}
              canManage={canManage}
              onChanged={() => router.refresh()}
            />
          ))}
      </div>

      {/* Every sticky note of this version, in a column that slides in
          beside the pages (a sheet rising above the tool bar on a narrow
          screen). */}
      <div
        data-open={listOpen ? "" : undefined}
        inert={!listOpen}
        className="note-rail"
      >
        <aside
          aria-label="所有便利貼"
          className="flex note-list w-72 flex-col overflow-y-auto rounded-menu border border-border bg-overlay p-1 shadow-md backdrop-blur-md max-lg:max-h-80 max-lg:w-auto"
        >
          {canAsk && noted.length > 0 && (
            <NoteSummary
              documentId={documentId}
              version={version}
              marks={noted}
              onPick={(mark) => focus(mark)}
            />
          )}
          <MarkList
            marks={noted}
            onPick={(mark) => {
              if (!window.matchMedia("(min-width: 64rem)").matches)
                setListOpen(false)
              focus(mark)
            }}
          />
        </aside>
      </div>

      {picked && (
        <SelectionActions
          key={`${picked.markId} ${picked.page} ${picked.x} ${picked.y} ${picked.text}`}
          documentId={documentId}
          picked={picked}
          onNote={canComment ? note : undefined}
          canAsk={canAsk}
        />
      )}

      {selectedMark && anchor && (
        <StickyNote
          key={selectedMark.id}
          mark={selectedMark}
          anchor={anchor}
          canComment={canComment}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onChanged={() => router.refresh()}
          ask={canAsk ? () => claudeSees(selectedMark) : undefined}
          people={people}
          onCommented={(id, body) => {
            done.current.push({
              kind: "comment",
              id,
              annotationId: selectedMark.id,
              body,
            })
            undone.current = []
          }}
        />
      )}

      {/* The tool bar floats over the bottom of the document. */}
      <div className="fixed inset-x-0 bottom-4 z-30 flex justify-center px-4">
        {/* On a phone the bar tightens to fit 375px; narrower than that it
            scrolls sideways instead of leaving the screen. */}
        <Toolbar aria-label="工具" className="max-w-full overflow-x-auto">
          {tools.map((tool) => {
            const disabled = tool.mode !== "read" && !canComment
            return (
              <Tooltip key={tool.mode}>
                <TooltipTrigger
                  render={
                    <Button
                      variant={mode === tool.mode ? "default" : "ghost"}
                      size="icon"
                      aria-label={tool.label}
                      aria-pressed={mode === tool.mode}
                      disabled={disabled}
                      className="rounded-full"
                      onClick={() => setMode(tool.mode)}
                    />
                  }
                >
                  <tool.icon />
                </TooltipTrigger>
                <TooltipContent>
                  {tool.label}，{tool.key}
                </TooltipContent>
              </Tooltip>
            )
          })}
          <span
            aria-hidden
            className="mx-1 h-6 w-px shrink-0 bg-border max-sm:hidden"
          />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant={listOpen ? "default" : "ghost"}
                  aria-label="所有便利貼"
                  aria-pressed={listOpen}
                  className="rounded-full max-sm:px-2"
                  onClick={() => setListOpen(!listOpen)}
                />
              }
            >
              <MessageSquareTextIcon />
              {open}
            </TooltipTrigger>
            <TooltipContent>所有便利貼</TooltipContent>
          </Tooltip>
          {actions}
        </Toolbar>
      </div>
    </div>
  )
}

const toolNames = { highlight: "螢光筆", box: "框選", pen: "原子筆" } as const

// Every mark with a sticky note, open ones first: who, where, the words of
// its first note. Picking one scrolls to it and opens its sticky note.
function MarkList({
  marks,
  onPick,
}: {
  marks: Mark[]
  onPick: (mark: Mark) => void
}) {
  if (marks.length === 0)
    return <p className="p-3 text-muted-foreground">還沒有便利貼</p>
  const sorted = [...marks].sort(
    (a, b) =>
      Number(Boolean(a.resolvedAt)) - Number(Boolean(b.resolvedAt)) ||
      a.page - b.page
  )
  return (
    <ul className="flex flex-col">
      {sorted.map((mark) => (
        <li key={mark.id}>
          <button
            type="button"
            onClick={() => onPick(mark)}
            className={cn(
              "flex w-full flex-col gap-1 rounded-control p-3 text-left hover:bg-muted",
              mark.resolvedAt && "text-muted-foreground"
            )}
          >
            <span className="flex justify-between gap-2">
              <span className="font-medium">
                {mark.author ?? "已離開的成員"}
              </span>
              <span className="text-muted-foreground">
                第 {mark.page} 頁，{toolNames[mark.tool]}
                {mark.resolvedAt && "，已處理"}
              </span>
            </span>
            <span className="line-clamp-3 break-words">
              {mark.comments[0]?.body ?? formatWhen(mark.createdAt)}
            </span>
            {mark.comments.length > 1 && (
              <span className="text-muted-foreground">
                還有 {mark.comments.length - 1} 則
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}
