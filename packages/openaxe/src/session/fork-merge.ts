// Step-level session fork + merge.
//
// `fork` branches a session at any message: the new child session is created with
// `parent_id` + `fork_point_message_id` set and receives copies of the messages
// from the fork point onward (the parent is never modified).
//
// `merge` folds a source session into a target session. Overlap between the two
// is anchored on `fork_point_message_id`: the session that carries the pointer
// (the fork) starts its region at message 0, the other session's region starts at
// the pointer's position. Positionally-paired messages that differ are conflicts;
// last-write-wins keeps the target's own message in place and appends a marker
// block showing both versions below it. Source messages beyond the overlap are
// appended cleanly. Messages before the fork point are never touched.
//
// Messages are written through `Session.updateMessage`/`updatePart` (the same
// event-projector path the existing fork uses) so the result is visible in the
// CLI/TUI transcript (V1 message/part tables).

export * as ForkMerge from "./fork-merge"

import { Effect, Schema } from "effect"
import { eq } from "drizzle-orm"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Session } from "./session"
import { SessionID, MessageID, PartID } from "./schema"

export class ForkMergeError extends Schema.TaggedErrorClass<ForkMergeError>()("ForkMergeError", {
  message: Schema.String,
}) {}

export type MergeStrategy = "lww" | "3way"

export type ForkResult = Session.Info & { readonly copied: number }

export type MergeResult = {
  readonly sourceSessionID: SessionID
  readonly targetSessionID: SessionID
  /** Positionally-overlapping messages whose content differs. */
  readonly conflicts: number
  /** Source messages appended to the target (source's unique post-fork messages). */
  readonly appended: number
  /** Overlapping messages that were identical and skipped. */
  readonly identical: number
}

const catchNotFound = (id: SessionID) =>
  Effect.mapError(() => new ForkMergeError({ message: `Session not found: ${id}` }))

// Rendered content of a message: its text parts joined, falling back to a JSON of
// the parts for tool/step-only messages. Used for conflict detection and markers.
const contentOf = (msg: SessionV1.WithParts): string => {
  const texts = msg.parts.filter((p): p is SessionV1.TextPart => p.type === "text").map((p) => p.text)
  return texts.length > 0 ? texts.join("\n") : JSON.stringify(msg.parts)
}

const conflictBlock = (sourceText: string, targetText: string) =>
  `<<<<<<< SOURCE\n${sourceText}\n=======\n${targetText}\n>>>>>>> TARGET`

// Copies a message (with new ids) into another session via the event projector.
// Assistant parentIDs pointing inside the copied range are remapped; references to
// messages outside it (e.g. before the fork point) are kept as-is.
const copyMessage = (
  session: Session.Interface,
  msg: SessionV1.WithParts,
  sessionID: SessionID,
  idMap: Map<string, MessageID>,
) =>
  Effect.gen(function* () {
    const newID = MessageID.ascending()
    idMap.set(msg.info.id, newID)
    const parentID =
      msg.info.role === "assistant" && msg.info.parentID
        ? (idMap.get(msg.info.parentID) ?? msg.info.parentID)
        : undefined
    yield* session.updateMessage({
      ...msg.info,
      sessionID,
      id: newID,
      ...(parentID ? { parentID } : {}),
    })
    for (const part of msg.parts) {
      const p: SessionV1.Part = { ...part, id: PartID.ascending(), messageID: newID, sessionID }
      if (p.type === "compaction" && p.tail_start_id) {
        p.tail_start_id = idMap.get(p.tail_start_id) ?? p.tail_start_id
      }
      yield* session.updatePart(p)
    }
  })

const setForkPointMessageID = (sessionID: SessionID, messageID: MessageID) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .update(SessionTable)
      .set({ fork_point_message_id: messageID })
      .where(eq(SessionTable.id, sessionID))
      .run()
      .pipe(Effect.orDie)
  })

// The first user message's agent/model, reused for synthetic conflict messages
// (user messages in the V1 schema require both). Falls back to generic values.
const firstUserAgentModel = (msgs: ReadonlyArray<SessionV1.WithParts>) => {
  for (const msg of msgs) {
    if (msg.info.role === "user") return { agent: msg.info.agent, model: msg.info.model }
  }
  return undefined
}

// Appends a synthetic user message carrying a conflict marker block. Last-write-
// wins: the target's own message stays untouched; the marker documents the source
// version the user would have lost.
const appendConflictMessage = (
  session: Session.Interface,
  targetSessionID: SessionID,
  source: SessionV1.WithParts,
  target: SessionV1.WithParts,
  agentModel: { agent: string; model: SessionV1.User["model"] } | undefined,
) =>
  Effect.gen(function* () {
    const id = MessageID.ascending()
    yield* session.updateMessage({
      id,
      sessionID: targetSessionID,
      role: "user",
      time: { created: Date.now() },
      agent: agentModel?.agent ?? "openaxe",
      model: agentModel?.model ?? { providerID: ProviderV2.ID.make("openaxe"), modelID: ModelV2.ID.make("openaxe") },
    } satisfies SessionV1.User)
    yield* session.updatePart({
      id: PartID.ascending(),
      messageID: id,
      sessionID: targetSessionID,
      type: "text",
      text: conflictBlock(contentOf(source), contentOf(target)),
      synthetic: true,
    } satisfies SessionV1.TextPart)
  })

/**
 * Fork `sessionID` at `atMessage`. Creates a new child session (parent_id +
 * fork_point_message_id set) containing copies of the messages from the fork
 * point onward. Fails with a typed error if the message does not exist.
 */
export const fork = (input: {
  sessionID: SessionID
  atMessage: MessageID
  name?: string
}): Effect.Effect<ForkResult, ForkMergeError, Session.Service | Database.Service> =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    yield* session.get(input.sessionID).pipe(catchNotFound(input.sessionID))
    const msgs = yield* session.messages({ sessionID: input.sessionID }).pipe(catchNotFound(input.sessionID))
    const at = msgs.findIndex((m) => m.info.id === input.atMessage)
    if (at === -1)
      return yield* new ForkMergeError({
        message: `Message not found: ${input.atMessage} in session ${input.sessionID}`,
      })

    const created = yield* session.create({
      parentID: input.sessionID,
      ...(input.name ? { title: input.name } : {}),
    })
    yield* setForkPointMessageID(created.id, input.atMessage)

    const idMap = new Map<string, MessageID>()
    for (const msg of msgs.slice(at)) {
      yield* copyMessage(session, msg, created.id, idMap)
    }
    return { ...created, copied: msgs.length - at } satisfies ForkResult
  })

/**
 * Merge `sourceSessionID` into `targetSessionID`. Overlapping ranges produce
 * conflict marker messages (target version kept); non-overlapping source
 * messages are appended cleanly. Messages before the fork point in either
 * session are never modified.
 */
export const merge = (input: { sourceSessionID: SessionID; targetSessionID: SessionID; strategy?: MergeStrategy }) =>
  Effect.gen(function* () {
    // ponytail: only last-write-wins is implemented; "3way" is an accepted alias.
    const session = yield* Session.Service
    yield* session.get(input.sourceSessionID).pipe(catchNotFound(input.sourceSessionID))
    yield* session.get(input.targetSessionID).pipe(catchNotFound(input.targetSessionID))
    const [srcMsgs, tgtMsgs] = yield* Effect.all([
      session.messages({ sessionID: input.sourceSessionID }).pipe(catchNotFound(input.sourceSessionID)),
      session.messages({ sessionID: input.targetSessionID }).pipe(catchNotFound(input.targetSessionID)),
    ])

    const { db } = yield* Database.Service
    const [srcRow, tgtRow] = yield* Effect.all([
      db.select().from(SessionTable).where(eq(SessionTable.id, input.sourceSessionID)).get().pipe(Effect.orDie),
      db.select().from(SessionTable).where(eq(SessionTable.id, input.targetSessionID)).get().pipe(Effect.orDie),
    ])
    const srcFp = srcRow?.fork_point_message_id ?? undefined
    const tgtFp = tgtRow?.fork_point_message_id ?? undefined

    // The fork point id anchors the divergence. The session that carries the
    // pointer (its own fork) starts its region at message 0; the other session's
    // region starts at the pointer's position. Without a fork point the sessions
    // are unrelated: no conflict comparison, everything appends cleanly.
    let srcStart = 0
    let tgtStart = 0
    if (tgtFp) {
      tgtStart = 0
      const at = srcMsgs.findIndex((m) => m.info.id === tgtFp)
      srcStart = at === -1 ? srcMsgs.length : at
    } else if (srcFp) {
      srcStart = 0
      const at = tgtMsgs.findIndex((m) => m.info.id === srcFp)
      tgtStart = at === -1 ? tgtMsgs.length : at
    }

    const overlap = Math.min(srcMsgs.length - srcStart, tgtMsgs.length - tgtStart)
    let conflicts = 0
    let identical = 0
    const agentModel = firstUserAgentModel([...srcMsgs, ...tgtMsgs])
    for (let i = 0; i < overlap; i++) {
      const source = srcMsgs[srcStart + i]!
      const target = tgtMsgs[tgtStart + i]!
      if (contentOf(source) === contentOf(target)) {
        identical++
        continue
      }
      conflicts++
      yield* appendConflictMessage(session, input.targetSessionID, source, target, agentModel)
    }

    const idMap = new Map<string, MessageID>()
    let appended = 0
    for (let i = srcStart + overlap; i < srcMsgs.length; i++) {
      yield* copyMessage(session, srcMsgs[i]!, input.targetSessionID, idMap)
      appended++
    }

    return {
      sourceSessionID: input.sourceSessionID,
      targetSessionID: input.targetSessionID,
      conflicts,
      appended,
      identical,
    } satisfies MergeResult
  })
