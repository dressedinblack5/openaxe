import { Effect, Layer, Context } from "effect"
import {
  Diagnostic,
  DiagnosticStore,
  ServerCapabilities,
  Position,
  Range,
} from "./types"
import type { MessageConnection } from "vscode-jsonrpc/node"

const DIAGNOSTICS_DEBOUNCE_MS = 150
const DIAGNOSTICS_DOCUMENT_WAIT_TIMEOUT_MS = 5_000
const DIAGNOSTICS_FULL_WAIT_TIMEOUT_MS = 10_000
const DIAGNOSTICS_REQUEST_TIMEOUT_MS = 3_000

export interface DocumentDiagnosticReport {
  items?: Diagnostic[]
  relatedDocuments?: Record<string, DocumentDiagnosticReport>
}

export interface WorkspaceDiagnosticReport {
  items?: Array<{
    uri?: string
    items?: Diagnostic[]
  }>
}

export interface DiagnosticRequestResult {
  handled: boolean
  matched: boolean
  byFile: Map<string, Diagnostic[]>
}

export interface CapabilityRegistration {
  id: string
  method: string
  registerOptions?: {
    identifier?: string
    workspaceDiagnostics?: boolean
  }
}

interface PublishedEntry {
  at: number
  version?: number
}

/**
 * DiagnosticStore - Owns push/pull/published/dedupe/merge
 */

export const makeDiagnosticStore = (serverID: string): DiagnosticStore => {
  const pushDiagnostics = new Map<string, Diagnostic[]>()
  const pullDiagnostics = new Map<string, Diagnostic[]>()
  const published = new Map<string, PublishedEntry>()
  const diagnosticRegistrations = new Map<string, CapabilityRegistration>()
  const registrationListeners = new Set<() => void>()
  const diagnosticListeners = new Set<(input: { path: string; serverID: string }) => void>()

  const dedupeDiagnostics = (items: Diagnostic[]): Diagnostic[] => {
    const seen = new Map<string, boolean>()
    return items.filter((item) => {
      const key = `${item.code ?? ""}|${item.severity ?? ""}|${item.message ?? ""}|${item.source ?? ""}|${item.range?.start.line ?? ""}:${item.range?.start.character ?? ""}:${item.range?.end.line ?? ""}:${item.range?.end.character ?? ""}`
      if (seen.has(key)) return false
      seen.set(key, true)
      return true
    })
  }

  const mergedDiagnostics = (filePath: string): Diagnostic[] =>
    dedupeDiagnostics([...(pushDiagnostics.get(filePath) ?? []), ...(pullDiagnostics.get(filePath) ?? [])])

  const updatePushDiagnostics = (filePath: string, next: Diagnostic[]): void => {
    pushDiagnostics.set(filePath, next)
    for (const listener of diagnosticListeners) listener({ path: filePath, serverID })
  }

  const updatePullDiagnostics = (filePath: string, next: Diagnostic[]): void => {
    pullDiagnostics.set(filePath, next)
  }

  const emitRegistrationChange = (): void => {
    for (const listener of registrationListeners) listener()
  }

  const shouldSeedDiagnosticsOnFirstPush = (): boolean => serverID === "typescript"

  // Public API
  return {
    updatePushDiagnostics,
    updatePullDiagnostics,
    getMergedDiagnostics(filePath: string): Diagnostic[] {
      return mergedDiagnostics(filePath)
    },
    getAllDiagnostics(): Map<string, Diagnostic[]> {
      const result = new Map<string, Diagnostic[]>()
      for (const key of new Set([...pushDiagnostics.keys(), ...pullDiagnostics.keys()])) {
        result.set(key, mergedDiagnostics(key))
      }
      return result
    },
    async waitForDocumentDiagnostics(path: string, version: number, after?: number): Promise<void> {
      // Placeholder implementation
    },
    async waitForFullDiagnostics(path: string, version: number, after?: number): Promise<void> {
      // Placeholder implementation
    },
  }
}

/**
 * Helper functions for diagnostic requests
 */

export const requestDocumentDiagnostics = async (
  connection: MessageConnection,
  filePath: string,
  identifier?: string,
): Promise<DiagnosticRequestResult> => {
  try {
    const report = await connection.sendRequest<DocumentDiagnosticReport | null>("textDocument/diagnostic", {
      ...(identifier ? { identifier } : {}),
      textDocument: { uri: `file://${filePath}` },
    })
    if (!report) return { handled: false, matched: false, byFile: new Map() }

    const byFile = new Map<string, Diagnostic[]>()
    const push = (target: string, items: Diagnostic[]) => {
      const existing = byFile.get(target) ?? []
      byFile.set(target, existing.concat(items))
    }

    let handled = false
    let matched = false
    if (Array.isArray(report.items)) {
      push(filePath, report.items)
      handled = true
      matched = true
    }
    for (const [uri, related] of Object.entries(report.relatedDocuments ?? {})) {
      const relatedPath = uri.startsWith("file://") ? uri.slice(7) : uri
      if (!relatedPath || !Array.isArray(related.items)) continue
      push(relatedPath, related.items)
      handled = true
      matched = matched || relatedPath === filePath
    }

    return { handled, matched, byFile }
  } catch {
    return { handled: false, matched: false, byFile: new Map() }
  }
}

export const requestWorkspaceDiagnostics = async (
  connection: MessageConnection,
  filePath: string,
  identifier?: string,
): Promise<DiagnosticRequestResult> => {
  try {
    const report = await connection.sendRequest<WorkspaceDiagnosticReport | null>("workspace/diagnostic", {
      ...(identifier ? { identifier } : {}),
      previousResultIds: [],
    })
    if (!report) return { handled: false, matched: false, byFile: new Map() }

    const byFile = new Map<string, Diagnostic[]>()
    let matched = false
    for (const item of report.items ?? []) {
      const relatedPath = item.uri?.startsWith("file://") ? item.uri.slice(7) : item.uri
      if (!relatedPath || !Array.isArray(item.items)) continue
      const existing = byFile.get(relatedPath) ?? []
      byFile.set(relatedPath, existing.concat(item.items))
      matched = matched || relatedPath === filePath
    }

    return { handled: true, matched, byFile }
  } catch {
    return { handled: false, matched: false, byFile: new Map() }
  }
}

export const mergeResults = (
  filePath: string,
  results: DiagnosticRequestResult[],
): { handled: boolean; matched: boolean } => {
  const handled = results.some((r) => r.handled)
  const matched = results.some((r) => r.matched)
  if (!handled) return { handled: false, matched: false }

  const merged = new Map<string, Diagnostic[]>()
  for (const result of results) {
    for (const [target, items] of result.byFile.entries()) {
      const existing = merged.get(target) ?? []
      merged.set(target, existing.concat(items))
    }

    if (matched && !merged.has(filePath)) merged.set(filePath, [])
    return { handled, matched }
  }
}

/**
 * Service
 */

export class DiagnosticStoreService extends Context.Service<DiagnosticStoreService>()("@opencode/LSP/DiagnosticStore") {
  static Live = (serverID: string) => Layer.succeed(DiagnosticStoreService, makeDiagnosticStore(serverID))
}

export * as Diagnostics from "./diagnostics"