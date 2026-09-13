import { createSignal } from "solid-js"

const [focus, setFocus] = createSignal<"patches" | "files">("patches")

export function getDiffViewerFocus() {
  return focus()
}

export function setDiffViewerFocus(value: "patches" | "files") {
  setFocus(value)
}
