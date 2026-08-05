export * as ConfigTemplate from "./template"

import { Schema } from "effect"
import { PermissionV1 } from "@opencode-ai/schema/permission-v1"

export const SessionTemplateStep = Schema.Struct({
  name: Schema.String,
  prompt: Schema.String,
  model: Schema.String.pipe(Schema.optional),
})
export type SessionTemplateStep = typeof SessionTemplateStep.Type

/**
 * YAML object form of a permission ruleset, mirroring the agent config shape:
 * `{ bash: "allow" }` or `{ edit: { "src/**": "deny" } }`.
 */
export const Permissions = Schema.Record(
  Schema.String,
  Schema.Union([PermissionV1.Action, Schema.Record(Schema.String, PermissionV1.Action)]),
)
export type Permissions = typeof Permissions.Type

/**
 * A reusable session preset stored as `.openaxe/templates/<name>.yaml`.
 * `mcp`/`tools` are opaque passthroughs validated structurally but not
 * consumed by the runtime; model/agent/permissions/steps are applied to the
 * created session.
 */
export class SessionTemplate extends Schema.Class<SessionTemplate>("SessionTemplate")({
  name: Schema.String,
  description: Schema.String.pipe(Schema.optional),
  model: Schema.String.pipe(Schema.optional),
  systemPrompt: Schema.String.pipe(Schema.optional),
  agent: Schema.String.pipe(Schema.optional),
  permissions: Permissions.pipe(Schema.optional),
  mcp: Schema.Record(Schema.String, Schema.Unknown).pipe(Schema.optional),
  tools: Schema.Array(Schema.String).pipe(Schema.optional),
  steps: Schema.Array(SessionTemplateStep).pipe(Schema.optional),
}) {}
