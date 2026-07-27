# Learning Review

## Overview

Post-turn background eval that auto-discovers skill updates and observations from each interaction. Provides fire-and-forget learning without blocking the main session loop.

## Key Patterns

- **`review()`** — forked as a background job after each assistant turn that returns `"continue"`.
- Evaluates user request + assistant response to decide if skill definitions or observations should be persisted.
- **`experimental.learning.review`** — opt-in boolean config.
- **`experimental.learning.model`** — optional separate model for reviews.

## Conventions

- Learning review is a background task — never blocks the main session loop.
- Reviews are fire-and-forget: failures are silently swallowed.

## Anti-Patterns

- Do not await review results in the main session loop — it's fire-and-forget.
- Do not persist review results without `experimental.learning.review` being enabled.
