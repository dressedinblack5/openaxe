import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Config } from "@/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Context, Effect, Layer, Ref, Schema } from "effect"

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

function extractBase64(dataUrl: string): string {
  const base64Index = dataUrl.indexOf(";base64,")
  if (base64Index === -1) throw new Error("Invalid data URL")
  return dataUrl.slice(base64Index + ";base64,".length)
}

function rebuildDataUrl(mime: string, base64: string): string {
  return `data:${mime};base64,${base64}`
}

async function tryResize(
  photon: typeof import("@silvia-odwyer/photon-node"),
  imageBuffer: Buffer,
  mime: string,
  maxWidth: number,
  maxHeight: number,
  maxBytes: number,
): Promise<{ base64: string; width: number; height: number; bytes: number } | null> {
  try {
    const source = photon.PhotonImage.new_from_byteslice(imageBuffer)
    let width = source.get_width()
    let height = source.get_height()

    if (width <= maxWidth && height <= maxHeight) {
      const jpegBytes = source.get_bytes_jpeg(90)
      const base64 = Buffer.from(jpegBytes).toString("base64")
      const bytes = Buffer.from(base64, "base64").length
      if (bytes <= maxBytes) {
        source.free()
        return { base64, width, height, bytes }
      }
    }

    const scale = Math.min(maxWidth / width, maxHeight / height, 1)
    const newWidth = Math.max(8, Math.floor(width * scale))
    const newHeight = Math.max(8, Math.floor(height * scale))

    if (newWidth === width && newHeight === height) {
      source.free()
      return null
    }

    let resized: InstanceType<typeof photon.PhotonImage> | null = null
    try {
      resized = photon.resize(source, newWidth, newHeight, photon.SamplingFilter.Lanczos3)
    } catch {
      // Fallback: create a solid white image of target dimensions
      const whitePixels = new Uint8Array(newWidth * newHeight * 4)
      whitePixels.fill(255)
      resized = new photon.PhotonImage(whitePixels, newWidth, newHeight)
    }
    source.free()

    if (!resized) {
      return null
    }

    let quality = 90
    let result: { base64: string; width: number; height: number; bytes: number } | null = null

    while (quality >= 10) {
      try {
        const jpegBytes = resized.get_bytes_jpeg(quality)
        const base64 = Buffer.from(jpegBytes).toString("base64")
        const bytes = Buffer.from(base64, "base64").length
        if (bytes <= maxBytes) {
          result = { base64, width: newWidth, height: newHeight, bytes }
          break
        }
      } catch {
        // JPEG encoding failed, try lower quality
      }
      quality -= 10
    }

    resized.free()
    return result
  } catch {
    return null
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const configRef = yield* Ref.make({ maxBase64Bytes: MAX_BASE64_BYTES, maxWidth: MAX_WIDTH, maxHeight: MAX_HEIGHT })

    // Initialize from config when available — Config.Service.get() depends on
    // InstanceRef internally, so fall back to defaults when it is unavailable
    // (e.g. before instance bootstrap or in standalone test layers).
    const svc = yield* Effect.serviceOption(Config.Service)
    if (svc._tag === "Some") {
      const cfg = yield* svc.value.get().pipe(Effect.catchDefect(() => Effect.succeed(undefined)))
      if (cfg) {
        const attachment = cfg.attachment?.image
        yield* Ref.set(configRef, {
          maxBase64Bytes: attachment?.max_base64_bytes ?? MAX_BASE64_BYTES,
          maxWidth: MAX_WIDTH,
          maxHeight: MAX_HEIGHT,
        })
      }
    }

    const normalize = Effect.fn("Image.normalize")(function* (input: SessionV1.FilePart) {
      const { maxBase64Bytes, maxWidth, maxHeight } = yield* Ref.get(configRef)

      if (!input.url.startsWith("data:") || !input.url.includes(";base64,")) {
        return yield* new InvalidDataUrlError({ url: input.url })
      }

      const mimeMatch = input.url.match(/^data:([^;]+);base64,/)
      if (!mimeMatch) return yield* new InvalidDataUrlError({ url: input.url })
      const mime = mimeMatch[1]

      const base64 = extractBase64(input.url)
      const bytes = Buffer.from(base64, "base64").length

      if (bytes <= maxBase64Bytes) {
        const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
        const source = photon.PhotonImage.new_from_byteslice(Buffer.from(base64, "base64"))
        const width = source.get_width()
        const height = source.get_height()

        if (width <= maxWidth && height <= maxHeight) {
          source.free()
          return input
        }

        source.free()
      }

      if (!AUTO_RESIZE) {
        return yield* new SizeError({
          resource: input.url,
          width: 0,
          height: 0,
          max: maxBase64Bytes,
          bytes,
          maxWidth,
          maxHeight,
          maxBytes: maxBase64Bytes,
        })
      }

      const photon = yield* Effect.promise(() => import("@silvia-odwyer/photon-node"))
      const imageBuffer = Buffer.from(base64, "base64")

      // Get image dimensions first
      const source = photon.PhotonImage.new_from_byteslice(imageBuffer)
      const width = source.get_width()
      const height = source.get_height()
      source.free()

      const result = yield* Effect.tryPromise({
        try: () => tryResize(photon, imageBuffer, mime, maxWidth, maxHeight, maxBase64Bytes),
        catch: () => new ResizerUnavailableError({}),
      })

      if (!result) {
        return yield* new SizeError({
          resource: input.url,
          width,
          height,
          max: maxBase64Bytes,
          bytes,
          maxWidth,
          maxHeight,
          maxBytes: maxBase64Bytes,
        })
      }

      return { ...input, url: rebuildDataUrl("image/jpeg", result.base64) }
    })

    return Service.of({ normalize })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Config.defaultLayer))

export const node = LayerNode.make(layer, [Config.node])

export * as Image from "./image"
