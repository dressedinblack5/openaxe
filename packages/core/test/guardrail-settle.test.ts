import fs from "fs/promises"
import path from "path"
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { NodeFileSystem } from "@effect/platform-node"
import { Guardrail } from "@opencode-ai/core/guardrail"
import { FileMutation } from "@opencode-ai/core/file-mutation"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Location } from "@opencode-ai/core/location"
import { LocationMutation } from "@opencode-ai/core/location-mutation"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { EditTool } from "@opencode-ai/core/tool/edit"
import { location } from "./fixture/location"
import { tmpdir } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"
import { toolIdentity, settleTool } from "./lib/tool"
import { it } from "./lib/effect"
import type { Settlement } from "@opencode-ai/core/tool/registry"

const sessionID = SessionV2.ID.make("ses_guardrail_settle_test")
const asserts: PermissionV2.AssertInput[] = []

const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) =>
      Effect.sync(() => asserts.push(input)).pipe(Effect.andThen(Effect.void)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)

const filesystem = FSUtil.defaultLayer

function baseLayers(directory: string) {
  const activeLocation = Layer.succeed(
    Location.Service,
    Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
  )
  const resolution = LocationMutation.layer.pipe(Layer.provide(filesystem), Layer.provide(activeLocation))
  const mutation = FileMutation.layer.pipe(Layer.provide(filesystem))
  const registry = ToolRegistry.defaultLayer.pipe(Layer.provide(permission))
  const edit = EditTool.layer.pipe(
    Layer.provide(registry),
    Layer.provide(permission),
    Layer.provide(resolution),
    Layer.provide(mutation),
    Layer.provide(filesystem),
  )
  return Layer.mergeAll(registry, resolution, mutation, edit)
}

function withTool<A, E>(directory: string, guardrailLayer: Layer.Layer<never, never>, body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E>) {
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(Effect.provide(Layer.mergeAll(baseLayers(directory), guardrailLayer)))
}

const call = (input: typeof EditTool.Input.Type, id = "call-gr") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "edit", input },
})

const gw = testEffect(
  Guardrail.layer.pipe(Layer.provideMerge(NodeFileSystem.layer)),
)

const guardrailLayer = Guardrail.layer.pipe(Layer.provideMerge(NodeFileSystem.layer))

describe("guardrail settlement verification", () => {
  gw.live("appends auto-verification warnings on edit that introduces unbalanced brackets", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "broken.ts"), "const x = { ok: 1 };")).pipe(
          Effect.andThen(
            withTool(tmp.path, guardrailLayer, (registry) =>
              settleTool(registry, call({ path: "broken.ts", oldString: "ok: 1", newString: "ok: 1, bad: {" })),
            ).pipe(
              Effect.map((settled: Settlement) => {
                expect(settled.output?.content.some((c: any) =>
                  c.type === "text" && c.text.includes("Auto-verification warnings") && c.text.includes("unclosed brace"),
                )).toBe(true)
              }),
            ),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  it.live("does not add warnings when guardrail is not in context", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "bad.ts"), "const x = 1;")).pipe(
          Effect.andThen(
            withTool(tmp.path, Layer.empty, (registry) =>
              settleTool(registry, call({ path: "bad.ts", oldString: "1", newString: "{ bad" })),
            ).pipe(
              Effect.map((settled: Settlement) => {
                const hasGuardrailText = settled.output?.content.some((c: any) =>
                  c.type === "text" && c.text.includes("Auto-verification warnings"),
                )
                expect(hasGuardrailText).toBe(false)
              }),
            ),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )

  gw.live("does not add warnings for a structurally clean file", () =>
    Effect.acquireUseRelease(
      Effect.promise(() => tmpdir()),
      (tmp) =>
        Effect.promise(() => fs.writeFile(path.join(tmp.path, "clean.ts"), "const x = 1;")).pipe(
          Effect.andThen(
            withTool(tmp.path, guardrailLayer, (registry) =>
              settleTool(registry, call({ path: "clean.ts", oldString: "1", newString: "2" })),
            ).pipe(
              Effect.map((settled: Settlement) => {
                const hasGuardrailText = settled.output?.content.some((c: any) =>
                  c.type === "text" && c.text.includes("Auto-verification warnings"),
                )
                expect(hasGuardrailText).toBe(false)
              }),
            ),
          ),
        ),
      (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
    ),
  )
})
