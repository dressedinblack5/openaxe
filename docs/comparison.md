# openaxe vs alternatives: open-source terminal AI coding agents

A comparison of open-source AI coding agents that run in the terminal, for developers
choosing between openaxe, official OpenCode, and other CLI coding assistants.

## TL;DR

- **openaxe** — lean, security-first fork of OpenCode. TUI/CLI only, Effect v4
  throughout, ~1.1 GB dependencies. Best when you want a lighter terminal agent
  without Electron or web apps.
- **Official OpenCode** — the upstream project (https://github.com/anomalyco/opencode
  fork lineage; originally sst/opencode). Full feature set including desktop and web
  UIs. Best when you want everything upstream ships.
- **Other terminal agents** (e.g. community CLI wrappers around major LLM APIs) —
  worth evaluating when you are locked into a single provider or need a minimal
  single-script tool.

## openaxe vs official OpenCode

| | openaxe | official opencode |
|---|---|---|
| Monorepo size | 13 packages | 36 |
| Dependency footprint | ~1.1 GB | ~2 GB+ |
| Architecture | TUI/CLI only | TUI + Electron + web apps |
| Effects | Effect v4 throughout | Mixed patterns |
| Plugin audit | All plugins reviewed for TUI/CLI compliance | Unrestricted |
| Security surface | No Electron, no web app attack surface | Electron + web stack |
| Startup | Lazy-loaded CLI commands | Eager imports |

## What openaxe keeps from OpenCode

15+ LLM providers (Anthropic, OpenAI, Google, Groq, Mistral, AWS Bedrock, Azure,
TogetherAI, xAI, DeepInfra, Perplexity, Cerebras, OpenRouter, Alibaba, Venice),
SolidJS terminal UI, MCP + ACP support, SQLite-backed persistent sessions, GitHub
integration, headless server mode, and a native Effect-based LSP client (17 code
intelligence operations, 30+ language servers).

## When to choose openaxe

- You work primarily in the terminal (Linux/macOS/Windows) and want a fast,
  low-footprint AI coding assistant.
- Security surface matters: no Electron, no bundled web apps.
- You prefer Effect-based TypeScript internals.

Repository: https://github.com/dressedinblack5/openaxe
Machine-readable summary: [llms.txt](../llms.txt)
