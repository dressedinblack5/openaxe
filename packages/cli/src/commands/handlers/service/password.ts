import { EOL } from "os"
import { Option } from "effect"
import { fn } from "effect/Effect";
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.service.commands.password,
  fn("cli.service.password")(function* (input) {
    const daemon = yield* Daemon.Service
    const value = Option.getOrUndefined(input.value)
    if (value !== undefined) yield* daemon.stop()
    process.stdout.write((yield* daemon.password(value)) + EOL)
  }),
)
