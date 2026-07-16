import { spawnSync } from "node:child_process"

// Duplicated from `packages/openaxe/src/util/process.ts` because the SDK cannot
// import `opencode` without creating a cycle (`opencode` depends on `@opencode-ai/sdk`).
export function stop(proc: Bun.Subprocess) {
  if (proc.exitCode !== null || proc.signalCode !== null) return
  if (process.platform === "win32" && proc.pid) {
    const out = spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { windowsHide: true })
    if (!out.error && out.status === 0) return
  }
  proc.kill()
}

export function bindAbort(proc: Bun.Subprocess, signal?: AbortSignal, onAbort?: () => void) {
  if (!signal) return () => {}
  const clear = () => {
    signal.removeEventListener("abort", abort)
  }
  const abort = () => {
    clear()
    stop(proc)
    onAbort?.()
  }
  signal.addEventListener("abort", abort, { once: true })
  proc.exited.then(clear, clear)
  if (signal.aborted) abort()
  return clear
}
