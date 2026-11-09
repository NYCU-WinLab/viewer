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

import { mark as saveMark } from "@/app/actions"
import { PdfPage } from "@/components/reader/pdf-page"
import { usePresence } from "@/components/reader/presence"
import { StickyNote, formatWhen } from "@/components/reader/sticky-note"
import type { Draft, Mark, Mode } from "@/components/reader/types"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
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

// The whole document, page under page, with the tool bar floating at the
// bottom. Marks and their sticky notes come from the server and refresh
// live; a new mark opens its sticky note at once.
export function Reader({
  documentId,
  version,
  marks,
  canComment,
  canManage,
  actions,
}: {
  documentId: string
  version: number
  marks: Mark[]
  canComment: boolean
  canManage: boolean
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
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width))
    )
    observer.observe(element)
    return () => observer.disconnect()
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

  const save = React.useCallback(
    async (draft: Draft) => {
      if (!canComment) return
      const result = await saveMark({ id: documentId, version, ...draft })
      if (!result.data) return toast.error(result.error ?? "標記失敗")
      setSelected(result.data.id)
      router.refresh()
    },
    [canComment, documentId, version, router]
  )

  // The highlighter marks whatever text is selected when the pointer lifts.
  React.useEffect(() => {
    if (mode !== "highlight") return
    const onUp = () => {
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
      selection.removeAllRanges()
      if (!rects.length || !exact) return
      const pageText = (end?.textContent ?? "").replace(/\s+/g, " ")
      save({
        tool: "highlight",
        page: Number(page.getAttribute("data-page")),
        geometry: { rects: rects.slice(0, 200) },
        quote: quoteOf(pageText, exact.slice(0, 5000)),
      })
    }
    document.addEventListener("pointerup", onUp)
    return () => document.removeEventListener("pointerup", onUp)
  }, [mode, save])

  // V, H, R and P pick tools; Esc reads again and closes the note.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [contenteditable]")
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === "Escape") {
        setMode("read")
        setSelected(null)
        return
      }
      const tool = tools.find((t) => t.key === event.key.toUpperCase())
      if (tool && (tool.mode === "read" || canComment)) setMode(tool.mode)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [canComment])

  const open = marks.filter((m) => !m.resolvedAt).length

  const focus = (mark: Mark) => {
    document
      .querySelector(`[data-page="${mark.page}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" })
    setSelected(mark.id)
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
    <div className="flex flex-col gap-6 pb-24">
      <div
        ref={column}
        onPointerMove={track}
        onPointerLeave={() => presence?.move(null)}
        className="mx-auto flex w-full max-w-5xl flex-col gap-6"
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
              onSelect={setSelected}
              onDraft={save}
              cursors={others.filter((v) => v.cursor.page === index + 1)}
            />
          ))}
      </div>

      {selectedMark && anchor && (
        <StickyNote
          key={selectedMark.id}
          mark={selectedMark}
          anchor={anchor}
          canComment={canComment}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onChanged={() => router.refresh()}
        />
      )}

      {/* The tool bar floats over the bottom of the document. */}
      <div className="fixed inset-x-0 bottom-6 z-30 flex justify-center px-4">
        <div
          role="toolbar"
          aria-label="工具"
          className="flex items-center gap-1 rounded-surface border border-border bg-overlay p-1 shadow-md backdrop-blur-md"
        >
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
          <span aria-hidden className="mx-1 h-6 w-px bg-border" />
          <Popover open={listOpen} onOpenChange={setListOpen}>
            <PopoverTrigger
              render={<Button variant="ghost" className="rounded-full" />}
            >
              <MessageSquareTextIcon />
              {open}
            </PopoverTrigger>
            <PopoverContent side="top" align="center" className="w-96">
              <MarkList
                marks={marks}
                onPick={(mark) => {
                  setListOpen(false)
                  focus(mark)
                }}
              />
            </PopoverContent>
          </Popover>
          {actions}
        </div>
      </div>
    </div>
  )
}

const toolNames = { highlight: "螢光筆", box: "框選", pen: "原子筆" } as const

// Every mark of this version, open ones first: who, where, the first words
// of its note. Picking one scrolls to it and opens its sticky note.
function MarkList({
  marks,
  onPick,
}: {
  marks: Mark[]
  onPick: (mark: Mark) => void
}) {
  if (marks.length === 0)
    return <p className="p-3 text-muted-foreground">還沒有標記</p>
  const sorted = [...marks].sort(
    (a, b) =>
      Number(Boolean(a.resolvedAt)) - Number(Boolean(b.resolvedAt)) ||
      a.page - b.page
  )
  return (
    <ul className="flex max-h-96 flex-col overflow-y-auto">
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
            <span className="line-clamp-2">
              {mark.comments[0]?.body ??
                mark.quote?.exact ??
                formatWhen(mark.createdAt)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
