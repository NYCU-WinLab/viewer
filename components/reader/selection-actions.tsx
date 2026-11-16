"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import {
  LanguagesIcon,
  MessageSquarePlusIcon,
  SparklesIcon,
  StickyNoteIcon,
} from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"

import { explain, translate } from "@/app/actions"
import { cutPage } from "@/components/reader/page-cut"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Translation } from "@/lib/anthropic"

/** Answers this page already got, by what was asked. */
const seen = new Map<string, Translation | string>()

/** Text the reader just selected, a highlight they clicked, or a box they
 * drew or clicked: where it ends on its page (in page fractions), its
 * words and the words around it, and a box's place to cut the picture. */
export type Picked = {
  page: number
  x: number
  y: number
  text: string
  context: string
  rect?: [number, number, number, number]
}

type Ask = "translate" | "explain"

/** An answer as the words of a sticky note: the translation, then its part
 * of speech and pronunciation, then the note. */
function noteOf(answer: Translation | string) {
  if (typeof answer === "string") return answer.slice(0, 5000)
  return [
    answer.translation,
    [answer.partOfSpeech, answer.phonetic].filter(Boolean).join("，"),
    answer.note,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 5000)
}

// Small buttons where a selection ends: write a sticky note on it,
// translate it, or have it explained (a box: note or explain). Nothing
// larger opens until one is pressed. They sit inside the page, so they
// scroll with it.
export function SelectionActions({
  documentId,
  picked,
  onNote,
  onKeep,
  canAsk,
}: {
  documentId: string
  picked: Picked
  /** Opens the sticky note of the selection; absent when the reader may
   * not comment. */
  onNote?: () => void
  /** Keeps an answer as a sticky note; absent when the reader may not
   * comment. */
  onKeep?: (body: string) => Promise<void>
  /** Claude is set up. */
  canAsk: boolean
}) {
  const [bar, setBar] = React.useState<HTMLDivElement | null>(null)
  const [asking, setAsking] = React.useState<Ask | null>(null)
  const place = React.useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return
      element.style.setProperty("--x", String(picked.x))
      element.style.setProperty("--y", String(picked.y))
      setBar(element)
    },
    [picked.x, picked.y]
  )
  const page = document.querySelector(`[data-page="${picked.page}"]`)
  const canTranslate = canAsk && !!picked.text
  const canExplain = canAsk && (!!picked.text || !!picked.rect)
  if (!page || (!onNote && !canExplain)) return null
  const button = (ask: Ask, label: string, icon: React.ReactNode) => (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={asking === ask ? "default" : "ghost"}
            size="icon"
            aria-label={label}
            aria-pressed={asking === ask}
            onClick={() => setAsking(asking === ask ? null : ask)}
          />
        }
      >
        {icon}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
  return createPortal(
    <div
      ref={place}
      data-selection-actions
      // Pressing a button keeps the selection it acts on.
      onMouseDown={(event) => event.preventDefault()}
      className={cn(
        "absolute page-point z-20 mt-1 flex rounded-menu border border-border bg-overlay p-1 shadow-md backdrop-blur-md select-none",
        // The bar stays inside the page: it hangs from its right end when
        // the selection ends in the right half.
        picked.x > 0.5 && "-translate-x-full"
      )}
    >
      {onNote && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="留言"
                onClick={onNote}
              />
            }
          >
            <MessageSquarePlusIcon />
          </TooltipTrigger>
          <TooltipContent>留言</TooltipContent>
        </Tooltip>
      )}
      {canTranslate && button("translate", "翻譯", <LanguagesIcon />)}
      {canExplain && button("explain", "解釋", <SparklesIcon />)}
      {asking && bar && (
        <AnswerPanel
          key={asking}
          ask={asking}
          documentId={documentId}
          picked={picked}
          anchor={bar}
          onKeep={onKeep}
          onClose={() => setAsking(null)}
        />
      )}
    </div>,
    page
  )
}

// The answer beside the buttons. A translation comes first, then what
// fits the selection: a word has its part of speech, pronunciation, senses
// and examples; a phrase its use and examples; a sentence a note on its
// paragraph. An explanation is a few sentences on the text or the cut of
// the page.
function AnswerPanel({
  ask,
  documentId,
  picked,
  anchor,
  onKeep,
  onClose,
}: {
  ask: Ask
  documentId: string
  picked: Picked
  anchor: Element
  onKeep?: (body: string) => Promise<void>
  onClose: () => void
}) {
  const [keeping, setKeeping] = React.useState(false)
  const label = ask === "translate" ? "翻譯" : "解釋"
  const key = `${ask}\n${picked.page}\n${picked.rect ?? ""}\n${picked.text}\n${picked.context}`
  const [result, setResult] = React.useState<
    { data: Translation | string } | { error: string } | null
  >(() => {
    const data = seen.get(key)
    return data ? { data } : null
  })
  React.useEffect(() => {
    if (seen.has(key)) return
    let cancelled = false
    const input = {
      id: documentId,
      text: picked.text,
      context: picked.context,
    }
    const image =
      ask === "explain" && picked.rect
        ? cutPage(picked.page, picked.rect)
        : undefined
    const request: Promise<{ data?: Translation | string; error?: string }> =
      ask === "translate"
        ? translate(input)
        : image === null
          ? Promise.resolve({ error: "這頁還沒畫好，再試一次" })
          : explain({ ...input, image })
    request.then((answer) => {
      if (answer.data) seen.set(key, answer.data)
      if (cancelled) return
      setResult(
        answer.data ? { data: answer.data } : { error: answer.error ?? "" }
      )
    })
    return () => {
      cancelled = true
    }
  }, [ask, documentId, key, picked])

  const answer = result && "data" in result ? result.data : null
  const data = typeof answer === "string" ? null : answer
  return (
    <PopoverPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          anchor={anchor}
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={16}
          className="isolate z-40"
        >
          <PopoverPrimitive.Popup
            data-slot="popover-content"
            aria-label={label}
            aria-busy={!result}
            className="flex max-h-96 w-80 max-w-(--available-width) flex-col gap-2 overflow-y-auto rounded-menu border border-border bg-overlay p-3 text-body text-foreground shadow-md outline-hidden backdrop-blur-md duration-overlay data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
          >
            {!result && <p className="text-muted-foreground">{label}中</p>}
            {result && "error" in result && (
              <p className="text-destructive">
                {result.error || `${label}失敗`}
              </p>
            )}
            {typeof answer === "string" && (
              <p className="break-words whitespace-pre-wrap">{answer}</p>
            )}
            {data && (
              <>
                <p
                  className={cn(
                    "break-words",
                    data.kind !== "sentence" && "text-title"
                  )}
                >
                  {data.translation}
                </p>
                {(data.partOfSpeech || data.phonetic) && (
                  <p className="text-muted-foreground">
                    {[data.partOfSpeech, data.phonetic]
                      .filter(Boolean)
                      .join("，")}
                  </p>
                )}
                {data.note && (
                  <p className="break-words text-muted-foreground">
                    {data.note}
                  </p>
                )}
                {data.examples.length > 0 && (
                  <ul className="flex flex-col gap-2 border-t border-border pt-2">
                    {data.examples.map((example, index) => (
                      <li key={index} className="flex flex-col break-words">
                        <span>{example.source}</span>
                        <span className="text-muted-foreground">
                          {example.translation}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {answer && onKeep && (
              <Button
                variant="outline"
                className="sticky bottom-0 self-start"
                disabled={keeping}
                onClick={async () => {
                  setKeeping(true)
                  await onKeep(noteOf(answer))
                  setKeeping(false)
                }}
              >
                <StickyNoteIcon />
                存成便利貼
              </Button>
            )}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
