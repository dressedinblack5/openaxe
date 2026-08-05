import { describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { Effect, Exit, Option } from "effect"
import { layer as sqliteLayer } from "#sqlite"
import { Sqlite } from "@opencode-ai/core/database/sqlite"
import { testEffect } from "../../test/lib/effect"
import { vecVersion, withVec0 } from "./vec"

const it = testEffect(sqliteLayer({ filename: ":memory:" }))

describe("sqlite-vec", () => {
  it.effect("loads vec0 at connection open and vec_version() returns Some version", () =>
    Effect.gen(function* () {
      // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- Sqlite.Native is shared unknown; the layer guarantees a bun Database.
      const native = (yield* Sqlite.Native) as Database
      const version = yield* vecVersion((sql) => native.query(sql).get())
      expect(Option.isSome(version)).toBe(true)
      expect(Option.getOrElse(version, () => "")).toMatch(/^v\d+\.\d+\.\d+/)
    }),
  )
})

describe("graceful degradation", () => {
  test("withVec0 never fails when the extension load throws", async () => {
    const exit = await Effect.runPromiseExit(
      withVec0(() => {
        throw new Error("bogus load path")
      }),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("a failing vec0 load leaves the DB fully usable", async () => {
    const db = new Database(":memory:")
    db.run("create table t (id integer)")
    const exit = await Effect.runPromiseExit(
      withVec0(() => {
        throw new Error("bogus load path")
      }),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    db.run("insert into t values (1)")
    expect((db.query("select count(*) as c from t").get() as { c: number }).c).toBe(1)
  })

  test("vecVersion returns None when the extension is not loaded", async () => {
    const db = new Database(":memory:")
    const version = await Effect.runPromise(vecVersion((sql) => db.query(sql).get()))
    expect(Option.isNone(version)).toBe(true)
  })
})
