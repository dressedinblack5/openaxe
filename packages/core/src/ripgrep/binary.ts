import { exec } from "node:child_process"
import { promisify } from "node:util"
import path from "node:path"
import { Context, Effect, Layer, Result, Stream } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "../cross-spawn-spawner"
import { LayerNode } from "../effect/layer-node"
import { httpClient } from "../effect/layer-node-platform"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { extractTgz, extractZip } from "../util/archive"
import { which } from "../util/which"

// ponytail: promisify exec — shell resolves PATHEXT on Windows where
// ChildProcessSpawner doesn't.
const execAsync = promisify(exec) as (
  cmd: string,
  opts?: { shell?: string | boolean },
) => Promise<{ stdout: string; stderr: string }>

const VERSION = "15.1.0"
const PLATFORM = {
  "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
  "arm64-linux": { platform: "aarch64-unknown-linux-gnu", extension: "tar.gz" },
  "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
  "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
  "arm64-win32": { platform: "aarch64-pc-windows-msvc", extension: "zip" },
  "ia32-win32": { platform: "i686-pc-windows-msvc", extension: "zip" },
  "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
} as const

interface Interface {
  readonly filepath: Effect.Effect<string, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/RipgrepBinary") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    // ponytail: follow redirects before filtering status — GitHub release
    // /releases/download URLs 302 to objects.githubusercontent.com, and the
    // Node http client does not follow redirects on its own.
    const http = HttpClient.filterStatusOk(HttpClient.followRedirects(5)(yield* HttpClient.HttpClient))
    const spawner = yield* ChildProcessSpawner

    const run = Effect.fnUntraced(function* (command: string, args: string[]) {
      const handle = yield* spawner.spawn(ChildProcess.make(command, args, { extendEnv: true, stdin: "ignore" }))
      const [stdout, stderr, code] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      )
      return { stdout, stderr, code }
    }, Effect.scoped)

    const extract = Effect.fnUntraced(function* (
      archive: string,
      config: (typeof PLATFORM)[keyof typeof PLATFORM],
      target: string,
    ) {
      const dir = yield* fs.makeTempDirectoryScoped({ directory: Global.Path.bin, prefix: "ripgrep-" })
      const extracted = path.join(
        dir,
        `ripgrep-${VERSION}-${config.platform}`,
        process.platform === "win32" ? "rg.exe" : "rg",
      )

      if (config.extension === "zip") {
        const unzipOk = yield* Effect.tryPromise({
          try: async () => execAsync(`unzip -o "${archive}" -d "${dir}"`, { shell: true }),
          catch: (cause) => cause,
        }).pipe(Effect.isSuccess)
        if (!unzipOk) {
          const shell = which("powershell.exe") ?? which("pwsh.exe") ?? "powershell.exe"
          const psCmd = `& { $global:ProgressPreference = 'SilentlyContinue'; Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${dir.replaceAll("'", "''")}' -Force }`
          yield* Effect.tryPromise({
            try: async () =>
              execAsync(`"${shell}" -NoProfile -NonInteractive -Command "${psCmd.replaceAll('"', '\\"')}"`, {
                shell: true,
              }),
            catch: (cause: unknown) => cause,
          }).pipe(Effect.isSuccess)
        }
        // ponytail: shell extractors can exit 0 without extracting (Wine's
        // powershell stub succeeds but does nothing) — fall back to pure-JS
        // extraction whenever the executable is still missing.
        if (!(yield* fs.isFile(extracted).pipe(Effect.orDie))) {
          yield* Effect.try({
            try: () => extractZip(archive, dir),
            catch: (cause) => new Error(`ripgrep extraction failed: ${String(cause)}`),
          }).pipe(Effect.orDie)
        }
      }

      if (config.extension === "tar.gz") {
        const result = yield* Effect.result(run("tar", ["-xzf", archive, "-C", dir]))
        if (
          Result.isFailure(result) ||
          result.success.code !== 0 ||
          !(yield* fs.isFile(extracted).pipe(Effect.orDie))
        ) {
          yield* Effect.try({
            try: () => extractTgz(archive, dir),
            catch: (cause) => new Error(`ripgrep extraction failed: ${String(cause)}`),
          }).pipe(Effect.orDie)
        }
      }

      if (!(yield* fs.isFile(extracted).pipe(Effect.orDie)))
        throw new Error(`ripgrep archive did not contain executable: ${extracted}`)

      yield* fs.copyFile(extracted, target)
      if (process.platform !== "win32") yield* fs.chmod(target, 0o755)
    }, Effect.scoped)

    return Service.of({
      filepath: yield* Effect.cached(
        Effect.gen(function* () {
          const system = yield* Effect.sync(() => which(process.platform === "win32" ? "rg.exe" : "rg"))
          if (system && (yield* fs.isFile(system).pipe(Effect.orDie))) return system

          const target = path.join(Global.Path.bin, `rg${process.platform === "win32" ? ".exe" : ""}`)
          if (yield* fs.isFile(target).pipe(Effect.orDie)) return target

          // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- the runtime guard below validates the arch-platform tuple against PLATFORM.
          const platformKey = `${process.arch}-${process.platform}` as keyof typeof PLATFORM
          const config = PLATFORM[platformKey]
          if (!config) throw new Error(`unsupported platform for ripgrep: ${platformKey}`)

          const filename = `ripgrep-${VERSION}-${config.platform}.${config.extension}`
          const url = `https://github.com/BurntSushi/ripgrep/releases/download/${VERSION}/${filename}`
          const archive = path.join(Global.Path.bin, filename)

          yield* Effect.logInfo("downloading ripgrep", { url })
          yield* fs.ensureDir(Global.Path.bin).pipe(Effect.orDie)
          const bytes = yield* HttpClientRequest.get(url).pipe(
            http.execute,
            Effect.flatMap((response) => response.arrayBuffer),
            Effect.mapError((cause) => (cause instanceof Error ? cause : new Error(String(cause)))),
          )
          if (bytes.byteLength === 0) throw new Error(`failed to download ripgrep from ${url}`)

          yield* fs.writeWithDirs(archive, new Uint8Array(bytes))
          yield* extract(archive, config, target)
          yield* fs.remove(archive, { force: true }).pipe(Effect.ignore)
          return target
        }),
      ),
    })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(FSUtil.defaultLayer),
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

export const node = LayerNode.make(layer, [FSUtil.node, httpClient, CrossSpawnSpawner.node])

export * as RipgrepBinary from "./binary"
