"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import { importFromNextcloud } from "@/app/actions"
import { Button } from "@/components/ui/button"

// The file's name and one button: import it (or open the document it
// became) and go there.
export function ImportNow({ path }: { path: string }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(false)
  const name = path.split("/").pop() ?? path
  return (
    <div className="flex flex-col items-center gap-12 text-center">
      <h1 className="text-title font-medium break-all">{name}</h1>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          const result = await importFromNextcloud({ path })
          if (!result.data) {
            toast.error(result.error ?? "匯入失敗")
            setBusy(false)
            return
          }
          router.replace(`/d/${result.data.id}`)
        }}
      >
        {busy ? "轉檔中…" : "在 Viewer 打開"}
      </Button>
    </div>
  )
}
