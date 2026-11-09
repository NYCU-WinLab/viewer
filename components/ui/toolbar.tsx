"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { cn } from "@/lib/utils"

const ToolbarContext =
  React.createContext<React.RefObject<HTMLDivElement | null> | null>(null)

// A floating bar of tools, such as a reader's tool bar at the bottom of the
// screen. Its panels (ToolbarPanel) open out of the bar itself: the same
// width, the same radius and surface, a small gap away, so the bar seems to
// grow instead of a separate menu appearing beside a button.
function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  const ref = React.useRef<HTMLDivElement>(null)
  return (
    <ToolbarContext.Provider value={ref}>
      <div
        ref={ref}
        role="toolbar"
        data-slot="toolbar"
        className={cn(
          "flex items-center gap-1 rounded-menu border border-border bg-overlay p-1 shadow-md backdrop-blur-md",
          className
        )}
        {...props}
      />
    </ToolbarContext.Provider>
  )
}

function ToolbarPanel({ ...props }: PopoverPrimitive.Root.Props) {
  return <PopoverPrimitive.Root data-slot="toolbar-panel" {...props} />
}

function ToolbarPanelTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return (
    <PopoverPrimitive.Trigger data-slot="toolbar-panel-trigger" {...props} />
  )
}

// Opens above the bar (side="bottom" for a bar at the top), as wide as the
// bar, with its radius. Rows inside use rounded-control, concentric with
// the panel's p-1.
function ToolbarPanelContent({
  className,
  side = "top",
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "side">) {
  const bar = React.useContext(ToolbarContext)
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        anchor={bar ?? undefined}
        side={side}
        align="center"
        sideOffset={8}
        collisionPadding={16}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="toolbar-panel-content"
          className={cn(
            "flex max-h-(--available-height) w-(--anchor-width) origin-(--transform-origin) flex-col overflow-y-auto rounded-menu border border-border bg-overlay p-1 text-body text-foreground shadow-md outline-hidden backdrop-blur-md duration-overlay data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  )
}

export { Toolbar, ToolbarPanel, ToolbarPanelContent, ToolbarPanelTrigger }
