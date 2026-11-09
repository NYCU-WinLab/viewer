"use client"

import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { join } from "./actions"

// The guest says who they are, then reads.
export function GuestJoin({ secret, name }: { secret: string; name: string }) {
  const [guest, setGuest] = React.useState("")
  const [busy, setBusy] = React.useState(false)
  return (
    <form
      className="flex flex-col items-center gap-6 text-center"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        const result = await join({ secret, name: guest })
        if (result?.error) {
          toast.error(result.error)
          setBusy(false)
        }
      }}
    >
      <h1 className="text-title font-semibold">{name}</h1>
      <div className="flex w-full max-w-sm gap-2">
        <Input
          autoFocus
          value={guest}
          onChange={(event) => setGuest(event.target.value)}
          placeholder="你的名字"
          aria-label="你的名字"
          maxLength={40}
        />
        <Button type="submit" disabled={busy || !guest.trim()}>
          進入
        </Button>
      </div>
    </form>
  )
}
