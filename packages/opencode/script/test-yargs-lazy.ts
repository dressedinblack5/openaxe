const { default: yargs } = await import("yargs")

let builderCalled = false
let handlerCalled = false

const cli = yargs(["--help"])
  .command({
    command: "test",
    describe: "a test command",
    builder: () => {
      builderCalled = true
      return cli
    },
    handler: () => {
      handlerCalled = true
    },
  })
  .command({
    command: "other",
    describe: "another test command",
    builder: () => {
      console.log("OTHER builder called!")
      return cli
    },
    handler: () => {
      console.log("OTHER handler called!")
    },
  })

await cli.parse()
console.log("--- results ---")
console.log("test builder called:", builderCalled)
console.log("test handler called:", handlerCalled)
