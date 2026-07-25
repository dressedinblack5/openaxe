# Run Command Engine

## Overview

The `openaxe run` execution engine — orchestrates prompt admission, session creation, LLM dispatch, tool execution, and result streaming. The most complex command in the CLI.

## Structure

```
cli/cmd/run/
├── index.ts           — yargs command registration → Effect task
├── execute.ts         — Core execution loop (prompt → stream → result)
├── session.ts         — Session creation/admission
├── prompt.ts          — Prompt building and admission
├── llm.ts             — LLM request dispatch (AI SDK / native routing)
├── stream.ts          — Server-sent event streaming
├── transport.ts       — HTTP transport for stream responses
├── agent.ts           — Agent resolution (model, provider, config)
├── tools.ts           — Tool registry integration
├── permission.ts      — Permission checking before tool execution
├── result.ts          — Result formatting and display
├── stream.transport.ts — Stream transport layer for testability
└── ...
```

## Key Patterns

- **Session admission**: `openaxe run` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)`.
- **LLM routing**: Decides between AI SDK path and native route runtime based on provider configuration.
- **Tool execution**: Tools are dispatched through the tool registry with permission checking before each invocation.
- **Stream transport**: Separated for testability — `stream.transport.ts` provides a mockable interface.

## Conventions

- All async work uses Effect tasks, not Promises.
- Tool results are streamed back via SSE, not buffered.
- Error recovery is handled at the execution level — failed tool calls are reported to the LLM for retry.

## Anti-Patterns

- Do not add new execution steps directly to `execute.ts` — extract into a dedicated module.
- Do not bypass permission checking when executing tools — always go through `permission.ts`.
- Do not mix AI SDK and native LLM dispatch logic in the same file — keep routing in `llm.ts`.
