import { Effect, Layer } from "effect"
import { SessionRunnerService, RunError } from "@opencode-ai/core/session/runner/service"
import { UnifiedRunnerInterface, UnifiedRunnerError } from "../types"
import { SessionSchema } from "@opencode-ai/core/session/schema"

/**
 * Core Adapter - Thin wrapper around UnifiedRunner.run()
 * Implements the original SessionRunnerService interface
 */
export const layer = Layer.effect(
  SessionRunnerService,
  Effect.gen(function* () {
    const unifiedRunner = yield* UnifiedRunnerInterface

    const run = Effect.fn("SessionRunnerAdapter.run")(function* (input: {
      readonly sessionID: SessionSchema.ID
      readonly force: boolean
    }): Effect.Effect<void, RunError> {
      try {
        yield* unifiedRunner.run({ sessionID: input.sessionID, force: input.force })
      } catch (error) {
        if (error instanceof UnifiedRunnerError) {
          // Map UnifiedRunnerError to RunError variants
          return yield* Effect.fail(error)
        }
        return yield* Effect.fail(error)
      }
    })

    return { run }
  }),
)

export const defaultLayer = layer

export * as SessionRunnerAdapter from "./session-runner-service"