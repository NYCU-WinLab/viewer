"use client"

import { useRouter } from "next/navigation"
import * as React from "react"
import { toast } from "sonner"

import { cornerLinkClassName } from "@/components/app-shell"
import { FileUpload } from "@/components/file-upload"
import { NextcloudPicker } from "@/components/nextcloud-picker"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

export const ACCEPT = ".pdf,.docx,.pptx"
const MAX_BYTES = 100 * 1024 * 1024

/** Sends one file to /api/upload; a documentId makes it a new version. */
export async function uploadFile(file: File, documentId?: string) {
  const params = new URLSearchParams({ name: file.name })
  if (documentId) params.set("documentId", documentId)
  const response = await fetch(`/api/upload?${params}`, {
    method: "PUT",
    body: file,
  })
  const result = (await response.json()) as {
    id?: string
    version?: number
    error?: string
  }
  if (!response.ok || !result.id) throw new Error(result.error ?? "上傳失敗")
  return result as { id: string; version: number }
}

/** Where the file comes from: this computer or the member's Nextcloud,
 * for a new document or, with documentId, a new version. */
export function UploadForm({
  documentId,
  onDone,
}: {
  documentId?: string
  onDone: (result: { id: string; version: number }) => void
}) {
  return (
    <Tabs defaultValue="computer" className="flex flex-col gap-6">
      <TabsList>
        <TabsTrigger value="computer">這台電腦</TabsTrigger>
        <TabsTrigger value="nextcloud">Nextcloud</TabsTrigger>
      </TabsList>
      <TabsContent value="computer">
        <ComputerUpload documentId={documentId} onDone={onDone} />
      </TabsContent>
      <TabsContent value="nextcloud">
        <NextcloudPicker documentId={documentId} onDone={onDone} />
      </TabsContent>
    </Tabs>
  )
}

/** The file picker and its submit button. */
function ComputerUpload({
  documentId,
  onDone,
}: {
  documentId?: string
  onDone: (result: { id: string; version: number }) => void
}) {
  const [files, setFiles] = React.useState<File[]>([])
  const [busy, setBusy] = React.useState(false)
  const submit = async () => {
    const [file] = files
    if (!file) return
    setBusy(true)
    try {
      onDone(await uploadFile(file, documentId))
      setFiles([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "上傳失敗")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-6">
      <FileUpload
        value={files}
        onValueChange={setFiles}
        accept={ACCEPT}
        acceptLabel="PDF、Word、PowerPoint"
        maxSize={MAX_BYTES}
        disabled={busy}
      />
      <DialogFooter>
        <Button onClick={submit} disabled={busy || files.length === 0}>
          {busy ? "轉檔中…" : documentId ? "上傳新版本" : "上傳"}
        </Button>
      </DialogFooter>
    </div>
  )
}

// The Upload button in the top right: a new document, opened once it is stored.
export function UploadButton() {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <span aria-hidden className="hidden h-4 w-px bg-border md:block" />
      <button
        type="button"
        className={cornerLinkClassName}
        onClick={() => setOpen(true)}
      >
        上傳
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>上傳文件</DialogTitle>
          </DialogHeader>
          <UploadForm
            onDone={({ id }) => {
              setOpen(false)
              router.push(`/d/${id}`)
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
