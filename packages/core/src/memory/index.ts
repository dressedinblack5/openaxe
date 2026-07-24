export * as Memory from "./index"

import { and, eq } from "drizzle-orm"
import { Context, Effect, Layer } from "effect"
import { LayerNode } from "../effect/layer-node"
import { Database } from "../database/database"
import { MemoryTable } from "./memory.sql"

export interface Interface {
  readonly set: (key: string, value: unknown, scope?: string, source?: string) => Effect.Effect<void>
  readonly get: (key: string) => Effect.Effect<unknown>
  readonly remove: (key: string) => Effect.Effect<void>
  readonly list: (kind?: string, scope?: string, source?: string) => Effect.Effect<Array<{ key: string; value: unknown; kind: string; scope: string; source: string }>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Memory") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    const set = Effect.fn("Memory.set")(function* (key: string, value: unknown, scope?: string, source?: string) {
      const existing = yield* db.select().from(MemoryTable).where(eq(MemoryTable.key, key)).get().pipe(Effect.orDie)
      if (existing) {
        yield* db.update(MemoryTable).set({ value }).where(eq(MemoryTable.key, key)).run().pipe(Effect.orDie)
      } else {
        yield* db.insert(MemoryTable).values({ key, value, scope, source }).run().pipe(Effect.orDie)
      }
    })

    const get = Effect.fn("Memory.get")(function* (key: string) {
      const row = yield* db.select().from(MemoryTable).where(eq(MemoryTable.key, key)).get().pipe(Effect.orDie)
      return row?.value ?? null
    })

    const remove = Effect.fn("Memory.remove")(function* (key: string) {
      yield* db.delete(MemoryTable).where(eq(MemoryTable.key, key)).run().pipe(Effect.orDie)
    })

    const list = Effect.fn("Memory.list")(function* (kind?: string, scope?: string, source?: string) {
      const conditions = []
      if (kind) conditions.push(eq(MemoryTable.kind, kind))
      if (scope) conditions.push(eq(MemoryTable.scope, scope))
      if (source) conditions.push(eq(MemoryTable.source, source))
      const query = db.select().from(MemoryTable)
      const rows = conditions.length
        ? yield* query.where(and(...conditions)).all().pipe(Effect.orDie)
        : yield* query.all().pipe(Effect.orDie)
      return rows.map((row) => ({ key: row.key, value: row.value, kind: row.kind, scope: row.scope, source: row.source }))
    })

    return Service.of({ set, get, remove, list })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))
export const node = LayerNode.make(layer, [Database.node])
