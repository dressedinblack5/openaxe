# SESSION ORCHESTRATION

## OVERVIEW

Durable session orchestration and LLM dispatch engine for openaxe.

## STRUCTURE

```
src/session/
├── llm/                LLM runtime adapters (AI SDK / Native) [see llm/AGENTS.md]
├── prompt/             Prompt building and system context algebra
├── llm.ts              LLM dispatch entry point (AI SDK vs Native)
├── session.ts          Session runner and orchestration
├── status.ts           Session lifecycle and state tracking
├── retry.ts            Retry logic for provider turns
└── ...                 (20+ files total)
```

## WHERE TO LOOK

| Task            | File                                         |
| --------------- | -------------------------------------------- |
| Input admission | `src/session/prompt.ts` (`SessionV2.prompt`) |
| Session runner  | `src/session/session.ts`                     |
| LLM dispatch    | `src/session/llm.ts`                         |
| Status tracking | `src/session/status.ts`                      |
| Retry logic     | `src/session/retry.ts`                       |
| System context  | `src/session/prompt/`                        |

## ARCHITECTURE NOTES

- **Durable Admission**: `SessionV2.prompt()` admits inputs to the database. It doesn't execute them immediately. `SessionExecution.wake()` triggers the drain.
- **Runtime Duality**: AI SDK is the default. Native runtime is opt-in via `OPENCODE_EXPERIMENTAL_NATIVE_LLM`.
- **Location Scoping**: `SessionRunner` binds model resolution, tool registry, and permissions to a specific filesystem location.
- **Process Global**: `SessionExecution` tracks active sessions across the process. It uses `LocationServiceMap` for placement.
- **EventV2**: Uses EventV2 for replay and transcript history.

## CONVENTIONS

- Use `SessionV2` for all durable transcript operations.
- Don't bridge through legacy `SessionPrompt.loop`.
- Keep durable prompt admission separate from model execution.
- Historical prompts lazily synthesize promoted records during retry.
