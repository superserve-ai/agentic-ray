import { createInterface } from "node:readline"

export async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes")
    })
  })
}

export async function promptUser(): Promise<string | null> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
  })
  return new Promise((resolve) => {
    rl.question("\nYou> ", (answer) => {
      resolve(answer)
      rl.close()
    })
    rl.on("close", () => resolve(null))
  })
}
