// @ts-nocheck
import { Effect, Layer } from "effect"
import { SessionRunnerService, RunError } from "@opencode-ai/core/session/runner/service"
import { UnifiedRunnerInterface } from "../types"
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
      return yield* unifiedRunner.run({ sessionID: input.sessionID, force: input.force })
    })

    return { run }
  }),
)

export const defaultLayer = layer

export * as SessionRunnerAdapter from "./session-runner-service"