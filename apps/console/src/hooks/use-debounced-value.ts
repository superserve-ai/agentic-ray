"use client"

import { useEffect, useState } from "react"

/**
 * Returns a copy of `value` that only updates after it has stopped changing for
 * `delay` ms. Used to keep list search from firing a request per keystroke.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])

  return debounced
}
