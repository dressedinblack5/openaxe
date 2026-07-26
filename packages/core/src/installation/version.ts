declare global {
  const OPENAXE_VERSION: string
  const OPENAXE_CHANNEL: string
}

export const InstallationVersion = typeof OPENAXE_VERSION === "string" ? OPENAXE_VERSION : "local"
export const InstallationChannel = typeof OPENAXE_CHANNEL === "string" ? OPENAXE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
