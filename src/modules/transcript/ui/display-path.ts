import { normalizeIdePath } from '../../../shared/platform/ide-path.js'

/**
 * Display form of an IDE-selection path: paths under the session cwd lose
 * the prefix so the indicator reads `src/a.ts` instead of a long absolute
 * path. Pure display: the model-facing block keeps the absolute path.
 */
export function displaySelectionPath(
  path: string,
  sessionCwd: string | undefined,
  caseInsensitive: boolean = process.platform === 'win32' || process.platform === 'darwin',
): string {
  if (sessionCwd === undefined || sessionCwd === '') return path
  const pathNorm = normalizeIdePath(path, false)
  const cwdNorm = normalizeIdePath(sessionCwd, false)
  if (cwdNorm === '' || cwdNorm.length >= pathNorm.length) return path
  if (cwdNorm === '/') {
    return pathNorm.startsWith('/') ? pathNorm.slice(1) : path
  }
  const foldedPath = normalizeIdePath(pathNorm, caseInsensitive)
  const foldedCwd = normalizeIdePath(cwdNorm, caseInsensitive)
  if (!foldedPath.startsWith(`${foldedCwd}/`)) return path
  return pathNorm.slice(cwdNorm.length + 1)
}
