/**
 * Helper for HttpApi endpoint error types.
 * The HttpApi endpoint overloads don't accept tagged error schemas directly,
 * so we wrap them through `any` to bypass the type mismatch that would
 * otherwise require `as any` on every endpoint.
 */
export function httpError(error: any): any {
  return error
}
