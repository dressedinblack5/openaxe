import { afterEach, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq, sql as drizzleSql } from "drizzle-orm"
import fs from "node:fs"
import path from "node:path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Session as SessionNs } from "@/session/session"
import { ForkMerge } from "@/session/fork-merge"
import { MessageID, PartID } from "../../src/session/schema"
import { InstanceState } from "@/effect/instance-state"
import { EmbedBackfill } from "@/session/embed-backfill"
import { SessionTable, SessionMessageTable } from "@opencode-ai/core/session/sql"
import { RetryPolicyOverridesTable } from "@opencode-ai/core/session/retry-policy.sql"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Prompt } from "@opencode-ai/core/session/prompt"
import { SessionV2 } from "@opencode-ai/core/session"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Vector } from "@opencode-ai/core/vector/vector"
import { Embedding } from "@opencode-ai/core/embedding/embedding"
import { ConfigEmbedding } from "@opencode-ai/core/config/embedding"
import { Reflection } from "@opencode-ai/core/reflection/reflection"
import { KB } from "@opencode-ai/core/kb/kb-builder"
import { SkillGenerator } from "@opencode-ai/core/generator/skill-generator"
import { Scheduler } from "@opencode-ai/core/scheduler/scheduler"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import * as DateTime from "effect/DateTime"

// 768 dims matches VectorService's default dimension (nomic-embed-text) — the
// fake embedding must agree or dimension validation rejects inserts.
const DIMS = 768
const bagOfWords = (text: string): number[] => {
  const dims = Array.from({ length: DIMS }, () => 0)
  for (const ch of text.toLowerCase()) {
    if (ch >= "a" && ch <= "z") dims[ch.charCodeAt(0) - 97] += 1
  }
  return dims
}

const fakeEmbedding = Layer.succeed(
  Embedding.Service,
  Embedding.Service.of({
    provider: { model: "fake", dimension: DIMS, embed: () => Effect.never },
    embed: (texts) =>
      Effect.sync(() => ({ vectors: [...texts].map((text) => bagOfWords(text)), dimension: DIMS, model: "fake" })),
  }),
)

// Embedding/Vector are intentionally NOT in the base layer: forkEmbedding no-ops
// without them, so seeded messages stay vector-less until `embed backfill` runs.
const vecLayers = Layer.mergeAll(
  fakeEmbedding,
  Vector.layer.pipe(Layer.provide(Layer.succeed(ConfigEmbedding.ConfigService, ConfigEmbedding.ConfigService.of({})))),
)

const it = testEffect(
  Layer.mergeAll(
    Database.defaultLayer,
    FSUtil.defaultLayer,
    SessionNs.defaultLayer,
    SessionV2.defaultLayer,
    EventV2.defaultLayer,
    Reflection.layer.pipe(Layer.provide(Database.defaultLayer)),
    KB.layer.pipe(Layer.provide(Database.defaultLayer), Layer.provide(FSUtil.defaultLayer)),
    SkillGenerator.layer.pipe(Layer.provide(Database.defaultLayer)),
    Scheduler.layer.pipe(Layer.provide(Database.defaultLayer), Layer.provide(SessionExecution.noopLayer)),
  ),
)

const model = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test"),
}
const stepModel = {
  id: ModelV2.ID.make("test-model"),
  providerID: ProviderV2.ID.make("test"),
  variant: ModelV2.VariantID.make("default"),
}
const toolProvider = { executed: false }

const timestamp = (t: number) => DateTime.makeUnsafe(t)

afterEach(async () => {
  await disposeAllInstances()
})

// V1 messages (the fork/merge transcript) plus V2 durable session_message rows
// (the rows search/reflection/skill-gen/KB consume).
const publishUser = (sessionID: string, messageID: string, text: string, t: number) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    yield* events.publish(SessionEvent.Prompted, {
      sessionID: SessionV2.ID.make(sessionID),
      messageID: SessionMessage.ID.make(messageID),
      timestamp: timestamp(t),
      prompt: Prompt.make({ text }),
      delivery: "steer",
    })
  })

const publishAssistantTurn = (sessionID: string, assistantID: string, tool: { callID: string; name: string; input: Record<string, unknown>; failed?: { error: SessionMessage.UnknownError } }, t: number) =>
  Effect.gen(function* () {
    const events = yield* EventV2.Service
    const sid = SessionV2.ID.make(sessionID)
    const mid = SessionMessage.ID.make(assistantID)
    yield* events.publish(SessionEvent.Step.Started, {
      sessionID: sid,
      assistantMessageID: mid,
      timestamp: timestamp(t),
      agent: "build",
      model: stepModel,
    })
    yield* events.publish(SessionEvent.Tool.Input.Started, {
      sessionID: sid,
      assistantMessageID: mid,
      callID: tool.callID,
      timestamp: timestamp(t + 1),
      name: tool.name,
    })
    yield* events.publish(SessionEvent.Tool.Called, {
      sessionID: sid,
      assistantMessageID: mid,
      callID: tool.callID,
      timestamp: timestamp(t + 1),
      tool: tool.name,
      input: tool.input,
      provider: toolProvider,
    })
    if (tool.failed) {
      yield* events.publish(SessionEvent.Tool.Failed, {
        sessionID: sid,
        assistantMessageID: mid,
        callID: tool.callID,
        timestamp: timestamp(t + 2),
        error: tool.failed.error,
        provider: toolProvider,
      })
    } else {
      yield* events.publish(SessionEvent.Tool.Success, {
        sessionID: sid,
        assistantMessageID: mid,
        callID: tool.callID,
        timestamp: timestamp(t + 2),
        structured: {},
        content: [],
        result: { text: "ok" },
        provider: toolProvider,
      })
    }
    yield* events.publish(SessionEvent.Step.Ended, {
      sessionID: sid,
      assistantMessageID: mid,
      timestamp: timestamp(t + 3),
      finish: "stop",
      cost: 0,
      tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
    })
  })

const fillV1 = (sessionID: string, count: number) =>
  Effect.gen(function* () {
    const session = yield* SessionNs.Service
    const ids: MessageID[] = []
    for (let i = 0; i < count; i++) {
      const id = MessageID.ascending()
      ids.push(id)
      yield* session.updateMessage({
        id,
        sessionID: SessionV2.ID.make(sessionID),
        role: "user",
        time: { created: Date.now() + i },
        agent: "test",
        model,
        tools: {},
      } satisfies SessionV1.User)
      yield* session.updatePart({
        id: PartID.ascending(),
        sessionID: SessionV2.ID.make(sessionID),
        messageID: id,
        type: "text",
        text: `m${i}`,
      } satisfies SessionV1.TextPart)
    }
    return ids
  })

const texts = (msgs: SessionV1.WithParts[]) =>
  msgs.flatMap((m) => m.parts.filter((p): p is SessionV1.TextPart => p.type === "text").map((p) => p.text))

it.instance("core-intelligence E2E: session -> messages -> fork -> merge -> backfill -> search -> schedule -> reflect -> skill -> KB", () =>
  Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    const session = yield* SessionNs.Service
    const db = (yield* Database.Service).db

    // 1. create session
    const created = yield* session.create({ title: "refactor the render loop architecture" })
    const sessionID = created.id
    expect(created.title).toBe("refactor the render loop architecture")

    // 2. send messages: V1 transcript for fork/merge + V2 durable rows for the rest
    const ids = yield* fillV1(sessionID, 5)
    const userTexts = [
      "zzqqxx search target discussion",
      "how does the module layout work",
      "we should decide whether to switch to lazy loading",
      "the build fails with a crash exception, tracking the bug",
      "pattern: always run tests before committing",
    ]
    for (let i = 0; i < userTexts.length; i++) {
      yield* publishUser(sessionID, `msg_user_${i}`, userTexts[i]!, i * 10)
    }
    // 5 assistant turns: 3 bash successes + 2 rate_limit failures (reflection
    // sees 2/5 = 40% >= 30% -> override; skill-gen sees bash x5 >= 3 -> skill)
    for (let i = 0; i < 5; i++) {
      yield* publishAssistantTurn(
        sessionID,
        `msg_asst_${i}`,
        {
          callID: `call_${i}`,
          name: "bash",
          input: { command: `echo turn ${i}` },
          ...(i >= 3 ? { failed: { error: { type: "unknown", message: "rate limit exceeded" } } } : {}),
        },
        100 + i * 10,
      )
    }

    // 3. fork at message 3 of 5
    const forkAt = ids[2]!
    const forked = yield* ForkMerge.fork({ sessionID: SessionV2.ID.make(sessionID), atMessage: forkAt, name: "branch" })
    const sessionRow = yield* db.select().from(SessionTable).where(eq(SessionTable.id, forked.id)).get()
    expect(sessionRow?.parent_id).toBe(sessionID)
    expect(sessionRow?.fork_point_message_id).toBe(forkAt)
    const childMsgs = yield* session.messages({ sessionID: forked.id })
    expect(childMsgs.length).toBe(3)

    // 4. diverge the fork (edit the m2 copy) and merge back -> conflict marker
    const m2Copy = (yield* session.messages({ sessionID: forked.id }))[0]!
    const textPart = m2Copy.parts.find((p) => p.type === "text")
    expect(textPart?.type).toBe("text")
    if (textPart?.type === "text") {
      yield* session.updatePart({ ...textPart, text: "m2 diverged in fork" })
    }
    const merged = yield* ForkMerge.merge({
      sourceSessionID: forked.id,
      targetSessionID: SessionV2.ID.make(sessionID),
      strategy: "lww",
    })
    expect(merged.conflicts).toBeGreaterThan(0)
    const mergedTexts = texts(yield* session.messages({ sessionID: SessionV2.ID.make(sessionID) })).join("\n")
    expect(mergedTexts).toContain("<<<<<<< SOURCE")

    // 5-6. backfill embeds the V2 user rows (assistant rows skipped), then
    // semantic search finds the zzqqxx message (only message with those letters).
    // Backfill + search share one vec layer scope: Vector's finalizers drop the
    // vec0 tables when the layer scope closes.
    const { backfill, rerun, hits } = yield* Effect.gen(function* () {
      const backfill = yield* EmbedBackfill.run({ batchSize: 2 })
      const rerun = yield* EmbedBackfill.run({ batchSize: 2 })
      const vector = yield* Vector.Service
      const hits = yield* vector.search("session_message", bagOfWords("zzqqxx"), 3, drizzleSql`session_id = ${sessionID}`)
      return { backfill, rerun, hits }
    }).pipe(Effect.provide(vecLayers))
    expect(backfill.embedded).toBe(userTexts.length)
    expect(backfill.skipped).toBe(0)
    // idempotent: a second run embeds nothing more
    expect(rerun.embedded).toBe(0)
    // durable vector blob written so search survives a restart
    const embeddedRow = yield* db
      .select({ vector: SessionMessageTable.vector })
      .from(SessionMessageTable)
      .where(eq(SessionMessageTable.id, SessionMessage.ID.make("msg_user_0")))
      .get()
    expect(embeddedRow?.vector).not.toBeNull()
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.id).toBe("msg_user_0")

    // 7. schedule a cron, list it, reject an invalid cron, remove it
    const projectId = (yield* db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())?.project_id
    const scheduler = yield* Scheduler.Service
    yield* scheduler.scheduleSession(SessionV2.ID.make(sessionID), "0 * * * *")
    const schedules = yield* scheduler.list()
    expect(schedules.some((s) => s.sessionID === sessionID && s.cron === "0 * * * *")).toBe(true)
    const invalid = yield* scheduler.scheduleSession(SessionV2.ID.make(sessionID), "not a cron").pipe(Effect.flip)
    expect(invalid._tag).toBe("Scheduler.InvalidCronError")
    yield* scheduler.unschedule(SessionV2.ID.make(sessionID))
    expect((yield* scheduler.list()).length).toBe(0)

    // 8. reflection writes the rate_limit retry policy override
    expect(projectId).toBeDefined()
    if (projectId) {
      yield* Reflection.run(projectId)
      const override = yield* db
        .select()
        .from(RetryPolicyOverridesTable)
        .where(eq(RetryPolicyOverridesTable.retry_reason, "rate_limit"))
        .get()
      expect(override?.max_attempts).toBe(5)
      expect(override?.base_delay_ms).toBe(60_000)
    }

    // 9. skill generation writes .openaxe/skills/auto-bash/SKILL.md
    const generator = yield* SkillGenerator.Service
    const drafts = yield* generator.analyzeSession(sessionID)
    expect(drafts.some((d) => d.name === "auto-bash")).toBe(true)
    const skillFile = path.join(ctx.directory, ".openaxe", "skills", "auto-bash", "SKILL.md")
    expect(fs.existsSync(skillFile)).toBe(true)

    // 10. KB build writes the 4 .openaxe/kb files
    if (projectId) {
      yield* KB.run(projectId)
      for (const file of KB.KB_FILES) {
        const kbPath = path.join(ctx.directory, ".openaxe", "kb", `${file}.md`)
        expect(fs.existsSync(kbPath)).toBe(true)
        const content = fs.readFileSync(kbPath, "utf8")
        expect(content).toContain(KB.USER_START)
      }
    }
  }),
  { git: true },
)
