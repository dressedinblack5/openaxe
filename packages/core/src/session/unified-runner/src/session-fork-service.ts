// @ts-nocheck
import { Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionSchema, SessionMessageID } from "@opencode-ai/schema"
import { SessionStore } from "@opencode-ai/core/session/store"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Slug } from "@opencode-ai/core/util/slug"
import { UnifiedRunnerError, SessionForkServiceInterface, SessionForkInput, SessionForkResult } from "./types"
import { SessionTable, MessageTable, PartTable } from "@opencode-ai/core/session/sql"
import { eq, and } from "drizzle-orm"
import { desc } from "drizzle-orm"

/**
 * SessionForkService - Shared fork service in core
 * Handles DB clone, SessionInput chain, EventV2 Forked event
 */
export const layer = Layer.effect(
  SessionForkServiceInterface,
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const events = yield* EventV2.Service
    const store = yield* SessionStore.Service

    const fork = Effect.fn("SessionForkService.fork")(function* (input: SessionForkInput): Effect.Effect<SessionForkResult, UnifiedRunnerError> {
      const parent = yield* store.get(input.parentSessionID)
      if (!parent) {
        return yield* new UnifiedRunnerError({
          sessionID: input.parentSessionID,
          message: `Parent session not found: ${input.parentSessionID}`,
        })
      }

      // Create new session ID
      const sessionID = SessionSchema.ID.make(`ses_${crypto.randomUUID().replace(/-/g, "")}`)
      const messageID = input.messageID ?? SessionMessageID.descending()

      // Clone session record
      const newSession = {
        id: sessionID,
        project_id: parent.projectID,
        workspace_id: parent.workspaceID,
        parent_id: input.parentSessionID,
        slug: Slug.create(),
        directory: parent.directory,
        path: parent.path,
        title: `${parent.title} (fork)`,
        agent: parent.agent,
        model: parent.model ? JSON.stringify(parent.model) : null,
        version: InstallationVersion,
        metadata: parent.metadata ? JSON.stringify(parent.metadata) : null,
        permission: parent.permission ? JSON.stringify(parent.permission) : null,
        time_created: Date.now(),
        time_updated: Date.now(),
        time_compacting: null,
        time_archived: null,
        cost: 0,
        tokens_input: 0,
        tokens_output: 0,
        tokens_reasoning: 0,
        tokens_cache_read: 0,
        tokens_cache_write: 0,
        share_url: null,
        summary_additions: null,
        summary_deletions: null,
        summary_files: null,
        summary_diffs: null,
        revert: null,
      }

      yield* db.insert(SessionTable).values(newSession).pipe(Effect.orDie)

      // Clone messages up to messageID (exclusive for subagents, inclusive for regular forks)
      const messages = yield* db
        .select()
        .from(MessageTable)
        .where(
          and(
            eq(MessageTable.session_id, input.parentSessionID),
            input.subagent ? MessageTable.id < messageID : MessageTable.id <= messageID,
          ),
        )
        .orderBy(desc(MessageTable.time_created))
        .all()
        .pipe(Effect.orDie)

      const idMap = new Map<string, string>()
      for (const msg of messages.reverse()) {
        const newMsgID = SessionMessageID.ascending()
        idMap.set(msg.id, newMsgID)

        const parentID = msg.role === "assistant" && msg.parent_id ? idMap.get(msg.parent_id) : undefined

        yield* db
          .insert(MessageTable)
          .values({
            id: newMsgID,
            session_id: sessionID,
            role: msg.role,
            parent_id: parentID,
            time_created: msg.time_created,
            time_updated: msg.time_updated,
            metadata: msg.metadata,
            cost: msg.cost,
            tokens_input: msg.tokens_input,
            tokens_output: msg.tokens_output,
            tokens_reasoning: msg.tokens_reasoning,
            tokens_cache_read: msg.tokens_cache_read,
            tokens_cache_write: msg.tokens_cache_write,
          })
          .pipe(Effect.orDie)

        // Clone parts
        const parts = yield* db
          .select()
          .from(PartTable)
          .where(
            and(
              eq(PartTable.session_id, input.parentSessionID),
              eq(PartTable.message_id, msg.id),
            ),
          )
          .all()
          .pipe(Effect.orDie)

        for (const part of parts) {
          const newPartID = SessionMessageID.ascending() // PartID uses same generator
          let partData = part.data

          // Update tail_start_id for compaction parts
          if (partData.type === "compaction" && partData.tail_start_id) {
            partData = { ...partData, tail_start_id: idMap.get(partData.tail_start_id) }
          }

          yield* db
            .insert(PartTable)
            .values({
              id: newPartID,
              session_id: sessionID,
              message_id: newMsgID,
              data: partData,
            })
            .pipe(Effect.orDie)
        }
      }

      // Emit fork event
      yield* events.publish(SessionEvent.Prompted, {
        type: "session.next.prompted",
        sessionID: sessionID,
        timestamp: Date.now(),
        messageID: idMap.get(messageID) ?? SessionMessageID.ascending(),
        prompt: { text: "Forked session", files: [] },
        delivery: "steer",
      })

      // Return result
      return { sessionID, subagent: input.subagent }
    })

    return { fork }
  }),
)

export const defaultLayer = layer

export * as SessionForkService from "./session-fork-service"