// Copies pdf.js's worker, CJK cMaps and standard fonts into public/pdfjs,
// so the reader loads them from this site. Runs before dev and build.
import { cp, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"

const root = dirname(require.resolve("pdfjs-dist/package.json"))
const out = join("public", "pdfjs")
await mkdir(out, { recursive: true })
await cp(
  join(root, "build", "pdf.worker.min.mjs"),
  join(out, "pdf.worker.min.mjs")
)
await cp(join(root, "cmaps"), join(out, "cmaps"), { recursive: true })
await cp(join(root, "standard_fonts"), join(out, "standard_fonts"), {
  recursive: true,
})
console.log("pdf.js assets copied")
