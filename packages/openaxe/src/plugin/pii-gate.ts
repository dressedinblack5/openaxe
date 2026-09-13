import type { Hooks, Plugin as PluginInstance } from "@opencode-ai/plugin"
import { PII_DENY_CONFIDENCE } from "./pii/schema"
import type { PiiOutput } from "./pii/schema"
import { scanTextStub } from "./pii/service"
import { redactArgs } from "./pii/redact"

/**
 * Internal TF PII gate plugin.
 *
 * Enforcing seams (advisory guardrails are NOT the boundary here):
 * - `permission.ask`: denies on a PII hit at confidence >= 0.8, otherwise
 *   falls through (stub abstains, so the ask flow stays live until the real
 *   `.tflite` PII artifact lands). Mutates `output.status` in place.
 * - `tool.execute.before`: always redacts cheap regex PII/secrets in
 *   `output.args` in place.
 *
 * Internal-only (not an external plugin) so `OPENCODE_PURE=1` stays safe:
 * internal plugins load even in pure mode. Self-contained under
 * `src/plugin/pii` — never depends on `packages/core`.
 */

export type PiiScanner = (text: string) => Promise<PiiOutput>

const defaultScanner: PiiScanner = (text) => scanTextStub(text)

type PermissionAskInput = Parameters<NonNullable<Hooks["permission.ask"]>>[0]

function permissionText(input: PermissionAskInput): string {
  const patterns = Array.isArray(input.pattern) ? input.pattern.join("\n") : (input.pattern ?? "")
  return [input.type ?? "", patterns, JSON.stringify(input.metadata ?? {})].join("\n")
}

/**
 * Build the gate hooks around an injectable scanner (tests inject mocks).
 *
 * Both hooks are total: a failing scanner degrades to fall-through (stub
 * abstains) instead of breaking the permission/tool flow. The gate must
 * never deny by default and never throw — it only denies on an explicit
 * high-confidence hit.
 */
export function createPiiGateHooks(scan: PiiScanner = defaultScanner): Hooks {
  return {
    "permission.ask": async (input, output) => {
      const result = await scan(permissionText(input)).catch(() => undefined)
      if (!result) return
      if (result.hit && result.confidence >= PII_DENY_CONFIDENCE) output.status = "deny"
    },
    "tool.execute.before": async (_input, output) => {
      output.args = redactArgs(output.args)
    },
  }
}

export const PiiGatePlugin: PluginInstance = async () => createPiiGateHooks()
