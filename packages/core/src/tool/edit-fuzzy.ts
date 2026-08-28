/**
 * Fuzzy replacement correction strategies for the edit leaf.
 *
 * These are ported from the V1 edit tool (packages/openaxe/src/tool/edit.ts),
 * which credits cline and gemini-cli for the approach. Core keeps exact-edit as
 * the primary path; these strategies run only as a retry when the exact
 * oldString cannot be found. Each strategy yields candidate substrings of the
 * content; the orchestrator applies the first candidate that uniquely matches.
 */
export * as EditFuzzy from "./edit-fuzzy"

/** Outcome of a fuzzy replacement attempt against one file. */
export type FuzzyResult =
  | { readonly tag: "not-found" }
  | { readonly tag: "ambiguous" }
  | { readonly tag: "disproportionate" }
  | { readonly tag: "replaced"; readonly text: string; readonly replacements: number }

/**
 * Levenshtein edit distance between two strings. Used by the block-anchor
 * strategy to score how similar candidate middle lines are to the search.
 */
function levenshtein(a: string, b: string): number {
  if (a === "" || b === "") return Math.max(a.length, b.length)
  const matrix: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost)
    }
  }
  return matrix[a.length][b.length]
}

function occurrences(content: string, search: string): number {
  if (search === "") return 0
  let count = 0
  let offset = 0
  while ((offset = content.indexOf(search, offset)) !== -1) {
    count++
    offset += search.length
  }
  return count
}

/** Line-trimmed matching: each search line matches when leading/trailing whitespace is ignored. */
function* lineTrimmed(content: string, find: string): Generator<string> {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")
  if (searchLines[searchLines.length - 1] === "") searchLines.pop()

  for (let i = 0; i <= originalLines.length - searchLines.length; i++) {
    let matches = true
    for (let j = 0; j < searchLines.length; j++) {
      if (originalLines[i + j].trim() !== searchLines[j].trim()) {
        matches = false
        break
      }
    }
    if (!matches) continue

    let matchStartIndex = 0
    for (let k = 0; k < i; k++) {
      matchStartIndex += originalLines[k].length + 1
    }
    let matchEndIndex = matchStartIndex
    for (let k = 0; k < searchLines.length; k++) {
      matchEndIndex += originalLines[i + k].length
      if (k < searchLines.length - 1) matchEndIndex += 1
    }
    yield content.substring(matchStartIndex, matchEndIndex)
  }
}

const SINGLE_CANDIDATE_THRESHOLD = 0.65
const MULTIPLE_CANDIDATES_THRESHOLD = 0.65

/**
 * Block-anchor fallback: requires at least 3 search lines and uses the first and
 * last trimmed lines as anchors, scoring the middle lines by similarity.
 */
function* blockAnchor(content: string, find: string): Generator<string> {
  const originalLines = content.split("\n")
  const searchLines = find.split("\n")
  if (searchLines.length < 3) return
  if (searchLines[searchLines.length - 1] === "") searchLines.pop()

  const firstLineSearch = searchLines[0].trim()
  const lastLineSearch = searchLines[searchLines.length - 1].trim()
  const searchBlockSize = searchLines.length
  const maxLineDelta = Math.max(1, Math.floor(searchBlockSize * 0.25))

  const candidates: Array<{ startLine: number; endLine: number }> = []
  for (let i = 0; i < originalLines.length; i++) {
    if (originalLines[i].trim() !== firstLineSearch) continue
    for (let j = i + 2; j < originalLines.length; j++) {
      if (originalLines[j].trim() === lastLineSearch) {
        if (Math.abs(j - i + 1 - searchBlockSize) <= maxLineDelta) {
          candidates.push({ startLine: i, endLine: j })
        }
        break
      }
    }
  }
  if (candidates.length === 0) return

  const middleSimilarity = (startLine: number, endLine: number) => {
    const actualBlockSize = endLine - startLine + 1
    const linesToCheck = Math.min(searchBlockSize - 2, actualBlockSize - 2)
    if (linesToCheck <= 0) return 1
    let similarity = 0
    for (let j = 1; j < searchBlockSize - 1 && j < actualBlockSize - 1; j++) {
      const originalLine = originalLines[startLine + j].trim()
      const searchLine = searchLines[j].trim()
      const maxLen = Math.max(originalLine.length, searchLine.length)
      if (maxLen === 0) continue
      similarity += 1 - levenshtein(originalLine, searchLine) / maxLen
    }
    return similarity / linesToCheck
  }
  const span = (startLine: number, endLine: number) => {
    let matchStartIndex = 0
    for (let k = 0; k < startLine; k++) {
      matchStartIndex += originalLines[k].length + 1
    }
    let matchEndIndex = matchStartIndex
    for (let k = startLine; k <= endLine; k++) {
      matchEndIndex += originalLines[k].length
      if (k < endLine) matchEndIndex += 1
    }
    return content.substring(matchStartIndex, matchEndIndex)
  }

  if (candidates.length === 1) {
    const { startLine, endLine } = candidates[0]
    if (middleSimilarity(startLine, endLine) >= SINGLE_CANDIDATE_THRESHOLD) yield span(startLine, endLine)
    return
  }
  let best: { startLine: number; endLine: number; similarity: number } | undefined
  for (const candidate of candidates) {
    const similarity = middleSimilarity(candidate.startLine, candidate.endLine)
    if (!best || similarity > best.similarity) best = { ...candidate, similarity }
  }
  if (best && best.similarity >= MULTIPLE_CANDIDATES_THRESHOLD) yield span(best.startLine, best.endLine)
}

/** Indentation correction: compare blocks after stripping their common indentation. */
function* indentationFlexible(content: string, find: string): Generator<string> {
  const removeIndentation = (text: string) => {
    const lines = text.split("\n")
    const nonEmptyLines = lines.filter((line) => line.trim().length > 0)
    if (nonEmptyLines.length === 0) return text
    const minIndent = Math.min(
      ...nonEmptyLines.map((line) => {
        const match = /^(\s*)/.exec(line)
        return match ? match[1].length : 0
      }),
    )
    return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n")
  }

  const normalizedFind = removeIndentation(find)
  const contentLines = content.split("\n")
  const findLines = find.split("\n")
  for (let i = 0; i <= contentLines.length - findLines.length; i++) {
    const block = contentLines.slice(i, i + findLines.length).join("\n")
    if (removeIndentation(block) === normalizedFind) yield block
  }
}

/** Guards against a fuzzy match spanning far more content than the search text. */
function isDisproportionateMatch(search: string, oldString: string): boolean {
  const oldLines = oldString.split("\n").length
  const searchLines = search.split("\n").length
  if (searchLines >= Math.max(oldLines + 3, oldLines * 2)) return true
  if (oldLines === 1) return false
  return search.trim().length > Math.max(oldString.trim().length + 500, oldString.trim().length * 4)
}

/**
 * Tries the fuzzy correction strategies in order and applies the first unique
 * match. When `replaceAll` is set every match of the yielded search is replaced.
 * Exact matches are intentionally not handled here: the caller runs the exact
 * path first and only retries with this when the exact search is absent.
 */
export function fuzzyReplace(content: string, find: string, replacement: string, replaceAll: boolean): FuzzyResult {
  let sawCandidate = false
  for (const replacer of [lineTrimmed, blockAnchor, indentationFlexible]) {
    for (const search of replacer(content, find)) {
      const index = content.indexOf(search)
      if (index === -1) continue
      sawCandidate = true
      if (isDisproportionateMatch(search, find)) return { tag: "disproportionate" }
      if (replaceAll) {
        return {
          tag: "replaced",
          text: content.replaceAll(search, replacement),
          replacements: occurrences(content, search),
        }
      }
      const lastIndex = content.lastIndexOf(search)
      if (index !== lastIndex) continue
      return {
        tag: "replaced",
        text: content.slice(0, index) + replacement + content.slice(index + search.length),
        replacements: 1,
      }
    }
  }
  return sawCandidate ? { tag: "ambiguous" } : { tag: "not-found" }
}
