import { createSignal } from "solid-js"

export type FocusRegion = "sidebar" | "messages" | "prompt" | "dialog"

const CYCLE: readonly FocusRegion[] = ["sidebar", "messages", "prompt"]

const [current, setCurrent] = createSignal<FocusRegion>("prompt")
const restored: FocusRegion[] = []

export function focusRegion(region: FocusRegion) {
  setCurrent(region)
}

export function focusNext() {
  const index = CYCLE.indexOf(current())
  const nextIndex = (index + 1) % CYCLE.length
  setCurrent(CYCLE[nextIndex] ?? "prompt")
}

export function focusPrev() {
  const index = CYCLE.indexOf(current())
  const prevIndex = (index - 1 + CYCLE.length) % CYCLE.length
  setCurrent(CYCLE[prevIndex] ?? "prompt")
}

export function pushDialog() {
  restored.push(current())
  setCurrent("dialog")
}

export function popDialog() {
  const previous = restored.pop()
  if (!previous) return
  setCurrent(previous)
}

export * as FocusManager from "./focus"
