import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { MessageV2 } from "@/session/message-v2"
import { Context, Effect, Layer, Schema } from "effect"

const MAX_BASE64_BYTES = 5 * 1024 * 1024
const MAX_WIDTH = 2000
const MAX_HEIGHT = 2000
const AUTO_RESIZE = true

export class InvalidDataUrlError extends Schema.TaggedErrorClass<InvalidDataUrlError>()("ImageInvalidDataUrlError", {
  url: Schema.String,
}) {
  override get message() {
    return "Image URL must be a base64 data URL"
  }
}

// ponytail: ResizerUnavailableError/SizeError kept as types for backward compat;
// @silvia-odwyer/photon-node removed so these are never actually thrown.
export class ResizerUnavailableError extends Schema.TaggedErrorClass<ResizerUnavailableError>()(
  "Image.ResizerUnavailableError",
  {},
) {}

export class DecodeError extends Schema.TaggedErrorClass<DecodeError>()("Image.DecodeError", {
  resource: Schema.String,
}) {
  override get message() {
    return `Image could not be decoded: ${this.resource}`
  }
}

export class SizeError extends Schema.TaggedErrorClass<SizeError>()("Image.SizeError", {
  resource: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
  max: Schema.Number,
  bytes: Schema.Number,
  maxWidth: Schema.Number,
  maxHeight: Schema.Number,
  maxBytes: Schema.Number,
}) {
  override get message() {
    return `Image ${this.resource} is ${this.width}x${this.height} with base64 size ${this.bytes}, exceeding configured limits ${this.maxWidth}x${this.maxHeight}/${this.maxBytes} bytes`
  }
}

export type Error = InvalidDataUrlError | ResizerUnavailableError | DecodeError | SizeError

export interface Interface {
  readonly normalize: (input: SessionV1.FilePart) => Effect.Effect<SessionV1.FilePart, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Image") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const normalize = Effect.fn("Image.normalize")(function* (input: SessionV1.FilePart) {
      if (!input.url.startsWith("data:") || !input.url.includes(";base64,"))
        return yield* new InvalidDataUrlError({ url: input.url })
      return input
    })

    return Service.of({ normalize })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export const node = LayerNode.make(layer, [Config.node])

export * as Image from "./image"
