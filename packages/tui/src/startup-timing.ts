// ponytail: packages/tui can't import openaxe's cli/startup-timing (dep direction is
// openaxe -> tui), so this twin tees to the same log file with absolute process ms.
import { openSync, writeSync } from "fs"

let fd: number | null = null
let last = 0

export function tuiMark(label: string) {
  if (!process.env.OPENAXE_STARTUP_TIMING) return
  if (!fd) {
    const file = process.env.OPENAXE_STARTUP_TIMING_LOG
    if (!file) return
    fd = openSync(file, "a")
  }
  const now = performance.now()
  const delta = last ? `+${(now - last).toFixed(0)}ms ` : ""
  last = now
  const line = `[TIMING] ${label}: ${delta}(total: ${now.toFixed(0)}ms)`
  console.error(line)
  writeSync(fd, line + "\n")
}
