import { ConfigErrorV1 } from "@opencode-ai/core/v1/config/error"
import { Cause, Effect } from "effect"
import { HttpRouter, HttpServerError, HttpServerRespondable, HttpServerResponse } from "effect/unstable/http"

function isConfigError(error: unknown): error is { _tag: string; [key: string]: unknown } {
  return typeof error === "object" && error !== null && "_tag" in error
}

function toObject(error: { _tag: string; [key: string]: unknown }): { name: string; data: Record<string, unknown> } {
  const { _tag, ...data } = error
  return { name: _tag, data }
}

// Keep typed HttpApi failures on their declared error path; this boundary only replaces defect-only empty 500s.
export const errorLayer = HttpRouter.middleware<{ handles: unknown }>()((effect) =>
  effect.pipe(
    Effect.catchCause((cause) => {
      const defect = cause.reasons.filter(Cause.isDieReason).find((reason) => {
        if (HttpServerResponse.isHttpServerResponse(reason.defect)) return false
        if (HttpServerError.isHttpServerError(reason.defect)) return false
        if (HttpServerRespondable.isRespondable(reason.defect)) return false
        return true
      })
      if (!defect) return Effect.failCause(cause)

      const error = defect.defect
      if (
        isConfigError(error) &&
        (error._tag === "ConfigJsonError" ||
          error._tag === "ConfigInvalidError" ||
          error._tag === "ConfigFrontmatterError" ||
          error._tag === "ConfigDirectoryTypoError")
      ) {
        return Effect.succeed(HttpServerResponse.jsonUnsafe(toObject(error), { status: 400 }))
      }

      const ref = `err_${crypto.randomUUID().slice(0, 8)}`

      return Effect.logError("failed", { ref, error, cause: Cause.pretty(cause) }).pipe(
        Effect.as(
          HttpServerResponse.jsonUnsafe(
            { name: "UnknownError", data: { message: "Unexpected server error. Check server logs for details.", ref } },
            { status: 500 },
          ),
        ),
      )
    }),
  ),
).layer
