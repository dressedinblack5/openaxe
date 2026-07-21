export function mergeDeep(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = { ...target }
  for (const key of Object.keys(source)) {
    const sv = source[key]
    const rv = result[key]
    if (sv && typeof sv === "object" && !Array.isArray(sv) && rv && typeof rv === "object" && !Array.isArray(rv)) {
      result[key] = mergeDeep(rv, sv)
    } else if (sv === undefined) {
      delete result[key]
    } else {
      result[key] = sv
    }
  }
  return result
}

export * as MergeDeep from "./merge-deep"
