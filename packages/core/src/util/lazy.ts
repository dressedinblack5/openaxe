export function lazy<T>(fn: () => T) {
  let value: T | undefined
  let loaded = false

  return (): T => {
    if (loaded) return value as T
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- value is set by fn() and matches T
    loaded = true
    value = fn()
    return value
  }
}
