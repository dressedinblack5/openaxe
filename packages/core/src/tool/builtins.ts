export * as BuiltInTools from "./builtins"

import { Layer } from "effect"
import { BashTool } from "./bash"
import { ApplyPatchTool } from "./apply-patch"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { KanbanTool } from "./kanban"
import { MemoryTool } from "./memory"
import { PlanExitTool } from "./plan-exit"
import { QuestionTool } from "./question"
import { ReadTool } from "./read"
import { ReadToolFileSystem } from "./read-filesystem"
import { SessionSearchTool } from "./session-search"
import { SkillTool } from "./skill"
import { SkillWriteTool } from "./skill-write"
import { TodoWriteTool } from "./todowrite"
import { ToolSearchTool } from "./tool-search"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { WriteTool } from "./write"

/**
 * Composes only the shipped Location-scoped built-in tool transforms.
 * Each tool retains its implementation and focused tests independently. Dynamic
 * MCP and plugin tools later use separate scoped canonical registrations, while
 * provider/model filtering belongs to a future materialization phase rather
 * than this static list. The caller intentionally supplies shared Location
 * services once to this merged set.
 *
 * TODO: Port the remaining launch-follow-up leaves deliberately:
 * - task is deferred: a faithful port must create and prompt a child subagent
 *   session (SessionV2) and track background/abort (BackgroundJob), but neither
 *   service is provided to this Location tool scope, and wiring SessionV2 here
 *   would require a per-location SessionProjector that double-projects durable
 *   session events (session projection is a process-wide concern owned above the
 *   Location layer).
 * - LSP, repo_clone, repo_overview, and Rune/code mode remain deferred pending
 *   core LSP / repository / mode runtime services.
 * Keep MCP and plugin transforms separate from this static built-in list.
 */
export const locationLayer = Layer.mergeAll(
  ApplyPatchTool.layer,
  BashTool.layer,
  EditTool.layer,
  GlobTool.layer,
  GrepTool.layer,
  KanbanTool.layer,
  MemoryTool.layer,
  PlanExitTool.layer,
  QuestionTool.layer,
  ReadTool.layer.pipe(Layer.provide(ReadToolFileSystem.layer)),
  SessionSearchTool.layer,
  SkillTool.layer,
  SkillWriteTool.layer,
  TodoWriteTool.layer,
  ToolSearchTool.layer,
  WebFetchTool.layer,
  WebSearchTool.layer.pipe(Layer.provide(WebSearchTool.defaultConfigLayer)),
  WriteTool.layer,
)
