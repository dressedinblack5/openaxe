import { createContext, createMemo, Show, useContext, type ParentProps } from "solid-js"

const hasReady = (value: unknown): value is { ready: unknown } =>
  typeof value === "object" && value !== null && "ready" in value

export function createSimpleContext<T, Props extends Record<string, unknown>>(
  input: {
    name: string
    init: ((input: Props) => T) | (() => T)
  } & (T extends { ready: unknown } ? { gate: boolean } : { gate?: boolean }),
) {
  const ctx = createContext<T>()

  return {
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props)
      const gate = input.gate ?? true

      if (!gate) {
        return <ctx.Provider value={init}>{props.children}</ctx.Provider>
      }

      const isReady = createMemo(() => {
        const ready = hasReady(init) ? init.ready : undefined
        if (ready === undefined) return true
        if (typeof ready === "function") return Boolean(ready())
        return Boolean(ready)
      })
      return (
        <Show when={isReady()}>
          <ctx.Provider value={init}>{props.children}</ctx.Provider>
        </Show>
      )
    },
    use: () => {
      const value = useContext(ctx)
      if (!value) throw new Error(`${input.name} context must be used within a context provider`)
      return value
    },
  }
}
