/**
 * Helper for HttpApi endpoint error types.
 * The HttpApi endpoint overloads don't accept tagged error schemas directly,
 * so we wrap them through `any` to bypass the type mismatch that would
 * otherwise require `as any` on every endpoint.
 */
// oxlint-disable-next-line typescript-eslint/no-explicit-any -- HttpApi endpoint overloads reject tagged error schemas; the any wrapper is the documented bypass (see module comment).
export function httpError(error: any): any {
  return error
}
