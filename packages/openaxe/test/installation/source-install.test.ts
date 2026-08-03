import { describe, expect } from "bun:test"
import { Effect, Layer, Stream } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Installation } from "../../src/installation"
import { AppProcess } from "@opencode-ai/core/process"
import { testEffect } from "../lib/effect"

const encoder = new TextEncoder()
const recorded: { cmd: string; args: readonly string[] }[] = []
function mockSpawner() {
  const spawner = ChildProcessSpawner.make((command) => {
    const std = ChildProcess.isStandardCommand(command) ? command : undefined
    recorded.push({ cmd: std?.command ?? "", args: std?.args ?? [] })
    const output = (std?.args ?? []).includes("--show-toplevel")
      ? "/home/dressedinblack/Projects/openaxe"
      : ""
    return Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: output ? Stream.make(encoder.encode(output)) : Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    )
  })
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

function mockHttpClient() {
  const client = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 }))))
  return Layer.succeed(HttpClient.HttpClient, client)
}

const layer = Installation.layer.pipe(
  Layer.provide(mockHttpClient()),
  Layer.provide(AppProcess.layer.pipe(Layer.provide(mockSpawner()))),
)

const it = testEffect(layer)

describe("installation method detection", () => {
  it.live("source run (bun dev) detects git method", () =>
    Effect.gen(function* () {
      const method = yield* Installation.use.method()
      expect(method).toBe("git")
    }))
})

describe("git upgrade", () => {
  it.live("resolves the repo root then runs git pull --ff-only and bun install", () =>
    Effect.gen(function* () {
      recorded.length = 0
      yield* Installation.use.upgrade("git", "9.9.9")
      const commands = recorded.map((r) => [r.cmd, ...r.args].join(" "))
      expect(commands).toContain("git rev-parse --show-toplevel")
      expect(commands).toContain("git pull --ff-only")
      expect(commands).toContain("bun install")
      const revParse = commands.indexOf("git rev-parse --show-toplevel")
      const pull = commands.indexOf("git pull --ff-only")
      const install = commands.indexOf("bun install")
      expect(pull).toBeGreaterThan(revParse)
      expect(install).toBeGreaterThan(pull)
    }))
})
