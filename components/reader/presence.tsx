"use client"

import * as React from "react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Cursor, PresenceEvent, Viewer } from "@/lib/presence"

type Me = { userId: string; name: string; image: string | null }

type Presence = {
  me: Me
  /** Every open tab, mine included. */
  viewers: Viewer[]
  /** Moves my cursor (null: off the pages). */
  move: (cursor: Cursor) => void
}

const PresenceContext = React.createContext<Presence | null>(null)

export function usePresence() {
  return React.useContext(PresenceContext)
}

/** A member's color, the same in every tab and on every document. */
export function whoOf(userId: string) {
  let hash = 0
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return String(Math.abs(hash) % 6)
}

// Joins the document's room: who else has it open, and their cursors.
// Cursor moves go out at most 20 times a second.
export function PresenceProvider({
  documentId,
  me,
  children,
}: {
  documentId: string
  me: Me
  children: React.ReactNode
}) {
  const [viewers, setViewers] = React.useState<Viewer[]>([])
  const conn = React.useRef("")
  const pending = React.useRef<{ cursor: Cursor } | null>(null)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(() => {
    const source = new EventSource(`/api/presence/${documentId}`)
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as
        PresenceEvent | { type: "hello"; conn: string }
      if (event.type === "hello") conn.current = event.conn
      else if (event.type === "viewers") setViewers(event.viewers)
      else
        setViewers((all) =>
          all.map((v) =>
            v.conn === event.conn ? { ...v, cursor: event.cursor } : v
          )
        )
    }
    return () => {
      source.close()
      conn.current = ""
    }
  }, [documentId])

  const flush = React.useCallback(() => {
    timer.current = null
    const next = pending.current
    pending.current = null
    if (!next || !conn.current) return
    fetch(`/api/presence/${documentId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conn: conn.current, cursor: next.cursor }),
    }).catch(() => {})
  }, [documentId])

  const move = React.useCallback(
    (cursor: Cursor) => {
      pending.current = { cursor }
      timer.current ??= setTimeout(flush, 50)
    },
    [flush]
  )

  const value = React.useMemo(
    () => ({ me, viewers, move }),
    [me, viewers, move]
  )
  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  )
}

function MemberAvatar({ member }: { member: Me }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Avatar
            data-who={whoOf(member.userId)}
            tabIndex={0}
            aria-label={member.name}
            className="size-8 ring-2 ring-background"
          />
        }
      >
        {member.image && <AvatarImage src={member.image} alt="" />}
        <AvatarFallback className="bg-who text-primary-foreground">
          {member.name.slice(0, 1)}
        </AvatarFallback>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end">
        {member.name}
      </TooltipContent>
    </Tooltip>
  )
}

// The top right corner of a document: me, then everyone else who has it
// open, one avatar per member however many tabs they have.
export function Viewers() {
  const presence = usePresence()
  if (!presence) return null
  const others = new Map<string, Me>()
  for (const v of presence.viewers)
    if (v.userId !== presence.me.userId) others.set(v.userId, v)
  return (
    <div className="flex items-center -space-x-2">
      <MemberAvatar member={presence.me} />
      {[...others.values()].map((member) => (
        <MemberAvatar key={member.userId} member={member} />
      ))}
    </div>
  )
}

// Another member's pointer on one page, with their name beside it.
export function RemoteCursor({
  viewer,
}: {
  viewer: Viewer & { cursor: NonNullable<Cursor> }
}) {
  const ref = React.useCallback(
    (element: HTMLDivElement | null) => {
      element?.style.setProperty("--x", String(viewer.cursor.x))
      element?.style.setProperty("--y", String(viewer.cursor.y))
    },
    [viewer.cursor.x, viewer.cursor.y]
  )
  return (
    <div
      ref={ref}
      data-who={whoOf(viewer.userId)}
      aria-hidden
      className="pointer-events-none absolute remote-cursor z-20 flex items-start"
    >
      <svg viewBox="0 0 16 16" className="size-4 fill-who stroke-background">
        <path d="M1 1 L14 6 L8 8 L6 14 Z" strokeWidth="1.5" />
      </svg>
      <span className="mt-3 rounded-full bg-who px-2 text-primary-foreground">
        {viewer.name}
      </span>
    </div>
  )
}
