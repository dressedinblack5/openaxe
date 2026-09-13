import { createSimpleContext } from "./helper"

export interface Args {
  model?: string
  agent?: string
  prompt?: string
  continue?: boolean
  sessionID?: string
  fork?: boolean
}

const Args = createSimpleContext({
  name: "Args",
  init: (props: Args) => props,
})
export const useArgs = Args.use
export const ArgsProvider = Args.provider
