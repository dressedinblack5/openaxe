import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { GlobalBus } from "@/bus/global"
import { EventV2 } from "@opencode-ai/core/event"
import { Effect, Queue } from "effect"
import {
  callback,
  concat,
  drop,
  encodeText,
  ensuring,
  filter,
  flatMap,
  fromEffect,
  fromQueue,
  make,
  map,
  merge,
  pipeThroughChannel,
  takeUntil,
  tick,
} from "effect/Stream"
import { HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Event, encode } from "effect/unstable/encoding/Sse"
import { EventApi } from "../groups/event"

function eventData(data: unknown): Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function eventID() {
  return EventV2.ID.create()
}

function eventResponse(events: EventV2.Interface) {
  return Effect.gen(function* () {
    const instance = yield* InstanceState.context
    const workspaceID = yield* InstanceState.workspaceID
    const queue = yield* Queue.unbounded<EventV2.Payload>()
    // Listener is acquired lazily (first pull), but server.connected is emitted
    // AFTER the listener is registered, so no events are lost at startup.
    const eventStream = fromEffect(events.listen((event) => Effect.sync(() => Queue.offerUnsafe(queue, event)))).pipe(
      flatMap((unsubscribe: EventV2.Unsubscribe) =>
        make({ id: eventID(), type: "server.connected", properties: {} }).pipe(
          concat(
            fromQueue(queue).pipe(
              ensuring(unsubscribe),
              filter(
                (event) =>
                  event.location?.directory === instance.directory &&
                  (event.location.workspaceID === undefined || event.location.workspaceID === workspaceID),
              ),
              map((event) => ({ id: event.id, type: event.type, properties: event.data })),
            ),
          ),
        ),
      ),
    )
    const disposed = callback<{ id: string; type: string; properties: unknown }>((queue) => {
      const listener = (event: {
        directory?: string
        payload: { id?: string; type?: string; properties?: unknown }
      }) => {
        if (event.directory !== instance.directory || event.payload.type !== "server.instance.disposed") return
        Queue.offerUnsafe(queue, {
          id: event.payload.id ?? eventID(),
          type: "server.instance.disposed",
          properties: event.payload.properties ?? {},
        })
      }
      return Effect.acquireRelease(
        Effect.sync(() => GlobalBus.on("event", listener)),
        () => Effect.sync(() => GlobalBus.off("event", listener)),
      )
    })
    const output = eventStream.pipe(
      merge(disposed, { haltStrategy: "left" }),
      takeUntil((event) => event.type === "server.instance.disposed"),
    )
    const heartbeat = tick("10 seconds").pipe(
      drop(1),
      map(() => ({ id: eventID(), type: "server.heartbeat", properties: {} })),
    )

    yield* Effect.logInfo("event connected")
    return HttpServerResponse.stream(
      output.pipe(
        merge(heartbeat, { haltStrategy: "left" }),
        map(eventData),
        pipeThroughChannel(encode()),
        encodeText,
        ensuring(Effect.logInfo("event disconnected")),
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  })
}

export const eventHandlers = HttpApiBuilder.group(EventApi, "event", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    return handlers.handleRaw(
      "subscribe",
      Effect.fn("EventHttpApi.subscribe")(function* () {
        return yield* eventResponse(events)
      }),
    )
  }),
)
