/** Legacy DSH-only identifiers used by saved last-run records. */
export type KernelBackendId = 'dsh'

export function isKernelId(value: unknown): value is KernelBackendId {
  return value === 'dsh'
}

export function kernelDisplayName(_id: KernelBackendId): string {
  return 'DSH'
}

/** Retained only to clear inherited markers from older processes. */
export const KERNEL_SWITCH_HANDOFF_ENV = 'DSH_TUI_BACKEND_HANDOFF'
