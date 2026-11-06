import type { listAnnotations } from "@/lib/actions/annotations"

export type Tool = "highlight" | "box" | "pen"

export type Mark = Awaited<ReturnType<typeof listAnnotations.run>>[number]
export type Comment = Mark["comments"][number]

/** What the pointer does: read and select text, or one of the marking
 * tools. */
export type Mode = "read" | Tool

/** A mark drawn on the page and not saved yet. */
export type Draft = {
  tool: Tool
  page: number
  geometry: Mark["geometry"]
  quote?: { exact: string; prefix: string; suffix: string }
}
