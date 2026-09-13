export * as SkillGenerator from "./skill-generator"

import { eq } from "drizzle-orm"
import fs from "node:fs"
import path from "node:path"
import matter from "gray-matter"
import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { ProjectV2 } from "../project"
import { SessionSchema } from "../session/schema"
import { SessionMessageTable, SessionTable } from "../session/sql"

/**
 * Draft payloads emitted by the generator.
 *
 * The plan names these after the plugin v2 effect hooks
 * (packages/plugin/src/v2/effect/{skill,agent}.ts), but those `SkillDraft` /
 * `AgentDraft` interfaces are transform-draft objects ({ source(), list() },
 * { list(), get(), ... }), not data shapes. This generator emits the data the
 * hooks wrap: SkillV2Info ({ name, description, location, content }) and
 * AgentV2Info ({ id, model, system, ... }) from @opencode-ai/sdk/v2/types.
 */
export type SkillDraft = {
  name: string
  description: string
  tools: string[]
  /** Observed argument keys per tool in the pattern. */
  params: Record<string, string[]>
}

export type AgentDraft = {
  name: string
  model: { id: string; providerID: string } | undefined
  systemPrompt: string
  skills: string[]
}

export type Options = {
  /** Minimum occurrences of a tool sequence before it becomes a draft (default 3). */
  readonly minOccurrences?: number
  /** Maximum drafts emitted per run, most frequent first (default 5). */
  readonly maxPatterns?: number
}

const DEFAULT_MIN_OCCURRENCES = 3
const DEFAULT_MAX_PATTERNS = 5

/** Same name guard as tool/skill-write.ts: 1-64 letters, digits, or hyphens. */
const validName = (value: string) => /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/.test(value)

export interface Interface {
  /** Mines one session's tool history and writes skill/agent drafts. Empty when no patterns found. */
  readonly analyzeSession: (sessionId: string) => Effect.Effect<SkillDraft[]>
  /** Mines every session of a project and writes aggregated drafts. */
  readonly generateFromHistory: (projectId: ProjectV2.ID, options?: Options) => Effect.Effect<SkillDraft[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SkillGenerator") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    return {
      analyzeSession: (sessionId: string) => generate(db, { sessionId: SessionSchema.ID.make(sessionId) }),
      generateFromHistory: (projectId: ProjectV2.ID, options?: Options) => generate(db, { projectId }, options),
    }
  }),
)

/**
 * Fork a detached run of `analyzeSession` so generation never blocks the
 * session hot path (same pattern as forkEmbedding in session/message-updater).
 * T16 hooks this to session-end; failures only log.
 */
export const analyzeAndFork = (sessionId: string): Effect.Effect<void, never, Service> =>
  Effect.gen(function* () {
    yield* (yield* Service).analyzeSession(sessionId)
  }).pipe(
    Effect.catchCause((cause) => Effect.logWarning(`skill generation for session ${sessionId} failed`, { cause })),
    Effect.forkDetach({ startImmediately: true }),
    Effect.asVoid,
  )

type ToolCall = { name: string; args: Record<string, unknown> | undefined }
type SessionMine = { sessionID: string; model: { id: string; providerID: string } | undefined; calls: ToolCall[] }

const generate = (
  db: Database.Interface["db"],
  scope: { sessionId: SessionSchema.ID } | { projectId: ProjectV2.ID },
  options?: Options,
): Effect.Effect<SkillDraft[]> =>
  Effect.gen(function* () {
    const mined = yield* mine(db, scope)
    if (mined.directory === undefined) return []
    const patterns = detectPatterns(mined.sessions, options)
    if (patterns.length === 0) return []

    const drafts: SkillDraft[] = []
    for (const pattern of patterns) {
      const skill = toSkillDraft(pattern, mined.sessions)
      drafts.push(skill)
      yield* writeSkill(path.join(mined.directory, ".openaxe", "skills"), pattern, skill)
      yield* writeAgent(path.join(mined.directory, ".openaxe", "agents"), toAgentDraft(pattern, mined.sessions))
    }
    return drafts
  })

/** Session rows (for directory/model) plus ordered tool calls per session. */
const mine = (db: Database.Interface["db"], scope: { sessionId: SessionSchema.ID } | { projectId: ProjectV2.ID }) =>
  Effect.gen(function* () {
    const sessionRows = yield* db
      .select({ id: SessionTable.id, directory: SessionTable.directory, model: SessionTable.model })
      .from(SessionTable)
      .where("sessionId" in scope ? eq(SessionTable.id, scope.sessionId) : eq(SessionTable.project_id, scope.projectId))
      .all()
      .pipe(Effect.orDie)
    if (sessionRows.length === 0) return { directory: undefined, sessions: [] }

    const modelOf = new Map(sessionRows.map((row) => [row.id, sessionModel(row.model)]))
    const bySession = new Map<SessionSchema.ID, ToolCall[]>()
    // eq() keeps its column's table qualification, so the message query filters
    // session_message.session_id directly (project scope joins session, like reflection).
    const messages =
      "sessionId" in scope
        ? db
            .select({
              sessionId: SessionMessageTable.session_id,
              type: SessionMessageTable.type,
              data: SessionMessageTable.data,
            })
            .from(SessionMessageTable)
            .where(eq(SessionMessageTable.session_id, scope.sessionId))
        : db
            .select({
              sessionId: SessionMessageTable.session_id,
              type: SessionMessageTable.type,
              data: SessionMessageTable.data,
            })
            .from(SessionMessageTable)
            .innerJoin(SessionTable, eq(SessionMessageTable.session_id, SessionTable.id))
            .where(eq(SessionTable.project_id, scope.projectId))
    const messageRows = yield* messages.orderBy(SessionMessageTable.seq).all().pipe(Effect.orDie)
    for (const row of messageRows) {
      if (row.type !== "assistant") continue
      const calls = toolCalls(row.data as unknown)
      if (calls.length === 0) continue
      const list = bySession.get(row.sessionId)
      if (list) list.push(...calls)
      else bySession.set(row.sessionId, [...calls])
    }

    // The .openaxe directory is the project directory the sessions share.
    const directory = sessionRows[0].directory
    const sessions: SessionMine[] = [...bySession.entries()].map(([sessionID, calls]) => ({
      sessionID,
      model: modelOf.get(sessionID),
      calls,
    }))
    return { directory, sessions }
  })

type Pattern = {
  tools: string[]
  count: number
  sessions: Map<string, number>
}

/**
 * Sliding-window detection over each session's ordered tool names: single
 * tools, consecutive pairs, and consecutive triples, each counting across
 * sessions. Multi-tool windows whose tools are all identical are skipped — a
 * run of `bash, bash, bash` is already covered by the single-tool pattern.
 */
const detectPatterns = (sessions: SessionMine[], options?: Options): Pattern[] => {
  const min = options?.minOccurrences ?? DEFAULT_MIN_OCCURRENCES
  const found = new Map<string, Pattern>()
  const bump = (tools: string[], sessionID: string) => {
    const key = tools.join("\u0000")
    let pattern = found.get(key)
    if (!pattern) {
      pattern = { tools, count: 0, sessions: new Map() }
      found.set(key, pattern)
    }
    pattern.count++
    pattern.sessions.set(sessionID, (pattern.sessions.get(sessionID) ?? 0) + 1)
  }
  for (const session of sessions) {
    const names = session.calls.map((call) => call.name)
    for (let i = 0; i < names.length; i++) {
      bump([names[i]], session.sessionID)
      if (i + 1 < names.length) bump([names[i], names[i + 1]], session.sessionID)
      if (i + 2 < names.length) bump([names[i], names[i + 1], names[i + 2]], session.sessionID)
    }
  }
  return [...found.values()]
    .filter((pattern) => pattern.count >= min && !(pattern.tools.length > 1 && new Set(pattern.tools).size === 1))
    .sort((a, b) => b.count - a.count)
    .slice(0, options?.maxPatterns ?? DEFAULT_MAX_PATTERNS)
}

const skillName = (tools: string[]) => `auto-${tools.join("-")}`

const toSkillDraft = (pattern: Pattern, sessions: SessionMine[]): SkillDraft => ({
  name: skillName(pattern.tools),
  description: `Automatically generated from ${pattern.count} similar tool sequences: ${pattern.tools.join(" \u2192 ")}.`,
  tools: pattern.tools,
  params: paramsFor(pattern.tools, sessions),
})

const toAgentDraft = (pattern: Pattern, sessions: SessionMine[]): AgentDraft => ({
  name: skillName(pattern.tools),
  model: modelFor(pattern, sessions),
  systemPrompt: [
    `You are an agent specialized in the ${pattern.tools.join(", ")} workflow.`,
    `This workflow was observed ${pattern.count} times across sessions.`,
    `Workflow: ${pattern.tools.map((tool, i) => `${i + 1}. ${tool}`).join(" ")}`,
  ].join("\n"),
  skills: [skillName(pattern.tools)],
})

/** Observed argument keys per tool across the mined sessions. */
const paramsFor = (tools: string[], sessions: SessionMine[]): Record<string, string[]> => {
  const params: Record<string, string[]> = {}
  for (const tool of tools) {
    const keys = new Set<string>()
    for (const session of sessions) {
      for (const call of session.calls) {
        if (call.name === tool && call.args) for (const key of Object.keys(call.args)) keys.add(key)
      }
    }
    params[tool] = [...keys].sort()
  }
  return params
}

/** Model of the session that used the pattern most often. */
const modelFor = (pattern: Pattern, sessions: SessionMine[]): { id: string; providerID: string } | undefined => {
  const best = [...pattern.sessions.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best) return undefined
  return sessions.find((session) => session.sessionID === best[0])?.model
}

const sessionModel = (model: unknown): { id: string; providerID: string } | undefined =>
  isRecord(model) && typeof model.id === "string" && typeof model.providerID === "string"
    ? { id: model.id, providerID: model.providerID }
    : undefined

/** Tool parts of an assistant message's content (defensive: data is unvalidated JSON from the DB). */
const toolCalls = (data: unknown): ToolCall[] => {
  if (!isRecord(data) || !Array.isArray(data.content)) return []
  const calls: ToolCall[] = []
  for (const part of data.content) {
    if (!isRecord(part) || part.type !== "tool") continue
    const name = part.name
    if (typeof name !== "string" || !validName(name)) continue
    const input = isRecord(part.state) ? part.state.input : undefined
    calls.push({ name, args: isRecord(input) ? input : undefined })
  }
  return calls
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const writeSkill = (skillsDir: string, pattern: Pattern, draft: SkillDraft): Effect.Effect<void> => {
  const body = [
    `# ${draft.name}`,
    "",
    `Automatically generated from ${pattern.count} similar tool sequences: ${draft.tools.join(" \u2192 ")}.`,
    "",
    "## Workflow",
    ...draft.tools.map((tool, i) => `${i + 1}. ${tool}`),
    ...(Object.keys(draft.params).length === 0
      ? []
      : ["", "## Parameters", ...Object.entries(draft.params).map(([tool, keys]) => `- ${tool}: ${keys.join(", ")}`)]),
  ].join("\n")
  // Frontmatter name is required for SkillV2 directory discovery (see tool/skill-write.ts).
  return writeFile(
    path.join(skillsDir, draft.name, "SKILL.md"),
    matter.stringify(body, { name: draft.name, description: draft.description, tools: draft.tools }),
  )
}

const writeAgent = (agentsDir: string, draft: AgentDraft): Effect.Effect<void> =>
  writeFile(path.join(agentsDir, `${draft.name}.json`), `${JSON.stringify(draft, null, 2)}\n`)

const writeFile = (filepath: string, content: string): Effect.Effect<void> =>
  Effect.promise(async () => {
    await fs.promises.mkdir(path.dirname(filepath), { recursive: true })
    await Bun.write(filepath, content)
  })
