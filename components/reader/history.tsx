"use client"

import * as React from "react"

import type { Draft } from "@/components/reader/types"

/** Something the reader just did, which Cmd+Z takes back and Shift+Cmd+Z
 * does again. Ids are the ones at the time; a mark or note made again gets
 * a new id, which the reader's history follows. */
export type Step =
  | {
      kind: "mark"
      id: string
      draft: Draft
      /** The note it was made with, when kept from an answer. */
      note?: string
    }
  | {
      kind: "unmark"
      id: string
      draft: Draft
      resolved: boolean
      /** The reader's own notes on it; other members' cannot come back. */
      notes: { id: string; body: string }[]
      lost: number
    }
  | { kind: "comment"; id: string; annotationId: string; body: string }
  | { kind: "uncomment"; id: string; annotationId: string; body: string }
  | { kind: "reword"; id: string; before: string; after: string }
  | { kind: "resolve"; id: string; resolved: boolean }

/** Records a step in the reader's history. Outside a reader it does
 * nothing. */
export const HistoryContext = React.createContext<(step: Step) => void>(
  () => {}
)

export const useRecord = () => React.useContext(HistoryContext)
