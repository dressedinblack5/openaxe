import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

export const RevertInput = Schema.Struct({
  count: Schema.Number,
}).annotate({ identifier: "RevertInput" })

export const RevertOutput = Schema.Struct({
  reverted: Schema.Number,
}).annotate({ identifier: "RevertOutput" })

export const RevertGroup = HttpApiGroup.make("server.revert").add(
  HttpApiEndpoint.post("revert.undo", "/api/revert", {
    payload: RevertInput,
    success: RevertOutput,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.revert.undo",
      summary: "Revert last AI file changes",
      description: "Revert the last N file mutations recorded by the revert module.",
    }),
  ),
)
