// @ts-nocheck
import { Effect, Layer } from "effect"
import { SessionData, SessionEventSubscriberInterface } from "../types"

/**
 * CLI Adapter - Wraps SessionData reducer output from SessionEventSubscriber
 * Provides SessionData for TUI rendering
 */

export interface SessionDataAdapterInterface {
  readonly getData: (sessionID: string) => Effect.Effect<SessionData | undefined>
  readonly subscribe: (sessionID: string) => Effect.Effect<void>
  readonly unsubscribe: (sessionID: string) => Effect.Effect<void>
}

export const SessionDataAdapter = Context.Tag<SessionDataAdapterInterface>("@opencode/SessionDataAdapter")

export const layer = Layer.effect(
  SessionDataAdapter,
  Effect.gen(function* () {
    const eventSubscriber = yield* SessionEventSubscriberInterface

    const getData = Effect.fn("SessionDataAdapter.getData")(function* (sessionID: string) {
      return yield* eventSubscriber.getData(sessionID)
    })

    const subscribe = Effect.fn("SessionDataAdapter.subscribe")(function* (sessionID: string) {
      yield* eventSubscriber.subscribe(sessionID)
    })

    const unsubscribe = Effect.fn("SessionDataAdapter.unsubscribe")(function* (sessionID: string) {
      yield* eventSubscriber.unsubscribe(sessionID)
    })

    return { getData, subscribe, unsubscribe }
  }),
)

export const defaultLayer = layer

export * as SessionDataAdapter from "./session-data"
