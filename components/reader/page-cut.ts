// What Claude is shown of a page: its text around what the reader points
// at, and a cut of the drawn page for a box.

/** The page's text as one line. */
export function pageText(page: number) {
  return (
    document.querySelector(`[data-page="${page}"] .textLayer`)?.textContent ??
    ""
  ).replace(/\s+/g, " ")
}

/** The page's text around `text` (800 characters each side), or its first
 * 4000 characters when `text` is empty or not found. */
export function contextOf(page: number, text = "") {
  const all = pageText(page)
  const at = text ? all.indexOf(text) : -1
  if (at < 0) return all.slice(0, 4000)
  return all.slice(Math.max(0, at - 800), at + text.length + 800)
}

/** A box on a page (page fractions) cut from the drawn page as a JPEG,
 * base64 without the data: prefix, at most 1280 px on its long side.
 * Null when the page is not drawn. */
export function cutPage(
  page: number,
  [x, y, w, h]: [number, number, number, number]
) {
  const canvas = document.querySelector<HTMLCanvasElement>(
    `[data-page="${page}"] canvas`
  )
  if (!canvas || !canvas.width || !canvas.height) return null
  const sx = x * canvas.width
  const sy = y * canvas.height
  const sw = Math.max(1, w * canvas.width)
  const sh = Math.max(1, h * canvas.height)
  const scale = Math.min(1, 1280 / Math.max(sw, sh))
  const out = document.createElement("canvas")
  out.width = Math.round(sw * scale)
  out.height = Math.round(sh * scale)
  const context = out.getContext("2d")
  if (!context) return null
  // The PDF draws on white; a transparent edge would turn black in JPEG.
  context.fillStyle = "white"
  context.fillRect(0, 0, out.width, out.height)
  context.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height)
  for (const quality of [0.85, 0.7, 0.5]) {
    const data = out.toDataURL("image/jpeg", quality).split(",")[1]
    if (data.length <= 900_000) return data
  }
  return null
}
