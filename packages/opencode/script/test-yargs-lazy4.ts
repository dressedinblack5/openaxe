import { default as yargs } from "yargs"

let heavyBuilderCalled = false
let lightBuilderCalled = false

const cli = yargs(["--help"])

// Heavy command (our lazy target)
cli.command({
  command: "heavy",
  describe: "a heavy command that loads slowly",
  builder: (y) => {
    heavyBuilderCalled = true
    return y.command({
      command: "sub",
      describe: "a subcommand",
      handler: () => {}
    })
  },
  handler: () => {}
})

// Light command 
cli.command({
  command: "light",
  describe: "a light command",
  builder: (y) => {
    lightBuilderCalled = true
    return y
  },
  handler: () => {}
})

await cli.parse(["--help"], (err, argv, output) => {})
process.stderr.write(`heavy builder called: ${heavyBuilderCalled}\n`)
process.stderr.write(`light builder called: ${lightBuilderCalled}\n`)

// Now test with a specific command
heavyBuilderCalled = false
const cli2 = yargs(["heavy", "--help"])
cli2.command({
  command: "heavy",
  describe: "a heavy command",
  builder: (y) => {
    heavyBuilderCalled = true
    return y.command({
      command: "sub",
      describe: "a subcommand",
      handler: () => {}
    })
  },
  handler: () => {}
})
await cli2.parse(["heavy", "--help"], (err, argv, output) => {})
process.stderr.write(`\nheavy builder called for 'heavy --help': ${heavyBuilderCalled}\n`)
