import { Effect } from "effect"
import { FileSystem } from "../filesystem"
import { DecodeError, ResizerUnavailableError, SizeError } from "../image"

export const make = Effect.gen(function* () {
  const loadPhoton = yield* Effect.cached(
    Effect.tryPromise({
      try: () => import("@silvia-odwyer/photon-node") as Promise<typeof import("@silvia-odwyer/photon-node")>,
      catch: () => new ResizerUnavailableError(),
    }),
  )

  return Effect.fn("Image.Photon.normalize")(function* (
    resource: string,
    content: FileSystem.Content & { readonly encoding: "base64" },
    limits: {
      readonly autoResize: boolean
      readonly maxWidth: number
      readonly maxHeight: number
      readonly maxBase64Bytes: number
    },
  ) {
    const photon = yield* loadPhoton

    let img: InstanceType<typeof photon.PhotonImage>
    try {
      img = photon.PhotonImage.new_from_base64(content.content)
    } catch {
      return yield* new DecodeError({ resource })
    }

    const width = img.get_width()
    const height = img.get_height()

    // Reject images that decoded with zero dimensions (truncated/corrupt data)
    if (width <= 0 || height <= 0) {
      img.free()
      return yield* new DecodeError({ resource })
    }

    const bytes = Buffer.byteLength(content.content, "utf-8")

    // Check if image exceeds dimension limits
    const exceedsDimension = width > limits.maxWidth || height > limits.maxHeight

    if (!limits.autoResize && exceedsDimension) {
      img.free()
      return yield* new SizeError({ resource, width, height, bytes, maxWidth: limits.maxWidth, maxHeight: limits.maxHeight, maxBytes: limits.maxBase64Bytes })
    }

    if (limits.autoResize && exceedsDimension) {
      const scale = Math.min(limits.maxWidth / width, limits.maxHeight / height)
      const newWidth = Math.max(1, Math.round(width * scale))
      const newHeight = Math.max(1, Math.round(height * scale))
      const resized = photon.resize(img, newWidth, newHeight, photon.SamplingFilter.Lanczos3)
      img.free()
      img = resized

      const raw = img.get_bytes()
      img.free()
      const resultBytes = raw.byteLength
      const b64 = Buffer.from(raw).toString("base64")

      if (resultBytes > limits.maxBase64Bytes) {
        const oversized = photon.PhotonImage.new_from_byteslice(raw)
        const fw = oversized.get_width()
        const fh = oversized.get_height()
        oversized.free()
        return yield* new SizeError({ resource, width: fw, height: fh, bytes: resultBytes, maxWidth: limits.maxWidth, maxHeight: limits.maxHeight, maxBytes: limits.maxBase64Bytes })
      }

      return { ...content, content: Buffer.from(raw).toString("base64") }
    }

    img.free()

    // No resize needed — check base64 byte budget only
    if (bytes > limits.maxBase64Bytes) {
      return yield* new SizeError({ resource, width, height, bytes, maxWidth: limits.maxWidth, maxHeight: limits.maxHeight, maxBytes: limits.maxBase64Bytes })
    }

    return content
  })
})
