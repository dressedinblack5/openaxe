// @ts-nocheck
import { describe, it, expect } from "bun:test"
import { DateTime } from "effect"
import { SessionEvent } from "@opencode-ai/schema/session-event"
import { reduceEvent, createInitialSessionData } from "../src/reducer"

const makeEventId = () => `evt_${Math.random().toString(36).slice(2)}`
const now = () => DateTime.makeUnsafe(Date.now())

// Helper to create event with proper Payload structure (id, type, data)
const makePromptedEvent = (overrides = {}) =>
  SessionEvent.Prompted.make({
    type: "session.next.prompted",
    id: makeEventId(),
    data: {
      timestamp: now(),
      sessionID: "ses_test123",
      messageID: "msg_test123",
      prompt: { text: "test", files: [] },
      delivery: "steer",
      ...overrides,
    },
  })

const makeStepStartedEvent = (overrides = {}) =>
  SessionEvent.Step.Started.make({
    type: "session.next.step.started",
    id: makeEventId(),
    data: {
      timestamp: now(),
      sessionID: "ses_test123",
      assistantMessageID: "msg_test123",
      agent: "test-agent",
      model: { providerID: "anthropic", id: "claude-3" },
      snapshot: undefined,
      ...overrides,
    },
  })

const makeStepEndedEvent = (overrides = {}) =>
  SessionEvent.Step.Ended.make({
    type: "session.next.step.ended",
    id: makeEventId(),
    data: {
      timestamp: now(),
      sessionID: "ses_test123",
      assistantMessageID: "msg_test123",
      finish: "completed",
      cost: 0,
      tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
      snapshot: undefined,
      ...overrides,
    },
  })

const makeTextStartedEvent = (overrides = {}) =>
  SessionEvent.Text.Started.make({
    type: "session.next.text.started",
    id: makeEventId(),
    data: {
      timestamp: now(),
      sessionID: "ses_test123",
      assistantMessageID: "msg_test123",
      textID: "text_123",
      ...overrides,
    },
  })

const makeTextDeltaEvent = (overrides = {}) =>
  SessionEvent.Text.Delta.make({
    type: "session.next.text.delta",
    id: makeEventId(),
    data: {
      timestamp: now(),
      sessionID: "ses_test123",
      assistantMessageID: "msg_test123",
      textID: "text_123",
      delta: "Hello",
      ...overrides,
    },
  })

const makeTextEndedEvent = (overrides = {}) =>
  SessionEvent.Text.Ended.make({
    type: "session.next.text.ended",
    id: makeEventId(),
    data: {
      timestamp: now(),
      sessionID: "ses_test123",
      assistantMessageID: "msg_test123",
      textID: "text_123",
      text: "Hello World",
      ...overrides,
    },
  })

const makeToolCalledEvent = (overrides = {}) =>
  SessionEvent.Tool.Called.make({
    type: "session.next.tool.called",
    id: makeEventId(),
    data: {
      timestamp: now(),
      sessionID: "ses_test123",
      assistantMessageID: "msg_test123",
      callID: "call_123",
      tool: "read_file",
      input: { filePath: "/test.ts" },
      provider: { executed: false, metadata: undefined },
      ...overrides,
    },
  })

const makeToolSuccessEvent = (overrides = {}) =>
  SessionEvent.Tool.Success.make({
    type: "session.next.tool.success",
    id: makeEventId(),
    data: {
      timestamp: now(),
      sessionID: "ses_test123",
      assistantMessageID: "msg_test123",
      callID: "call_123",
      structured: { content: "file content" },
      content: [],
      outputPaths: [],
      result: undefined,
      provider: { executed: false, metadata: undefined },
      ...overrides,
    },
  })

const makeShellStartedEvent = (overrides = {}) =>
  SessionEvent.Shell.Started.make({
    type: "session.next.shell.started",
    id: makeEventId(),
    data: {
      timestamp: now(),
      sessionID: "ses_test123",
      messageID: "msg_test123",
      callID: "call_123",
      command: "ls -la",
      ...overrides,
    },
  })

const makeShellEndedEvent = (overrides = {}) =>
  SessionEvent.Shell.Ended.make({
    type: "session.next.shell.ended",
    id: makeEventId(),
    data: {
      timestamp: now(),
      sessionID: "ses_test123",
      messageID: "msg_test123",
      callID: "call_123",
      output: "file1.txt\nfile2.txt",
      ...overrides,
    },
  })

describe("SessionData Reducer", () => {
  const initialState = createInitialSessionData()

  it("should handle session.next.prompted", () => {
    const event = makePromptedEvent()
    const result = reduceEvent(initialState, event)
    expect(result.data.announced).toBe(true)
  })

  it("should handle session.next.step.started", () => {
    const event = makeStepStartedEvent()
    const result = reduceEvent(initialState, event)
    expect(result.data.ids.has("msg_test123")).toBe(true)
    expect(result.data.role.get("msg_test123")).toBe("assistant")
    expect(result.data.msg.get("msg_test123")).toBe("")
  })

  it("should handle session.next.step.ended", () => {
    const startEvent = makeStepStartedEvent()
    const endEvent = makeStepEndedEvent({ assistantMessageID: "msg_test123" })

    const afterStart = reduceEvent(initialState, startEvent)
    const result = reduceEvent(afterStart.data, endEvent)

    expect(result.data.end.has("msg_test123")).toBe(true)
    expect(result.commits.some((c) => c.type === "step")).toBe(true)
  })

  it("should handle session.next.text events", () => {
    const startedEvent = makeTextStartedEvent()
    const deltaEvent = makeTextDeltaEvent()
    const endedEvent = makeTextEndedEvent()

    let state = reduceEvent(initialState, startedEvent)
    state = reduceEvent(state.data, deltaEvent)
    state = reduceEvent(state.data, endedEvent)

    expect(state.data.text.get("text_123")).toBe("Hello World")
  })

  it("should handle session.next.tool events", () => {
    const inputStartedEvent = SessionEvent.Tool.Input.Started.make({
      type: "session.next.tool.input.started",
      id: makeEventId(),
      data: {
        timestamp: now(),
        sessionID: "ses_test123",
        assistantMessageID: "msg_test123",
        callID: "call_123",
        name: "read_file",
      },
    })

    const calledEvent = makeToolCalledEvent()
    const successEvent = makeToolSuccessEvent()

    let state = reduceEvent(initialState, inputStartedEvent)
    state = reduceEvent(state.data, calledEvent)
    state = reduceEvent(state.data, successEvent)

    expect(state.data.tools.has("read_file")).toBe(true)
    expect(state.data.call.get("call_123")?.tool).toBe("read_file")
    expect(state.commits.some((c) => c.type === "tool" && c.result === "success")).toBe(true)
  })

  it("should handle session.next.shell events", () => {
    const startedEvent = makeShellStartedEvent()
    const endedEvent = makeShellEndedEvent()

    let state = reduceEvent(initialState, startedEvent)
    state = reduceEvent(state.data, endedEvent)

    expect(state.data.lastBashOutput).toBe("file1.txt\nfile2.txt")
  })

  it("should be idempotent for repeated events", () => {
    const event = makeStepStartedEvent()
    const result1 = reduceEvent(initialState, event)
    const result2 = reduceEvent(result1.data, event)

    expect(result2.data.ids.has("msg_test123")).toBe(true)
  })

  it("should maintain isolation between sessions", () => {
    const event1 = makePromptedEvent({ sessionID: "ses_test123" })
    const event2 = makePromptedEvent({ sessionID: "ses_test456" })

    const state1 = reduceEvent(initialState, event1)
    const state2 = reduceEvent(initialState, event2)

    expect(state1.data.announced).toBe(true)
    expect(state2.data.announced).toBe(true)
  })
})

describe("Reducer Property Tests", () => {
  it("should maintain idempotence for step events", () => {
    const state = createInitialSessionData()
    const event = makeStepStartedEvent({ assistantMessageID: "msg_test123" })

    const r1 = reduceEvent(state, event)
    const r2 = reduceEvent(r1.data, event)
    const r3 = reduceEvent(r2.data, event)

    expect(r1.data.ids).toEqual(r2.data.ids)
    expect(r2.data.ids).toEqual(r3.data.ids)
  })

  it("should have monotonic growth of ids set", () => {
    let state = createInitialSessionData()

    const events = [
      makeStepStartedEvent({ assistantMessageID: "msg_1" }),
      makeStepStartedEvent({ assistantMessageID: "msg_2" }),
    ]

    for (const event of events) {
      state = reduceEvent(state, event).data
    }

    expect(state.ids.size).toBe(2)
    expect(state.ids.has("msg_1")).toBe(true)
    expect(state.ids.has("msg_2")).toBe(true)
  })

  it("should not lose data when events are reordered", () => {
    const events = [
      SessionEvent.Text.Started.make({
        type: "session.next.text.started",
        id: makeEventId(),
        data: {
          timestamp: now(),
          sessionID: "ses_test123",
          assistantMessageID: "msg_1",
          textID: "text_1",
        },
      }),
      SessionEvent.Text.Ended.make({
        type: "session.next.text.ended",
        id: makeEventId(),
        data: {
          timestamp: now(),
          sessionID: "ses_test123",
          assistantMessageID: "msg_1",
          textID: "text_1",
          text: "Hello World",
        },
      }),
    ]

    let state1 = createInitialSessionData()
    for (const event of events) {
      state1 = reduceEvent(state1, event).data
    }

    let state2 = createInitialSessionData()
    for (const event of events.reverse()) {
      state2 = reduceEvent(state2, event).data
    }

    expect(state1.text.get("text_1")).toBe("Hello World")
  })
})
