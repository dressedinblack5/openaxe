import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Effect } from "effect"
import type { Session } from "@/session/session"
import type { SessionID } from "@/session/schema"
import type { Agent } from "./agent"

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent session's full permission ruleset — allow, deny, and
 *    external_directory rules all cascade to the child so the parent's
 *    approved/denied session permissions apply to everything it spawns.
 * 2. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them. These come last so they win over any
 *    inherited parent allow for those tools.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = input.subagent.permission.some((rule) => Wildcard.match("task", rule.permission))
  const canTodo = input.subagent.permission.some((rule) => Wildcard.match("todowrite", rule.permission))
  return [
    ...input.parentSessionPermission,
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
}

/**
 * Number of ancestor sessions above `session` (0 for a root session) — the
 * subagent depth a child spawned from `session` would have. Walks the
 * parentID chain; missing sessions terminate the walk early.
 */
export function ancestorDepth(
  getSession: (id: SessionID) => Effect.Effect<Session.Info, unknown>,
  session: { parentID?: SessionID },
): Effect.Effect<number> {
  return Effect.gen(function* () {
    let depth = 0
    let current: { parentID?: SessionID } | undefined = session
    while (current?.parentID) {
      depth += 1
      current = yield* getSession(current.parentID).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    }
    return depth
  })
}
