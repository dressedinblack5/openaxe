import { describe, expect, test } from "bun:test"
import { Identifier } from "../../src/id/id"

describe("Identifier", () => {
  test("timestamp() returns the creation time", () => {
    const now = Date.now()
    const id = Identifier.create("tool", "ascending", now)
    expect(Identifier.timestamp(id)).toBeGreaterThanOrEqual(now)
    expect(Identifier.timestamp(id)).toBeLessThan(now + 2000)
  })

  test("ascending ids sort by creation order", () => {
    const a = Identifier.create("tool", "ascending", 1000)
    const b = Identifier.create("tool", "ascending", 2000)
    expect(a < b).toBe(true)
  })

  test("descending ids sort newest-first", () => {
    const a = Identifier.create("tool", "descending", 1000)
    const b = Identifier.create("tool", "descending", 2000)
    expect(b < a).toBe(true)
  })

  test("ids are unique within the same millisecond", () => {
    const now = Date.now()
    const ids = new Set(Array.from({ length: 50 }, () => Identifier.create("tool", "ascending", now)))
    expect(ids.size).toBe(50)
  })
})
