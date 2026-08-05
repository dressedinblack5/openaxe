import { castDraft, produce, type WritableDraft } from "immer"
import { Effect, Option } from "effect"
import { Embedding } from "../embedding/embedding"
import { Vector } from "../vector/vector"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"

export type MemoryState = {
  messages: SessionMessage.Message[]
  // Reverse indexes for O(1) lookups
  assistantIndex: Map<SessionMessage.ID, number>
  shellIndex: Map<string, number>
  latestAssistantIndex: number
}

export interface Adapter {
  readonly getCurrentAssistant: () => Effect.Effect<SessionMessage.Assistant | undefined>
  readonly getAssistant: (messageID: SessionMessage.ID) => Effect.Effect<SessionMessage.Assistant | undefined>
  readonly getCurrentShell: (callID: string) => Effect.Effect<SessionMessage.Shell | undefined>
  readonly updateAssistant: (assistant: SessionMessage.Assistant) => Effect.Effect<void>
  readonly updateShell: (shell: SessionMessage.Shell) => Effect.Effect<void>
  readonly appendMessage: (message: SessionMessage.Message) => Effect.Effect<void>
}

function rebuildIndexes(state: MemoryState) {
  state.assistantIndex.clear()
  state.shellIndex.clear()
  state.latestAssistantIndex = -1
  
  for (let i = 0; i < state.messages.length; i++) {
    const message = state.messages[i]
    if (message.type === "assistant") {
      state.assistantIndex.set(message.id, i)
      if (!message.time.completed) {
        state.latestAssistantIndex = i
      }
    } else if (message.type === "shell") {
      state.shellIndex.set(message.callID, i)
    }
  }
  
  // If we have a completed assistant after the latest incomplete, 
  // we should not return the incomplete one - find the actual latest
  if (state.latestAssistantIndex >= 0) {
    // Check if there's any assistant message after this one
    for (let i = state.latestAssistantIndex + 1; i < state.messages.length; i++) {
      const msg = state.messages[i]
      if (msg.type === "assistant") {
        // There's a later assistant (completed or not), so don't use the incomplete one
        state.latestAssistantIndex = -1
        break
      }
    }
  }
}

export function memory(state: MemoryState): Adapter {
  // Initialize indexes if not present
  if (!state.assistantIndex) {
    state.assistantIndex = new Map()
    state.shellIndex = new Map()
    state.latestAssistantIndex = -1
    rebuildIndexes(state)
  }

  const getAssistantIndex = (messageID: SessionMessage.ID): number | undefined => {
    return state.assistantIndex.get(messageID)
  }

  const getLatestAssistantIndex = (): number => {
    return state.latestAssistantIndex
  }

  const getShellIndex = (callID: string): number | undefined => {
    return state.shellIndex.get(callID)
  }

  return {
    getCurrentAssistant() {
      return Effect.sync(() => {
        const index = getLatestAssistantIndex()
        if (index < 0) return undefined
        const assistant = state.messages[index]
        return assistant?.type === "assistant" && !assistant.time.completed ? assistant : undefined
      })
    },
    getAssistant(messageID) {
      return Effect.sync(() => {
        const index = getAssistantIndex(messageID)
        if (index === undefined) return undefined
        const assistant = state.messages[index]
        return assistant?.type === "assistant" ? assistant : undefined
      })
    },
    getCurrentShell(callID) {
      return Effect.sync(() => {
        const index = getShellIndex(callID)
        if (index === undefined) return undefined
        const shell = state.messages[index]
        return shell?.type === "shell" ? shell : undefined
      })
    },
    updateAssistant(assistant) {
      return Effect.sync(() => {
        const index = getAssistantIndex(assistant.id)
        if (index === undefined) return
        const current = state.messages[index]
        if (current?.type !== "assistant") return
        state.messages[index] = assistant
        // Update indexes if completion status changed
        if (assistant.time.completed && state.latestAssistantIndex === index) {
          state.latestAssistantIndex = -1
          for (let i = state.messages.length - 1; i >= 0; i--) {
            const msg = state.messages[i]
            if (msg.type === "assistant" && !msg.time.completed) {
              state.latestAssistantIndex = i
              break
            }
          }
        }
      })
    },
    updateShell(shell) {
      return Effect.sync(() => {
        const index = getShellIndex(shell.callID)
        if (index === undefined) return
        const current = state.messages[index]
        if (current?.type !== "shell") return
        state.messages[index] = shell
      })
    },
    appendMessage(message) {
      return Effect.sync(() => {
        const index = state.messages.length
        state.messages.push(message)
        // Update indexes
        if (message.type === "assistant") {
          state.assistantIndex.set(message.id, index)
          if (!message.time.completed) {
            state.latestAssistantIndex = index
          }
        } else if (message.type === "shell") {
          state.shellIndex.set(message.callID, index)
        }
      })
    },
  }
}

export function update(adapter: Adapter, event: SessionEvent.Event) {
  type DraftAssistant = WritableDraft<SessionMessage.Assistant>
  type DraftTool = WritableDraft<SessionMessage.AssistantTool>
  type DraftText = WritableDraft<SessionMessage.AssistantText>
  type DraftReasoning = WritableDraft<SessionMessage.AssistantReasoning>

  const latestTool = (assistant: DraftAssistant | undefined, callID?: string) =>
    assistant?.content.findLast(
      (item): item is DraftTool => item.type === "tool" && (callID === undefined || item.id === callID),
    )

  const latestText = (assistant: DraftAssistant | undefined, textID: string) =>
    assistant?.content.findLast((item): item is DraftText => item.type === "text" && item.id === textID)

  const latestReasoning = (assistant: DraftAssistant | undefined, reasoningID: string) =>
    assistant?.content.findLast((item): item is DraftReasoning => item.type === "reasoning" && item.id === reasoningID)

  const updateOwnedAssistant = (messageID: SessionMessage.ID, recipe: (draft: DraftAssistant) => void) =>
    Effect.gen(function* () {
      const assistant = yield* adapter.getAssistant(messageID)
      if (assistant) yield* adapter.updateAssistant(produce(assistant, recipe))
    })

  return Effect.gen(function* () {
    const append = (message: SessionMessage.Message) =>
      Effect.gen(function* () {
        yield* adapter.appendMessage(message)
        // Async, detached: embedding never blocks or fails the message write.
        yield* forkEmbedding(message, event.data.sessionID)
      })
    yield* SessionEvent.All.match(event, {
      "session.next.agent.switched": (event) => {
        return append(
          SessionMessage.AgentSwitched.make({
            id: event.data.messageID,
            type: "agent-switched",
            metadata: event.metadata,
            agent: event.data.agent,
            time: { created: event.data.timestamp },
          }),
        )
      },
      "session.next.model.switched": (event) => {
        return append(
          SessionMessage.ModelSwitched.make({
            id: event.data.messageID,
            type: "model-switched",
            metadata: event.metadata,
            model: event.data.model,
            time: { created: event.data.timestamp },
          }),
        )
      },
      "session.next.moved": () => Effect.void,
      "session.next.prompted": (event) => {
        return append(
          SessionMessage.User.make({
            id: event.data.messageID,
            type: "user",
            metadata: event.metadata,
            text: event.data.prompt.text,
            files: event.data.prompt.files,
            agents: event.data.prompt.agents,
            time: { created: event.data.timestamp },
          }),
        )
      },
      "session.next.prompt.admitted": () => Effect.void,
      "session.next.context.updated": (event) =>
        append(
          SessionMessage.System.make({
            id: event.data.messageID,
            type: "system",
            text: event.data.text,
            time: { created: event.data.timestamp },
          }),
        ),
      "session.next.synthetic": (event) => {
        return append(
          SessionMessage.Synthetic.make({
            sessionID: event.data.sessionID,
            text: event.data.text,
            id: event.data.messageID,
            type: "synthetic",
            time: { created: event.data.timestamp },
          }),
        )
      },
      "session.next.shell.started": (event) => {
        return append(
          SessionMessage.Shell.make({
            id: event.data.messageID,
            type: "shell",
            metadata: event.metadata,
            callID: event.data.callID,
            command: event.data.command,
            output: "",
            time: { created: event.data.timestamp },
          }),
        )
      },
      "session.next.shell.ended": (event) => {
        return Effect.gen(function* () {
          const currentShell = yield* adapter.getCurrentShell(event.data.callID)
          if (currentShell) {
            yield* adapter.updateShell(
              produce(currentShell, (draft) => {
                draft.output = event.data.output
                draft.time.completed = event.data.timestamp
              }),
            )
          }
        })
      },
      "session.next.step.started": (event) => {
        return Effect.gen(function* () {
          const currentAssistant = yield* adapter.getCurrentAssistant()
          if (currentAssistant) {
            yield* adapter.updateAssistant(
              produce(currentAssistant, (draft) => {
                draft.time.completed = event.data.timestamp
              }),
            )
          }
          yield* append(
            SessionMessage.Assistant.make({
              id: event.data.assistantMessageID,
              type: "assistant",
              agent: event.data.agent,
              model: event.data.model,
              time: { created: event.data.timestamp },
              content: [],
              snapshot: event.data.snapshot ? { start: event.data.snapshot } : undefined,
            }),
          )
        })
      },
      "session.next.step.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.time.completed = event.data.timestamp
          draft.finish = event.data.finish
          draft.cost = event.data.cost
          draft.tokens = event.data.tokens
          if (event.data.snapshot) draft.snapshot = { ...draft.snapshot, end: event.data.snapshot }
        })
      },
      "session.next.step.failed": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.time.completed = event.data.timestamp
          draft.finish = "error"
          draft.error = event.data.error
        })
      },
      "session.next.text.started": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.content.push(
            castDraft(SessionMessage.AssistantText.make({ type: "text", id: event.data.textID, text: "" })),
          )
        })
      },
      "session.next.text.delta": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestText(draft, event.data.textID)
          if (match) match.text += event.data.delta
        })
      },
      "session.next.text.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestText(draft, event.data.textID)
          if (match) match.text = event.data.text
        })
      },
      "session.next.tool.input.started": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.content.push(
            castDraft(
              SessionMessage.AssistantTool.make({
                type: "tool",
                id: event.data.callID,
                name: event.data.name,
                time: { created: event.data.timestamp },
                state: SessionMessage.ToolStatePending.make({ status: "pending", input: "" }),
              }),
            ),
          )
        })
      },
      "session.next.tool.input.delta": () => Effect.void,
      "session.next.tool.input.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && match.state.status === "pending") match.state.input = event.data.text
        })
      },
      "session.next.tool.called": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match) {
            match.provider = event.data.provider
            match.time.ran = event.data.timestamp
            match.state = castDraft(
              SessionMessage.ToolStateRunning.make({
                status: "running",
                input: event.data.input,
                structured: {},
                content: [],
              }),
            )
          }
        })
      },
      "session.next.tool.progress": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && match.state.status === "running") {
            match.state.structured = event.data.structured
            match.state.content = [...event.data.content]
          }
        })
      },
      "session.next.tool.success": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && match.state.status === "running") {
            match.provider = {
              executed: event.data.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.data.provider.metadata,
            }
            match.time.completed = event.data.timestamp
            match.state = castDraft(
              SessionMessage.ToolStateCompleted.make({
                status: "completed",
                input: match.state.input,
                structured: event.data.structured,
                content: [...event.data.content],
                outputPaths: event.data.outputPaths ? [...event.data.outputPaths] : [],
                result: event.data.result,
              }),
            )
          }
        })
      },
      "session.next.tool.failed": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestTool(draft, event.data.callID)
          if (match && (match.state.status === "pending" || match.state.status === "running")) {
            match.provider = {
              executed: event.data.provider.executed || match.provider?.executed === true,
              metadata: match.provider?.metadata,
              resultMetadata: event.data.provider.metadata,
            }
            match.time.completed = event.data.timestamp
            match.state = castDraft(
              SessionMessage.ToolStateError.make({
                status: "error",
                error: event.data.error,
                input: typeof match.state.input === "string" ? {} : match.state.input,
                structured: match.state.status === "running" ? match.state.structured : {},
                content: match.state.status === "running" ? match.state.content : [],
                result: event.data.result,
              }),
            )
          }
        })
      },
      "session.next.reasoning.started": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          draft.content.push(
            castDraft(
              SessionMessage.AssistantReasoning.make({
                type: "reasoning",
                id: event.data.reasoningID,
                text: "",
                providerMetadata: event.data.providerMetadata,
              }),
            ),
          )
        })
      },
      "session.next.reasoning.delta": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestReasoning(draft, event.data.reasoningID)
          if (match) match.text += event.data.delta
        })
      },
      "session.next.reasoning.ended": (event) => {
        return updateOwnedAssistant(event.data.assistantMessageID, (draft) => {
          const match = latestReasoning(draft, event.data.reasoningID)
          if (match) {
            match.text = event.data.text
            if (event.data.providerMetadata !== undefined) match.providerMetadata = event.data.providerMetadata
          }
        })
      },
      "session.next.retried": () => Effect.void,
      "session.next.compaction.started": () => Effect.void,
      "session.next.compaction.delta": () => Effect.void,
      "session.next.compaction.ended": (event) => {
        return append(
          SessionMessage.Compaction.make({
            id: event.data.messageID,
            type: "compaction",
            metadata: event.metadata,
            reason: event.data.reason,
            summary: event.data.text,
            recent: event.data.recent,
            time: { created: event.data.timestamp },
          }),
        )
      },
    })
  })
}

const embeddableText = (message: SessionMessage.Message): string | undefined => {
  switch (message.type) {
    case "user":
    case "system":
    case "synthetic":
      return message.text
    case "compaction":
      return message.summary
    case "shell":
      return message.command
    default:
      // Assistant content is streamed via updates; embedding per delta would
      // duplicate vec rows, so it is left to the T16 backfill.
      return undefined
  }
}

/**
 * Fork a detached embed of a just-persisted message into session_message_vec.
 * No-op when the embedding/vector services are absent from the runtime context.
 */
export const forkEmbedding: (message: SessionMessage.Message, sessionID: string) => Effect.Effect<void> = (
  message,
  sessionID,
) =>
  Effect.gen(function* () {
    const text = embeddableText(message)
    if (text === undefined) return
    const embedding = yield* Effect.serviceOption(Embedding.Service)
    const vector = yield* Effect.serviceOption(Vector.Service)
    if (Option.isNone(embedding) || Option.isNone(vector)) return
    yield* Effect.gen(function* () {
      const vec = yield* embedding.value.embed([text])
      const vectorValue = vec.vectors[0]
      if (vectorValue) yield* vector.value.insert("session_message", message.id, vectorValue, { sessionId: sessionID })
    }).pipe(
      // catchCause, not catch: SQLite/vec0 defects surface as causes, not typed errors.
      Effect.catchCause((cause) => Effect.logWarning(`embedding session message ${message.id} failed`, { cause })),
      Effect.forkDetach({ startImmediately: true }),
      Effect.asVoid,
    )
  })

export * as SessionMessageUpdater from "./message-updater"
