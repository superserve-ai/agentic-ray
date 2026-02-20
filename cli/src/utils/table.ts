import Table from "cli-table3"

const TABLE_CHARS = {
  top: "─",
  "top-mid": "┬",
  "top-left": "┌",
  "top-right": "┐",
  bottom: "─",
  "bottom-mid": "┴",
  "bottom-left": "└",
  "bottom-right": "┘",
  left: "│",
  "left-mid": "├",
  mid: "─",
  "mid-mid": "┼",
  right: "│",
  "right-mid": "┤",
  middle: "│",
} as const

export function createTable(head: string[]): Table.Table {
  return new Table({
    head,
    style: { head: [], border: [], "padding-left": 1, "padding-right": 1 },
    chars: TABLE_CHARS,
  })
}
