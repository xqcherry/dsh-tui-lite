/** Supported runtime is the exact version shipped in this package's dependencies. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { gte } from 'semver'
const require = createRequire(import.meta.url)
const own = JSON.parse(readFileSync(require.resolve('@deepseek-harness-tui/dsh-tui/package.json'), 'utf8')) as {
  dependencies: Record<string, string>
}
export const UPSTREAM_VALIDATED_VERSION = own.dependencies['@deepseek-ai/dsh']!
const required = Object.keys(own.dependencies).filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))

function versionOf(name: string): string | undefined {
  try {
    return (JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')) as { version: string }).version
  } catch {
    return undefined
  }
}

/** Presentation metadata uses the installed runtime, never the TUI version. */
export function readHarnessVersion(): string | undefined {
  return versionOf('@deepseek-ai/dsh')
}

/** Refuse an untested or incomplete host before acquiring any TUI resources. */
export function assertUpstreamRuntime(versions?: Readonly<Record<string, string | undefined>>): void {
  for (const name of required) {
    const installed = versions === undefined ? versionOf(name) : versions[name]
    if (installed !== UPSTREAM_VALIDATED_VERSION) {
      throw new Error(`dsh-tui runtime mismatch: ${name} is ${installed ?? 'missing'}; expected ${UPSTREAM_VALIDATED_VERSION}. Reinstall or upgrade the client package.`)
    }
  }
}

/** Keep version-dependent API decisions in the adapter. */
export function installedMeetsVersion(name: string, minimum: string): boolean {
  const version = versionOf(name)
  return version !== undefined && gte(version, minimum)
}
