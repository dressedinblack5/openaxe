import { Effect } from "effect"
import { SessionEvent } from "@opencode-ai/schema"
import { SessionData, SessionDataReducer } from "./types"

/**
 * Pure SessionData reducer over EventV2 stream
 * This is the core of the CLI TUI bridge - reduces EventV2 events to SessionData
 * that the TUI can render
 */

export const createInitialSessionData = (includeUserText = false): SessionData => ({
  includeUserText,
  announced: false,
  ids: new Set(),
  tools: new Set(),
  call: new Map(),
  shell: new Map(),
  permissions: [],
  questions: [],
  role: new Map(),
  msg: new Map(),
  part: new Map(),
  text: new Map(),
  sent: new Map(),
  visible: new Map(),
  end: new Set(),
  lastBashOutput: undefined,
})

/**
 * Helper to safely get object from unknown
 */
const dict = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? { ...v } : {}

/**
 * Main reducer function - pure function that reduces EventV2 to SessionData
 */
export const reduceEvent: SessionDataReducer = (state, event) => {
  const newState = { ...state }
  const commits: SessionEvent.StreamCommit[] = []

  switch (event.type) {
    case "session.next.prompted": {
      newState.announced = true
      break
    }

    case "session.next.step.started": {
      newState.ids.add(event.data.assistantMessageID)
      newState.role.set(event.data.assistantMessageID, "assistant")
      newState.msg.set(event.data.assistantMessageID, "")
      break
    }

    case "session.next.step.ended": {
      newState.end.add(event.data.assistantMessageID)
      commits.push({ type: "step", assistantMessageID: event.data.assistantMessageID })
      break
    }

    case "session.next.step.failed": {
      newState.end.add(event.data.assistantMessageID)
      commits.push({ type: "step", assistantMessageID: event.data.assistantMessageID, error: event.data.error })
      break
    }

    case "session.next.text.started": {
      newState.ids.add(event.data.assistantMessageID)
      newState.text.set(event.data.textID, "")
      break
    }

    case "session.next.text.delta": {
      const current = newState.text.get(event.data.textID) ?? ""
      newState.text.set(event.data.textID, current + event.data.delta)
      break
    }

    case "session.next.text.ended": {
      newState.text.set(event.data.textID, event.data.text)
      break
    }

    case "session.next.reasoning.started": {
      newState.ids.add(event.data.assistantMessageID)
      newState.part.set(event.data.reasoningID, "reasoning")
      break
    }

    case "session.next.reasoning.delta": {
      // Reasoning deltas are live-only, not persisted
      break
    }

    case "session.next.reasoning.ended": {
      // Reasoning ended - full value in event.data.text
      break
    }

    case "session.next.tool.input.started": {
      newState.ids.add(event.data.assistantMessageID)
      newState.tools.add(event.data.name)
      newState.call.set(event.data.callID, { ...dict(event.data.input), name: event.data.name })
      break
    }

    case "session.next.tool.input.delta": {
      // Input deltas are live-only
      break
    }

    case "session.next.tool.input.ended": {
      // Full input received
      break
    }

    case "session.next.tool.called": {
      const call = newState.call.get(event.data.callID) ?? {}
      newState.call.set(event.data.callID, {
        ...call,
        tool: event.data.tool,
        input: event.data.input,
        provider: event.data.provider,
      })
      break
    }

    case "session.next.tool.progress": {
      // Tool progress - structured updates
      break
    }

    case "session.next.tool.success": {
      const call = newState.call.get(event.data.callID) ?? {}
      newState.call.set(event.data.callID, {
        ...call,
        result: event.data.result,
        output: event.data.output,
        outputPaths: event.data.outputPaths,
      })
      commits.push({ type: "tool", callID: event.data.callID, result: "success" })
      break
    }

    case "session.next.tool.failed": {
      const call = newState.call.get(event.data.callID) ?? {}
      newState.call.set(event.data.callID, {
        ...call,
        error: event.data.error,
        result: event.data.result,
      })
      commits.push({ type: "tool", callID: event.data.callID, result: "failed", error: event.data.error })
      break
    }

    case "session.next.shell.started": {
      newState.shell.set(event.data.callID, { source: "shell", command: event.data.command })
      newState.lastBashOutput = undefined
      break
    }

    case "session.next.shell.ended": {
      newState.shell.set(event.data.callID, { source: "shell", command: undefined })
      newState.lastBashOutput = event.data.output
      break
    }

    case "session.next.compaction.started": {
      // Compaction started
      break
    }

    case "session.next.compaction.delta": {
      // Compaction delta - live only
      break
    }

    case "session.next.compaction.ended": {
      // Compaction ended - full text in event.data.text
      break
    }

    case "session.next.agent.switched": {
      // Agent switched
      break
    }

    case "session.next.model.switched": {
      // Model switched
      break
    }

    case "session.next.moved": {
      // Session moved
      break
    }

    case "session.next.prompt.admitted": {
      // Prompt admitted
      break
    }

    case "session.next.context.updated": {
      // Context updated
      break
    }

    case "session.next.synthetic": {
      // Synthetic event
      break
    }

    case "session.next.retried": {
      // Retry
      break
    }

    default: {
      // Exhaustiveness check
      const _exhaustive: never = event
      return _exhaustive
    }
  }

  // Build footer output
  const footer = buildFooter(newState)

  return {
    data: newState,
    commits,
    footer,
  }
}

/**
 * Build footer output from SessionData
 */
// oxlint-disable-next-line typescript/no-redundant-type-constituents -- FooterOutput from schema has error type in union
const buildFooter = (data: SessionData): SessionEvent.FooterOutput | undefined => {
  // Check for permission request
  if (data.permissions.length > 0) {
    return {
      view: "permission",
      patch: { status: "permission" },
    }
  }

  // Check for question
  if (data.questions.length > 0) {
    return {
      view: "question",
      patch: { status: "question" },
    }
  }

  // Default session view
  return {
    view: "session",
    patch: { status: "idle" },
  }
}

/**
 * Effect wrapper for the reducer
 */
export const makeReducer = (initialState?: SessionData): Effect.Effect<SessionDataReducer> =>
  Effect.succeed((state = initialState ?? createInitialSessionData(), event: SessionEvent.Event) =>
    reduceEvent(state, event),
  )

export * as Reducer from "./reducer"