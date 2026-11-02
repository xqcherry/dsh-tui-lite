/**
 * Compact adaptation of dsh-ui-whale's hand-drawn blue whale and idle motion.
 * Upstream: https://github.com/omdsh-dev/dsh-ui-whale
 * Commit: 74a2fdd3d1ae43708a2e58caf8e44ec1591fa48d
 * Copyright (c) 2026 lhh010. BSD-3-Clause; see THIRD_PARTY_LICENSES.
 * Each pair of pixel rows becomes one terminal row: 12 columns × 4 rows.
 */
const REST = [
  '000000000000',
  '000000000000',
  '001111000101',
  '012222100221',
  '124122212100',
  '122222222100',
  '012333321000',
  '001111110000',
] as const

// The compact fluke spans at most two pixel rows. Only the tail changes;
// the face and body stay anchored across poses.
const TAILS = [
  REST.slice(0, 4),
  ['000000000000', '000000000000', '001111000110', '012222100221'],
  ['000000000000', '000000000000', '001111000000', '012222101221'],
] as const

export const WHALE_PALETTE: Readonly<Record<string, `#${string}`>> = {
  '1': '#203864',
  '2': '#0066ff',
  '3': '#b4c7e7',
  '4': '#f2f2f2',
}

/** Deterministic idle poses, independent of session or assistant state. */
export function getWhalePixels(elapsedMs: number): readonly string[] {
  const time = Math.max(0, elapsedMs)
  const tailPhase = time % 11000 - 10200
  const tail = tailPhase < 0 ? 0 : [0, 1, 2, 1, 0][Math.min(4, Math.floor(tailPhase / 160))]
  const rows: string[] = [...TAILS[tail], ...REST.slice(4)]
  if (time % 5000 >= 4800) rows[4] = '122122212100'
  return rows
}
