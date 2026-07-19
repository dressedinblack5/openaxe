import fs from "fs/promises"
import path from "path"
import { tmpdir } from "./test/fixture/tmpdir.ts"

async function main() {
  const tmp = await tmpdir()
  try {
    const first = path.join(tmp.path, "first")
    await fs.mkdir(path.join(first, "review"), { recursive: true })
    await fs.writeFile(path.join(first, "review", "SKILL.md"), "# review")
    await fs.writeFile(path.join(first, "foo.md"), "# foo")

    console.log("Testing Bun.Glob patterns on:", first)
    
    // Test individual patterns
    for (const pat of ["*.md", "**/SKILL.md", "{*.md,**/SKILL.md}", "**/*"]) {
      const results: string[] = []
      for await (const match of new Bun.Glob(pat).scan({ cwd: first, absolute: true, dot: true })) {
        results.push(match)
      }
      console.log(`  ${pat}:`, results)
    }

    for (const pat of ["*.md", "**/SKILL.md", "{*.md,**/SKILL.md}"]) {
      const results: string[] = []
      for await (const match of new Bun.Glob(pat).scan({ cwd: first, absolute: true, dot: true })) {
        results.push(match)
      }
      console.log(`  ${pat}:`, results)
    }
  } finally {
    await tmp[Symbol.asyncDispose]()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
