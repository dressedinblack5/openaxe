#!/usr/bin/env bun

import { $ } from "bun"
import { parseArgs } from "node:util"

type Release = {
  tag_name: string
  draft: boolean
}

type Commit = {
  hash: string
  author: string | null
  message: string
  areas: Set<string>
}

type Diff = {
  sha: string
  login: string | null
  message: string
}

const repo = process.env.GH_REPO ?? "dressedinblack5/openaxe"
const bot = ["actions-user", "github-actions[bot]", "opencode", "opencode-agent[bot]"]
const team = [
  ...(await Bun.file(new URL("../.github/TEAM_MEMBERS", import.meta.url))
    .text()
    .then((x) => x.split(/\r?\n/).map((x) => x.trim()))
    .then((x) => x.filter((x) => x && !x.startsWith("#")))),
  ...bot,
]

function ref(input: string) {
  if (input === "HEAD") return input
  if (input.startsWith("v")) return input
  if (input.match(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/)) return `v${input}`
  return input
}

async function latest() {
  const data: Release[] = await $`gh api "/repos/${repo}/releases?per_page=100"`.json()
  const release = data.find((item) => !item.draft)
  if (!release) throw new Error("No releases found")
  return release.tag_name.replace(/^v/, "")
}

async function diff(base: string, head: string) {
  const list: Diff[] = []
  for (let page = 1; ; page++) {
    const text =
      await $`gh api "/repos/${repo}/compare/${base}...${head}?per_page=100&page=${page}" --jq '.commits[] | {sha: .sha, login: .author.login, message: .commit.message}'`.text()
    const batch = text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const parsed: Diff = JSON.parse(line)
        return parsed
      })
    if (batch.length === 0) break
    list.push(...batch)
    if (batch.length < 100) break
  }
  return list
}

function reverted(commits: Commit[]) {
  const seen = new Map<string, Commit>()

  for (const commit of commits) {
    const match = commit.message.match(/^Revert "(.+)"$/)
    if (match) {
      const msg = match[1]
      if (msg === undefined) continue
      if (seen.has(msg)) seen.delete(msg)
      else seen.set(commit.message, commit)
      continue
    }

    const revert = `Revert "${commit.message}"`
    if (seen.has(revert)) {
      seen.delete(revert)
      continue
    }

    seen.set(commit.message, commit)
  }

  return [...seen.values()]
}

async function commits(from: string, to: string) {
  const base = ref(from)
  const head = ref(to)

  const data = new Map<string, { login: string | null; message: string }>()
  for (const item of await diff(base, head)) {
    data.set(item.sha, { login: item.login, message: item.message.split("\n")[0] ?? "" })
  }

  const log =
    await $`git log ${base}..${head} --format=%H -- packages/openaxe packages/sdk packages/plugin packages/extensions github`.text()

  const list: Commit[] = []
  for (const hash of log.split("\n").filter(Boolean)) {
    const item = data.get(hash)
    if (!item) continue
    if (item.message.match(/^(ignore:|test:|chore:|ci:|release:)/i)) continue

    const diffOutput = await $`git diff-tree --no-commit-id --name-only -r ${hash}`.text()
    const areas = new Set<string>()

    for (const file of diffOutput.split("\n").filter(Boolean)) {
      if (file.startsWith("packages/tui/") || file.startsWith("packages/ui/")) areas.add("tui")
      else if (file.startsWith("packages/openaxe/") || file.startsWith("packages/cli/")) areas.add("cli")
      else if (
        file.startsWith("packages/core/") ||
        file.startsWith("packages/llm/") ||
        file.startsWith("packages/schema/") ||
        file.startsWith("packages/effect-drizzle-sqlite/") ||
        file.startsWith("packages/server/") ||
        file.startsWith("packages/http-recorder/") ||
        file.startsWith("packages/script/")
      )
        areas.add("core")
      else if (file.startsWith("packages/sdk/") || file.startsWith("packages/plugin/")) areas.add("sdk")
      else if (file.startsWith(".github/")) areas.add("github")
    }

    if (areas.size === 0) continue

    list.push({
      hash: hash.slice(0, 7),
      author: item.login,
      message: item.message,
      areas,
    })
  }

  return reverted(list)
}

async function contributors(from: string, to: string) {
  const base = ref(from)
  const head = ref(to)

  const users: Map<string, Set<string>> = new Map()
  for (const item of await diff(base, head)) {
    const title = item.message.split("\n")[0] ?? ""
    if (!item.login || team.includes(item.login)) continue
    if (title.match(/^(ignore:|test:|chore:|ci:|release:)/i)) continue
    let titles = users.get(item.login)
    if (titles === undefined) {
      titles = new Set()
      users.set(item.login, titles)
    }
    titles.add(title)
  }

  return users
}

async function published(to: string) {
  if (to === "HEAD") return undefined
  const body = await $`gh release view ${ref(to)} --repo ${repo} --json body --jq .body`.text().catch(() => "")
  if (!body) return undefined

  const lines = body.split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith("**Thank you to "))
  if (start < 0) return undefined
  return lines.slice(start).join("\n").trim()
}

async function thanks(from: string, to: string, reuse: boolean) {
  const release = reuse ? await published(to) : undefined
  if (release) return release.split(/\r?\n/)

  const users = await contributors(from, to)
  if (users.size === 0) return []

  const lines = [`**Thank you to ${users.size} community contributor${users.size > 1 ? "s" : ""}:**`]
  for (const [name, commits] of users) {
    lines.push(`- @${name}:`)
    for (const commit of commits) lines.push(`  - ${commit}`)
  }
  return lines
}

function format(from: string, to: string, list: Commit[], thanks: string[]) {
  const typeOrder = ["feat", "fix", "perf", "refactor", "chore"] as const
  const grouped = new Map<string, string[]>()
  for (const t of typeOrder) grouped.set(t, [])

  for (const commit of list) {
    const match = commit.message.match(/^(feat|fix|perf|refactor|chore|docs)(\([^)]+\))?: (.+)/)
    if (!match) continue
    const [, type, , message] = match
    if (!typeOrder.includes(type)) continue
    const attr = commit.author && !team.includes(commit.author) ? ` (@${commit.author})` : ""
    const entries = grouped.get(type)
    if (entries)
      entries.push(
        `- \`${commit.hash}\` ${type}(${commit.message.split("(")[1]?.split(")")[0] ?? "openaxe"}): ${message}${attr}`,
      )
  }

  const lines = ["## What's Changed", ""]

  let hasContent = false
  const emojiMap = {
    feat: "🚀 Features",
    fix: "🐛 Fixes",
    perf: "⚡ Performance",
    refactor: "🧹 Chore & Refactor",
    chore: "🧹 Chore & Refactor",
  } as const
  const seenEmoji = new Set<string>()
  for (const type of ["feat", "fix", "perf", "refactor", "chore"] as const) {
    const entries = grouped.get(type) ?? []
    if (entries.length === 0) continue
    const emoji = emojiMap[type]
    if (seenEmoji.has(emoji)) continue
    seenEmoji.add(emoji)
    hasContent = true
    lines.push(`### ${emoji}`)
    // Collect all entries for this emoji
    const allEntries = ["feat", "fix", "perf", "refactor", "chore"]
      .filter(
        (t) =>
          (
            ({
              feat: "🚀 Features",
              fix: "🐛 Fixes",
              perf: "⚡ Performance",
              refactor: "🧹 Chore & Refactor",
              chore: "🧹 Chore & Refactor",
            }) as const
          )[t] === emoji,
      )
      .flatMap((t) => grouped.get(t) ?? [])
    lines.push(...allEntries)
    lines.push("")
  }

  if (!hasContent) {
    lines.push("No notable changes.")
  }

  if (thanks.length > 0) {
    if (lines.at(-1) !== "") lines.push("")
    lines.push("## Community Contributors Input")
    lines.push("")
    lines.push(...thanks)
  }

  if (lines.at(-1) === "") lines.pop()
  return lines.join("\n")
}

if (import.meta.main) {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      from: { type: "string", short: "f" },
      to: { type: "string", short: "t", default: "HEAD" },
      help: { type: "boolean", short: "h", default: false },
    },
  })

  if (values.help) {
    console.log(`
Usage: bun script/raw-changelog.ts [options]

Options:
  -f, --from <version>   Starting version (default: latest non-draft GitHub release)
  -t, --to <ref>         Ending ref (default: HEAD)
  -h, --help             Show this help message

Examples:
  bun script/raw-changelog.ts
  bun script/raw-changelog.ts --from 1.0.200
  bun script/raw-changelog.ts -f 1.0.200 -t 1.0.205
`)
    process.exit(0)
  }

  const to = values.to
  const from = values.from ?? (await latest())
  const list = await commits(from, to)
  console.log(format(from, to, list, await thanks(from, to, !values.from)))
}
