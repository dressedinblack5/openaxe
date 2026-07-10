import path from "path"
import { writeHeapSnapshot } from "node:v8"

const MINUTE = 60_000
const LIMIT = 2 * 1024 * 1024 * 1024

let timer: Timer | undefined
let lock = false
let armed = true

export async function start() {
  const heapSnapshotsEnabled =
    process.env["OPENCODE_AUTO_HEAP_SNAPSHOT"]?.toLowerCase() === "true" ||
    process.env["OPENCODE_AUTO_HEAP_SNAPSHOT"] === "1"
  if (!heapSnapshotsEnabled) return
  if (timer) return

  const { Global } = await import("@opencode-ai/core/global")

  const run = async () => {
    if (lock) return

    const stat = process.memoryUsage()
    if (stat.rss <= LIMIT) {
      armed = true
      return
    }
    if (!armed) return

    lock = true
    armed = false
    const file = path.join(
      Global.Path.log,
      `heap-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
    )
    await Promise.resolve()
      .then(() => writeHeapSnapshot(file))
      .catch(() => {})

    lock = false
  }

  timer = setInterval(() => {
    void run()
  }, MINUTE)
  timer.unref?.()
}

export * as Heap from "./heap"
