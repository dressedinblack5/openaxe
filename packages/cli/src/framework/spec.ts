import type { Command } from "effect/unstable/cli/Command"
import { make as makeCommand, withDescription } from "effect/unstable/cli/Command"

type Options<Config extends Command.Config, Commands extends ReadonlyArray<Any>> = {
  readonly description?: string
  readonly params?: Config
  readonly commands?: Commands
}

export interface Node<
  Name extends string,
  Spec extends Command<Name, any, any, any, any>,
  Commands extends Children,
> {
  readonly name: Name
  readonly spec: Spec
  readonly commands: Commands
}

export type Any = Node<string, Command<any, any, any, any, any>, Children>
export type Children = Readonly<Record<string, Any>>

export function make<
  const Name extends string,
  const Config extends Command.Config = {},
  const Commands extends ReadonlyArray<Any> = [],
>(name: Name, options: Options<Config, Commands> = {}) {
  const command = makeCommand(name, options.params ?? ({} as Config))
  const spec = options.description ? command.pipe(withDescription(options.description)) : command
  return {
    name,
    spec,
    commands: Object.fromEntries(
      (options.commands ?? []).map((command) => [command.name, command]),
    ) as ChildrenOf<Commands>,
  }
}

type ChildrenOf<Commands extends ReadonlyArray<Any>> = {
  readonly [Node in Commands[number] as Node["name"]]: Node
}

export * as Spec from "./spec"
