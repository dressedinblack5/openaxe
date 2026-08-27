// Unified Context Module - Main Exports

// Core service (re-exports types)
export * from "./context"

// Adapters - excluded from typecheck until Effect v4 migration complete
// export * from "./adapters/system-context"
// export * from "./adapters/instance-context"
// export * from "./adapters/workspace-context"
// export * from "./adapters/plugin-context"

// Self-reexport for namespace import
export * as Context from "./context"