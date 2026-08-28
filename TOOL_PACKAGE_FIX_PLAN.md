# Tool Package TypeScript Fix Plan

## Overview

This document outlines the fixes needed to resolve pre-existing TypeScript typecheck errors in the `packages/tool` package. These issues are unrelated to the oxlint fixes and represent fundamental architecture issues in the tool system.

## Summary of Issues

| File                 | Issue Count | Primary Issues                                                              |
| -------------------- | ----------- | --------------------------------------------------------------------------- |
| `cli-tool.ts`        | 6           | Execute signature mismatch, context type incompatibility, Promise vs Effect |
| `plugin-tool.ts`     | 4           | Missing `jsonSchema` property, JSONSchema7[] vs JSONSchema7                 |
| `registry.ts`        | 4           | Missing ToolRegistrationError export, Effect error type mismatches          |
| `tool.ts`            | 8           | ToolRuntime not generic, ToolFailure used as value, P["Type"] vs Type<P>    |
| `external-loader.ts` | 2           | Missing module, Effect error type mismatches                                |
| `types.ts`           | 4           | Missing SessionID/MessageID exports, ToolRegistrationError missing          |

---

## Detailed Fix Plan

### 1. `packages/tool/src/adapters/cli-tool.ts` (6 errors)

**Problem**: `CliToolDefinition` and `ToolDefinition` have incompatible `execute` signatures and context types.

| Error  | Location | Root Cause                                                                                        |
| ------ | -------- | ------------------------------------------------------------------------------------------------- |
| TS2322 | Line 59  | `Effect<ToolExecutionResult, ToolFailure>` not assignable to `Effect<ToolExecutionResult, never>` |
| TS2352 | Line 89  | `CliToolDefinition` doesn't sufficiently overlap `ToolDefinition`                                 |
| TS2345 | Line 120 | `Promise<Type<O>>` vs `Effect<Type<O>, ToolFailure>`                                              |
| TS2345 | Line 135 | `CliToolContext` not assignable to `ToolContext`                                                  |
| TS2345 | Line 146 | Same context mismatch                                                                             |

**Fix Strategy**:

1. Make `ToolDefinition.execute` return `Effect<ToolExecutionResult, ToolFailure>` instead of `Effect<Schema.Schema.Type<Output>, ToolFailure>`
2. Make `ToolContext` a base type that `CliToolContext` extends (already done, but need to ensure covariance)
3. Update `CliToolDefinition.execute` to match `ToolDefinition.execute` signature exactly
4. Fix `makeCliTool` to return proper Effect instead of Promise
5. Remove unsafe casts with proper type narrowing

**Files to Modify**:

- `packages/tool/src/types.ts` - Update `ToolDefinition.execute` signature
- `packages/tool/src/adapters/cli-tool.ts` - Fix all signatures

---

### 2. `packages/tool/src/adapters/plugin-tool.ts` (4 errors)

**Problem**: Missing `jsonSchema` in returned object, JSONSchema7 array vs object.

| Error  | Location | Root Cause                                                                 |
| ------ | -------- | -------------------------------------------------------------------------- |
| TS2353 | Line 54  | `jsonSchema` not in `ToolDefinition` properties                            |
| TS2559 | Line 116 | `normalizeZodJsonSchema` returns `JSONSchema7[]` but expects `JSONSchema7` |
| TS2322 | Line 117 | `unknown` not assignable to `JSONSchema7`                                  |

**Fix Strategy**:

1. Add `jsonSchema` property to the returned object in `fromZodTool`
2. Fix `normalizeZodJsonSchema` to return `JSONSchema7` (not array)
3. Ensure `toZodTool` returns proper `ZodToolDefinition` without `jsonSchema` (it's not part of ZodToolDefinition)

---

### 3. `packages/tool/src/registry.ts` (4 errors)

**Problem**: Missing `ToolRegistrationError` export, Effect error type mismatches.

| Error  | Location | Root Cause                                                                        |
| ------ | -------- | --------------------------------------------------------------------------------- |
| TS2305 | Line 2   | `ToolRegistrationError` not exported from `./types`                               |
| TS2345 | Line 46  | `Effect<void, ToolRegistrationError>` vs `Effect<void, never>`                    |
| TS2322 | Line 67  | `Effect<ToolDefinition<P,O>                                                       | undefined, unknown>`vs`Effect<..., never>` |
| TS2322 | Line 77  | `Effect<ToolDefinition[], unknown>` vs `Effect<readonly ToolDefinition[], never>` |

**Fix Strategy**:

1. Export `ToolRegistrationError` from `./types.ts` (already defined in `tool.ts`)
2. Update `ToolRegistryInterface` to use `ToolFailure` instead of `ToolRegistrationError` for consistency, or export the error
3. Fix Effect error types to use `never` where appropriate (these are internal operations that shouldn't fail with these errors)

---

### 4. `packages/tool/src/tool.ts` (8 errors)

**Problem**: Multiple fundamental type system issues.

| Error  | Location            | Root Cause                                               |
| ------ | ------------------- | -------------------------------------------------------- |
| TS2315 | Line 72             | `ToolRuntime` not generic but used as `ToolRuntime<P,O>` |
| TS7006 | Lines 73, 95, 95    | Implicit `any` types for parameters                      |
| TS2693 | Lines 101, 112, 123 | `ToolFailure` used as value but only refers to type      |
| TS2345 | Lines 109, 131      | `P["Type"]` not assignable to `Type<P>`                  |

**Fix Strategy**:

1. Make `ToolRuntime` generic: `interface ToolRuntime<P extends Schema.Schema<unknown>, O extends Schema.Schema<unknown>>`
2. Add explicit type annotations for `name`, `call`, `context` parameters
3. Use `ToolFailureError` (the class) where `ToolFailure` (the interface) is used as value
4. Use `Schema.Schema.Type<P>` instead of `P["Type"]` (the latter is not a valid type access)

---

### 5. `packages/tool/src/external-loader.ts` (2 errors)

**Problem**: Missing module import, Effect error type mismatches.

| Error  | Location | Root Cause                                                     |
| ------ | -------- | -------------------------------------------------------------- |
| TS2307 | Line 3   | Cannot find module `@opencode-ai/openaxe/tool/discovery-cache` |
| TS2345 | Line 31  | Effect error type `unknown` vs `never`                         |

**Fix Strategy**:

1. Fix import path: `@opencode-ai/core/tool/discovery-cache` (not `@opencode-ai/openaxe/tool/...`)
2. Change Effect error types from `unknown` to `never` for internal operations

---

### 6. `packages/tool/src/types.ts` (4 errors)

**Problem**: Missing exports, missing types.

| Error  | Location | Root Cause                                                                    |
| ------ | -------- | ----------------------------------------------------------------------------- |
| TS2305 | Line 2   | `ToolRegistrationError` not exported                                          |
| TS2305 | Line 2   | `ToolRegistrationError` not in module                                         |
| TS2305 | Line 8   | `SessionID`, `MessageID` not exported from `@opencode-ai/core/session/schema` |

**Fix Strategy**:

1. Export `ToolRegistrationError` from `types.ts` (re-export from `tool.ts`)
2. Ensure `SessionID`, `MessageID` are properly exported from core session schema (already fixed in previous commits)

---

## Implementation Order (Dependency-Aware)

### Phase 1: Foundation Types (No Dependencies)

1. **`packages/tool/src/types.ts`** - Export `ToolRegistrationError`, ensure all types available
2. **`packages/tool/src/tool.ts`** - Fix `ToolRuntime` generic, `ToolFailureError`, `Schema.Schema.Type<P>`

### Phase 2: Core Tool Logic (Depends on Phase 1)

3. **`packages/tool/src/adapters/cli-tool.ts`** - Fix execute signatures, context types
4. **`packages/tool/src/adapters/plugin-tool.ts`** - Fix jsonSchema, JSONSchema7 normalization

### Phase 3: Registry & External (Depends on Phase 1-2)

5. **`packages/tool/src/registry.ts`** - Export ToolRegistrationError, fix Effect error types
6. **`packages/tool/src/external-loader.ts`** - Fix import path, Effect error types

### Phase 4: Integration & Tests

7. Update test files for type-only imports
8. Run full typecheck and test suite

---

## Estimated Effort

| Phase   | Files | Estimated Time | Risk   |
| ------- | ----- | -------------- | ------ |
| Phase 1 | 2     | 2-3 hours      | Low    |
| Phase 2 | 2     | 3-4 hours      | Medium |
| Phase 3 | 2     | 2-3 hours      | Low    |
| Phase 4 | 3+    | 1-2 hours      | Low    |

**Total**: ~8-12 hours

---

## Testing Strategy

After each phase:

1. Run `npx tsc --noEmit` in `packages/tool`
2. Run affected test suites: `bun test test/tool/`
3. Verify no regressions in other packages: `bun test test/effect/ test/config/ test/lsp/ test/plugin/`

## Success Criteria

- `npx tsc --noEmit` passes in `packages/tool` with 0 errors
- All existing tests pass
- No regressions in other packages
- Oxlint still passes (0 errors)
