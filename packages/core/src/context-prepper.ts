export * as ContextPrepper from "./context-prepper"

import { Duration, Effect, Layer, Schema } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { AppProcess } from "./process"
import { Location } from "./location"
import { SystemContext } from "./system-context/index"
import { SystemContextRegistry } from "./system-context/registry"

class Change extends Schema.Class<Change>("ContextPrepper.Change")({
  path: Schema.String,
  status: Schema.Literals(["A", "M", "D"]),
}) {}

const Changes = Schema.Array(Change)
const key = SystemContext.Key.make("core/context-prepper")

function render(changes: ReadonlyArray<Change>): string {
  return changes.map((c) => `  ${c.path} (${statusLabel(c.status)})`).join("\n")
}

function statusLabel(s: "A" | "M" | "D"): string {
  switch (s) {
    case "A": return "added"
    case "M": return "modified"
    case "D": return "deleted"
  }
}

function parseLine(line: string): Change | null {
  const c = line[0]
  if (c === "R") {
    const parts = line.slice(1).trim().split("\t")
    return new Change({ path: parts[parts.length - 1]!, status: "M" })
  }
  return c === "A" || c === "M" || c === "D"
    ? new Change({ path: line.slice(1).trim(), status: c })
    : null
}

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const location = yield* Location.Service
    const proc = yield* AppProcess.Service
    const registry = yield* SystemContextRegistry.Service

    const source = (changes: ReadonlyArray<Change>) =>
      SystemContext.make({
        key,
        codec: Schema.toCodecJson(Changes),
        load: Effect.succeed(changes),
        baseline: (c) => `<recent_changes>\n${render(c)}\n</recent_changes>`,
        update: (_prev, c) => `<recent_changes>\n${render(c)}\n</recent_changes>`,
        removed: () => "No longer tracking recent changes.",
      })

    const observe = Effect.fn("ContextPrepper.observe")(function* () {
      const result = yield* proc
        .run(
          ChildProcess.make("git", ["diff", "--name-status", "HEAD", "--", "."], {
            cwd: location.directory,
            extendEnv: true,
            stdin: "ignore",
          }),
          { timeout: Duration.seconds(5) },
        )
        .pipe(
          Effect.map((r) => ({
            exitCode: r.exitCode,
            text: r.stdout.toString("utf8").trim(),
          })),
          Effect.catch(() => Effect.succeed({ exitCode: 1, text: "" })),
        )
      if (result.exitCode !== 0) return []
      if (!result.text) return []
      return result.text.split("\n").map(parseLine).filter((c): c is Change => c !== null)
    })

    yield* registry.register({
      key,
      load: observe().pipe(
        Effect.map((changes) => (changes.length === 0 ? SystemContext.empty : source(changes))),
        Effect.catch(() => Effect.succeed(SystemContext.empty)),
        Effect.catchDefect(() => Effect.succeed(SystemContext.empty)),
      ),
    })
  }),
)
