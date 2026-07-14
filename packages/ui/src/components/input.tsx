"use client"

import { Input as InputPrimitive } from "@base-ui/react/input"
import { forwardRef, type ReactNode, useId } from "react"

import { cn } from "../lib/utils"

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
  suffix?: ReactNode
  wrapperClassName?: string
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      error,
      suffix,
      wrapperClassName,
      id,
      "aria-describedby": describedBy,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId()
    const inputId = id ?? generatedId
    const errorId = `${inputId}-error`
    const describedByFinal =
      [describedBy, error ? errorId : null].filter(Boolean).join(" ") ||
      undefined

    return (
      <div className={cn("relative", wrapperClassName)}>
        <InputPrimitive
          ref={ref}
          id={inputId}
          className={cn(
            "h-9 w-full border border-input bg-background px-3 text-sm text-foreground",
            "placeholder:text-muted",
            "focus:border-border-focus focus:ring-2 focus:ring-border-focus focus:outline-none",
            "disabled:cursor-not-allowed disabled:opacity-30",
            error && "border-destructive focus:ring-destructive/20",
            suffix &&
              "[appearance:textfield] pr-10 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            className,
          )}
          aria-invalid={!!error}
          aria-describedby={describedByFinal}
          {...props}
        />
        {suffix && (
          <div className="absolute top-1/2 right-3 -translate-y-1/2 text-muted">
            {suffix}
          </div>
        )}
        {error && (
          <p id={errorId} className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    )
  },
)

Input.displayName = "Input"

export type { InputProps }
export { Input }
