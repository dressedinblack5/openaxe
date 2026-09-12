import { describe, expect, it } from "bun:test"
import type { Permission } from "@opencode-ai/sdk"
import { createPiiGateHooks } from "../../src/plugin/pii-gate"
import type { PiiScanner } from "../../src/plugin/pii-gate"

const askInput: Permission = {
  id: "test",
  type: "edit",
  pattern: ["contact jane@example.com"],
  sessionID: "ses_test",
  messageID: "msg_test",
  title: "edit",
  metadata: {},
  time: { created: Date.now() },
}

describe("pii-gate", () => {
  it("denies on a high-confidence hit", async () => {
    const scan: PiiScanner = async () => ({ hit: true, confidence: 0.95, kinds: ["email"] })
    const hooks = createPiiGateHooks(scan)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    await hooks["permission.ask"]!(askInput, output)
    expect(output.status).toBe("deny")
  })

  it("falls through on abstain (stub)", async () => {
    const scan: PiiScanner = async () => ({ hit: false, confidence: 0 })
    const hooks = createPiiGateHooks(scan)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    await hooks["permission.ask"]!(askInput, output)
    expect(output.status).toBe("ask")
  })

  it("falls through on low-confidence hit", async () => {
    const scan: PiiScanner = async () => ({ hit: true, confidence: 0.2 })
    const hooks = createPiiGateHooks(scan)
    const output: { status: "ask" | "deny" | "allow" } = { status: "ask" }
    await hooks["permission.ask"]!(askInput, output)
    expect(output.status).toBe("ask")
  })

  it("redacts tool args in place", async () => {
    const scan: PiiScanner = async () => ({ hit: false, confidence: 0 })
    const hooks = createPiiGateHooks(scan)
    const output = { args: { text: "mail jane@example.com", nested: { ssn: "123-45-6789" } } }
    await hooks["tool.execute.before"]!({ tool: "write", sessionID: "s", callID: "c" }, output)
    expect(output.args).toEqual({ text: "mail [REDACTED_EMAIL]", nested: { ssn: "[REDACTED_SSN]" } })
  })
})
