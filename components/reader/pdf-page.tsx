"use client"

import type { PDFDocumentProxy } from "pdfjs-dist"
import * as React from "react"

import { RemoteCursor } from "@/components/reader/presence"
import type { Draft, Mark, Mode } from "@/components/reader/types"
import type { Viewer } from "@/lib/presence"
import { cn } from "@/lib/utils"

type Size = { width: number; height: number }

/** A point on the page, as fractions of its width and height. */
function fractionOf(event: React.PointerEvent, box: DOMRect): [number, number] {
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  return [
    clamp((event.clientX - box.left) / box.width),
    clamp((event.clientY - box.top) / box.height),
  ]
}

const round = (value: number) => Math.round(value * 10000) / 10000

/** Keeps every other point closer than about 2 px, so a stroke stays small. */
function thin(points: [number, number][], width: number) {
  const kept: [number, number][] = []
  for (const point of points) {
    const last = kept.at(-1)
    if (
      !last ||
      Math.hypot((point[0] - last[0]) * width, (point[1] - last[1]) * width) > 2
    )
      kept.push([round(point[0]), round(point[1])])
  }
  return kept
}

export function strokePath(points: [number, number][]) {
  return points
    .map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`)
    .join(" ")
}

// One page: the PDF drawn on a canvas, its text as an invisible layer you
// can select (that is what the highlighter marks), and the marks on top.
// Pages draw only when they come near the screen.
export function PdfPage({
  pdf,
  number,
  size,
  width,
  marks,
  mode,
  selected,
  onSelect,
  onDraft,
  cursors,
}: {
  pdf: PDFDocumentProxy
  number: number
  /** At scale 1, in PDF points. */
  size: Size
  /** On screen, in CSS pixels. */
  width: number
  marks: Mark[]
  mode: Mode
  selected: string | null
  onSelect: (id: string) => void
  onDraft: (draft: Draft) => void
  /** Other members' pointers on this page. */
  cursors: (Viewer & { cursor: NonNullable<Viewer["cursor"]> })[]
}) {
  const frame = React.useRef<HTMLDivElement>(null)
  const canvas = React.useRef<HTMLCanvasElement>(null)
  const text = React.useRef<HTMLDivElement>(null)
  const [near, setNear] = React.useState(false)
  const [drawing, setDrawing] = React.useState<[number, number][] | null>(null)
  const height = (width * size.height) / size.width
  // The svg stretches 0..1 to the page, so a 4 px corner is a different
  // fraction across and down.
  const corner = width ? { rx: 4 / width, ry: 4 / height } : {}

  React.useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setNear(true),
      { rootMargin: "100% 0px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    if (!near || !canvas.current || !text.current || width === 0) return
    let cancelled = false
    let cleanup = () => {}
    ;(async () => {
      const { TextLayer } = await import("pdfjs-dist")
      const page = await pdf.getPage(number)
      if (cancelled) return
      const scale = width / size.width
      const viewport = page.getViewport({ scale })
      const ratio = window.devicePixelRatio || 1
      const target = canvas.current!
      target.width = Math.floor(viewport.width * ratio)
      target.height = Math.floor(viewport.height * ratio)
      const render = page.render({
        canvas: target,
        viewport,
        transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0],
      })
      const layer = text.current!
      layer.replaceChildren()
      frame.current!.style.setProperty("--scale-factor", String(scale))
      frame.current!.style.setProperty("--total-scale-factor", String(scale))
      frame.current!.style.setProperty("--user-unit", "1")
      const textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: layer,
        viewport,
      })
      cleanup = () => {
        render.cancel()
        textLayer.cancel()
      }
      await Promise.all([
        render.promise.catch(() => {}),
        textLayer.render().catch(() => {}),
      ])
    })()
    return () => {
      cancelled = true
      cleanup()
    }
  }, [near, pdf, number, size.width, width])

  const drawingTool = mode === "box" || mode === "pen"

  const down = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawingTool || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const box = event.currentTarget.getBoundingClientRect()
    setDrawing([fractionOf(event, box)])
  }
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return
    const point = fractionOf(event, event.currentTarget.getBoundingClientRect())
    setDrawing(mode === "box" ? [drawing[0], point] : [...drawing, point])
  }
  const up = () => {
    if (!drawing) return
    setDrawing(null)
    if (mode === "box" && drawing.length === 2) {
      const [[x1, y1], [x2, y2]] = drawing
      const rect: [number, number, number, number] = [
        round(Math.min(x1, x2)),
        round(Math.min(y1, y2)),
        round(Math.abs(x2 - x1)),
        round(Math.abs(y2 - y1)),
      ]
      // A click, not a drag: nothing to mark.
      if (rect[2] * width < 6 || rect[3] * height < 6) return
      onDraft({ tool: "box", page: number, geometry: { rects: [rect] } })
    }
    if (mode === "pen") {
      const points = thin(drawing, width)
      if (points.length < 2) return
      onDraft({ tool: "pen", page: number, geometry: { points } })
    }
  }

  const marksClickable = mode === "read" || mode === "highlight"

  return (
    <div
      ref={frame}
      data-page={number}
      className="relative mx-auto bg-background shadow-md"
    >
      {/* The frame takes its size from the canvas; the canvas is sized by
          its width and height attributes before it draws. */}
      <canvas
        ref={canvas}
        width={Math.floor(width)}
        height={Math.floor(height)}
        className="block h-auto w-full"
      />
      <div
        ref={text}
        className={cn(
          "textLayer",
          mode === "highlight" && "cursor-text",
          drawingTool && "pointer-events-none"
        )}
      />
      <svg
        viewBox="0 0 1 1"
        preserveAspectRatio="none"
        className={cn(
          "absolute inset-0 size-full",
          drawingTool ? "cursor-crosshair touch-none" : "pointer-events-none"
        )}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrawing(null)}
      >
        {marks.map((mark) => (
          <MarkShape
            key={mark.id}
            mark={mark}
            corner={corner}
            selected={mark.id === selected}
            clickable={marksClickable}
            onSelect={() => onSelect(mark.id)}
          />
        ))}
        {drawing && mode === "box" && drawing.length === 2 && (
          <rect
            x={Math.min(drawing[0][0], drawing[1][0])}
            y={Math.min(drawing[0][1], drawing[1][1])}
            width={Math.abs(drawing[1][0] - drawing[0][0])}
            height={Math.abs(drawing[1][1] - drawing[0][1])}
            {...corner}
            vectorEffect="non-scaling-stroke"
            className="fill-mark-box/10 stroke-mark-box stroke-3"
          />
        )}
        {drawing && mode === "pen" && (
          <path
            d={strokePath(drawing)}
            vectorEffect="non-scaling-stroke"
            className="fill-none stroke-mark-pen stroke-3"
          />
        )}
      </svg>
      {cursors.map((viewer) => (
        <RemoteCursor key={viewer.conn} viewer={viewer} />
      ))}
    </div>
  )
}

// One mark: a highlighter's lines (fluorescent yellow), a box (blue) or a
// pen stroke (red), the box and the pen equally thick. Resolved marks
// fade; the selected one is drawn heavier.
function MarkShape({
  mark,
  corner,
  selected,
  clickable,
  onSelect,
}: {
  mark: Mark
  corner: { rx?: number; ry?: number }
  selected: boolean
  clickable: boolean
  onSelect: () => void
}) {
  const group = cn(
    clickable && "pointer-events-auto cursor-pointer",
    mark.resolvedAt && !selected && "opacity-40"
  )
  const click = (event: React.MouseEvent) => {
    event.stopPropagation()
    onSelect()
  }
  if ("points" in mark.geometry) {
    const d = strokePath(mark.geometry.points)
    return (
      <g data-mark={mark.id} className={group} onClick={click}>
        {/* A wide invisible stroke, so a thin line is easy to click. */}
        <path
          d={d}
          vectorEffect="non-scaling-stroke"
          className="fill-none stroke-transparent stroke-12"
        />
        <path
          d={d}
          vectorEffect="non-scaling-stroke"
          className={cn(
            "fill-none stroke-mark-pen",
            selected ? "stroke-5" : "stroke-3"
          )}
        />
      </g>
    )
  }
  return (
    <g data-mark={mark.id} className={group} onClick={click}>
      {mark.geometry.rects.map(([x, y, w, h], index) => (
        <rect
          key={index}
          x={x}
          y={y}
          width={w}
          height={h}
          {...(mark.tool === "box" ? corner : {})}
          vectorEffect="non-scaling-stroke"
          // Multiply, like ink on paper: the color tints the page behind the
          // text, and the black text stays black.
          className={
            mark.tool === "highlight"
              ? cn(
                  "fill-marker mix-blend-multiply",
                  selected && "stroke-marker stroke-4"
                )
              : cn(
                  "fill-mark-box/5 stroke-mark-box",
                  selected ? "stroke-5" : "stroke-3"
                )
          }
        />
      ))}
    </g>
  )
}
