import { describe, expect } from "bun:test"
import { DateTime, Effect, Layer, Schema } from "effect"
import { SessionMessageUpdater } from "@opencode-ai/core/session/message-updater"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { Model } from "@opencode-ai/schema/model"
import { Provider } from "@opencode-ai/schema/provider"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
// ponytail: toTaggedUnion+as any cast — DecodingServices param mismatch is a Schema quirk, runtime works fine
const decodeEvent = (input: unknown): SessionEvent.Event =>
  Schema.decodeUnknownSync(SessionEvent.All as any)(input)

describe("SessionMessageUpdater", () => {
  it.effect("memory() adapter: appendMessage then getCurrentAssistant returns undefined", () =>
    Effect.gen(function* () {
      const state: { messages: SessionMessage.Message[] } = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)

      yield* adapter.appendMessage(
        SessionMessage.User.make({
          id: SessionMessage.ID.make("msg_user_1"),
          type: "user",
          text: "hello",
          time: { created: DateTime.makeUnsafe(0) },
        }),
      )

      expect(yield* adapter.getCurrentAssistant()).toBeUndefined()
      expect(yield* adapter.getAssistant(SessionMessage.ID.make("msg_user_1"))).toBeUndefined()
      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].type).toBe("user")
    }),
  )

  it.effect("session.next.step.started creates an assistant message", () =>
    Effect.gen(function* () {
      const state: { messages: SessionMessage.Message[] } = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)

      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.step.started",
          id: "evt_step_1",
          data: {
            timestamp: 1000,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            agent: "build",
            model: { id: "claude", providerID: "anthropic" },
          },
        }),
      )

      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].type).toBe("assistant")
      if (state.messages[0].type === "assistant") {
        expect(state.messages[0].agent).toBe("build")
        expect(state.messages[0].model).toEqual({ id: Model.ID.make("claude"), providerID: Provider.ID.anthropic })
        expect(state.messages[0].content).toEqual([])
        expect(state.messages[0].time.completed).toBeUndefined()
        expect(DateTime.toEpochMillis(state.messages[0].time.created)).toBe(1000)
      }
    }),
  )

  it.effect("session.next.text.delta accumulates text on an existing text block", () =>
    Effect.gen(function* () {
      const state: { messages: SessionMessage.Message[] } = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)

      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.step.started",
          id: "evt_1",
          data: {
            timestamp: 1000,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            agent: "build",
            model: { id: "claude", providerID: "anthropic" },
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.text.started",
          id: "evt_2",
          data: {
            timestamp: 1100,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            textID: "txt_1",
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.text.delta",
          id: "evt_3",
          data: {
            timestamp: 1200,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            textID: "txt_1",
            delta: "Hello",
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.text.delta",
          id: "evt_4",
          data: {
            timestamp: 1300,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            textID: "txt_1",
            delta: " World",
          },
        }),
      )

      expect(state.messages).toHaveLength(1)
      const msg = state.messages[0]
      expect(msg.type).toBe("assistant")
      if (msg.type === "assistant") {
        expect(msg.content).toHaveLength(1)
        const textBlock = msg.content[0]
        expect(textBlock?.type).toBe("text")
        if (textBlock?.type === "text") {
          expect(textBlock.text).toBe("Hello World")
        }
      }
    }),
  )

  it.effect("session.next.tool.input.started → called → success transitions tool state", () =>
    Effect.gen(function* () {
      const state: { messages: SessionMessage.Message[] } = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)

      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.step.started",
          id: "evt_15",
          data: {
            timestamp: 1000,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            agent: "build",
            model: { id: "claude", providerID: "anthropic" },
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.tool.input.started",
          id: "evt_16",
          data: {
            timestamp: 1100,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            callID: "call_1",
            name: "read_file",
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.tool.called",
          id: "evt_17",
          data: {
            timestamp: 1200,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            callID: "call_1",
            tool: "read_file",
            input: { path: "/tmp/test.txt" },
            provider: { executed: false },
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.tool.success",
          id: "evt_18",
          data: {
            timestamp: 1300,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            callID: "call_1",
            structured: { lines: 42 },
            content: [{ type: "text", text: "file content" }],
            result: "done",
            provider: { executed: false },
          },
        }),
      )

      expect(state.messages).toHaveLength(1)
      const msg = state.messages[0]
      expect(msg.type).toBe("assistant")
      if (msg.type === "assistant") {
        expect(msg.content).toHaveLength(1)
        const tool = msg.content[0]
        expect(tool?.type).toBe("tool")
        if (tool?.type === "tool") {
          expect(tool.name).toBe("read_file")
          expect(tool.state.status).toBe("completed")
          if (tool.state.status === "completed") {
            expect(tool.state.result).toBe("done")
          }
          expect(tool.time.completed).toBeDefined()
        }
      }
    }),
  )

  it.effect("session.next.shell.started → ended updates shell output", () =>
    Effect.gen(function* () {
      const state: { messages: SessionMessage.Message[] } = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)

      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.shell.started",
          id: "evt_20",
          data: {
            timestamp: 1000,
            sessionID: "ses_test",
            messageID: "msg_shell_1",
            callID: "shell_1",
            command: "ls -la",
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.shell.ended",
          id: "evt_21",
          data: {
            timestamp: 2000,
            sessionID: "ses_test",
            callID: "shell_1",
            output: "total 42\n-rw-r--r--  1 user user  1024 Jan 1 00:00 file.txt",
          },
        }),
      )

      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].type).toBe("shell")
      if (state.messages[0].type === "shell") {
        expect(state.messages[0].command).toBe("ls -la")
        expect(state.messages[0].output).toContain("total 42")
        expect(state.messages[0].time.completed).toBeDefined()
        expect(DateTime.toEpochMillis(state.messages[0].time.created)).toBe(1000)
        if (state.messages[0].time.completed) {
          expect(DateTime.toEpochMillis(state.messages[0].time.completed)).toBe(2000)
        }
      }
    }),
  )

  it.effect("session.next.compaction.ended appends a compaction message", () =>
    Effect.gen(function* () {
      const state: { messages: SessionMessage.Message[] } = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)

      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.compaction.ended",
          id: "evt_30",
          data: {
            timestamp: 1000,
            sessionID: "ses_test",
            messageID: "msg_compaction_1",
            reason: "auto",
            text: "summarized earlier conversation",
            recent: "recent messages kept verbatim",
          },
        }),
      )

      expect(state.messages).toHaveLength(1)
      expect(state.messages[0].type).toBe("compaction")
      if (state.messages[0].type === "compaction") {
        expect(state.messages[0].reason).toBe("auto")
        expect(state.messages[0].summary).toBe("summarized earlier conversation")
        expect(state.messages[0].recent).toBe("recent messages kept verbatim")
      }
    }),
  )

  it.effect("multiple session.next.step.started completes the first assistant", () =>
    Effect.gen(function* () {
      const state: { messages: SessionMessage.Message[] } = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)

      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.step.started",
          id: "evt_40",
          data: {
            timestamp: 1000,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            agent: "build",
            model: { id: "claude", providerID: "anthropic" },
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.step.started",
          id: "evt_41",
          data: {
            timestamp: 2000,
            sessionID: "ses_test",
            assistantMessageID: "msg_a2",
            agent: "edit",
            model: { id: "gpt-4", providerID: "openai" },
          },
        }),
      )

      expect(state.messages).toHaveLength(2)

      const first = state.messages[0]
      expect(first.type).toBe("assistant")
      if (first.type === "assistant") {
        expect(first.agent).toBe("build")
        expect(first.time.completed).toBeDefined()
        if (first.time.completed) {
          expect(DateTime.toEpochMillis(first.time.completed)).toBe(2000)
        }
      }

      const second = state.messages[1]
      expect(second.type).toBe("assistant")
      if (second.type === "assistant") {
        expect(second.agent).toBe("edit")
        expect(second.time.completed).toBeUndefined()
      }

      // getCurrentAssistant returns the newest incomplete assistant
      const current = yield* adapter.getCurrentAssistant()
      expect(current?.agent).toBe("edit")
    }),
  )

  it.effect("session.next.tool.failed transitions tool state to error", () =>
    Effect.gen(function* () {
      const state: { messages: SessionMessage.Message[] } = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)

      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.step.started",
          id: "evt_50",
          data: {
            timestamp: 1000,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            agent: "build",
            model: { id: "claude", providerID: "anthropic" },
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.tool.input.started",
          id: "evt_51",
          data: {
            timestamp: 1100,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            callID: "call_1",
            name: "read_file",
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.tool.called",
          id: "evt_52",
          data: {
            timestamp: 1200,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            callID: "call_1",
            tool: "read_file",
            input: { path: "/nonexistent" },
            provider: { executed: false },
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.tool.failed",
          id: "evt_53",
          data: {
            timestamp: 1300,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            callID: "call_1",
            error: { type: "unknown", message: "File not found" },
            provider: { executed: false },
          },
        }),
      )

      expect(state.messages).toHaveLength(1)
      const msg = state.messages[0]
      expect(msg.type).toBe("assistant")
      if (msg.type === "assistant") {
        expect(msg.content).toHaveLength(1)
        const tool = msg.content[0]
        expect(tool?.type).toBe("tool")
        if (tool?.type === "tool") {
          expect(tool.state.status).toBe("error")
          if (tool.state.status === "error") {
            expect(tool.state.error.message).toBe("File not found")
          }
          expect(tool.time.completed).toBeDefined()
        }
      }
    }),
  )

  it.effect("session.next.reasoning.delta accumulates reasoning text", () =>
    Effect.gen(function* () {
      const state: { messages: SessionMessage.Message[] } = { messages: [] }
      const adapter = SessionMessageUpdater.memory(state)

      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.step.started",
          id: "evt_60",
          data: {
            timestamp: 1000,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            agent: "build",
            model: { id: "claude", providerID: "anthropic" },
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.reasoning.started",
          id: "evt_61",
          data: {
            timestamp: 1100,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            reasoningID: "reason_1",
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.reasoning.delta",
          id: "evt_62",
          data: {
            timestamp: 1200,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            reasoningID: "reason_1",
            delta: "Let me think",
          },
        }),
      )
      yield* SessionMessageUpdater.update(
        adapter,
        decodeEvent({
          type: "session.next.reasoning.delta",
          id: "evt_63",
          data: {
            timestamp: 1300,
            sessionID: "ses_test",
            assistantMessageID: "msg_a1",
            reasoningID: "reason_1",
            delta: " about this problem.",
          },
        }),
      )

      expect(state.messages).toHaveLength(1)
      const msg = state.messages[0]
      expect(msg.type).toBe("assistant")
      if (msg.type === "assistant") {
        expect(msg.content).toHaveLength(1)
        const reason = msg.content[0]
        expect(reason?.type).toBe("reasoning")
        if (reason?.type === "reasoning") {
          expect(reason.text).toBe("Let me think about this problem.")
        }
      }
    }),
  )
})
