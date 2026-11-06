// Turns docx and pptx into PDF through the convert service (Gotenberg,
// LibreOffice inside, with fonts that stand in for Times New Roman,
// Calibri, Arial and 標楷體 at the same widths). PDFs pass through.

const types = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const

export async function toPdf(
  kind: "docx" | "pptx",
  body: Uint8Array
): Promise<Uint8Array> {
  const url = process.env.CONVERT_URL
  if (!url) throw new Error("轉檔服務沒有設定")
  const form = new FormData()
  form.append(
    "files",
    new Blob([body as BlobPart], { type: types[kind] }),
    `document.${kind}`
  )
  const response = await fetch(
    `${url.replace(/\/$/, "")}/forms/libreoffice/convert`,
    { method: "POST", body: form, signal: AbortSignal.timeout(120_000) }
  )
  if (!response.ok) throw new Error(`轉檔失敗(${response.status})`)
  return new Uint8Array(await response.arrayBuffer())
}
