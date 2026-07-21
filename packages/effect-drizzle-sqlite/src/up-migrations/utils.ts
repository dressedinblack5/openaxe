/* oxlint-disable */
export interface UpgradeResult {
  newDb: boolean
}

// ponytail: only sqlite used; other dialects (pg, mysql, mssql, cockroach, singlestore, effect) removed until needed
export const MIGRATIONS_TABLE_VERSIONS = {
  sqlite: 1,
} as const

export const GET_VERSION_FOR = {
  sqlite: (columns: string[]): number => {
    if (columns.includes("name")) return 1
    return 0
  },
} as const
