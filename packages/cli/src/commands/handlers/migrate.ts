import { log } from "effect/Effect";
import { Commands } from "../commands"
import { Runtime } from "../../framework/runtime"

export default Runtime.handler(Commands.commands.migrate, (_input) => log("No migrations to run."))
