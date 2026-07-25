# Context Compressor

## Overview

LLM-driven structured compression with ghost-skill re-injection. Produces sectioned summaries (decisions, code changes, context, unresolved items) that preserve agent context across long sessions.

## Key Patterns

- **`compress()`** — consumes active skill definitions as "ghost skills" in the compression prompt. Returns structured sections + dense summary + list of referenced skills.
- **`experimental.compressor.enabled`** — opt-in config flag.
- **`experimental.compressor.model`** — optional separate model for compression (defaults to the main model).

## Conventions

- Compression is a background hook called during compaction before the compaction LLM prompt.
- Ghost skills are skill definitions available at compression time, ensuring the agent retains awareness of its toolset.

## Anti-Patterns

- Do not run compressor on every turn — only during compaction boundaries.
- Do not include raw tool results in compressed summaries — summarize decisions and outcomes.
