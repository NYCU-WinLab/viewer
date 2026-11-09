"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"

// Inside Nextcloud's frame, Keycloak and Nextcloud refuse to show their
// sign-in pages, so they open in a small window. The window ends on
// /embed/done, which tells this frame to load again.
export function EmbedPopup({ href, label }: { href: string; label: string }) {
  React.useEffect(() => {
    const done = (event: MessageEvent) => {
      if (event.origin === location.origin && event.data === "viewer:done")
        location.reload()
    }
    window.addEventListener("message", done)
    return () => window.removeEventListener("message", done)
  }, [])
  return (
    <Button
      onClick={() => {
        const popup = window.open(
          href,
          "viewer-sign-in",
          "popup,width=520,height=720"
        )
        if (!popup) location.href = href
      }}
    >
      {label}
    </Button>
  )
}
