import { default as yargs } from "yargs"

let builderCalled = false
let handlerCalled = false

const cli: any = yargs(["--help"])
  .command({
    command: "test",
    describe: "a test command",
    builder: (y) => {
      builderCalled = true
      return y
    },
    handler: () => {
      handlerCalled = true
    },
  })
  .command({
    command: "other",
    describe: "another test command",
    builder: (y) => {
      process.stderr.write("OTHER builder called!\n")
      return y
    },
    handler: () => {
      process.stderr.write("OTHER handler called!\n")
    },
  })

const result = await cli.parse()
process.stderr.write(`test builder called: ${builderCalled}\n`)
process.stderr.write(`test handler called: ${handlerCalled}\n`)
process.exit(0)
