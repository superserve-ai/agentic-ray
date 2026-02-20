import boxen from "boxen"

export function commandBox(command: string): string {
  return boxen(command, {
    margin: { left: 4, right: 0, top: 0, bottom: 0 },
    padding: { left: 2, right: 2, top: 0, bottom: 0 },
    dimBorder: true,
    borderStyle: "single",
  })
}
