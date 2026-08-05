import { afterEach, describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session as SessionNs } from "@/session/session"
import { ForkMerge } from "@/session/fork-merge"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(Database.defaultLayer, SessionNs.defaultLayer))

const model = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test"),
}

afterEach(async () => {
  await disposeAllInstances()
})

// Seeds `count` user messages ("m0".."mN") into a session through the same
// event-projector path the CLI transcript uses. Returns their ids in order.
const fill = Effect.fn("ForkMergeTest.fill")(function* (sessionID: SessionID, count: number) {
  const session = yield* SessionNs.Service
  const ids: MessageID[] = []
  for (let i = 0; i < count; i++) {
    const id = MessageID.ascending()
    ids.push(id)
    yield* session.updateMessage({
      id,
      sessionID,
      role: "user",
      time: { created: Date.now() + i },
      agent: "test",
      model,
      tools: {},
    } satisfies SessionV1.User)
    yield* session.updatePart({
      id: PartID.ascending(),
      sessionID,
      messageID: id,
      type: "text",
      text: `m${i}`,
    } satisfies SessionV1.TextPart)
  }
  return ids
})

const sessionScoped = Effect.acquireRelease(SessionNs.use.create({}), (session) =>
  SessionNs.use.remove(session.id).pipe(Effect.ignore),
)

const texts = (msgs: SessionV1.WithParts[]) =>
  msgs.flatMap((m) => m.parts.filter((p): p is SessionV1.TextPart => p.type === "text").map((p) => p.text))

describe("session fork", () => {
  it.instance(
    "forks at message 5 of 10: child has messages 5-10 + parentID + fork_point_message_id",
    () =>
      Effect.gen(function* () {
        const source = yield* sessionScoped
        const ids = yield* fill(source.id, 10)
        const forkAt = ids[4]!

        const forked = yield* ForkMerge.fork({ sessionID: source.id, atMessage: forkAt, name: "branch" })

        expect(forked.parentID).toBe(source.id)
        expect(forked.title).toBe("branch")

        const db = (yield* Database.Service).db
        const row = yield* db.select().from(SessionTable).where(eq(SessionTable.id, forked.id)).get()
        expect(row?.parent_id).toBe(source.id)
        expect(row?.fork_point_message_id).toBe(forkAt)

        const childMsgs = yield* SessionNs.Service.use((s) => s.messages({ sessionID: forked.id }))
        expect(childMsgs.length).toBe(6)
        expect(texts(childMsgs)).toEqual(["m4", "m5", "m6", "m7", "m8", "m9"])

        // the parent is untouched: still 10 messages, original content
        const parentMsgs = yield* SessionNs.Service.use((s) => s.messages({ sessionID: source.id }))
        expect(parentMsgs.length).toBe(10)
        expect(texts(parentMsgs)).toEqual(Array.from({ length: 10 }, (_, i) => `m${i}`))
      }),
    { git: true },
  )

  it.instance(
    "forking at a non-existent message fails with a typed ForkMergeError",
    () =>
      Effect.gen(function* () {
        const source = yield* sessionScoped
        yield* fill(source.id, 3)

        const error = yield* ForkMerge.fork({
          sessionID: source.id,
          atMessage: MessageID.make("msg_does-not-exist"),
        }).pipe(Effect.flip)

        expect(error._tag).toBe("ForkMergeError")
        expect(error.message).toContain("Message not found")
      }),
    { git: true },
  )
})

describe("session merge", () => {
  it.instance(
    "merge back: conflict markers for diverged overlap, clean append for source-unique messages",
    () =>
      Effect.gen(function* () {
        const session = yield* SessionNs.Service
        const source = yield* sessionScoped
        const ids = yield* fill(source.id, 10)
        const forkAt = ids[4]!

        const forked = yield* ForkMerge.fork({ sessionID: source.id, atMessage: forkAt })
        // diverge on the fork: edit the copy of "m5" (fork index 1)
        const forkMsgs = yield* session.messages({ sessionID: forked.id })
        expect(forkMsgs.length).toBe(6)
        const m5Copy = forkMsgs[1]!
        const textPart = m5Copy.parts.find((p): p is SessionV1.TextPart => p.type === "text")!
        yield* session.updatePart({ ...textPart, text: "changed-on-fork" })
        // add a source-unique message to the fork
        const uniqueId = MessageID.ascending()
        yield* session.updateMessage({
          id: uniqueId,
          sessionID: forked.id,
          role: "user",
          time: { created: Date.now() + 100 },
          agent: "test",
          model,
        } satisfies SessionV1.User)
        yield* session.updatePart({
          id: PartID.ascending(),
          sessionID: forked.id,
          messageID: uniqueId,
          type: "text",
          text: "fork-unique",
        } satisfies SessionV1.TextPart)

        const result = yield* ForkMerge.merge({ sourceSessionID: forked.id, targetSessionID: source.id })

        // 6-message overlap: 1 conflict (m5 diverged), 5 identical; 1 unique appended
        expect(result.conflicts).toBe(1)
        expect(result.identical).toBe(5)
        expect(result.appended).toBe(1)

        const targetMsgs = yield* session.messages({ sessionID: source.id })
        // 10 original + 1 conflict marker + 1 appended fork-unique
        expect(targetMsgs.length).toBe(12)

        // conflict marker appended with the standard block
        const conflictMsg = targetMsgs.find((m) =>
          m.parts.some((p) => p.type === "text" && p.text.includes("<<<<<<< SOURCE")),
        )
        expect(conflictMsg).toBeDefined()
        const block = conflictMsg!.parts.find((p): p is SessionV1.TextPart => p.type === "text")!.text
        expect(block).toContain("<<<<<<< SOURCE")
        expect(block).toContain("changed-on-fork")
        expect(block).toContain("m5")
        expect(block).toContain("=======")
        expect(block).toContain(">>>>>>> TARGET")

        // the fork-unique message was appended cleanly
        expect(texts(targetMsgs)).toContain("fork-unique")

        // messages before the fork point were never modified
        expect(texts(targetMsgs.slice(0, 4))).toEqual(["m0", "m1", "m2", "m3"])
      }),
    { git: true },
  )

  it.instance(
    "merge with no divergence: clean, no conflict markers, nothing appended",
    () =>
      Effect.gen(function* () {
        const session = yield* SessionNs.Service
        const source = yield* sessionScoped
        const ids = yield* fill(source.id, 10)
        const forkAt = ids[4]!

        const forked = yield* ForkMerge.fork({ sessionID: source.id, atMessage: forkAt })

        const result = yield* ForkMerge.merge({ sourceSessionID: forked.id, targetSessionID: source.id })

        expect(result.conflicts).toBe(0)
        expect(result.appended).toBe(0)
        expect(result.identical).toBe(6)

        const targetMsgs = yield* session.messages({ sessionID: source.id })
        expect(targetMsgs.length).toBe(10)
        expect(targetMsgs.some((m) => m.parts.some((p) => p.type === "text" && p.text.includes("<<<<<<<")))).toBe(false)
      }),
    { git: true },
  )

  it.instance(
    "merge the original into the fork: source's post-fork messages append, pre-fork skipped",
    () =>
      Effect.gen(function* () {
        const session = yield* SessionNs.Service
        const source = yield* sessionScoped
        const ids = yield* fill(source.id, 10)
        const forkAt = ids[4]!

        const forked = yield* ForkMerge.fork({ sessionID: source.id, atMessage: forkAt })
        // the original continues after the fork
        const extraId = MessageID.ascending()
        yield* session.updateMessage({
          id: extraId,
          sessionID: source.id,
          role: "user",
          time: { created: Date.now() + 100 },
          agent: "test",
          model,
        } satisfies SessionV1.User)
        yield* session.updatePart({
          id: PartID.ascending(),
          sessionID: source.id,
          messageID: extraId,
          type: "text",
          text: "original-new",
        } satisfies SessionV1.TextPart)

        const result = yield* ForkMerge.merge({ sourceSessionID: source.id, targetSessionID: forked.id })

        // 6-message overlap all identical; the original's new message appended
        expect(result.identical).toBe(6)
        expect(result.appended).toBe(1)
        expect(result.conflicts).toBe(0)

        const forkMsgs = yield* session.messages({ sessionID: forked.id })
        expect(forkMsgs.length).toBe(7)
        expect(texts(forkMsgs)).toEqual(["m4", "m5", "m6", "m7", "m8", "m9", "original-new"])
        // pre-fork messages (m0..m3) were NOT appended to the fork
        expect(texts(forkMsgs).includes("m0")).toBe(false)
      }),
    { git: true },
  )
})
