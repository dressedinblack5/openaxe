import { run as runTui, type TuiInput } from "@opencode-ai/tui"
import { AppLayer } from "@/effect/app-layer"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppLayer))
}
