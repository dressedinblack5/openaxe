import type { Effect } from "effect/Effect"
import { flatMap, gen, promise } from "effect/Effect";
import type { Command, Environment } from "effect/unstable/cli/Command"
import { run as commandRun, withHandler, withSubcommands } from "effect/unstable/cli/Command"
import { Spec } from "./spec"
import { Daemon } from "../services/daemon"

export type Input<Value> =
  Value extends Spec.Node<infer _Name, infer Command, infer _Commands>
    ? Input<Command>
    : Value extends Command<infer _Name, infer Input, infer _Context, infer _Error, infer _Requirements>
      ? Input
      : never

type RuntimeHandler = (input: unknown) => Effect<void, unknown, Daemon.Service>
type Loader<Node extends Spec.Any> = () => Promise<{
  default: (input: Input<Node>) => Effect<void, any, Daemon.Service>
}>
type ProvidedCommand = Command<string, unknown, unknown, unknown, Daemon.Service>

export type Handlers<Node extends Spec.Any> = keyof Node["commands"] extends never
  ? Loader<Node>
  : { readonly $?: Loader<Node> } & { readonly [Key in keyof Node["commands"]]: Handlers<Node["commands"][Key]> }

interface LazyHandler {
  readonly spec: Command.Any
  readonly load: () => Promise<{ default: RuntimeHandler }>
}

type RuntimeHandlers =
  | (() => Promise<{ default: RuntimeHandler }>)
  | {
      readonly $?: () => Promise<{ default: RuntimeHandler }>
      readonly [key: string]: RuntimeHandlers | (() => Promise<{ default: RuntimeHandler }>) | undefined
    }

export function handler<const Node extends Spec.Any, Error, Requirements>(
  _node: Node,
  run: (input: Input<Node>) => Effect<void, Error, Requirements>,
) {
  return run
}

export function handlers<const Root extends Spec.Any>(root: Root, handlers: Handlers<Root>) {
  const result: LazyHandler[] = []

  function add(node: Spec.Any, value: RuntimeHandlers) {
    if (typeof value === "function") {
      result.push({ spec: node.spec, load: value })
      return
    }
    if (value.$) result.push({ spec: node.spec, load: value.$ })
    for (const [name, child] of Object.entries(node.commands)) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      add(child, value[name] as unknown as RuntimeHandlers)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  add(root, handlers as unknown as RuntimeHandlers)
  return result
}

export function run(commands: Spec.Any, handlers: ReadonlyArray<LazyHandler>, options: { readonly version: string }): Effect<void, unknown, Environment> {
  return commandRun(provide(commands, handlers), options)
}

function provide(node: Spec.Any, handlers: ReadonlyArray<LazyHandler>): ProvidedCommand {
  const handler = handlers.find((handler) => handler.spec === node.spec)
  const spec = handler
    ? node.spec.pipe(
        withHandler((input) =>
          gen(function* () {
            yield* flatMap(promise(handler.load), (module) => module.default(input))
          }),
        ),
      )
    : node.spec
  if (!Object.keys(node.commands).length) return spec
  return spec.pipe(
    withSubcommands(Object.values(node.commands).map((child) => provide(child, handlers))),
  )
}

export * as Runtime from "./runtime"
