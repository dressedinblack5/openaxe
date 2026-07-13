export * as SessionEvent from "./session-event"

import { Schema } from "effect"
import { Event } from "./event"
import { ProviderMetadata, ToolContent } from "./llm"
import { Delivery } from "./session-delivery"
import { Model } from "./model"
import { DateTimeUtcFromMillis, NonNegativeInt, RelativePath } from "./schema"
import { FileAttachment, Prompt } from "./prompt"
import { SessionID } from "./session-id"
import { Location } from "./location"
import { SessionMessageID } from "./session-message-id"
import { SessionMessage } from "./session-message"

export { FileAttachment }

export const Source = Schema.Struct({
  start: NonNegativeInt,
  end: NonNegativeInt,
  text: Schema.String,
}).annotate({
  identifier: "session.next.event.source",
})
export type Source = typeof Source.Type

const Base = {
  timestamp: DateTimeUtcFromMillis,
  sessionID: SessionID,
}
const PromptFields = {
  ...Base,
  messageID: SessionMessageID.ID,
  prompt: Prompt,
  delivery: Delivery,
}

const options = {
  durable: {
    aggregate: "sessionID",
    version: 1,
  },
} as const
const stepSettlementOptions = {
  durable: {
    aggregate: "sessionID",
    version: 2,
  },
} as const

export const UnknownError = SessionMessage.UnknownError
export type UnknownError = SessionMessage.UnknownError

export const AgentSwitched = Event.define({
  type: "session.next.agent.switched",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessageID.ID,
    agent: Schema.String,
  },
})
export type AgentSwitched = typeof AgentSwitched.Type

export const ModelSwitched = Event.define({
  type: "session.next.model.switched",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessageID.ID,
    model: Model.Ref,
  },
})
export type ModelSwitched = typeof ModelSwitched.Type

export const Moved = Event.define({
  type: "session.next.moved",
  ...options,
  schema: {
    ...Base,
    location: Location.Ref,
    subdirectory: RelativePath.pipe(Schema.optional),
  },
})
export type Moved = typeof Moved.Type

export const Prompted = Event.define({
  type: "session.next.prompted",
  ...options,
  schema: PromptFields,
})
export type Prompted = typeof Prompted.Type

export const PromptAdmitted = Event.define({
  type: "session.next.prompt.admitted",
  ...options,
  schema: PromptFields,
})
export type PromptAdmitted = typeof PromptAdmitted.Type

export const ContextUpdated = Event.define({
  type: "session.next.context.updated",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessageID.ID,
    text: Schema.String,
  },
})
export type ContextUpdated = typeof ContextUpdated.Type

export const Synthetic = Event.define({
  type: "session.next.synthetic",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessageID.ID,
    text: Schema.String,
  },
})
export type Synthetic = typeof Synthetic.Type

// -- Shell --

const _ShellStarted = Event.define({
  type: "session.next.shell.started",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessageID.ID,
    callID: Schema.String,
    command: Schema.String,
  },
})
const _ShellEnded = Event.define({
  type: "session.next.shell.ended",
  ...options,
  schema: {
    ...Base,
    callID: Schema.String,
    output: Schema.String,
  },
})

export const Shell = {
  Started: _ShellStarted,
  Ended: _ShellEnded,
} as const
export type Shell = {
  readonly Started: typeof _ShellStarted.Type
  readonly Ended: typeof _ShellEnded.Type
}

// -- Step --

const _StepStarted = Event.define({
  type: "session.next.step.started",
  ...options,
  schema: {
    ...Base,
    assistantMessageID: SessionMessageID.ID,
    agent: Schema.String,
    model: Model.Ref,
    snapshot: Schema.String.pipe(Schema.optional),
  },
})
const _StepEnded = Event.define({
  type: "session.next.step.ended",
  ...stepSettlementOptions,
  schema: {
    ...Base,
    assistantMessageID: SessionMessageID.ID,
    finish: Schema.String,
    cost: Schema.Finite,
    tokens: Schema.Struct({
      input: Schema.Finite,
      output: Schema.Finite,
      reasoning: Schema.Finite,
      cache: Schema.Struct({
        read: Schema.Finite,
        write: Schema.Finite,
      }),
    }),
    snapshot: Schema.String.pipe(Schema.optional),
  },
})
const _StepFailed = Event.define({
  type: "session.next.step.failed",
  ...stepSettlementOptions,
  schema: {
    ...Base,
    assistantMessageID: SessionMessageID.ID,
    error: UnknownError,
  },
})

export const Step = {
  Started: _StepStarted,
  Ended: _StepEnded,
  Failed: _StepFailed,
} as const
export type Step = {
  readonly Started: typeof _StepStarted.Type
  readonly Ended: typeof _StepEnded.Type
  readonly Failed: typeof _StepFailed.Type
}

// -- Text --

const _TextStarted = Event.define({
  type: "session.next.text.started",
  ...options,
  schema: {
    ...Base,
    assistantMessageID: SessionMessageID.ID,
    textID: Schema.String,
  },
})

// Stream fragments are live-only; Text.Ended is the replayable full-value boundary.
const _TextDelta = Event.define({
  type: "session.next.text.delta",
  schema: {
    ...Base,
    assistantMessageID: SessionMessageID.ID,
    textID: Schema.String,
    delta: Schema.String,
  },
})

const _TextEnded = Event.define({
  type: "session.next.text.ended",
  ...options,
  schema: {
    ...Base,
    assistantMessageID: SessionMessageID.ID,
    textID: Schema.String,
    text: Schema.String,
  },
})

export const Text = {
  Started: _TextStarted,
  Delta: _TextDelta,
  Ended: _TextEnded,
} as const
export type Text = {
  readonly Started: typeof _TextStarted.Type
  readonly Delta: typeof _TextDelta.Type
  readonly Ended: typeof _TextEnded.Type
}

// -- Reasoning --

const _ReasoningStarted = Event.define({
  type: "session.next.reasoning.started",
  ...options,
  schema: {
    ...Base,
    assistantMessageID: SessionMessageID.ID,
    reasoningID: Schema.String,
    providerMetadata: ProviderMetadata.pipe(Schema.optional),
  },
})

// Stream fragments are live-only; Reasoning.Ended is the replayable full-value boundary.
const _ReasoningDelta = Event.define({
  type: "session.next.reasoning.delta",
  schema: {
    ...Base,
    assistantMessageID: SessionMessageID.ID,
    reasoningID: Schema.String,
    delta: Schema.String,
  },
})

const _ReasoningEnded = Event.define({
  type: "session.next.reasoning.ended",
  ...options,
  schema: {
    ...Base,
    assistantMessageID: SessionMessageID.ID,
    reasoningID: Schema.String,
    text: Schema.String,
    providerMetadata: ProviderMetadata.pipe(Schema.optional),
  },
})

export const Reasoning = {
  Started: _ReasoningStarted,
  Delta: _ReasoningDelta,
  Ended: _ReasoningEnded,
} as const
export type Reasoning = {
  readonly Started: typeof _ReasoningStarted.Type
  readonly Delta: typeof _ReasoningDelta.Type
  readonly Ended: typeof _ReasoningEnded.Type
}

// -- Tool --

const ToolBase = {
  ...Base,
  assistantMessageID: SessionMessageID.ID,
  callID: Schema.String,
}

const _ToolInputStarted = Event.define({
  type: "session.next.tool.input.started",
  ...options,
  schema: {
    ...ToolBase,
    name: Schema.String,
  },
})

// Stream fragments are live-only; Input.Ended is the replayable raw-input boundary.
const _ToolInputDelta = Event.define({
  type: "session.next.tool.input.delta",
  schema: {
    ...ToolBase,
    delta: Schema.String,
  },
})

const _ToolInputEnded = Event.define({
  type: "session.next.tool.input.ended",
  ...options,
  schema: {
    ...ToolBase,
    text: Schema.String,
  },
})

const _ToolCalled = Event.define({
  type: "session.next.tool.called",
  ...options,
  schema: {
    ...ToolBase,
    tool: Schema.String,
    input: Schema.Record(Schema.String, Schema.Unknown),
    provider: Schema.Struct({
      executed: Schema.Boolean,
      metadata: ProviderMetadata.pipe(Schema.optional),
    }),
  },
})

/**
 * Replayable bounded running-tool state. Tools should checkpoint semantic
 * transitions or at a bounded cadence, not persist every stdout/stderr chunk.
 */
const _ToolProgress = Event.define({
  type: "session.next.tool.progress",
  ...options,
  schema: {
    ...ToolBase,
    structured: Schema.Record(Schema.String, Schema.Any),
    content: Schema.Array(ToolContent),
  },
})

const _ToolSuccess = Event.define({
  type: "session.next.tool.success",
  ...options,
  schema: {
    ...ToolBase,
    structured: Schema.Record(Schema.String, Schema.Any),
    content: Schema.Array(ToolContent),
    outputPaths: Schema.Array(Schema.String).pipe(Schema.optional),
    result: Schema.Unknown.pipe(Schema.optional),
    provider: Schema.Struct({
      executed: Schema.Boolean,
      metadata: ProviderMetadata.pipe(Schema.optional),
    }),
  },
})

const _ToolFailed = Event.define({
  type: "session.next.tool.failed",
  ...options,
  schema: {
    ...ToolBase,
    error: UnknownError,
    result: Schema.Unknown.pipe(Schema.optional),
    provider: Schema.Struct({
      executed: Schema.Boolean,
      metadata: ProviderMetadata.pipe(Schema.optional),
    }),
  },
})

export const Tool = {
  Input: {
    Started: _ToolInputStarted,
    Delta: _ToolInputDelta,
    Ended: _ToolInputEnded,
  },
  Called: _ToolCalled,
  Progress: _ToolProgress,
  Success: _ToolSuccess,
  Failed: _ToolFailed,
} as const
export type Tool = {
  Input: {
    readonly Started: typeof _ToolInputStarted.Type
    readonly Delta: typeof _ToolInputDelta.Type
    readonly Ended: typeof _ToolInputEnded.Type
  }
  readonly Called: typeof _ToolCalled.Type
  readonly Progress: typeof _ToolProgress.Type
  readonly Success: typeof _ToolSuccess.Type
  readonly Failed: typeof _ToolFailed.Type
}

// -- Retry --

export const RetryError = Schema.Struct({
  message: Schema.String,
  statusCode: Schema.Finite.pipe(Schema.optional),
  isRetryable: Schema.Boolean,
  responseHeaders: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
  responseBody: Schema.String.pipe(Schema.optional),
  metadata: Schema.Record(Schema.String, Schema.String).pipe(Schema.optional),
}).annotate({
  identifier: "session.next.retry_error",
})
export type RetryError = typeof RetryError.Type

export const Retried = Event.define({
  type: "session.next.retried",
  ...options,
  schema: {
    ...Base,
    attempt: Schema.Finite,
    error: RetryError,
  },
})
export type Retried = typeof Retried.Type

// -- Compaction --

const _CompactionStarted = Event.define({
  type: "session.next.compaction.started",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessageID.ID,
    reason: Schema.Union([Schema.Literal("auto"), Schema.Literal("manual")]),
  },
})

const _CompactionDelta = Event.define({
  type: "session.next.compaction.delta",
  schema: {
    ...Base,
    messageID: SessionMessageID.ID,
    text: Schema.String,
  },
})

const _CompactionEnded = Event.define({
  type: "session.next.compaction.ended",
  ...options,
  schema: {
    ...Base,
    messageID: SessionMessageID.ID,
    reason: _CompactionStarted.data.fields.reason,
    text: Schema.String,
    recent: Schema.String,
  },
})

export const Compaction = {
  Started: _CompactionStarted,
  Delta: _CompactionDelta,
  Ended: _CompactionEnded,
} as const
export type Compaction = {
  readonly Started: typeof _CompactionStarted.Type
  readonly Delta: typeof _CompactionDelta.Type
  readonly Ended: typeof _CompactionEnded.Type
}

// -- Event inventories --

export const DurableDefinitions = Event.inventory(
  AgentSwitched,
  ModelSwitched,
  Moved,
  Prompted,
  PromptAdmitted,
  ContextUpdated,
  Synthetic,
  Shell.Started,
  Shell.Ended,
  Step.Started,
  Step.Ended,
  Step.Failed,
  Text.Started,
  Text.Ended,
  Tool.Input.Started,
  Tool.Input.Ended,
  Tool.Called,
  Tool.Progress,
  Tool.Success,
  Tool.Failed,
  Reasoning.Started,
  Reasoning.Ended,
  Retried,
  Compaction.Started,
  Compaction.Ended,
)

export const Definitions = Event.inventory(
  AgentSwitched,
  ModelSwitched,
  Moved,
  Prompted,
  PromptAdmitted,
  ContextUpdated,
  Synthetic,
  Shell.Started,
  Shell.Ended,
  Step.Started,
  Step.Ended,
  Step.Failed,
  Text.Started,
  Text.Delta,
  Text.Ended,
  Reasoning.Started,
  Reasoning.Delta,
  Reasoning.Ended,
  Tool.Input.Started,
  Tool.Input.Delta,
  Tool.Input.Ended,
  Tool.Called,
  Tool.Progress,
  Tool.Success,
  Tool.Failed,
  Retried,
  Compaction.Started,
  Compaction.Delta,
  Compaction.Ended,
)

export const Durable = Schema.Union(DurableDefinitions, { mode: "oneOf" }).pipe(Schema.toTaggedUnion("type"))
export type DurableEvent = typeof Durable.Type

export const All = Schema.Union(Definitions, { mode: "oneOf" }).pipe(Schema.toTaggedUnion("type"))
export type Event = typeof All.Type
export type Type = Event["type"]
