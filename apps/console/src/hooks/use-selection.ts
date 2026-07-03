"use client"

import { useCallback, useState } from "react"

interface UseSelectionReturn {
  selected: Set<string>
  allSelected: boolean
  someSelected: boolean
  toggleAll: () => void
  toggleOne: (id: string) => void
  clearSelection: () => void
  setSelected: React.Dispatch<React.SetStateAction<Set<string>>>
}

export function useSelection(items: { id: string }[]): UseSelectionReturn {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const allSelected = items.length > 0 && selected.size === items.length
  const someSelected = selected.size > 0 && !allSelected

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(items.map((item) => item.id)))
    }
  }

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Stable identity so callers can safely list it in effect deps (e.g. "clear
  // selection when the page/filter changes") without re-running every render.
  const clearSelection = useCallback(() => setSelected(new Set()), [])

  return {
    selected,
    allSelected,
    someSelected,
    toggleAll,
    toggleOne,
    clearSelection,
    setSelected,
  }
}
