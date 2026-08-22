import { Locale } from "./locale"

export function collapseToolOutput(output: string, maxLines: number, maxChars: number) {
  const lines = output.split("\n")
  if (lines.length <= maxLines && Bun.stringWidth(output) <= maxChars) {
    return { output, overflow: false }
  }

  const preview = lines.slice(0, maxLines).join("\n")
  if (Bun.stringWidth(preview) > maxChars) {
    return { output: Locale.truncate(preview, maxChars), overflow: true }
  }

  return { output: [...lines.slice(0, maxLines), "…"].join("\n"), overflow: true }
}
