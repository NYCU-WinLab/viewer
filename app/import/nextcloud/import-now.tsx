"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import { importFromNextcloud } from "@/app/actions"
import { Button } from "@/components/ui/button"

// The file's name and one button: import it (or open the document it
// became) and go there. auto starts at once, as inside Nextcloud.
export function ImportNow({ path, auto }: { path: string; auto?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = React.useState(!!auto)
  const name = path.split("/").pop() ?? path
  const open = React.useCallback(async () => {
    setBusy(true)
    const result = await importFromNextcloud({ path })
    if (!result.data) {
      toast.error(result.error ?? "匯入失敗")
      setBusy(false)
      return
    }
    router.replace(`/d/${result.data.id}`)
  }, [path, router])
  const started = React.useRef(false)
  React.useEffect(() => {
    if (!auto || started.current) return
    started.current = true
    void open()
  }, [auto, open])
  return (
    <div className="flex flex-col items-center gap-12 text-center">
      <h1 className="text-title font-medium break-all">{name}</h1>
      <Button disabled={busy} onClick={open}>
        {busy ? "轉檔中…" : "在 Viewer 打開"}
      </Button>
    </div>
  )
}
