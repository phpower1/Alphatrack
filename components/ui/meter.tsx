import { Meter as MeterPrimitive } from "@base-ui/react/meter"

import { cn } from "@/lib/utils"

/**
 * Hand-written to match the generated `base-nova` primitives — the shadcn
 * registry has no `meter` entry, but @base-ui/react ships the primitive.
 *
 * Use Meter (role="meter") for a measurement inside a known range — capital
 * utilisation, ROI against a target, DTE elapsed. Use Progress for task
 * completion. They are not interchangeable to a screen reader.
 */
function Meter({
  className,
  children,
  value,
  ...props
}: MeterPrimitive.Root.Props) {
  return (
    <MeterPrimitive.Root
      value={value}
      data-slot="meter"
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    >
      {children}
    </MeterPrimitive.Root>
  )
}

function MeterTrack({ className, ...props }: MeterPrimitive.Track.Props) {
  return (
    <MeterPrimitive.Track
      data-slot="meter-track"
      className={cn(
        "relative flex h-1.5 w-full items-center overflow-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    />
  )
}

function MeterIndicator({
  className,
  ...props
}: MeterPrimitive.Indicator.Props) {
  return (
    <MeterPrimitive.Indicator
      data-slot="meter-indicator"
      className={cn("h-full rounded-full bg-brand transition-all", className)}
      {...props}
    />
  )
}

function MeterLabel({ className, ...props }: MeterPrimitive.Label.Props) {
  return (
    <MeterPrimitive.Label
      data-slot="meter-label"
      className={cn("text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  )
}

function MeterValue({ className, ...props }: MeterPrimitive.Value.Props) {
  return (
    <MeterPrimitive.Value
      data-slot="meter-value"
      className={cn(
        "ml-auto font-mono text-xs text-foreground tabular-nums",
        className
      )}
      {...props}
    />
  )
}

export { Meter, MeterTrack, MeterIndicator, MeterLabel, MeterValue }
