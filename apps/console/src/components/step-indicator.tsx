import { Check } from "lucide-react"
import { cn } from "@superserve/ui"

interface StepIndicatorProps {
  step: number
  label: string
  completed: boolean
  active: boolean
  onClick: () => void
}

export function StepIndicator({
  step,
  label,
  completed,
  active,
  onClick,
}: StepIndicatorProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-4 px-4 py-4 text-left transition-colors",
        active
          ? "bg-surface border border-dashed border-border"
          : "hover:bg-surface-hover border border-dashed border-transparent",
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center h-7 w-7 rounded-full border text-xs font-mono shrink-0",
          completed
            ? "bg-primary border-primary text-white"
            : active
              ? "border-primary text-primary"
              : "border-border text-muted",
        )}
      >
        {completed ? <Check className="h-3.5 w-3.5" /> : step}
      </div>
      <span
        className={cn(
          "font-medium text-sm",
          completed || active ? "text-foreground" : "text-muted",
        )}
      >
        {label}
      </span>
    </button>
  )
}
