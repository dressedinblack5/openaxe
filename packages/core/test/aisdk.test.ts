import { describe, expect } from "bun:test"
import { AISDK } from "@opencode-ai/core/aisdk"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Effect, Exit, Scope } from "effect"
import { testEffect } from "./lib/effect"

const it = testEffect(AISDK.locationLayer)

function makeModel(): ModelV2.Info {
  const m = ModelV2.Info.empty(ProviderV2.ID.make("test"), ModelV2.ID.make("test-model"))
  return {
    ...m,
    api: { id: ModelV2.ID.make("test-model"), type: "aisdk" as const, package: "@ai-sdk/test" },
  } as ModelV2.Info
}

function makeSDKEvent(): AISDK.SDKEvent {
  return { model: makeModel(), package: "@ai-sdk/test", options: {} }
}

function makeLanguageEvent(): AISDK.LanguageEvent {
  return { model: makeModel(), sdk: {}, options: {} }
}

describe("AISDK", () => {
  it.effect("registers and fires an sdk hook", () =>
    Effect.gen(function* () {
      const svc = yield* AISDK.Service
      const event = makeSDKEvent()
      let received: AISDK.SDKEvent | undefined
      yield* svc.hook.sdk((e) => {
        received = e
      })
      const result = yield* svc.runSDK(event)
      expect(received).toBe(event)
      expect(result).toBe(event)
    }),
  )

  it.effect("registers and fires a language hook", () =>
    Effect.gen(function* () {
      const svc = yield* AISDK.Service
      const event = makeLanguageEvent()
      let received: AISDK.LanguageEvent | undefined
      yield* svc.hook.language((e) => {
        received = e
      })
      const result = yield* svc.runLanguage(event)
      expect(received).toBe(event)
      expect(result).toBe(event)
    }),
  )

  it.effect("hook can mutate event.sdk", () =>
    Effect.gen(function* () {
      const svc = yield* AISDK.Service
      const event = makeSDKEvent()
      const sdk = { custom: true }
      yield* svc.hook.sdk((e) => {
        e.sdk = sdk
      })
      const result = yield* svc.runSDK(event)
      expect(result.sdk).toBe(sdk)
    }),
  )

  it.effect("hook is auto-disposed when its scope closes", () =>
    Effect.gen(function* () {
      const svc = yield* AISDK.Service
      const event = makeSDKEvent()
      let count = 0

      const scope = yield* Scope.make()
      yield* svc.hook.sdk(() => { count++ }).pipe(Scope.provide(scope))

      yield* svc.runSDK(event)
      expect(count).toBe(1)

      yield* Scope.close(scope, Exit.void)
      yield* svc.runSDK(event)
      expect(count).toBe(1)
    }),
  )

  it.effect("multiple hooks fire in registration order", () =>
    Effect.gen(function* () {
      const svc = yield* AISDK.Service
      const event = makeSDKEvent()
      const order: number[] = []
      yield* svc.hook.sdk(() => { order.push(1) })
      yield* svc.hook.sdk(() => { order.push(2) })
      yield* svc.runSDK(event)
      expect(order).toEqual([1, 2])
    }),
  )
})
