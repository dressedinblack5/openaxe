/**
 * Model-facing plan_exit leaf. V1's plan_exit gated on an active plan mode and
 * switched the session to the build agent. Core does not yet track a plan-mode
 * concept, so this tool returns an informative result instead of erroring (per
 * the V2 port rule). The session-agent switch belongs to the session layer once
 * plan mode exists.
 */
export * as PlanExitTool from "./plan-exit"

import { Effect, Layer, Schema } from "effect"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "plan_exit"

export const Input = Schema.Struct({})

export const Output = Schema.Struct({
  approved: Schema.Boolean,
  message: Schema.String,
})

export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description:
            "End plan mode and switch to the build agent to implement the approved plan. Plan mode is not tracked by this core runtime yet, so calling it reports that status instead of switching agents.",
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [{ type: "text", text: output.message }],
          execute: () =>
            Effect.gen(function* () {
              return {
                approved: false,
                message:
                  "Plan mode is not active in this runtime: core does not track a plan-mode session yet. No agent switch was performed. To begin implementing a plan, switch the session agent to build.",
              }
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)
