import { dlopen, ptr } from "bun:ffi"
import type { ReadStream } from "node:tty"

const STD_INPUT_HANDLE = -10
const STD_OUTPUT_HANDLE = -11
const ENABLE_PROCESSED_INPUT = 0x0001
const ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004

const kernel = () =>
  dlopen("kernel32.dll", {
    GetStdHandle: { args: ["i32"], returns: "ptr" },
    GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
    SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
    FlushConsoleInputBuffer: { args: ["ptr"], returns: "i32" },
  })

let k32: ReturnType<typeof kernel> | undefined

function load(): ReturnType<typeof kernel> | undefined {
  if (process.platform !== "win32") return undefined
  try {
    k32 ??= kernel()
    return k32
  } catch {
    return undefined
  }
}

/**
 * Enable ANSI escape sequence processing on the console stdout handle.
 *
 * Windows Terminal and most modern terminals enable virtual terminal
 * processing themselves, but the legacy conhost (plain cmd.exe / PowerShell
 * window) requires the application to opt in via
 * ENABLE_VIRTUAL_TERMINAL_PROCESSING or ANSI output renders as raw escape
 * codes.
 */
export function win32EnableVirtualTerminalProcessing() {
  if (process.platform !== "win32") return
  if (!process.stdout.isTTY) return
  const api = load()
  if (!api) return

  const handle = api.symbols.GetStdHandle(STD_OUTPUT_HANDLE)
  const buf = new Uint32Array(1)
  if (api.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return

  const mode = buf[0]
  if ((mode & ENABLE_VIRTUAL_TERMINAL_PROCESSING) !== 0) return
  api.symbols.SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING)
}

/**
 * Clear ENABLE_PROCESSED_INPUT on the console stdin handle.
 */
export function win32DisableProcessedInput() {
  if (process.platform !== "win32") return
  if (!process.stdin.isTTY) return
  const api = load()
  if (!api) return

  const handle = api.symbols.GetStdHandle(STD_INPUT_HANDLE)
  const buf = new Uint32Array(1)
  if (api.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return

  const mode = buf[0]
  if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
  api.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
}

/**
 * Discard any queued console input (mouse events, key presses, etc.).
 */
export function win32FlushInputBuffer() {
  if (process.platform !== "win32") return
  if (!process.stdin.isTTY) return
  const api = load()
  if (!api) return

  const handle = api.symbols.GetStdHandle(STD_INPUT_HANDLE)
  api.symbols.FlushConsoleInputBuffer(handle)
}

let unhook: (() => void) | undefined

/**
 * Keep ENABLE_PROCESSED_INPUT disabled.
 *
 * On Windows, Ctrl+C becomes a CTRL_C_EVENT (instead of stdin input) when
 * ENABLE_PROCESSED_INPUT is set. Various runtimes can re-apply console modes
 * (sometimes on a later tick), and the flag is console-global, not per-process.
 *
 * We combine:
 * - A `setRawMode(...)` hook to re-clear after known raw-mode toggles.
 * - A low-frequency poll as a backstop for native/external mode changes.
 */
export function win32InstallCtrlCGuard() {
  if (process.platform !== "win32") return undefined
  if (!process.stdin.isTTY) return undefined
  const api = load()
  if (!api) return undefined
  if (unhook) return unhook

  const stdin = process.stdin as ReadStream
  // oxlint-disable-next-line typescript-eslint/unbound-method -- raw method ref captured only to restore the original hook after the guard is removed
  const original = stdin.setRawMode

  const handle = api.symbols.GetStdHandle(STD_INPUT_HANDLE)
  const buf = new Uint32Array(1)

  if (api.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return undefined
  const initial = buf[0]

  const enforce = () => {
    if (api.symbols.GetConsoleMode(handle, ptr(buf)) === 0) return
    const mode = buf[0]
    if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
    api.symbols.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
  }

  // Some runtimes can re-apply console modes on the next tick; enforce twice.
  const later = () => {
    enforce()
    setImmediate(enforce)
  }

  let wrapped: ReadStream["setRawMode"] | undefined

  if (typeof original === "function") {
    wrapped = (mode: boolean) => {
      const result = original.call(stdin, mode)
      later()
      return result
    }

    stdin.setRawMode = wrapped
  }

  // Ensure it's cleared immediately too (covers any earlier mode changes).
  later()

  const interval = setInterval(enforce, 100)
  interval.unref()

  let done = false
  unhook = () => {
    if (done) return
    done = true

    clearInterval(interval)
    if (wrapped && stdin.setRawMode === wrapped) {
      stdin.setRawMode = original
    }

    api.symbols.SetConsoleMode(handle, initial)
    unhook = undefined
  }

  return unhook
}
