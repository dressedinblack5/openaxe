export * as SessionCompactionEvent from "./session-compaction-event"

import { Event } from "./event"
import { SessionID } from "./session-id"
import { Schema } from "effect"

export const Compacted = Event.define({
  type: "session.compacted",
  schema: {
    sessionID: SessionID,
    source: Schema.Literals(["checkpoint", "fresh"]).pipe(Schema.optional),
    timestamp: Schema.Number.pipe(Schema.optional),
    tokensBefore: Schema.Number.pipe(Schema.optional),
    tokensAfter: Schema.Number.pipe(Schema.optional),
    summary: Schema.String.pipe(Schema.optional),
    transcriptPath: Schema.String.pipe(Schema.optional),
  },
})

export const Definitions = Event.inventory(Compacted)
