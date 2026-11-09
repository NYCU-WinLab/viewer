"use client"

import * as React from "react"

import { StatusPage } from "@/components/status-page"

// Where the sign-in window of an embedded page ends: it tells the frame
// that opened it to load again, and closes.
export default function EmbedDone() {
  React.useEffect(() => {
    window.opener?.postMessage("viewer:done", location.origin)
    window.close()
  }, [])
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <StatusPage title="完成，可以關掉這個視窗" />
    </main>
  )
}
