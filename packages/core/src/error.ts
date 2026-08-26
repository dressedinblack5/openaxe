/**
 * Type guard for discriminated unions with _tag field
 */
export const isTagged = <T extends { _tag: string }>(
  tag: T["_tag"],
): ((value: unknown) => value is T) => (value): value is T =>
  typeof value === "object" && value !== null && "_tag" in value && (value as Record<string, unknown>)._tag === tag

/**
 * Type for a tagged error - uses plain interface with _tag
 */
export type TaggedError<TTag extends string, TFields extends Record<string, unknown>> = {
  readonly _tag: TTag
} & TFields

/**
 * Create a tagged error constructor
 */
export const makeTaggedError = <TTag extends string, TFields extends Record<string, unknown>>(
  tag: TTag,
  _fields: TFields,
): { make: (input: TFields) => TaggedError<TTag, TFields> } => ({
  make: (input: TFields) => ({ _tag: tag, ...input } as TaggedError<TTag, TFields>),
})

/**
 * Type guard utility for error unions
 */
export const isErrorType = <T extends { _tag: string }>(
  errors: T[],
  tag: T["_tag"],
): ((error: T) => error is Extract<T, { _tag: typeof tag }>) =>
  (error): error is Extract<T, { _tag: typeof tag }> => error._tag === tag

/**
 * Narrow error union by tag
 */
export const narrowError = <T extends { _tag: string }>(
  error: T,
  tag: T["_tag"],
): Extract<T, { _tag: typeof tag }> | undefined =>
  error._tag === tag ? error : undefined