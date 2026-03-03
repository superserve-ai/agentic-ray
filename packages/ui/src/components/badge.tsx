import { cn } from "../lib/utils"

type BadgeVariant = "default" | "success" | "warning" | "destructive" | "muted"

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant
  dot?: boolean
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  muted: "bg-surface-hover text-muted",
}

const dotColorClasses: Record<BadgeVariant, string> = {
  default: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted",
}

function Badge({
  className,
  variant = "default",
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn("h-1.5 w-1.5", dotColorClasses[variant])} />}
      {children}
    </span>
  )
}

export { Badge }
export type { BadgeVariant }
