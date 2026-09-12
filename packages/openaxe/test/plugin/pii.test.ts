import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { PiiService, PiiServiceStub, loadPii, resetPiiCache, scanText } from "../../src/plugin/pii/service"
import { redactArgs, redactText } from "../../src/plugin/pii/redact"
import type { PiiInput } from "../../src/plugin/pii/schema"

describe("pii scan stub", () => {
  it("abstains so the fall-through path stays live", async () => {
    resetPiiCache()
    const result = await Effect.runPromise(
      scanText("contact me at jane@example.com").pipe(Effect.provide(PiiServiceStub)),
    )
    expect(result.hit).toBe(false)
    expect(result.confidence).toBe(0)
  })

  it("caches the pii load across scans", async () => {
    resetPiiCache()
    let loads = 0
    const counting = Layer.succeed(PiiService, {
      load: () =>
        Effect.sync(() => {
          loads += 1
          return { scan: (_input: PiiInput) => Effect.succeed({ hit: false, confidence: 0 }) }
        }),
    })
    const program = Effect.gen(function* () {
      yield* scanText("a")
      yield* scanText("b")
      yield* loadPii()
    }).pipe(Effect.provide(counting))
    await Effect.runPromise(program)
    expect(loads).toBe(1)
  })
})

describe("redactArgs", () => {
  const leaked = {
    email: "mail jane@example.com now",
    aws: "key AKIAIOSFODNN7EXAMPLE here",
    github: "token ghp_abcdefghijklmnopqrstuvwxyz0123456789 here",
    ssn: "ssn 123-45-6789 here",
    apikey: "key sk-abcdefghijklmnopqrstuvwxyz0123456789 here",
    nested: { list: ["clean", "mail bob@example.org"] },
  }

  it("redacts email/AKIA/ghp/SSN/key", () => {
    expect(redactText(leaked.email)).toBe("mail [REDACTED_EMAIL] now")
    expect(redactText(leaked.aws)).toBe("key [REDACTED_AWS_KEY] here")
    expect(redactText(leaked.github)).toBe("token [REDACTED_GITHUB_TOKEN] here")
    expect(redactText(leaked.ssn)).toBe("ssn [REDACTED_SSN] here")
    expect(redactText(leaked.apikey)).toBe("key [REDACTED_API_KEY] here")
    const redacted = redactArgs(leaked)
    expect(redacted.nested.list[1]).toBe("mail [REDACTED_EMAIL]")
    expect(redacted.email).not.toContain("jane@example.com")
  })

  it("is idempotent", () => {
    const once = redactArgs(leaked)
    expect(redactArgs(once)).toEqual(once)
    expect(redactText(redactText(leaked.email))).toBe(redactText(leaked.email))
  })

  it("leaves clean input untouched", () => {
    expect(redactText("hello world")).toBe("hello world")
    expect(redactArgs({ n: 42, b: true, s: "ok" })).toEqual({ n: 42, b: true, s: "ok" })
  })
})
