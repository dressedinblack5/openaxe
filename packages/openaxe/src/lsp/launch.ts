import { Process } from "@/util/process"

type Child = Process.Child

export function spawn(cmd: string, args: string[], opts?: Process.Options): Child
export function spawn(cmd: string, opts?: Process.Options): Child
export function spawn(cmd: string, argsOrOpts?: string[] | Process.Options, opts?: Process.Options) {
  const args = Array.isArray(argsOrOpts) ? [...argsOrOpts] : []
  const cfg = Array.isArray(argsOrOpts) ? opts : argsOrOpts

  // On Windows, .cmd/.bat files with spaces in the path need explicit routing
  // through cmd.exe — Bun.spawn doesn't quote the path when delegating to
  // cmd.exe internally, so the space breaks the command line and stdio is null.
  const spawnCmd =
    process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd) && cmd.includes(" ")
      ? [process.env.COMSPEC ?? "cmd.exe", "/c", cmd, ...args]
      : [cmd, ...args]

  const proc = Process.spawn(spawnCmd, {
    ...cfg,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  if (!proc.stdin || !proc.stdout || !proc.stderr) throw new Error("Process output not available")

  return proc
}

export * as LspLaunch from "./launch"
