export function lazy<T>(fn: () => T) {
  let value: T | undefined
  let loaded = false

  return (): T => {
    // oxlint-disable-next-line typescript-eslint/no-unsafe-type-assertion -- value is set by fn() and matches T.
    if (loaded) return value as T
    loaded = true
    value = fn()
    return value
  }
}
