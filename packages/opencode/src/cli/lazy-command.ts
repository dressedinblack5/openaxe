import type { CommandModule, Argv, ArgumentsCamelCase } from "yargs"

/**
 * Lazy-load a yargs CommandModule — keeps `command`/`describe`/`aliases` static
 * so yargs can route help text without evaluating the module, but defers the
 * `builder`/`handler` import until the first time the command is actually invoked.
 *
 * Use this for heavy command modules whose builder+handler import expensive
 * transitive dependencies (Effect layers, SDK clients, server modules, etc.).
 */
export function lazyCommand<T, U>(
  command: string | readonly string[],
  describe: string | false,
  aliases: string | readonly string[] | undefined,
  loader: () => Promise<CommandModule<T, U>>,
): CommandModule<T, U> {
  let mod: CommandModule<T, U> | undefined

  return {
    command,
    describe,
    aliases,
    async builder(args: Argv<T>) {
      if (!mod) mod = await loader()
      const b = mod.builder as ((args: Argv<T>) => Argv<U> | Promise<Argv<U>>) | undefined
      return b ? b(args) : (args as unknown as Argv<U>)
    },
    async handler(args: ArgumentsCamelCase<U>) {
      if (!mod) mod = await loader()
      return mod.handler?.(args)
    },
  }
}
