"use client"

import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { LanguagesIcon, MessageSquarePlusIcon } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"

import { translate } from "@/app/actions"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { Translation } from "@/lib/llm"

/** Text the reader just selected: where it ends on its page (in page
 * fractions), and the words around it for the translator. */
export type Picked = {
  page: number
  x: number
  y: number
  text: string
  context: string
}

// Two small buttons where a selection ends: write a sticky note on it, or
// translate it. Nothing larger opens until one is pressed. They sit inside
// the page, so they scroll with it.
export function SelectionActions({
  documentId,
  picked,
  onNote,
  canTranslate,
}: {
  documentId: string
  picked: Picked
  /** Opens the sticky note of the selection; absent when the reader may
   * not comment. */
  onNote?: () => void
  canTranslate: boolean
}) {
  const [bar, setBar] = React.useState<HTMLDivElement | null>(null)
  const [translating, setTranslating] = React.useState(false)
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
  if (!page || (!onNote && !canTranslate)) return null
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
      {canTranslate && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={translating ? "default" : "ghost"}
                size="icon"
                aria-label="翻譯"
                aria-pressed={translating}
                onClick={() => setTranslating(!translating)}
              />
            }
          >
            <LanguagesIcon />
          </TooltipTrigger>
          <TooltipContent>翻譯</TooltipContent>
        </Tooltip>
      )}
      {translating && bar && (
        <TranslationPanel
          documentId={documentId}
          picked={picked}
          anchor={bar}
          onClose={() => setTranslating(false)}
        />
      )}
    </div>,
    page
  )
}

// The translation of the selection, beside the buttons: the translation
// first, then what fits the selection. A word has its part of speech,
// pronunciation, senses and examples; a phrase its use and examples; a
// sentence a note on its paragraph.
function TranslationPanel({
  documentId,
  picked,
  anchor,
  onClose,
}: {
  documentId: string
  picked: Picked
  anchor: Element
  onClose: () => void
}) {
  const [result, setResult] = React.useState<
    { data: Translation } | { error: string } | null
  >(null)
  React.useEffect(() => {
    let cancelled = false
    translate({
      id: documentId,
      text: picked.text,
      context: picked.context,
    }).then((answer) => {
      if (cancelled) return
      setResult(
        answer.data ? { data: answer.data } : { error: answer.error ?? "" }
      )
    })
    return () => {
      cancelled = true
    }
  }, [documentId, picked.text, picked.context])

  const data = result && "data" in result ? result.data : null
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
            aria-label="翻譯"
            aria-busy={!result}
            className="flex max-h-96 w-80 max-w-(--available-width) flex-col gap-2 overflow-y-auto rounded-menu border border-border bg-overlay p-3 text-body text-foreground shadow-md outline-hidden backdrop-blur-md duration-overlay data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95"
          >
            {!result && <p className="text-muted-foreground">翻譯中</p>}
            {result && "error" in result && (
              <p className="text-destructive">{result.error || "翻譯失敗"}</p>
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
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}
