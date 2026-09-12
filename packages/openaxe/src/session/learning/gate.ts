import { Context, Effect, Layer, Schema } from "effect"

/**
 * TF learning gate stub.
 *
 * Effect Schemas for input/output, a `GateService` Effect Service, and a
 * lazy cached model-load seam. Real TF inference lands later; this module
 * only establishes the seams so `learning.ts` can consult the gate before
 * the LLM candidates loop.
 */

export const DEFAULT_GATE_MODEL_PATH = "model/learning-gate.tflite"

export const DEFAULT_GATE_THRESHOLD = 0.5

export const GateInput = Schema.Struct({
  userMessage: Schema.String,
  assistantMessage: Schema.String,
})
export type GateInput = Schema.Schema.Type<typeof GateInput>

/**
 * Gate verdict. `confidence` is the trust in the `learnable` verdict itself.
 * The consumer (`learning.ts`) skips the LLM review only on a confident
 * NOT-learnable verdict (`learnable: false` at `confidence >= threshold`);
 * every other outcome — including low confidence — proceeds to the LLM path.
 * The stub below abstains as `{ learnable: false, confidence: 0 }`, which
 * never skips: an unloadable gate must not suppress learning.
 */
export const GateOutput = Schema.Struct({
  learnable: Schema.Boolean,
  confidence: Schema.Number,
})
export type GateOutput = Schema.Schema.Type<typeof GateOutput>

/**
 * Minimal interpreter surface. The real `.tflite` interpreter must satisfy
 * this interface; tests inject mocks here.
 */
export interface GateInterpreter {
  readonly predict: (input: GateInput) => Effect.Effect<GateOutput>
}

/** Deterministic stub: always abstains (confidence 0) so the LLM path stays live. */
export const StubGateInterpreter: GateInterpreter = {
  predict: () => Effect.succeed({ learnable: false, confidence: 0 }),
}

export class GateService extends Context.Service<
  GateService,
  {
    readonly load: (modelPath: string) => Effect.Effect<GateInterpreter>
  }
>()("@opencode/LearningGate") {}

/** Default layer: no model file yet, so every load resolves the stub. */
export const GateServiceStub = Layer.succeed(GateService, {
  load: () => Effect.succeed(StubGateInterpreter),
})

const gateCache = new Map<string, Effect.Effect<GateInterpreter, never, GateService>>()

/**
 * Lazy, cached model-load seam for the `.tflite` artifact.
 * The `Effect.cached` outer runs once per path on first use; every later call
 * reuses the memoized getter, so `GateService.load` fires at most once.
 */
export const loadGateModel = (
  modelPath: string = DEFAULT_GATE_MODEL_PATH,
): Effect.Effect<GateInterpreter, never, GateService> =>
  Effect.gen(function* () {
    const hit = gateCache.get(modelPath)
    if (hit) return yield* hit
    const service = yield* GateService
    const getOnce = yield* Effect.cached(service.load(modelPath))
    gateCache.set(modelPath, getOnce)
    return yield* getOnce
  })

/** Test-only: drop cached interpreters so layers stay isolated between tests. */
export const resetGateCache = (): void => {
  gateCache.clear()
}

/** Stub `decideLearnable(userMessage, assistantMessage) -> { learnable, confidence }`. */
export const decideLearnable = (
  userMessage: string,
  assistantMessage: string,
  modelPath: string = DEFAULT_GATE_MODEL_PATH,
): Effect.Effect<GateOutput, Schema.SchemaError, GateService> =>
  Effect.gen(function* () {
    const input = yield* Schema.decodeUnknownEffect(GateInput)({ userMessage, assistantMessage })
    const interpreter = yield* loadGateModel(modelPath)
    return yield* interpreter.predict(input)
  })
