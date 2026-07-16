import { Effect } from "effect"
import { FileSystem } from "../filesystem"
import { DecodeError, SizeError } from "../image"

export const make = Effect.gen(function* () {
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
    const bytes = Buffer.byteLength(content.content, "utf-8")
    // ponytail: @silvia-odwyer/photon-node (1.8MB WASM) removed.
    // Pixel decode + resize skipped. Dimension limits not checked;
    // only base64 byte length is compared against budget.
    if (bytes <= limits.maxBase64Bytes || limits.autoResize) return content
    return yield* new SizeError({
      resource,
      width: 0,
      height: 0,
      bytes,
      maxWidth: limits.maxWidth,
      maxHeight: limits.maxHeight,
      maxBytes: limits.maxBase64Bytes,
    })
  })
})
