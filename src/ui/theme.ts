/** Default terminal palette shared by UI and Markdown formatting. */
export type Theme = {
  autoAccept: string
  bashBorder: string
  /** Primary brand/focus color. */
  accent: string
  toolNameMutate: string
  toolNameExec: string
  /** Primary brand/focus shimmer color. */
  accentShimmer: string
  /** Working activity indicator color. */
  activity: string
  /** Working activity indicator shimmer color. */
  activityShimmer: string
  permission: string
  permissionShimmer: string
  planMode: string
  ide: string
  promptBorder: string
  promptBorderShimmer: string
  text: string
  inverseText: string
  inactive: string
  inactiveShimmer: string
  subtle: string
  suggestion: string
  remember: string
  background: string
  // Semantic colors
  success: string
  error: string
  warning: string
  merged: string
  warningShimmer: string
  // Diff colors
  diffAdded: string
  diffRemoved: string
  diffAddedDimmed: string
  diffRemovedDimmed: string
  diffAddedWord: string
  diffRemovedWord: string
  // Tool card surfaces (two depth levels; the card itself takes the dim
  // shade, diff context rows the lighter one, changed rows the diff palette)
  toolCardBackground: string
  toolCardBackgroundDim: string
  // Tool status dots, by tool category (error always wins with a red ✗)
  toolDotExec: string
  toolDotRead: string
  toolDotWrite: string
  toolDotWeb: string
  toolDotTask: string
  // Diff syntax highlighting (user themes may override any of these)
  syntaxKeyword: string
  syntaxString: string
  syntaxComment: string
  syntaxNumber: string
  syntaxFunction: string
  syntaxType: string
  syntaxVariable: string
  syntaxOperator: string
  syntaxPunctuation: string
  syntaxConstant: string
  // Agent colors
  // Grove colors
  professionalBlue: string
  // Chrome colors
  chromeYellow: string
  // Themed chrome that used to be hardcoded: the context bar's per-content-type
  // segment fills (system → tools, in bar order), the thinking-effort ignition
  // pair (top-tier sweep / `❯` prefix / tier badge), and the prompt caret.
  // `cursor` empty keeps the inverse-video caret.
  contextBarSystem: string
  contextBarPrompt: string
  contextBarAssistant: string
  contextBarThinking: string
  contextBarTools: string
  /** Effort ignition colour: the wave crest, the charged `❯` and the badge. */
  ignition: string
  /** Where the ignition wave fades out (its resting end), i.e. the band colour. */
  ignitionDim: string
  /**
   * Prompt-input caret fill. Empty (every built-in) keeps the inverse-video
   * caret; a declared fill gets the palette ink that contrasts with it.
   */
  cursor: string
  // TUI V2 colors
  /** Mascot body color. */
  mascotBody: string
  /** Input/editor background color. */
  inputBackground: string
  userMessageBackground: string
  userMessageBackgroundHover: string
  messageActionsBackground: string
  selectionBg: string
  bashMessageBackgroundColor: string
  memoryBackgroundColor: string
  rate_limit_fill: string
  rate_limit_empty: string
  fastMode: string
  fastModeShimmer: string
  userPromptLabel: string
  // Subagent message colors
  subagentBullet: string
  subagentDescription: string
  subagentModel: string
  subagentElapsed: string
  subagentToolName: string
  subagentStatusRunning: string
  subagentStatusCompleted: string
  subagentStatusFailed: string
}

export type ThemeName = string
export type ThemeColorKey = keyof Theme

const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255})`
}

/** The five used-segment fills of the context bar, in bar order. */
type ContextBarRamp = Pick<
  Theme,
  | 'contextBarSystem'
  | 'contextBarPrompt'
  | 'contextBarAssistant'
  | 'contextBarThinking'
  | 'contextBarTools'
>

/**
 * Gentle Mist Blue's context-bar ramp — the DeepSeek blue family. The bar was
 * never light-specific, so the family's dark and light presets share it; only
 * the ignition pair differs between them.
 */
const MIST_BAR_RAMP: ContextBarRamp = {
  contextBarSystem: rgb('#1E3A8A'), // deep blue
  contextBarPrompt: rgb('#1D4ED8'), // vivid blue
  contextBarAssistant: rgb('#2563EB'), // bright blue
  contextBarThinking: rgb('#3B82F6'), // accent blue
  contextBarTools: rgb('#60A5FA'), // sky blue
}

/**
 * Gentle Mist Blue dark adaptation. The blues come straight from the card
 * The palette keeps the OpenCode contrast idea: near-white text, one vivid
 * blue accent family, and saturated semantic accents for tool status.
 */
const darkTheme: Theme = {
  autoAccept: rgb('#C084FC'), // Soft violet
  bashBorder: rgb('#FB7185'), // Mist rose
  accent: rgb('#4D9EFF'), // Accent Soft — mist brand blue
  toolNameMutate: rgb('#FB923C'), // soft gold — Edit/Write (warm accent)
  toolNameExec: rgb('#34D399'), // mist cyan — Bash/exec tools
  accentShimmer: rgb('#8CC8FF'), // Border Blue for shimmer effect
  activity: rgb('#4D9EFF'),
  activityShimmer: rgb('#9BD1FF'),
  permission: rgb('#6FB4FF'), // Border Blue — pane/dialog accent
  permissionShimmer: rgb('#A5D2FF'),
  planMode: rgb('#4ADE80'), // Muted sage green
  ide: rgb('#5EB1FF'), // Accent Blue
  promptBorder: rgb('#4C6FA8'), // Muted blue-gray
  promptBorderShimmer: rgb('#4D9EFF'),
  text: rgb('#FFFFFF'), // Warm off-white (from #F6F3ED)
  inverseText: rgb('#111827'), // Deep warm charcoal (from #343945)
  inactive: rgb('#A7B2C4'), // Mist gray-blue — feeds dimColor
  inactiveShimmer: rgb('#C9D3E3'),
  subtle: rgb('#7F8A9E'), // Dimmer blue-gray
  suggestion: rgb('#8CC8FF'), // Border Blue — focus/selection
  remember: rgb('#8CC8FF'),
  background: rgb('#2563EB'), // Accent Blue — badge fill
  success: rgb('#4ADE80'), // Mist green (from #4E9675)
  error: rgb('#FF6B81'), // Soft rose
  warning: rgb('#FFC857'), // Soft amber
  merged: rgb('#C084FC'), // Soft violet (matches autoAccept)
  warningShimmer: rgb('#FFD98A'),
  diffAdded: rgb('#15351F'),
  diffRemoved: rgb('#3A1D24'),
  diffAddedDimmed: rgb('#1A2E22'),
  diffRemovedDimmed: rgb('#2E1E24'),
  diffAddedWord: rgb('#4ADE80'),
  diffRemovedWord: rgb('#FF7A90'),
  toolCardBackground: rgb('#1E293B'), // lighter blue-grey card surface
  toolCardBackgroundDim: rgb('#151D2B'), // deeper blue substrate
  toolDotExec: rgb('#34D399'), // sage green — bash/pwsh
  toolDotRead: rgb('#60A5FA'), // cyan blue — read/grep/glob
  toolDotWrite: rgb('#C084FC'), // soft violet — edit/write
  toolDotWeb: rgb('#FB923C'), // mist blue — web search/fetch
  toolDotTask: rgb('#F472B6'), // mist rose — subagent/jobs
  syntaxKeyword: rgb('#7DD3FC'), // muted anchor blue
  syntaxString: rgb('#86EFAC'), // mist green, distinct without neon saturation
  syntaxComment: rgb('#94A3B8'), // neutral blue-grey
  syntaxNumber: rgb('#FDBA74'), // softened warm amber
  syntaxFunction: rgb('#60A5FA'), // muted cyan
  syntaxType: rgb('#C4B5FD'), // softened violet
  syntaxVariable: rgb('#E2E8F0'), // near-text
  syntaxOperator: rgb('#CBD5E1'), // blue grey
  syntaxPunctuation: rgb('#94A3B8'), // dim blue grey
  syntaxConstant: rgb('#F9A8D4'), // softened rose
  professionalBlue: rgb('#4D9EFF'),
  chromeYellow: rgb('#FFC857'),
  // Pre-theme values, now overridable: the mist family's bar ramp (shared with
  // `light`) and the ignition pair — bright blue over the terminal's own dark
  // substrate.
  ...MIST_BAR_RAMP,
  ignition: rgb('#7DD3FC'),
  ignitionDim: rgb('#1B2233'),
  // Every built-in leaves the caret empty on purpose: empty keeps the
  // inverse-video block the palette always had, and a theme opts into a
  // coloured block by naming a fill.
  cursor: '',
  mascotBody: rgb('#D98A63'), // Warm mascot orange
  inputBackground: rgb('#000000'),
  userMessageBackground: '', // user turn: no fill, gold bold text only (Kimi style)
  userMessageBackgroundHover: rgb('#1E3A8A'), // hover/expand: blue block with gold text
  messageActionsBackground: rgb('#263449'),
  selectionBg: rgb('#254A7A'), // Mist-blue tint on dark
  bashMessageBackgroundColor: rgb('#1A2332'),
  memoryBackgroundColor: rgb('#1E293B'),
  rate_limit_fill: rgb('#4D9EFF'),
  rate_limit_empty: rgb('#334155'),
  fastMode: rgb('#FB923C'),
  fastModeShimmer: rgb('#FDBA74'),
  userPromptLabel: rgb('#FFDF80'),
  subagentBullet: rgb('#F472B6'),
  subagentDescription: rgb('#F4F7FF'),
  subagentModel: rgb('#AAB4C8'),
  subagentElapsed: rgb('#AAB4C8'),
  subagentToolName: rgb('#4D9EFF'),
  subagentStatusRunning: rgb('#4D9EFF'),
  subagentStatusCompleted: rgb('#4ADE80'),
  subagentStatusFailed: rgb('#FF6B81'),
}

export function getTheme(_name: ThemeName = 'dark'): Theme {
  return darkTheme
}

export function getActiveTheme(): Theme {
  return darkTheme
}

export function getActiveThemeName(): ThemeName {
  return 'dark'
}

export function isLightThemeActive(_name: ThemeName): boolean {
  return false
}

export function cursorGlyphColor(theme: Theme): 'text' | 'inverseText' {
  const fill = parseFixedColor(theme.cursor)
  const ink = parseFixedColor(theme.text)
  const inverse = parseFixedColor(theme.inverseText)
  if (fill === undefined || ink === undefined || inverse === undefined) return 'inverseText'
  return contrastRatio(fill, ink) > contrastRatio(fill, inverse) ? 'text' : 'inverseText'
}

/**
 * sRGB channels of a fixed-channel color (`#rgb`, `#rrggbb`, `#rrggbbaa`,
 * `rgb()`), or undefined for the 16-color `ansi:*` forms — those carry no
 * channel values here, and their consumers fall back rather than guess. A
 * palette a legacy runtime resolver hands back can also omit the key entirely,
 * so undefined is a normal input, not a programming error.
 *
 * `#rrggbbaa` is accepted because the validators accept it, and the renderer
 * (chalk) drops the alpha byte: the visible channels are the first six digits.
 * Reading only three/six-digit hex made `#000000` and `#000000ff` — the same
 * background on screen — take opposite contrast branches.
 */
function parseFixedColor(color: string | undefined): readonly [number, number, number] | undefined {
  if (typeof color !== 'string') return undefined
  const trimmed = color.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(trimmed)
  if (hex !== null) {
    const digits = hex[1]!.length === 3
      ? [...hex[1]!].map(digit => digit + digit).join('')
      : hex[1]!
    // The slice stops at six digits, so a trailing alpha byte is ignored here
    // exactly as the SGR emitter ignores it.
    return [
      parseInt(digits.slice(0, 2), 16),
      parseInt(digits.slice(2, 4), 16),
      parseInt(digits.slice(4, 6), 16),
    ]
  }
  const form = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(trimmed)
  if (form === null) return undefined
  return [Number(form[1]), Number(form[2]), Number(form[3])]
}

/** WCAG contrast ratio between two sRGB colors, for glyph-on-fill choices. */
function contrastRatio(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number {
  const channel = (value: number): number => {
    const c = value / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const luminance = (color: readonly [number, number, number]): number =>
    0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2])
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}
