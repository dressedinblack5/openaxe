import { Effect, Layer, Context } from "effect"
import { ServerCapabilities, TextDocumentSyncKind } from "./types"

/**
 * CapabilityRegistry - Typed accessors for server capabilities
 * Provides clean interface for capability negotiation
 */

export interface CapabilityRegistry {
  hasTextDocumentSync(capabilities: ServerCapabilities): boolean
  getTextDocumentSyncKind(capabilities: ServerCapabilities): TextDocumentSyncKind | undefined
  hasDiagnosticProvider(capabilities: ServerCapabilities): boolean
  getDiagnosticProvider(capabilities: ServerCapabilities): ServerCapabilities["diagnosticProvider"]
  hasCompletionProvider(capabilities: ServerCapabilities): boolean
  getCompletionProvider(capabilities: ServerCapabilities): ServerCapabilities["completionProvider"]
  hasHoverProvider(capabilities: ServerCapabilities): boolean
  hasDefinitionProvider(capabilities: ServerCapabilities): boolean
  hasReferencesProvider(capabilities: ServerCapabilities): boolean
  hasDocumentSymbolProvider(capabilities: ServerCapabilities): boolean
  hasWorkspaceSymbolProvider(capabilities: ServerCapabilities): boolean
  hasCodeActionProvider(capabilities: ServerCapabilities): boolean
  getCodeActionProvider(capabilities: ServerCapabilities): ServerCapabilities["codeActionProvider"]
  hasRenameProvider(capabilities: ServerCapabilities): boolean
  getRenameProvider(capabilities: ServerCapabilities): ServerCapabilities["renameProvider"]
  hasFormattingProvider(capabilities: ServerCapabilities): boolean
  getFormattingProvider(capabilities: ServerCapabilities): ServerCapabilities["documentFormattingProvider"]
  hasTypeDefinitionProvider(capabilities: ServerCapabilities): boolean
  hasImplementationProvider(capabilities: ServerCapabilities): boolean
  hasCallHierarchyProvider(capabilities: ServerCapabilities): boolean
  hasInlayHintProvider(capabilities: ServerCapabilities): boolean
  hasSelectionRangeProvider(capabilities: ServerCapabilities): boolean
  hasLinkedEditingRangeProvider(capabilities: ServerCapabilities): boolean
  hasSemanticTokensProvider(capabilities: ServerCapabilities): boolean
  getSemanticTokensProvider(capabilities: ServerCapabilities): ServerCapabilities["semanticTokensProvider"]
}

export const makeCapabilityRegistry = (): CapabilityRegistry => ({
  hasTextDocumentSync(capabilities: ServerCapabilities): boolean {
    return capabilities.textDocumentSync !== undefined
  },

  getTextDocumentSyncKind(capabilities: ServerCapabilities): TextDocumentSyncKind | undefined {
    if (!capabilities.textDocumentSync) return undefined
    if (typeof capabilities.textDocumentSync === "number") return capabilities.textDocumentSync
    return (capabilities.textDocumentSync as any).change
  },

  hasDiagnosticProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.diagnosticProvider !== undefined
  },

  getDiagnosticProvider(capabilities: ServerCapabilities): ServerCapabilities["diagnosticProvider"] {
    return capabilities.diagnosticProvider
  },

  hasCompletionProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.completionProvider !== undefined
  },

  getCompletionProvider(capabilities: ServerCapabilities): ServerCapabilities["completionProvider"] {
    return capabilities.completionProvider
  },

  hasHoverProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.hoverProvider !== undefined
  },

  hasDefinitionProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.definitionProvider !== undefined
  },

  hasReferencesProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.referencesProvider !== undefined
  },

  hasDocumentSymbolProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.documentSymbolProvider !== undefined
  },

  hasWorkspaceSymbolProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.workspaceSymbolProvider !== undefined
  },

  hasCodeActionProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.codeActionProvider !== undefined
  },

  getCodeActionProvider(capabilities: ServerCapabilities): ServerCapabilities["codeActionProvider"] {
    return capabilities.codeActionProvider
  },

  hasRenameProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.renameProvider !== undefined
  },

  getRenameProvider(capabilities: ServerCapabilities): ServerCapabilities["renameProvider"] {
    return capabilities.renameProvider
  },

  hasFormattingProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.documentFormattingProvider !== undefined
  },

  getFormattingProvider(capabilities: ServerCapabilities): ServerCapabilities["documentFormattingProvider"] {
    return capabilities.documentFormattingProvider
  },

  hasTypeDefinitionProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.typeDefinitionProvider !== undefined
  },

  hasImplementationProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.implementationProvider !== undefined
  },

  hasCallHierarchyProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.callHierarchyProvider !== undefined
  },

  hasInlayHintProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.inlayHintProvider !== undefined
  },

  hasSelectionRangeProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.selectionRangeProvider !== undefined
  },

  hasLinkedEditingRangeProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.linkedEditingRangeProvider !== undefined
  },

  hasSemanticTokensProvider(capabilities: ServerCapabilities): boolean {
    return capabilities.semanticTokensProvider !== undefined
  },

  getSemanticTokensProvider(capabilities: ServerCapabilities): ServerCapabilities["semanticTokensProvider"] {
    return capabilities.semanticTokensProvider
  },
})

/**
 * ClientCapabilities - For tracking which capabilities are supported by a client
 */

export interface ClientCapabilities {
  textDocument?: {
    synchronization?: {
      dynamicRegistration?: boolean
      willSave?: boolean
      willSaveWaitUntil?: boolean
      didSave?: boolean
    }
    completion?: {
      dynamicRegistration?: boolean
      completionItem?: {
        snippetSupport?: boolean
        commitCharactersSupport?: boolean
        documentationFormat?: ReadonlyArray<"markdown" | "plaintext">
        deprecatedSupport?: boolean
        preselectSupport?: boolean
        tagSupport?: { valueSet: ReadonlyArray<number> }
      }
    }
    hover?: { dynamicRegistration?: boolean }
    signatureHelp?: { dynamicRegistration?: boolean }
    definition?: { dynamicRegistration?: boolean }
    references?: { dynamicRegistration?: boolean }
    documentHighlight?: { dynamicRegistration?: boolean }
    documentSymbol?: { dynamicRegistration?: boolean }
    codeAction?: { dynamicRegistration?: boolean }
    codeLens?: { dynamicRegistration?: boolean }
    formatting?: { dynamicRegistration?: boolean }
    rangeFormatting?: { dynamicRegistration?: boolean }
    onTypeFormatting?: { dynamicRegistration?: boolean }
    rename?: { dynamicRegistration?: boolean }
    documentLink?: { dynamicRegistration?: boolean }
    colorProvider?: { dynamicRegistration?: boolean }
    foldingRange?: { dynamicRegistration?: boolean }
    diagnostic?: { dynamicRegistration?: boolean }
    selectionRange?: { dynamicRegistration?: boolean }
    linkedEditingRange?: { dynamicRegistration?: boolean }
    semanticTokens?: { dynamicRegistration?: boolean }
    callHierarchy?: { dynamicRegistration?: boolean }
    typeDefinition?: { dynamicRegistration?: boolean }
    implementation?: { dynamicRegistration?: boolean }
    inlayHint?: { dynamicRegistration?: boolean }
    inlineValue?: { dynamicRegistration?: boolean }
  }
  workspace?: {
    applyEdit?: boolean
    workspaceEdit?: { documentChanges?: boolean }
    didChangeConfiguration?: { dynamicRegistration?: boolean }
    didChangeWatchedFiles?: { dynamicRegistration?: boolean }
    symbol?: { dynamicRegistration?: boolean }
    executeCommand?: { dynamicRegistration?: boolean }
    workspaceFolders?: boolean
    configuration?: boolean
    diagnostics?: { refreshSupport?: boolean }
  }
  window?: {
    workDoneProgress?: boolean
    showMessage?: { messageActionItem?: { additionalPropertiesSupport?: boolean } }
    showDocument?: { support?: boolean }
  }
  general?: {
    positionEncodings?: ReadonlyArray<"utf-8" | "utf-16" | "utf-32">
    markdown?: { parser?: "marked" | "commonmark"; allowedTags?: ReadonlyArray<string> }
  }
}

export const makeClientCapabilities = (): ClientCapabilities => ({
  textDocument: {
    synchronization: {
      dynamicRegistration: true,
      willSave: true,
      willSaveWaitUntil: true,
      didSave: true,
    },
    completion: {
      dynamicRegistration: true,
      completionItem: {
        snippetSupport: true,
        commitCharactersSupport: true,
        documentationFormat: ["markdown", "plaintext"],
        deprecatedSupport: true,
        preselectSupport: true,
        tagSupport: { valueSet: [1] },
      },
    },
    hover: { dynamicRegistration: true },
    signatureHelp: { dynamicRegistration: true },
    definition: { dynamicRegistration: true },
    references: { dynamicRegistration: true },
    documentHighlight: { dynamicRegistration: true },
    documentSymbol: { dynamicRegistration: true },
    codeAction: { dynamicRegistration: true },
    codeLens: { dynamicRegistration: true },
    formatting: { dynamicRegistration: true },
    rangeFormatting: { dynamicRegistration: true },
    onTypeFormatting: { dynamicRegistration: true },
    rename: { dynamicRegistration: true },
    documentLink: { dynamicRegistration: true },
    colorProvider: { dynamicRegistration: true },
    foldingRange: { dynamicRegistration: true },
    diagnostic: { dynamicRegistration: true },
    selectionRange: { dynamicRegistration: true },
    linkedEditingRange: { dynamicRegistration: true },
    semanticTokens: { dynamicRegistration: true },
    callHierarchy: { dynamicRegistration: true },
    typeDefinition: { dynamicRegistration: true },
    implementation: { dynamicRegistration: true },
    inlayHint: { dynamicRegistration: true },
    inlineValue: { dynamicRegistration: true },
  },
  workspace: {
    applyEdit: true,
    workspaceEdit: { documentChanges: true },
    didChangeConfiguration: { dynamicRegistration: true },
    didChangeWatchedFiles: { dynamicRegistration: true },
    symbol: { dynamicRegistration: true },
    executeCommand: { dynamicRegistration: true },
    workspaceFolders: true,
    configuration: true,
    diagnostics: { refreshSupport: false },
  },
  window: {
    workDoneProgress: true,
    showMessage: { messageActionItem: { additionalPropertiesSupport: true } },
    showDocument: { support: true },
  },
  general: {
    positionEncodings: ["utf-8", "utf-16"],
    markdown: { parser: "commonmark" },
  },
})

/**
 * Service
 */

export class CapabilityRegistryService extends Context.Service<CapabilityRegistryService>()("@opencode/LSP/CapabilityRegistry") {
  static Live = Layer.succeed(CapabilityRegistryService, makeCapabilityRegistry())
}

export * as Capabilities from "./capabilities"