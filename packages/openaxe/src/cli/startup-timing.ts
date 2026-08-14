// ponytail: simple timer — gate behind OPENAXE_STARTUP_TIMING; tee to OPENAXE_STARTUP_TIMING_LOG
// so marks survive the TUI alt-screen (stderr scrollback is lost on alt-screen swap).
import { openSync, writeSync } from "fs"

const marks: [string, number][] | null = process.env.OPENAXE_STARTUP_TIMING ? [] : null
const logFd = process.env.OPENAXE_STARTUP_TIMING_LOG ? openSync(process.env.OPENAXE_STARTUP_TIMING_LOG, "a") : null

function log(line: string) {
  console.error(line)
  if (logFd) writeSync(logFd, line + "\n")
}

export function mark(label: string) {
  if (!marks) return
  const now = performance.now()
  if (marks.length === 0) {
    marks.push([label, now])
    log(`[TIMING] ${label}`)
    return
  }
  const prev = marks.at(-1)![1]
  const total = now - marks[0][1]
  marks.push([label, now])
  log(`[TIMING] ${label}: +${(now - prev).toFixed(0)}ms (total: ${total.toFixed(0)}ms)`)
}

export function report() {
  if (!marks) return
  const total = marks.at(-1)![1] - marks[0][1]
  log(`[TIMING] === ${marks[0][0]} → ${marks.at(-1)![0]}: ${total.toFixed(0)}ms ===`)
}
