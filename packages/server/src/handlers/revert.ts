import { Revert } from "@opencode-ai/core/revert"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { InvalidRequestError } from "../errors"

export const RevertHandler = HttpApiBuilder.group(Api, "server.revert", (handlers) =>
  Effect.gen(function* () {
    return handlers.handle("revert.undo", (ctx) =>
      Effect.gen(function* () {
        const reverted = yield* Revert.revert(ctx.payload.count).pipe(
          Effect.catchTag("PlatformError", (err) =>
            Effect.fail(new InvalidRequestError({ message: `Revert failed: ${err.message}` })),
          ),
        )
        return { reverted } as const
      }),
    )
  }),
)
