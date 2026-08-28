import { createSignal, createMemo } from "solid-js"

export type FocusRegion = "sidebar" | "messages" | "prompt" | "dialog" | "autocomplete"

const CYCLE: readonly FocusRegion[] = ["sidebar", "messages", "prompt"]

const [current, setCurrent] = createSignal<FocusRegion>("prompt")
const [_focusStack, setFocusStack] = createSignal<FocusRegion[]>([])

export const focusRegionSignal = current

export function isFocused(region: FocusRegion) {
  return createMemo(() => current() === region)
}

export function focusRegion(region: FocusRegion) {
  setCurrent(region)
}

export function focusNext() {
  const index = CYCLE.indexOf(current())
  if (index === -1) return
  const nextIndex = (index + 1) % CYCLE.length
  setCurrent(CYCLE[nextIndex])
}

export function focusPrev() {
  const index = CYCLE.indexOf(current())
  if (index === -1) return
  const prevIndex = (index - 1 + CYCLE.length) % CYCLE.length
  setCurrent(CYCLE[prevIndex])
}

export function pushFocus(region: FocusRegion) {
  setFocusStack((prev) => [...prev, current()])
  setCurrent(region)
}

export function popFocus() {
  setFocusStack((prev) => {
    const previous = prev[prev.length - 1]
    if (!previous) return prev
    setCurrent(previous)
    return prev.slice(0, -1)
  })
}

export function replaceFocus(region: FocusRegion) {
  setFocusStack((prev) => [...prev.slice(0, -1), current()])
  setCurrent(region)
}

export function clearFocusStack() {
  setFocusStack([])
}

export * as FocusManager from "./focus"
