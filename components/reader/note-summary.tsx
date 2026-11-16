"use client"

import { SparklesIcon } from "lucide-react"
import * as React from "react"

import { summarizeNotesOf } from "@/app/actions"
import type { Mark } from "@/components/reader/types"
import { Button } from "@/components/ui/button"

type Result =
  | {
      summary: string
      open: { markId: string; question: string }[]
    }
  | { error: string }

// At the top of the list of sticky notes: Claude sums up what the notes
// say and lists the questions still open; picking one goes to its mark.
// The summary is of the notes as they were; once they change, the button
// offers a new one.
export function NoteSummary({
  documentId,
  version,
  marks,
  onPick,
}: {
  documentId: string
  version: number
  marks: Mark[]
  onPick: (mark: Mark) => void
}) {
  const notes = marks
    .flatMap((mark) => mark.comments.map((note) => note.id))
    .join()
  const resolved = marks.filter((mark) => mark.resolvedAt).length
  const now = `${notes} ${resolved}`
  const [result, setResult] = React.useState<{ of: string; data: Result }>()
  const [busy, setBusy] = React.useState(false)

  const run = async () => {
    setBusy(true)
    const answer = await summarizeNotesOf({ id: documentId, version })
    setResult({
      of: now,
      data: answer.data ?? { error: answer.error ?? "摘要失敗" },
    })
    setBusy(false)
  }

  const data = result?.data
  return (
    <section
      aria-label="便利貼摘要"
      aria-busy={busy}
      className="flex flex-col gap-2 border-b border-border p-2"
    >
      {(!data || result.of !== now || "error" in data) && (
        <Button variant="ghost" disabled={busy} onClick={run}>
          <SparklesIcon />
          {busy ? "摘要中" : data ? "重新摘要" : "摘要"}
        </Button>
      )}
      {data && "error" in data && (
        <p className="px-1 text-destructive">{data.error}</p>
      )}
      {data && "summary" in data && (
        <>
          <p className="px-1 break-words whitespace-pre-wrap">{data.summary}</p>
          {data.open.length > 0 && (
            <ul className="flex flex-col">
              {data.open.map((item, index) => {
                const mark = marks.find((m) => m.id === item.markId)
                return (
                  <li key={index}>
                    <button
                      type="button"
                      disabled={!mark}
                      onClick={() => mark && onPick(mark)}
                      className="flex w-full flex-col rounded-control px-1 py-2 text-left hover:bg-muted disabled:text-muted-foreground"
                    >
                      <span className="break-words">{item.question}</span>
                      {mark && (
                        <span className="text-muted-foreground">
                          第 {mark.page} 頁，{mark.author ?? "已離開的成員"}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
