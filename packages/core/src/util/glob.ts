export interface Options {
  cwd?: string
  absolute?: boolean
  include?: "file" | "all"
  dot?: boolean
  symlink?: boolean
}

export async function scan(pattern: string, options: Options = {}): Promise<string[]> {
  try {
    const results: string[] = []
    for await (const match of new Bun.Glob(pattern).scan({
      cwd: options.cwd,
      absolute: options.absolute,
      dot: options.dot,
      nodir: options.include !== "all",
    } as Record<string, unknown>)) {
      results.push(match)
    }
    return results
  } catch (e) {
    if (e instanceof Error && e.message.includes("ENOENT")) return []
    throw e
  }
}

export function scanSync(pattern: string, options: Options = {}): string[] {
  try {
    return [...new Bun.Glob(pattern).scanSync({
      cwd: options.cwd,
      absolute: options.absolute,
      dot: options.dot,
      nodir: options.include !== "all",
    } as Record<string, unknown>)]
  } catch (e) {
    if (e instanceof Error && e.message.includes("ENOENT")) return []
    throw e
  }
}

export function match(pattern: string, filepath: string): boolean {
  return new Bun.Glob(pattern).match(filepath)
}

export * as Glob from "./glob"
