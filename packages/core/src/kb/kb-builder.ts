export * as KB from "./kb-builder"

import { desc, eq } from "drizzle-orm"
import { Context, Effect, Layer, Option, Result } from "effect"
import matter from "gray-matter"
import path from "node:path"
import { Database } from "../database/database"
import { Embedding } from "../embedding/embedding"
import { FSUtil } from "../fs-util"
import { ProjectV2 } from "../project"
import { ProjectTable } from "../project/sql"
import { SessionMessageTable, SessionTable } from "../session/sql"

/**
 * Project KB auto-builder. Generates `.openaxe/kb/{architecture,patterns,decisions,errors}.md`
 * from a project's session history (titles, user prompts, tool usage, tool errors).
 *
 * LSP is intentionally NOT used: core has no LSP client (that lives in
 * packages/openaxe/src/lsp) and core cannot depend on openaxe. Session summaries
 * + message content are the KB sources instead.
 *
 * User-edited content between `<!-- USER:START -->` / `<!-- USER:END -->` markers is
 * preserved verbatim across re-builds; everything else is regenerated.
 */

export const USER_START = "<!-- USER:START -->"
export const USER_END = "<!-- USER:END -->"

export const KB_FILES = ["architecture", "patterns", "decisions", "errors"] as const
export type KbFile = (typeof KB_FILES)[number]

/** `.openaxe/kb` under the project directory (same base dir convention as session templates). */
export const kbDir = (directory: string) => path.join(directory, ".openaxe", "kb")

const TITLES: Record<KbFile, string> = {
  architecture: "Project Architecture",
  patterns: "Project Patterns",
  decisions: "Project Decisions",
  errors: "Project Errors",
}

interface SessionSummary {
  readonly id: string
  readonly title: string
  /** Title + extracted user/shell message text — the raw text keyword classification runs over. */
  readonly text: string
  readonly tags: readonly string[]
  readonly tools: ReadonlyMap<string, number>
  readonly errors: readonly string[]
}

export interface Interface {
  readonly build: (projectId: ProjectV2.ID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/KBBuilder") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const fs = yield* FSUtil.Service
    return { build: (projectId) => buildProject(db, fs, projectId) }
  }),
)

/** Convenience for callers that provide KBBuilder.layer (e.g. `openaxe kb build`, T16). */
export const run = (projectId: ProjectV2.ID): Effect.Effect<void, never, Service> =>
  Effect.gen(function* () {
    yield* (yield* Service).build(projectId)
  })

const buildProject = (
  db: Database.Interface["db"],
  fs: FSUtil.Interface,
  projectId: ProjectV2.ID,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const dir = yield* projectDirectory(db, projectId).pipe(Effect.orDie)
    if (dir === undefined) {
      // ponytail: no project row and no sessions for this id — nothing to build against, no-op.
      yield* Effect.logWarning(`KBBuilder: no project or session rows for ${projectId}, skipping`)
      return
    }
    const summaries = yield* loadSummaries(db, projectId)
    const related = yield* relatedGroups(summaries)
    for (const file of KB_FILES) {
      const { blocks, sourceSessions } = sectionsFor(file, summaries, related)
      const generated = matter.stringify(renderBody(file, blocks), frontmatterFor(file, sourceSessions))
      const filePath = path.join(kbDir(dir), `${file}.md`)
      const old = yield* fs.readFileStringSafe(filePath).pipe(Effect.orDie)
      yield* fs.writeWithDirs(filePath, preserveUserSections(old, generated)).pipe(Effect.orDie)
    }
  })

/** Project directory from the project row, falling back to the latest session's directory. */
const projectDirectory = (db: Database.Interface["db"], projectId: ProjectV2.ID): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const project = yield* db
      .select({ worktree: ProjectTable.worktree })
      .from(ProjectTable)
      .where(eq(ProjectTable.id, projectId))
      .get()
      .pipe(Effect.orDie)
    if (project) return String(project.worktree)
    const session = yield* db
      .select({ directory: SessionTable.directory })
      .from(SessionTable)
      .where(eq(SessionTable.project_id, projectId))
      .orderBy(desc(SessionTable.time_updated))
      .get()
      .pipe(Effect.orDie)
    return session ? session.directory : undefined
  })

const loadSummaries = (db: Database.Interface["db"], projectId: ProjectV2.ID): Effect.Effect<readonly SessionSummary[]> =>
  Effect.gen(function* () {
    const sessions = yield* db
      .select({
        id: SessionTable.id,
        title: SessionTable.title,
        metadata: SessionTable.metadata,
      })
      .from(SessionTable)
      .where(eq(SessionTable.project_id, projectId))
      .orderBy(desc(SessionTable.time_updated))
      .all()
      .pipe(Effect.orDie)

    const rows = yield* db
      .select({
        sessionID: SessionMessageTable.session_id,
        type: SessionMessageTable.type,
        data: SessionMessageTable.data,
      })
      .from(SessionMessageTable)
      .innerJoin(SessionTable, eq(SessionMessageTable.session_id, SessionTable.id))
      .where(eq(SessionTable.project_id, projectId))
      .all()
      .pipe(Effect.orDie)

    const bySession = new Map<string, { lines: string[]; tools: Map<string, number>; errors: Set<string> }>()
    for (const row of rows) {
      const key = String(row.sessionID)
      const acc = bySession.get(key) ?? { lines: [], tools: new Map<string, number>(), errors: new Set<string>() }
      bySession.set(key, acc)
      const text = messageText(row.type, row.data)
      if (text !== "") acc.lines.push(text)
      for (const part of toolParts(row.data)) {
        acc.tools.set(part.name, (acc.tools.get(part.name) ?? 0) + 1)
        if (part.error !== undefined) acc.errors.add(part.error)
      }
    }

    return sessions.map((session) => {
      const acc = bySession.get(String(session.id)) ?? { lines: [], tools: new Map<string, number>(), errors: new Set<string>() }
      return {
        id: String(session.id),
        title: session.title,
        text: [session.title, ...acc.lines].join("\n"),
        tags: tagsOf(session.metadata),
        tools: acc.tools,
        errors: [...acc.errors],
      }
    })
  })

/** Defensive extraction: data is unvalidated JSON from the DB (T15 reflection.ts pattern). */
const messageText = (type: string, data: unknown): string => {
  if (!isRecord(data)) return ""
  if (type === "shell") return typeof data.command === "string" ? data.command : ""
  if (type === "compaction") return typeof data.summary === "string" ? data.summary : ""
  return typeof data.text === "string" ? data.text : ""
}

const toolParts = (data: unknown): ReadonlyArray<{ name: string; error: string | undefined }> => {
  if (!isRecord(data) || !Array.isArray(data.content)) return []
  return data.content.flatMap((part) => {
    if (!isRecord(part) || part.type !== "tool") return []
    const state = isRecord(part.state) ? part.state : undefined
    const error = state !== undefined && (state.status === "error" || state.error !== undefined) ? errorText(state.error) : undefined
    return [{ name: typeof part.name === "string" ? part.name : "unknown", error }]
  })
}

const errorText = (error: unknown): string => {
  if (!isRecord(error)) return ""
  if (typeof error.message === "string") return error.message
  const data = error.data
  if (isRecord(data) && typeof data.message === "string") return data.message
  return ""
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const tagsOf = (metadata: Record<string, unknown> | null | undefined): readonly string[] => {
  if (metadata === null || metadata === undefined || !Array.isArray(metadata.tags)) return []
  return metadata.tags.filter((tag): tag is string => typeof tag === "string")
}

/**
 * Related sessions: embed each summary and group sessions whose vectors are
 * nearly identical (cosine >= threshold). When no Embedding service is in
 * context or embedding fails, fall back to grouping sessions that share a
 * metadata tag. Related sessions extend each file's sourceSessions.
 */
const RELATED_THRESHOLD = 0.9

const relatedGroups = (summaries: readonly SessionSummary[]): Effect.Effect<ReadonlyMap<string, readonly string[]>> =>
  Effect.gen(function* () {
    if (summaries.length < 2) return new Map<string, readonly string[]>()
    const embedding = yield* Effect.serviceOption(Embedding.Service)
    if (Option.isSome(embedding)) {
      const result = yield* embedding.value.embed(summaries.map((summary) => summary.text)).pipe(Effect.result)
      if (Result.isFailure(result)) {
        yield* Effect.logWarning(
          `KBBuilder: embedding failed (${result.failure._tag}), grouping related sessions by metadata tags`,
        )
      } else {
        const vectors = result.success.vectors
        if (vectors.length === summaries.length && vectors.every((vector) => vector.length > 0)) {
          return relatedByVectors(summaries, vectors)
        }
      }
    }
    return relatedByTags(summaries)
  })

const relatedByVectors = (
  summaries: readonly SessionSummary[],
  vectors: readonly number[][],
): ReadonlyMap<string, readonly string[]> => {
  const related = new Map<string, string[]>()
  for (let i = 0; i < summaries.length; i++) {
    for (let j = i + 1; j < summaries.length; j++) {
      if (cosine(vectors[i], vectors[j]) >= RELATED_THRESHOLD) {
        link(related, summaries[i].id, summaries[j].id)
        link(related, summaries[j].id, summaries[i].id)
      }
    }
  }
  return related
}

const relatedByTags = (summaries: readonly SessionSummary[]): ReadonlyMap<string, readonly string[]> => {
  const byTag = new Map<string, string[]>()
  for (const summary of summaries) {
    for (const tag of summary.tags) byTag.set(tag, [...(byTag.get(tag) ?? []), summary.id])
  }
  const related = new Map<string, string[]>()
  for (const ids of byTag.values()) {
    if (ids.length < 2) continue
    for (const id of ids) {
      related.set(id, [...new Set([...(related.get(id) ?? []), ...ids])].filter((other) => other !== id))
    }
  }
  return related
}

const link = (related: Map<string, string[]>, a: string, b: string) => {
  const list = related.get(a) ?? []
  if (!list.includes(b)) related.set(a, [...list, b])
}

const cosine = (a: readonly number[], b: readonly number[]): number => {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

const TOPIC_KEYWORDS: Record<KbFile, RegExp> = {
  architecture: /architecture|structur|layout|module|package|component|refactor|how (does|is|are)|where (is|are)|codebase|overview|entry ?point/i,
  patterns: /pattern|workflow|repeat|recurring|always|convention|habit|standard practice|reusable|boilerplate/i,
  decisions: /decide|decided|decision|choose|chose|prefer|switch to|should we|use .* instead|tradeoff|trade-off|why did/i,
  errors: /error|fail|broken|crash|exception|not working|issue|bug/i,
}

const sectionsFor = (
  file: KbFile,
  summaries: readonly SessionSummary[],
  related: ReadonlyMap<string, readonly string[]>,
) => {
  const contributors = summaries.filter((summary) => contributes(file, summary))
  const sourceSessions = [
    ...new Set(contributors.flatMap((summary) => [summary.id, ...(related.get(summary.id) ?? [])])),
  ]
  const blocks = contributors.map((summary) => ({
    heading: `## ${summary.title} (${summary.id})`,
    bullets: bulletsFor(file, summary),
  }))
  return { blocks, sourceSessions }
}

const contributes = (file: KbFile, summary: SessionSummary): boolean =>
  file === "errors"
    ? summary.errors.length > 0 || TOPIC_KEYWORDS.errors.test(summary.text)
    : TOPIC_KEYWORDS[file].test(summary.text)

const bulletsFor = (file: KbFile, summary: SessionSummary): readonly string[] => {
  const matched = [
    ...new Set(
      summary.text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && TOPIC_KEYWORDS[file].test(line)),
    ),
  ].slice(0, 5)
  const errorBullets = [...new Set(summary.errors)].slice(0, 5).map((error) => `- ${error}`)
  if (file === "patterns") {
    const tools = [...summary.tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    const toolLine =
      tools.length > 0 ? `- Repeated tools: ${tools.map(([name, count]) => `${name} (${count})`).join(", ")}` : ""
    return [...matched, ...(toolLine === "" ? [] : [toolLine])]
  }
  if (file === "errors") return [...errorBullets, ...matched]
  return matched
}

const renderBody = (file: KbFile, blocks: readonly { heading: string; bullets: readonly string[] }[]): string => {
  const sections =
    blocks.length > 0
      ? blocks
          .map((block) => `${block.heading}\n\n${block.bullets.length > 0 ? block.bullets.join("\n") : "_Nothing extracted from this session yet._"}`)
          .join("\n\n")
      : "_Nothing extracted from recent sessions yet._"
  // The marker block is always present so user edits land in a stable slot across re-builds.
  return `# ${TITLES[file]}\n\n${sections}\n\n${USER_START}\n${USER_END}\n`
}

const frontmatterFor = (file: KbFile, sourceSessions: readonly string[]) => ({
  title: TITLES[file],
  generatedAt: new Date().toISOString(),
  sourceSessions: [...sourceSessions],
})

const userBlock = (content: string): string | undefined => {
  const start = content.indexOf(USER_START)
  if (start < 0) return undefined
  const end = content.indexOf(USER_END, start)
  if (end < 0) return undefined
  return content.slice(start, end + USER_END.length)
}

/**
 * Re-splice the user-edited marker block from the old file into the freshly
 * generated content. Missing old content or markers means the file is
 * fully machine-generated (or brand new) — regenerate it wholesale.
 */
export const preserveUserSections = (oldContent: string | undefined, newContent: string): string => {
  if (oldContent === undefined) return newContent
  const preserved = userBlock(oldContent)
  if (preserved === undefined) return newContent
  const generatedBlock = userBlock(newContent)
  if (generatedBlock === undefined) return newContent
  return newContent.replace(generatedBlock, preserved)
}
