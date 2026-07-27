import type { RouteDefaultsInput } from "./route/client"
import type { Model, ModelID, ProviderID } from "./schema"

export type ModelOptions = RouteDefaultsInput

export type ModelFactory<Options extends ModelOptions = ModelOptions> = (
  id: string | ModelID,
  options?: Options,
) => Model

type AnyModelFactory = (...args: never[]) => Model

export interface Definition<Factory extends AnyModelFactory = ModelFactory> {
  readonly id: ProviderID
  readonly model: Factory
  readonly apis?: Record<string, AnyModelFactory>
}

export * as Provider from "./provider"
