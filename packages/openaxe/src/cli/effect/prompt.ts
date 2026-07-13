import {
  intro as promptIntro,
  outro as promptOutro,
  log as promptLog,
  isCancel as promptIsCancel,
  select as promptSelect,
  autocomplete as promptAutocomplete,
  text as promptText,
  password as promptPassword,
  spinner as promptSpinner,
} from "@clack/prompts"
import { Effect, Option } from "effect"

export const intro = (msg: string) => Effect.sync(() => promptIntro(msg))
export const outro = (msg: string) => Effect.sync(() => promptOutro(msg))

export const log = {
  info: (msg: string) => Effect.sync(() => promptLog.info(msg)),
  error: (msg: string) => Effect.sync(() => promptLog.error(msg)),
  warn: (msg: string) => Effect.sync(() => promptLog.warn(msg)),
  success: (msg: string) => Effect.sync(() => promptLog.success(msg)),
}

const optional = <Value>(result: Value | symbol) => {
  if (promptIsCancel(result)) return Option.none<Value>()
  return Option.some(result)
}

export const select = <Value>(opts: Parameters<typeof promptSelect<Value>>[0]) =>
  Effect.promise(() => promptSelect(opts)).pipe(Effect.map((result) => optional(result)))

export const autocomplete = <Value>(opts: Parameters<typeof promptAutocomplete<Value>>[0]) =>
  Effect.promise(() => promptAutocomplete(opts)).pipe(Effect.map((result) => optional(result)))

export const text = (opts: Parameters<typeof promptText>[0]) =>
  Effect.promise(() => promptText(opts)).pipe(Effect.map((result) => optional(result)))

export const password = (opts: Parameters<typeof promptPassword>[0]) =>
  Effect.promise(() => promptPassword(opts)).pipe(Effect.map((result) => optional(result)))

export const spinner = () => {
  const s = promptSpinner()
  return {
    start: (msg: string) => Effect.sync(() => s.start(msg)),
    stop: (msg: string, code?: number) => Effect.sync(() => s.stop(msg, code)),
  }
}
