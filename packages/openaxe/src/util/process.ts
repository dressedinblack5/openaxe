import { Readable, Writable } from "node:stream"
import { buffer } from "node:stream/consumers"
import { errorMessage } from "./error"

export type Stdio = "inherit" | "pipe" | "ignore" | number
export type Shell = boolean | string

export interface Options {
  cwd?: string
  env?: NodeJS.ProcessEnv | null
  stdin?: Stdio
  stdout?: Stdio
  stderr?: Stdio
  shell?: Shell
  abort?: AbortSignal
  kill?: NodeJS.Signals | number
  timeout?: number
}

export interface RunOptions extends Omit<Options, "stdout" | "stderr"> {
  nothrow?: boolean
}

export interface Result {
  code: number
  stdout: Buffer
  stderr: Buffer
}

export interface TextResult extends Result {
  text: string
}

export class RunFailedError extends Error {
  readonly cmd: string[]
  readonly code: number
  readonly stdout: Buffer
  readonly stderr: Buffer

  constructor(cmd: string[], code: number, stdout: Buffer, stderr: Buffer) {
    const text = stderr.toString().trim()
    super(
      text
        ? `Command failed with code ${code}: ${cmd.join(" ")}\n${text}`
        : `Command failed with code ${code}: ${cmd.join(" ")}`,
    )
    this.name = "ProcessRunFailedError"
    this.cmd = [...cmd]
    this.code = code
    this.stdout = stdout
    this.stderr = stderr
  }
}

// ponytail: wraps Bun.Subprocess with Node.js-compatible streams (Readable/Writable)
// so existing code using .stdin.write(), .stdout.on("data", ...) continues working.
export interface Child {
  readonly pid: number
  readonly stdin: Writable | null
  readonly stdout: Readable | null
  readonly stderr: Readable | null
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  readonly exited: Promise<number>
  kill(signal?: NodeJS.Signals | number): void
}

export function spawn(cmd: string[], opts: Options = {}): Child {
  if (cmd.length === 0) throw new Error("Command is required")
  opts.abort?.throwIfAborted()

  let bunProc: ReturnType<typeof Bun.spawn> | undefined
  let spawnError: Error | undefined

  try {
    bunProc = Bun.spawn(cmd, {
      cwd: opts.cwd,
      env: opts.env === null ? {} : opts.env ? { ...process.env, ...opts.env } : undefined,
      stdio: [opts.stdin ?? "ignore", opts.stdout ?? "ignore", opts.stderr ?? "ignore"],
    } as any)
  } catch (err) {
    spawnError = err as Error
  }

  let closed = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const abort = () => {
    if (closed) return
    if (bunProc && (bunProc.exitCode !== null || bunProc.signalCode !== null)) return
    closed = true
    bunProc?.kill(opts.kill ?? "SIGTERM")
    const ms = opts.timeout ?? 5_000
    if (ms <= 0) return
    timer = setTimeout(() => bunProc?.kill("SIGKILL"), ms)
  }

  const exited = (async () => {
    if (spawnError) throw spawnError
    if (!bunProc) throw new Error("Process not spawned")
    const code = await bunProc.exited
    opts.abort?.removeEventListener("abort", abort)
    if (timer) clearTimeout(timer)
    return code
  })()

  void exited.catch(() => undefined)

  if (opts.abort) {
    opts.abort.addEventListener("abort", abort, { once: true })
    if (opts.abort.aborted) abort()
  }

  // ponytail: stdin may be FileSink (Bun) which has .write()/.end() same as Writable
  const stdin = bunProc && bunProc.stdin && typeof bunProc.stdin === "object"
    ? ("getWriter" in bunProc.stdin ? Writable.fromWeb(bunProc.stdin as any) : bunProc.stdin as any as Writable)
    : null
  return {
    get pid() { return bunProc?.pid ?? 0 },
    stdin,
    stdout: bunProc?.stdout ? Readable.fromWeb(bunProc.stdout as any) : null,
    stderr: bunProc?.stderr ? Readable.fromWeb(bunProc.stderr as any) : null,
    get exitCode() { return bunProc?.exitCode ?? null },
    get signalCode() { return bunProc?.signalCode ?? null },
    exited,
    kill(signal) { bunProc?.kill(signal as any) },
  }
}

export async function run(cmd: string[], opts: RunOptions = {}): Promise<Result> {
  const proc = spawn(cmd, {
    cwd: opts.cwd,
    env: opts.env,
    stdin: opts.stdin,
    shell: opts.shell,
    abort: opts.abort,
    kill: opts.kill,
    timeout: opts.timeout,
    stdout: "pipe",
    stderr: "pipe",
  })

  if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")

  const out = await Promise.all([
    proc.exited,
    buffer(proc.stdout),
    buffer(proc.stderr),
  ])
    .then(([code, stdout, stderr]) => ({
      code,
      stdout,
      stderr,
    }))
    .catch((err: unknown) => {
      if (!opts.nothrow) throw err
      return {
        code: 1,
        stdout: Buffer.alloc(0),
        stderr: Buffer.from(errorMessage(err)),
      }
    })
  if (out.code === 0 || opts.nothrow) return out
  throw new RunFailedError(cmd, out.code, out.stdout, out.stderr)
}

// Duplicated in `packages/sdk/js/src/process.ts` because the SDK cannot import
// `opencode` without creating a cycle. Keep both copies in sync.
export async function stop(proc: Child) {
  if (proc.exitCode !== null || proc.signalCode !== null) return

  if (process.platform !== "win32" || !proc.pid) {
    proc.kill()
    return
  }

  const out = await run(["taskkill", "/pid", String(proc.pid), "/T", "/F"], {
    nothrow: true,
  })

  if (out.code === 0) return
  proc.kill()
}

export async function text(cmd: string[], opts: RunOptions = {}): Promise<TextResult> {
  const out = await run(cmd, opts)
  return {
    ...out,
    text: out.stdout.toString(),
  }
}

export async function lines(cmd: string[], opts: RunOptions = {}): Promise<string[]> {
  return (await text(cmd, opts)).text.split(/\r?\n/).filter(Boolean)
}

export * as Process from "./process"
