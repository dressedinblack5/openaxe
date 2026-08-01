// oxlint-disable-next-line typescript-eslint/no-explicit-any -- plugin option blobs carry arbitrary JSON keys indexed dynamically by plugin authors (e.g. ctx.options.description); no closed schema exists.
export type PluginOptions = Readonly<Record<string, any>>
