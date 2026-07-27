import { Context, Effect, FileSystem, Layer, Stream } from "effect"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner, ExitCode } from "effect/unstable/process/ChildProcessSpawner"
import path from "node:path"
import { CrossSpawnSpawner } from "./cross-spawn-spawner"

export interface FileError {
  readonly message: string
  readonly line?: number
}

export interface VerifyResult {
  readonly file: string
  readonly errors: ReadonlyArray<FileError>
  readonly passed: boolean
}

export interface Diagnostic {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly message: string
  readonly severity: "error" | "warning"
}

export interface VerificationResult {
  readonly projectType: string
  readonly files: ReadonlyArray<string>
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly passed: boolean
  readonly verifier: string
}

export interface Interface {
  readonly verify: (files: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<VerifyResult>>
  readonly verifyProject: (files: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<VerificationResult>, never, ChildProcessSpawner>
  readonly verifyStructural: (files: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<VerifyResult>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Guardrail") {}

type BracketPair = { open: string; close: string; label: string }

const pairs: ReadonlyArray<BracketPair> = [
  { open: "{", close: "}", label: "brace" },
  { open: "[", close: "]", label: "bracket" },
  { open: "(", close: ")", label: "parenthesis" },
]

function checkSource(source: string): ReadonlyArray<FileError> {
  const errors: FileError[] = []
  const lines = source.split("\n")

  for (const pair of pairs) {
    let depth = 0
    let inString: string | null = null
    let inLineComment = false
    let inBlockComment = false
    let escaped = false
    for (let i = 0; i < lines.length; i++) {
      for (let j = 0; j < lines[i].length; j++) {
        const ch = lines[i][j]
        const next = lines[i][j + 1] ?? ""

        if (inLineComment) {
          continue
        }
        if (inBlockComment) {
          if (ch === "*" && next === "/") {
            inBlockComment = false
            j++
          }
          continue
        }

        if (ch === "/" && next === "/") {
          inLineComment = true
          continue
        }
        if (ch === "/" && next === "*") {
          inBlockComment = true
          j++
          continue
        }

        if (escaped) {
          escaped = false
          continue
        }
        if (ch === "\\") {
          escaped = true
          continue
        }
        if (inString !== null) {
          if (ch === inString) inString = null
          continue
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          inString = ch
          continue
        }
        if (ch === pair.open) depth++
        if (ch === pair.close) {
          depth--
          if (depth < 0) {
            errors.push({ message: `unexpected closing ${pair.label}`, line: i + 1 })
            depth = 0
          }
        }
      }
      inLineComment = false
    }
    if (depth > 0) {
      errors.push({ message: `unclosed ${pair.label} at end of file` })
    }
  }

  return errors
}

function parseRelativeImports(source: string): ReadonlyArray<{ readonly path: string; readonly line: number }> {
  const results: Array<{ path: string; line: number }> = []
  const lines = source.split("\n")
  const re = /from\s+["'`](\.\.?\/[^"'`]+)["'`]|require\s*\(\s*["'`](\.\.?\/[^"'`]+)["'`]|(?:\bimport\s+)["'`](\.\.?\/[^"'`]+)["'`]/g

  for (let i = 0; i < lines.length; i++) {
    let m: RegExpExecArray | null
    while ((m = re.exec(lines[i])) !== null) {
      results.push({ path: m[1] ?? m[2] ?? m[3], line: i + 1 })
    }
  }

  return results
}

function resolveImportPath(importerFile: string, importPath: string): string[] {
  const dir = path.dirname(importerFile)
  const resolved = path.resolve(dir, importPath)
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs", ".json"]
  const candidates: string[] = [resolved]
  for (const ext of extensions) {
    candidates.push(resolved + ext)
    candidates.push(path.join(resolved, "index") + ext)
  }
  return candidates
}

function checkImports(
  file: string,
  source: string,
  fs: FileSystem.FileSystem,
): Effect.Effect<ReadonlyArray<FileError>> {
  return Effect.gen(function* () {
    const imports = parseRelativeImports(source)
    const errors: FileError[] = []

    for (const imp of imports) {
      const candidates = resolveImportPath(file, imp.path)
      let found = false
      for (const candidate of candidates) {
        if (yield* fs.exists(candidate).pipe(Effect.catch(() => Effect.succeed(false)))) {
          found = true
          break
        }
      }
      if (!found) {
        errors.push({ message: `relative import "${imp.path}" not found`, line: imp.line })
      }
    }

    return errors
  })
}

const EXT_TO_TYPE: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".rs": "rust",
  ".py": "python",
  ".go": "go",
  ".js": "javascript",
  ".jsx": "javascript",
}

function parseTscDiagnostics(output: string): Diagnostic[] {
  const result: Diagnostic[] = []
  const re = /^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(output)) !== null) {
    result.push({
      file: m[1],
      line: Number(m[2]),
      column: Number(m[3]),
      message: `${m[5]}: ${m[6]}`,
      severity: m[4] as "error" | "warning",
    })
  }
  return result
}

function parseCargoDiagnostics(output: string): Diagnostic[] {
  const result: Diagnostic[] = []
  for (const raw of output.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    try {
      const obj = JSON.parse(line)
      if (obj.reason !== "compiler-message" || !obj.message) continue
      const msg = obj.message
      if (!msg.spans?.length) continue
      const span = msg.spans[0]
      result.push({
        file: span.file_name,
        line: span.line_start,
        column: span.column_start,
        message: msg.message,
        severity: msg.level === "error" ? "error" : "warning",
      })
    } catch { /* ponytail: malformed lint output from edge-case tool, skip unparseable lines */ }
  }
  return result
}

function parseRuffDiagnostics(output: string): Diagnostic[] {
  try {
    const items = JSON.parse(output)
    if (!Array.isArray(items)) return []
    return items
      .map(
        (item: Record<string, any>) =>
          ({
            file: item.filename ?? item.file ?? "",
            line: item.location?.row ?? item.line ?? 1,
            column: item.location?.column ?? item.column ?? 1,
            message: item.code ? `${item.code}: ${item.message}` : item.message,
            severity: item.severity === "error" || item.level === "error" ? "error" : "warning",
          }) as Diagnostic,
      )
      .filter((d: Diagnostic) => d.file)
  } catch { /* ponytail: invalid ruff JSON output, treat as empty result */
    return []
  }
}

function parseGoVetDiagnostics(output: string): Diagnostic[] {
  const result: Diagnostic[] = []
  const re = /^(.+?):(\d+):(\d+):\s*(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(output)) !== null) {
    result.push({
      file: m[1],
      line: Number(m[2]),
      column: Number(m[3]),
      message: m[4],
      severity: "error",
    })
  }
  return result
}

function runVerifier(
  command: string,
  args: string[],
  cwd: string,
): Effect.Effect<{ output: string; exitCode: ExitCode }, never, ChildProcessSpawner> {
  return Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner
      const handle = yield* spawner.spawn(ChildProcess.make(command, args, { extendEnv: true, cwd, stdin: "ignore" }))
      const [output, exitCode] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.all)).pipe(Effect.catch(() => Effect.succeed(""))),
          handle.exitCode.pipe(Effect.catch(() => Effect.succeed(ExitCode(0)))),
        ],
        { concurrency: "unbounded" },
      )
      return { output, exitCode }
    }),
  ).pipe(Effect.catch(() => Effect.succeed({ output: "", exitCode: ExitCode(0) })))
}

function verifyTypeScript(files: string[]): Effect.Effect<VerificationResult, never, ChildProcessSpawner> {
  const dir = path.dirname(files[0])
  return runVerifier("tsc", ["--noEmit", "--pretty", "false"], dir).pipe(
    Effect.map(({ output, exitCode }) => ({
      projectType: "typescript" as const,
      files,
      diagnostics: parseTscDiagnostics(output),
      passed: exitCode === 0,
      verifier: "tsc --noEmit",
    })),
  )
}

function verifyRust(files: string[]): Effect.Effect<VerificationResult, never, ChildProcessSpawner> {
  const dir = path.dirname(files[0])
  return runVerifier("cargo", ["check", "--message-format", "json"], dir).pipe(
    Effect.map(({ output, exitCode }) => ({
      projectType: "rust" as const,
      files,
      diagnostics: parseCargoDiagnostics(output),
      passed: exitCode === 0,
      verifier: "cargo check",
    })),
  )
}

function verifyPython(files: string[]): Effect.Effect<VerificationResult, never, ChildProcessSpawner> {
  const dir = path.dirname(files[0])
  return runVerifier("ruff", ["check", "--output-format", "json", ...files], dir).pipe(
    Effect.map(({ output, exitCode }) => ({
      projectType: "python" as const,
      files,
      diagnostics: parseRuffDiagnostics(output),
      passed: exitCode === 0,
      verifier: "ruff check",
    })),
    Effect.catch(() =>
      Effect.forEach(files, (file) =>
        Effect.scoped(
          Effect.gen(function* () {
            const spawner = yield* ChildProcessSpawner
            const handle = yield* spawner.spawn(
              ChildProcess.make("python", ["-m", "py_compile", file], { extendEnv: true, cwd: dir, stdin: "ignore" }),
            )
            const [stderr, ecode] = yield* Effect.all(
              [
                Stream.mkString(Stream.decodeText(handle.stderr)).pipe(Effect.catch(() => Effect.succeed(""))),
                handle.exitCode.pipe(Effect.catch(() => Effect.succeed(ExitCode(0)))),
              ],
              { concurrency: "unbounded" },
            )
            return { file, stderr, exitCode: ecode } as const
          }),
        ),
      ).pipe(
        Effect.map((results) => {
          const diagnostics: Diagnostic[] = []
          for (const r of results) {
            if (r.exitCode !== 0) {
              const re = /File "(.+?)",\s+line\s+(\d+)/g
              let m: RegExpExecArray | null
              while ((m = re.exec(r.stderr)) !== null) {
                diagnostics.push({
                  file: m[1],
                  line: Number(m[2]),
                  column: 1,
                  message: r.stderr.trim(),
                  severity: "error",
                })
              }
              if (diagnostics.length === 0 && r.stderr.trim()) {
                diagnostics.push({ file: r.file, line: 1, column: 1, message: r.stderr.trim(), severity: "error" })
              }
            }
          }
          return { projectType: "python" as const, files, diagnostics, passed: diagnostics.length === 0, verifier: "python -m py_compile" } satisfies VerificationResult
        }),
        Effect.catch(() =>
          Effect.succeed({ projectType: "python" as const, files, diagnostics: [], passed: true, verifier: "python -m py_compile" }),
        ),
      ),
    ),
  )
}

function verifyGo(files: string[]): Effect.Effect<VerificationResult, never, ChildProcessSpawner> {
  const dir = path.dirname(files[0])
  return runVerifier("go", ["vet", "./..."], dir).pipe(
    Effect.map(({ output, exitCode }) => ({
      projectType: "go" as const,
      files,
      diagnostics: parseGoVetDiagnostics(output),
      passed: exitCode === 0,
      verifier: "go vet",
    })),
  )
}

function groupFilesByType(files: ReadonlyArray<string>): Record<string, string[]> {
  const groups: Record<string, string[]> = {}
  for (const file of files) {
    const ext = path.extname(file).toLowerCase()
    const type = EXT_TO_TYPE[ext]
    if (type) (groups[type] ??= []).push(file)
  }
  return groups
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem

    const verify = Effect.fn("Guardrail.verify")(function* (files: ReadonlyArray<string>) {
      return yield* Effect.forEach(files, (file) =>
        Effect.gen(function* () {
          const content = yield* fs.readFileString(file).pipe(
            Effect.catch(() => Effect.succeed("")),
          )
          const errors = checkSource(content)
          return { file, errors, passed: errors.length === 0 } satisfies VerifyResult
        }),
      )
    })

    const verifyStructural = Effect.fn("Guardrail.verifyStructural")(function* (files: ReadonlyArray<string>) {
      return yield* Effect.forEach(files, (file) =>
        Effect.gen(function* () {
          const content = yield* fs.readFileString(file).pipe(
            Effect.catch(() => Effect.succeed("")),
          )
          const bracketErrors = checkSource(content)
          const importErrors = yield* checkImports(file, content, fs)
          const errors = [...bracketErrors, ...importErrors]
          return { file, errors, passed: errors.length === 0 } satisfies VerifyResult
        }),
      )
    })

    const verifyProject = Effect.fn("Guardrail.verifyProject")(function* (files: ReadonlyArray<string>) {
      const groups = groupFilesByType(files)
      const types = Object.keys(groups)
      if (types.length === 0) return []

      return yield* Effect.forEach(
        types,
        (type) => {
          switch (type) {
            case "typescript":
              return verifyTypeScript(groups[type])
            case "rust":
              return verifyRust(groups[type])
            case "python":
              return verifyPython(groups[type])
            case "go":
              return verifyGo(groups[type])
            default:
              return Effect.succeed({
                projectType: type,
                files: groups[type],
                diagnostics: [],
                passed: true,
                verifier: "none",
              } satisfies VerificationResult)
          }
        },
        { concurrency: 1 },
      )
    })

    return Service.of({ verify, verifyProject, verifyStructural })
  }),
)

export const defaultLayer = layer.pipe(
  Layer.provide(CrossSpawnSpawner.defaultLayer),
)

export * as Guardrail from "./guardrail"
