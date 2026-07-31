import {
  RequestError,
  type Agent as ACPAgent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseSessionRequest,
  type ForkSessionRequest,
  type InitializeRequest,
  type ListSessionsRequest,
  type LoadSessionRequest,
  type NewSessionRequest,
  type PromptRequest,
  type ResumeSessionRequest,
  type SetSessionConfigOptionRequest,
  type SetSessionModelRequest,
  type SetSessionModeRequest,
} from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { fromUnknownDefect, toRequestError } from "./error"
import type { Error, Interface } from "./service"
import { make } from "./service"
export function init({ sdk: _sdk }: { sdk: OpencodeClient }) {
  return {
    create: (connection: AgentSideConnection) => {
      return new Agent(make({ sdk: _sdk, connection }))
    },
  }
}

export class Agent implements ACPAgent {
  constructor(private readonly service: Promise<Interface>) {}

  initialize(params: InitializeRequest) {
    return this.withService((service) => service.initialize(params))
  }

  authenticate(params: AuthenticateRequest) {
    return this.withService((service) => service.authenticate(params))
  }

  newSession(params: NewSessionRequest) {
    return this.withService((service) => service.newSession(params))
  }

  loadSession(params: LoadSessionRequest) {
    return this.withService((service) => service.loadSession(params))
  }

  listSessions(params: ListSessionsRequest) {
    return this.withService((service) => service.listSessions(params))
  }

  resumeSession(params: ResumeSessionRequest) {
    return this.withService((service) => service.resumeSession(params))
  }

  closeSession(params: CloseSessionRequest) {
    return this.withService((service) => service.closeSession(params))
  }

  unstable_forkSession(params: ForkSessionRequest) {
    return this.withService((service) => service.forkSession(params))
  }

  setSessionConfigOption(params: SetSessionConfigOptionRequest) {
    return this.withService((service) => service.setSessionConfigOption(params))
  }

  setSessionMode(params: SetSessionModeRequest) {
    return this.withService((service) => service.setSessionMode(params))
  }

  unstable_setSessionModel(params: SetSessionModelRequest) {
    return this.withService((service) => service.setSessionModel(params))
  }

  prompt(params: PromptRequest) {
    return this.withService((service) => service.prompt(params))
  }

  cancel(params: CancelNotification) {
    return this.withService((service) => service.cancel(params))
  }

  private withService<A>(fn: (service: Interface) => Effect.Effect<A, Error>) {
    return this.service.then((service) => run(fn(service)))
  }
}

function run<A>(effect: Effect.Effect<A, Error>) {
  return Effect.runPromise(effect.pipe(Effect.mapError(toRequestError))).catch((defect: unknown) => {
    if (defect instanceof RequestError) throw defect
    throw toRequestError(fromUnknownDefect(defect))
  })
}

export * as ACP from "./agent"
