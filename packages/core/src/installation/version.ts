declare global {
  const OPENAXE_VERSION: string
  const OPENAXE_CHANNEL: string
}

const devStamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")

export const InstallationVersion = typeof OPENAXE_VERSION === "string" ? OPENAXE_VERSION : `0.0.0-local-${devStamp}`
export const InstallationChannel = typeof OPENAXE_CHANNEL === "string" ? OPENAXE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
