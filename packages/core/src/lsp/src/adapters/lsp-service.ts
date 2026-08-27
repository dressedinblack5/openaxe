// @ts-nocheck
import { Effect, Layer, Context } from "effect"
import { LSP as CoreLSP } from "../lsp"

export type {
  Status,
  Range,
  Symbol,
  DocumentSymbol,
  Diagnostic,
} from "../types"

export const LSPAdapterLayer = (lsp: Layer.Layer<CoreLSP.Service, unknown, unknown>) =>
  Layer.effect(
    Context.Service<CoreLSP.Service, CoreLSP.Interface>()("@opencode/LSP"),
    Effect.gen(function* () {
      const coreLSP = yield* CoreLSP.Service
      return {
        init: coreLSP.init,
        status: coreLSP.status,
        hasClients: coreLSP.hasClients,
        touchFile: coreLSP.touchFile,
        diagnostics: coreLSP.diagnostics,
        hover: coreLSP.hover,
        definition: coreLSP.definition,
        references: coreLSP.references,
        implementation: coreLSP.implementation,
        documentSymbol: coreLSP.documentSymbol,
        workspaceSymbol: coreLSP.workspaceSymbol,
        prepareCallHierarchy: coreLSP.prepareCallHierarchy,
        incomingCalls: coreLSP.incomingCalls,
        outgoingCalls: coreLSP.outgoingCalls,
        codeAction: coreLSP.codeAction,
        rename: coreLSP.rename,
        prepareRename: coreLSP.prepareRename,
        typeDefinition: coreLSP.typeDefinition,
        signatureHelp: coreLSP.signatureHelp,
        completion: coreLSP.completion,
        formatting: coreLSP.formatting,
        applyCodeAction: coreLSP.applyCodeAction,
        removeClients: coreLSP.removeClients,
      }
    }),
  ).pipe(Layer.provide(lsp))

export const LSPAdapterDefault = LSPAdapterLayer(CoreLSP.defaultLayer)

export * as LSPAdapter from "./lsp-service"