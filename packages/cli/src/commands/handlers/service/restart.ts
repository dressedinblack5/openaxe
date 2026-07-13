import { EOL } from "os"
import { fn } from "effect/Effect";
import { Commands } from "../../commands"
import { Runtime } from "../../../framework/runtime"
import { Daemon } from "../../../services/daemon"

export default Runtime.handler(
  Commands.commands.service.commands.restart,
  fn("cli.service.restart")(function* () {
    const daemon = yield* Daemon.Service
    yield* daemon.stop()
    process.stdout.write((yield* daemon.start()) + EOL)
  }),
)
