import { Effect, Schema } from "effect"
import type { Context } from "./tool"
import { define } from "./tool"
import path from "path"
import { LSP, type Range as LspRange } from "@/lsp/lsp"
import DESCRIPTION from "./lsp.txt"
import { InstanceState } from "@/effect/instance-state"
import { pathToFileURL } from "url"
import { assertExternalDirectoryEffect } from "./external-directory"
import { FSUtil } from "@opencode-ai/core/fs-util"

type LspOperation =
  | "goToDefinition"
  | "findReferences"
  | "hover"
  | "documentSymbol"
  | "workspaceSymbol"
  | "goToImplementation"
  | "prepareCallHierarchy"
  | "incomingCalls"
  | "outgoingCalls"
  | "codeAction"
  | "rename"
  | "prepareRename"
  | "typeDefinition"
  | "signatureHelp"
  | "completion"
  | "formatting"
  | "applyCodeAction"

interface OperationDef {
  readonly buildInput: (args: Args, file: string, uri: string, pos: Pos) => unknown
  readonly permissionMeta: (args: Args, file: string, relPath: string) => Record<string, unknown>
  readonly validate?: (args: Args) => Effect.Effect<void, Error>
}

interface Args {
  operation: LspOperation
  filePath: string
  line: number
  character: number
  query?: string
  newName?: string
  tabSize?: number
  insertSpaces?: boolean
  title?: string
  range?: LspRange
}

interface Pos { file: string; line: number; character: number }

const operationTable: Record<LspOperation, OperationDef> = {
  goToDefinition: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "goToDefinition", filePath: relPath, line: args.line, character: args.character }),
  },
  findReferences: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "findReferences", filePath: relPath, line: args.line, character: args.character }),
  },
  hover: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "hover", filePath: relPath, line: args.line, character: args.character }),
  },
  documentSymbol: {
    buildInput: (_, __, uri) => ({ uri }),
    permissionMeta: (_, file) => ({ operation: "documentSymbol", filePath: file }),
  },
  workspaceSymbol: {
    buildInput: (args) => ({ query: args.query ?? "" }),
    permissionMeta: () => ({ operation: "workspaceSymbol" }),
  },
  goToImplementation: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "goToImplementation", filePath: relPath, line: args.line, character: args.character }),
  },
  prepareCallHierarchy: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "prepareCallHierarchy", filePath: relPath, line: args.line, character: args.character }),
  },
  incomingCalls: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "incomingCalls", filePath: relPath, line: args.line, character: args.character }),
  },
  outgoingCalls: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "outgoingCalls", filePath: relPath, line: args.line, character: args.character }),
  },
  codeAction: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "codeAction", filePath: relPath, line: args.line, character: args.character }),
  },
  prepareRename: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "prepareRename", filePath: relPath, line: args.line, character: args.character }),
  },
  rename: {
    buildInput: (args, __, ___, pos) => ({ ...pos, newName: args.newName! }),
    permissionMeta: (args, __, relPath) => ({ operation: "rename", filePath: relPath, line: args.line, character: args.character }),
    validate: (args) => args.newName ? Effect.void : Effect.fail(new Error("newName is required for rename operation")),
  },
  typeDefinition: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "typeDefinition", filePath: relPath, line: args.line, character: args.character }),
  },
  signatureHelp: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "signatureHelp", filePath: relPath, line: args.line, character: args.character }),
  },
  completion: {
    buildInput: (_, __, ___, pos) => pos,
    permissionMeta: (args, __, relPath) => ({ operation: "completion", filePath: relPath, line: args.line, character: args.character }),
  },
  formatting: {
    buildInput: (args, file) => ({ file, tabSize: args.tabSize, insertSpaces: args.insertSpaces }),
    permissionMeta: () => ({ operation: "formatting" }),
  },
  applyCodeAction: {
    buildInput: (args, __, ___, pos) => ({ ...pos, title: args.title!, range: args.range }),
    permissionMeta: (args, __, relPath) => ({ operation: "applyCodeAction", filePath: relPath, line: args.line, character: args.character }),
    validate: (args) => args.title ? Effect.void : Effect.fail(new Error("title is required for applyCodeAction operation")),
  },
} as const

const operationKeys = Object.keys(operationTable) as LspOperation[]

export const Parameters = Schema.Struct({
  operation: Schema.Literals(operationKeys).annotate({ description: "The LSP operation to perform" }),
  filePath: Schema.String.annotate({ description: "The absolute or relative path to the file" }),
  line: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The line number (1-based, as shown in editors)",
  }),
  character: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The character offset (1-based, as shown in editors)",
  }),
  query: Schema.optional(Schema.String).annotate({
    description: "Search query for workspaceSymbol. Empty string requests all symbols.",
  }),
  newName: Schema.optional(Schema.String).annotate({
    description: "New name for rename operation.",
  }),
  tabSize: Schema.optional(Schema.Int).annotate({
    description: "Tab size for formatting (default 2).",
  }),
  insertSpaces: Schema.optional(Schema.Boolean).annotate({
    description: "Use spaces for formatting (default true).",
  }),
  title: Schema.optional(Schema.String).annotate({
    description: "Title of the code action to apply (required for applyCodeAction).",
  }),
})

export const LspTool = define(
  "lsp",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* FSUtil.Service
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (args: Args, ctx: Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const file = path.isAbsolute(args.filePath) ? args.filePath : path.join(instance.directory, args.filePath)
          yield* assertExternalDirectoryEffect(ctx, file)

          const opName = args.operation
          const op = operationTable[opName]
          if (!op) throw new Error(`Unknown LSP operation: ${args.operation}`)
          if (op.validate) yield* op.validate(args)

          const uri = pathToFileURL(file).href
          const pos = { file, line: args.line - 1, character: args.character - 1 }
          const relPath = path.relative(instance.worktree, file)
          const detail =
            args.operation === "workspaceSymbol" || args.operation === "formatting"
              ? ""
              : args.operation === "documentSymbol"
                ? relPath
                : `${relPath}:${args.line}:${args.character}`
          const title = detail ? `${String(args.operation)} ${detail}` : String(args.operation)

          const meta = op.permissionMeta(args, file, file)
          yield* ctx.ask({
            permission: "lsp",
            patterns: ["*"],
            always: ["*"],
            metadata: meta,
          })

          const exists = yield* fs.existsSafe(file)
          if (!exists) throw new Error(`File not found: ${file}`)

          const available = yield* lsp.hasClients(file)
          if (!available) throw new Error("No LSP server available for this file type.")

          yield* lsp.touchFile(file, "document")

          const input = op.buildInput(args, file, uri, pos)
          const callLsp: (opName: LspOperation, input: unknown) => Effect.Effect<unknown[], never, never> = (opName, input) => {
            switch (opName) {
              case "goToDefinition": return lsp.definition(input as { file: string; line: number; character: number }) as Effect.Effect<unknown[], never, never>
              case "findReferences": return lsp.references(input as { file: string; line: number; character: number }) as Effect.Effect<unknown[], never, never>
              case "hover": return lsp.hover(input as { file: string; line: number; character: number }) as Effect.Effect<unknown[], never, never>
              case "documentSymbol": return lsp.documentSymbol((input as { uri: string }).uri) as Effect.Effect<unknown[], never, never>
              case "workspaceSymbol": return lsp.workspaceSymbol((input as { query: string }).query) as Effect.Effect<unknown[], never, never>
              case "goToImplementation": return lsp.implementation(input as { file: string; line: number; character: number }) as Effect.Effect<unknown[], never, never>
              case "prepareCallHierarchy": return lsp.prepareCallHierarchy(input as { file: string; line: number; character: number }) as Effect.Effect<unknown[], never, never>
              case "incomingCalls": return lsp.incomingCalls(input as { file: string; line: number; character: number }) as Effect.Effect<unknown[], never, never>
              case "outgoingCalls": return lsp.outgoingCalls(input as { file: string; line: number; character: number }) as Effect.Effect<unknown[], never, never>
              case "codeAction": return lsp.codeAction(input as { file: string; line: number; character: number; range?: LspRange }) as Effect.Effect<unknown[], never, never>
              case "prepareRename": return lsp.prepareRename(input as { file: string; line: number; character: number }) as Effect.Effect<unknown[], never, never>
              case "rename": return lsp.rename(input as { file: string; line: number; character: number; newName: string }) as Effect.Effect<unknown[], never, never>
              case "typeDefinition": return lsp.typeDefinition(input as { file: string; line: number; character: number }) as Effect.Effect<unknown[], never, never>
              case "signatureHelp": return lsp.signatureHelp(input as { file: string; line: number; character: number }) as Effect.Effect<unknown[], never, never>
              case "completion": return lsp.completion(input as { file: string; line: number; character: number }) as Effect.Effect<unknown[], never, never>
              case "formatting": return lsp.formatting(input as { file: string; tabSize?: number; insertSpaces?: boolean }) as Effect.Effect<unknown[], never, never>
              case "applyCodeAction": return lsp.applyCodeAction(input as { file: string; line: number; character: number; title: string; range?: LspRange }) as Effect.Effect<unknown[], never, never>
              default: throw new Error(`Unhandled LSP operation: ${String(opName)}`)
            }
          }
          const result: unknown[] = yield* callLsp(opName, input)

          return {
            title,
            metadata: { result },
            output: result.length === 0 ? `No results found for ${args.operation}` : JSON.stringify(result, null, 2),
          }
        }).pipe(Effect.orDie) as Effect.Effect<
          { title: string; metadata: { result: unknown[] }; output: string },
          never,
          never
        >,
    }
  }),
)
