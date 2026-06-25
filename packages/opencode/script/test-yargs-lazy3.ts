import { default as yargs } from "yargs"

let builderCalled = false
let handlerCalled = false

let out = ""

const cli = yargs(["--help"])
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

await cli.parse(["--help"], (err: unknown, argv: unknown, output: string | undefined) => {
  out = output ?? ""
})
process.stderr.write(`test builder called: ${builderCalled}\n`)
process.stderr.write(`test handler called: ${handlerCalled}\n`)
process.stderr.write(`output length: ${out.length}\n`)
