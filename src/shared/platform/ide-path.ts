/** Normalize IDE paths without consulting the host filesystem. */
export function normalizeIdePath(path: string, caseInsensitive: boolean): string {
  const normalized = path === '/' ? '/' : path.replace(/\\/g, '/').replace(/\/+$/, '')
  return caseInsensitive ? normalized.toLowerCase() : normalized
}
