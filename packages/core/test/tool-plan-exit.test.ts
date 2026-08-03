import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { PlanExitTool } from "@opencode-ai/core/tool/plan-exit"
import { testEffect } from "./lib/effect"
import { toolIdentity, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_plan_exit_tool_test")

const withTool = <A, E, R>(body: (registry: ToolRegistry.Interface) => Effect.Effect<A, E, R>) => {
  const registry = ToolRegistry.defaultLayer
  const planExit = PlanExitTool.layer.pipe(Layer.provide(registry))
  return Effect.gen(function* () {
    return yield* body(yield* ToolRegistry.Service)
  }).pipe(Effect.provide(Layer.mergeAll(registry, planExit)))
}

const call = (input: typeof PlanExitTool.Input.Type = {}, id = "call-plan-exit") => ({
  sessionID,
  ...toolIdentity,
  call: { type: "tool-call" as const, id, name: "plan_exit", input },
})

const it = testEffect(Layer.empty)

describe("PlanExitTool", () => {
  it.effect("registers plan_exit as a canonical tool", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["plan_exit"])
      }),
    ),
  )

  it.effect("returns an informative result instead of erroring", () =>
    withTool((registry) =>
      Effect.gen(function* () {
        const settled = yield* settleTool(registry, call())
        expect(settled.result.type).toBe("text")
        expect(String(settled.result.value)).toContain("Plan mode is not active in this runtime")
        expect(settled.output?.structured).toMatchObject({ approved: false })
      }),
    ),
  )
})
