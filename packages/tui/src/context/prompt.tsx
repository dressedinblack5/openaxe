import { createSimpleContext } from "./helper"
import type { PromptRef } from "../component/prompt"

const PromptRef = createSimpleContext({
  name: "PromptRef",
  init: () => {
    let current: PromptRef | undefined

    return {
      get current() {
        return current
      },
      set(ref: PromptRef | undefined) {
        current = ref
      },
    }
  },
})
export const usePromptRef = PromptRef.use
export const PromptRefProvider = PromptRef.provider
