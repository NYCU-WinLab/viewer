"use client"

import * as React from "react"
import { createPortal } from "react-dom"

import { cn } from "@/lib/utils"

/** Someone a note can mention: a name, and a hint for the special ones. */
export type Mentionable = { name: string; hint?: string }

/** Who a note can mention: Claude (when set up), the others who can open
 * the document, and all of them at once. */
export function mentionables(people: string[], claude: boolean) {
  return [
    ...(claude ? [{ name: "Claude", hint: "AI 回覆" }] : []),
    ...[...new Set(people)].map((name) => ({ name })),
    { name: "all", hint: "所有人" },
  ] satisfies Mentionable[]
}

/** The @word being typed at the caret: where its @ is and the letters
 * after it, or null. */
function typing(field: HTMLTextAreaElement) {
  const caret = field.selectionStart
  if (caret !== field.selectionEnd) return null
  const match = field.value.slice(0, caret).match(/(?:^|\s)@([^\s@]*)$/)
  if (!match) return null
  return { at: caret - match[1].length - 1, caret, query: match[1] }
}

/** Sets CSS custom properties on an element (the token check allows no
 * inline style attribute). */
function place(x: number, y: number) {
  return (element: HTMLElement | null) => {
    element?.style.setProperty("--x", `${x}px`)
    element?.style.setProperty("--y", `${y}px`)
  }
}

// Typing @ in a note opens a short list of who can be mentioned, filtered
// by the letters after it. Up and Down move, Enter or Tab puts the name in,
// Esc closes the list. Returns the key handler the field calls first (true
// when the list used the key), what the field calls on every change, and
// the list itself.
export function useMentions(
  field: React.RefObject<HTMLTextAreaElement | null>,
  options: Mentionable[],
  setValue: (value: string) => void
) {
  const [word, setWord] = React.useState<ReturnType<typeof typing>>(null)
  const [active, setActive] = React.useState(0)
  const query = word?.query.toLowerCase() ?? ""
  const shown = word
    ? options
        .filter((option) => option.name.toLowerCase().includes(query))
        .sort(
          (a, b) =>
            Number(!a.name.toLowerCase().startsWith(query)) -
            Number(!b.name.toLowerCase().startsWith(query))
        )
        .slice(0, 6)
    : []
  const open = shown.length > 0

  const [box, setBox] = React.useState<DOMRect | null>(null)
  const update = () => {
    const element = field.current
    const next = element ? typing(element) : null
    setWord(next)
    setBox(next ? element!.getBoundingClientRect() : null)
    setActive(0)
  }

  const choose = (option: Mentionable) => {
    const element = field.current
    if (!element || !word) return
    const value = element.value
    const next = `${value.slice(0, word.at)}@${option.name} ${value.slice(word.caret)}`
    const caret = word.at + option.name.length + 2
    pending.current = caret
    setValue(next)
    setWord(null)
  }
  // The caret goes after the name as soon as the field shows it, before
  // the next key.
  const pending = React.useRef<number | null>(null)
  React.useLayoutEffect(() => {
    const element = field.current
    if (pending.current === null || !element) return
    element.focus()
    element.setSelectionRange(pending.current, pending.current)
    pending.current = null
  })

  const onKey = (event: React.KeyboardEvent) => {
    if (!open || event.nativeEvent.isComposing) return false
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((active + step + shown.length) % shown.length)
    } else if (event.key === "Enter" || event.key === "Tab")
      choose(shown[Math.min(active, shown.length - 1)])
    else if (event.key === "Escape") setWord(null)
    else return false
    event.preventDefault()
    event.stopPropagation()
    return true
  }

  const list =
    open && box
      ? createPortal(
          <ul
            ref={place(box.left, box.bottom + 4)}
            role="listbox"
            aria-label="提及"
            data-mentions
            // A press on the list keeps the field focused.
            onMouseDown={(event) => event.preventDefault()}
            className="fixed top-(--y) left-(--x) z-50 flex w-48 flex-col rounded-menu border border-border bg-overlay p-1 text-body text-foreground shadow-md backdrop-blur-md"
          >
            {shown.map((option, index) => (
              <li
                key={option.name}
                role="option"
                aria-selected={index === active}
                onClick={() => choose(option)}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex cursor-default justify-between gap-2 rounded-control px-2 py-1",
                  index === active && "bg-muted"
                )}
              >
                <span className="truncate">{option.name}</span>
                {option.hint && (
                  <span className="shrink-0 text-muted-foreground">
                    {option.hint}
                  </span>
                )}
              </li>
            ))}
          </ul>,
          document.body
        )
      : null

  return { onKey, update, list }
}

/** A note's words with each @mention in bold. */
export function WithMentions({ text }: { text: string }) {
  return text.split(/(@[^\s@，。、,.!?？！:：]+)/).map((part, index) =>
    index % 2 ? (
      <span key={index} className="font-medium">
        {part}
      </span>
    ) : (
      part
    )
  )
}
