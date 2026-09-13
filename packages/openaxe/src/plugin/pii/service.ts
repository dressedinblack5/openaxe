import { Context, Effect, Layer, Schema } from "effect"
import { DEFAULT_PII_MODEL_PATH, PiiInput } from "./schema"
import type { PiiInput as PiiInputType, PiiOutput as PiiOutputType } from "./schema"

/**
 * Offline PII detector stub.
 *
 * Effect Schemas for input/output, a `PiiService` Effect Service, and a lazy
 * `Effect.cached` model-load seam keyed by `.tflite` path. Real inference
 * (TFLite INT8 PII artifact) lands later; until then the stub abstains
 * (`hit: false`, confidence 0) so the permission fall-through path stays
 * live. No TF imports here.
 */

/**
 * Minimal interpreter surface. The real `.tflite` PII interpreter must
 * satisfy this interface; tests inject mocks here.
 */
export interface PiiInterpreter {
  readonly scan: (input: PiiInputType) => Effect.Effect<PiiOutputType>
}

/** Deterministic stub: always abstains so the fall-through path stays live. */
export const StubPiiInterpreter: PiiInterpreter = {
  scan: () => Effect.succeed({ hit: false, confidence: 0 }),
}

export class PiiService extends Context.Service<
  PiiService,
  {
    readonly load: (modelPath: string) => Effect.Effect<PiiInterpreter>
  }
>()("@openaxe/Pii") {}

/** Default layer: no model file yet, so every load resolves the stub. */
export const PiiServiceStub = Layer.succeed(PiiService, {
  load: () => Effect.succeed(StubPiiInterpreter),
})

const piiCache = new Map<string, Effect.Effect<PiiInterpreter, never, PiiService>>()

/**
 * Lazy, cached model-load seam for the `.tflite` PII artifact.
 * The `Effect.cached` outer runs once per path on first use; every later call
 * reuses the memoized getter, so `PiiService.load` fires at most once.
 */
export const loadPii = (
  modelPath: string = DEFAULT_PII_MODEL_PATH,
): Effect.Effect<PiiInterpreter, never, PiiService> =>
  Effect.gen(function* () {
    const hit = piiCache.get(modelPath)
    if (hit) return yield* hit
    const service = yield* PiiService
    const getOnce = yield* Effect.cached(service.load(modelPath))
    piiCache.set(modelPath, getOnce)
    return yield* getOnce
  })

/** Test-only: drop cached interpreters so layers stay isolated between tests. */
export const resetPiiCache = (): void => {
  piiCache.clear()
}

/** Stub `scanText(text) -> { hit, confidence, kinds? }`. */
export const scanText = (
  text: string,
  modelPath: string = DEFAULT_PII_MODEL_PATH,
): Effect.Effect<PiiOutputType, Schema.SchemaError, PiiService> =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(PiiInput)({ text })
    const interpreter = yield* loadPii(modelPath)
    return yield* interpreter.scan(input)
  })

/**
 * Promise helper backed by the stub layer, for non-Effect call sites
 * (e.g. the openaxe internal plugin). Keeps Effect piping inside this
 * package so cross-package Effect generics never leak into consumers.
 */
export const scanTextStub = (text: string): Promise<PiiOutputType> =>
  Effect.runPromise(Effect.provide(scanText(text), PiiServiceStub))
