import { Effect, Layer, Context, Ref, HashMap, Scope } from "effect"
import { EventV2 } from "@opencode-ai/core/event"
import { InstanceState } from "@opencode-ai/core/effect/instance-state"
import { SessionEvent, SessionID } from "@opencode-ai/schema"
import { SessionEventSubscriberInterface, SessionData } from "./types"
import { reduceEvent, createInitialSessionData } from "./reducer"

/**
 * SessionEventSubscriber - CLI service
 * Streams EventV2, runs pure reducer, publishes SessionData to InstanceState
 * TUI reads from InstanceState for instant hot-reload
 */

interface SubscriberState {
  reducers: HashMap.HashMap<string, SessionData>
  scopes: HashMap.HashMap<string, Scope.CloseableScope>
}

export const layer = Layer.scoped(
  SessionEventSubscriberInterface,
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const instanceState = yield* InstanceState.make<SubscriberState>(
      Effect.fn("SessionEventSubscriber.state")(function* () {
        const scope = yield* Scope.Scope
        return { reducers: HashMap.empty(), scopes: HashMap.empty() }
      }),
    )

    const subscribe = Effect.fn("SessionEventSubscriber.subscribe")(function* (sessionID: SessionID) {
      const state = yield* InstanceState.get(instanceState)
      if (HashMap.has(state.reducers, sessionID)) return

      // Create new reducer state
      const initialData = createInitialSessionData()
      const newReducers = HashMap.set(state.reducers, sessionID, initialData)

      // Create scope for this subscription
      const childScope = yield* Scope.make
      const newScopes = HashMap.set(state.scopes, sessionID, childScope)

      yield* Ref.set(instanceState.ref, { ...state, reducers: newReducers, scopes: newScopes })

      // Subscribe to EventV2 stream for this session
      yield* Scope.extend(
        childScope,
        events
          .stream({ sessionID })
          .pipe(
            Effect.flatMap((event) =>
              Effect.gen(function* () {
                const currentState = yield* InstanceState.get(instanceState)
                const reducerState = HashMap.get(currentState.reducers, sessionID)
                if (Option.isNone(reducerState)) return
                const result = reduceEvent(reducerState.value, event)
                const updatedReducers = HashMap.set(currentState.reducers, sessionID, result.data)
                yield* Ref.set(instanceState.ref, { ...currentState, reducers: updatedReducers })
              }),
            ),
            Effect.catchAllCause(Effect.logError),
          ),
      )
    })

    const unsubscribe = Effect.fn("SessionEventSubscriber.unsubscribe")(function* (sessionID: SessionID) {
      const state = yield* InstanceState.get(instanceState)
      const scope = HashMap.get(state.scopes, sessionID)
      if (Option.isSome(scope)) {
        yield* Scope.close(scope.value, Exit.void)
      }
      const newReducers = HashMap.remove(state.reducers, sessionID)
      const newScopes = HashMap.remove(state.scopes, sessionID)
      yield* Ref.set(instanceState.ref, { ...state, reducers: newReducers, scopes: newScopes })
    })

    const getData = Effect.fn("SessionEventSubscriber.getData")(function* (sessionID: SessionID) {
      const state = yield* InstanceState.get(instanceState)
      return HashMap.get(state.reducers, sessionID).pipe(
        Effect.map((opt) => opt.value),
      )
    })

    return { subscribe, unsubscribe, getData }
  }),
)

export const defaultLayer = layer

export * as SessionEventSubscriber from "./session-event-subscriber"