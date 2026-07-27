# Prompt Building

## Overview

Session prompt construction and admission. Handles durable `session_input` rows, prompt projection, and model-ready message formatting.

## Key Patterns

- **Durable admission**: `SessionV2.prompt(...)` admits one durable `session_input` row before scheduling advisory `SessionExecution.wake(sessionID)`.
- **Resume behavior**: `resume: false` requests admit-only behavior (no execution wakeup).
- **History reload**: Projected history is reloaded before durable continuation to ensure up-to-date context.
- **Promote boundaries**: Prompts promote at the next safe provider-turn boundary. An explicit `queue` input promotes when the session would otherwise become idle.

## Conventions

- Keep prompt admission separate from model execution.
- Serialize runner promotes admitted inputs into visible user messages at safe boundaries.
- One `llm.stream(request)` call per provider turn.

## Anti-Patterns

- Do not skip prompt admission — every user message must go through durable admission.
- Do not bridge through legacy `SessionPrompt.loop(...)` — use the serialized runner directly.
- Do not promote without reloading projected history first.
