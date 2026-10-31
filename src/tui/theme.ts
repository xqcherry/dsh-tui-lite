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
  contextBarSystem: rgb('#22305F'), // deep navy
  contextBarPrompt: rgb('#2B3D78'), // navy
  contextBarAssistant: rgb('#344A92'), // indigo
  contextBarThinking: rgb('#4D6BFE'), // DeepSeek brand blue
  contextBarTools: rgb('#5A7CFF'), // lighter blue
}

/**
 * Gentle Mist Blue dark adaptation. The blues come straight from the card
 * (#27478C–#ABC2EC); neutrals are warm (derived from #F6F3ED/#343945) so
 * the palette reads calm rather than cyber-hard on a dark terminal.
 */
const darkTheme: Theme = {
  autoAccept: rgb('#B3A0D4'), // Soft violet
  bashBorder: rgb('#D194AE'), // Mist rose
  accent: rgb('#7DA1DE'), // Accent Soft — mist brand blue
  toolNameMutate: rgb('#E5C07B'), // soft gold — Edit/Write (warm accent)
  toolNameExec: rgb('#56B6C2'), // mist cyan — Bash/exec tools
  accentShimmer: rgb('#ABC2EC'), // Border Blue for shimmer effect
  activity: rgb('#7DA1DE'),
  activityShimmer: rgb('#ABC2EC'),
  permission: rgb('#ABC2EC'), // Border Blue — pane/dialog accent
  permissionShimmer: rgb('#C9D7F2'),
  planMode: rgb('#7FAE99'), // Muted sage green
  ide: rgb('#5E88CC'), // Accent Blue
  promptBorder: rgb('#55606F'), // Muted blue-gray
  promptBorderShimmer: rgb('#7DA1DE'),
  text: rgb('#E8E6E0'), // Warm off-white (from #F6F3ED)
  inverseText: rgb('#22262E'), // Deep warm charcoal (from #343945)
  inactive: rgb('#8D95A6'), // Mist gray-blue — feeds dimColor
  inactiveShimmer: rgb('#AAB2C2'),
  subtle: rgb('#5E6673'), // Dimmer blue-gray
  suggestion: rgb('#ABC2EC'), // Border Blue — focus/selection
  remember: rgb('#ABC2EC'),
  background: rgb('#5E88CC'), // Accent Blue — badge fill
  success: rgb('#82B89D'), // Mist green (from #4E9675)
  error: rgb('#DA8A93'), // Soft rose
  warning: rgb('#D8B270'), // Soft amber
  merged: rgb('#B3A0D4'), // Soft violet (matches autoAccept)
  warningShimmer: rgb('#E4C78E'),
  diffAdded: rgb('#27392C'),
  diffRemoved: rgb('#3E2A2C'),
  diffAddedDimmed: rgb('#2B352C'),
  diffRemovedDimmed: rgb('#362B2C'),
  diffAddedWord: rgb('#57956B'),
  diffRemovedWord: rgb('#B26671'),
  toolCardBackground: rgb('#242B3A'), // lighter blue-grey card surface
  toolCardBackgroundDim: rgb('#1C2330'), // deeper blue substrate
  toolDotExec: rgb('#7FAE99'), // sage green — bash/pwsh
  toolDotRead: rgb('#82B8C7'), // cyan blue — read/grep/glob
  toolDotWrite: rgb('#B3A0D4'), // soft violet — edit/write
  toolDotWeb: rgb('#7DA1DE'), // mist blue — web search/fetch
  toolDotTask: rgb('#D194AE'), // mist rose — subagent/jobs
  syntaxKeyword: rgb('#78A0D6'), // muted anchor blue
  syntaxString: rgb('#79AD91'), // mist green, distinct without neon saturation
  syntaxComment: rgb('#74808D'), // neutral blue-grey
  syntaxNumber: rgb('#C89B70'), // softened warm amber
  syntaxFunction: rgb('#6FAEB5'), // muted cyan
  syntaxType: rgb('#A98FBF'), // softened violet
  syntaxVariable: rgb('#C9D1D9'), // near-text
  syntaxOperator: rgb('#93A1B0'), // blue grey
  syntaxPunctuation: rgb('#7A8694'), // dim blue grey
  syntaxConstant: rgb('#C98291'), // softened rose
  professionalBlue: rgb('#7DA1DE'),
  chromeYellow: rgb('#D8B270'),
  // Pre-theme values, now overridable: the mist family's bar ramp (shared with
  // `light`) and the ignition pair — bright blue over the terminal's own dark
  // substrate.
  ...MIST_BAR_RAMP,
  ignition: rgb('#82B9FF'),
  ignitionDim: rgb('#1B1E28'),
  // Every built-in leaves the caret empty on purpose: empty keeps the
  // inverse-video block the palette always had, and a theme opts into a
  // coloured block by naming a fill.
  cursor: '',
  mascotBody: rgb('#D98A63'), // Warm mascot orange
  inputBackground: rgb('#000000'),
  userMessageBackground: '', // user turn: no fill, gold bold text only (Kimi style)
  userMessageBackgroundHover: rgb('#3B5BDB'), // hover/expand: blue block with gold text
  messageActionsBackground: rgb('#2E333D'),
  selectionBg: rgb('#3B4A66'), // Mist-blue tint on dark
  bashMessageBackgroundColor: rgb('#2C3038'),
  memoryBackgroundColor: rgb('#30353D'),
  rate_limit_fill: rgb('#7DA1DE'),
  rate_limit_empty: rgb('#3C414B'),
  fastMode: rgb('#E09A58'),
  fastModeShimmer: rgb('#EAB478'),
  userPromptLabel: rgb('#FFDF80'),
  subagentBullet: rgb('#D194AE'),
  subagentDescription: rgb('#E8E6E0'),
  subagentModel: rgb('#8D95A6'),
  subagentElapsed: rgb('#8D95A6'),
  subagentToolName: rgb('#7DA1DE'),
  subagentStatusRunning: rgb('#7DA1DE'),
  subagentStatusCompleted: rgb('#82B89D'),
  subagentStatusFailed: rgb('#DA8A93'),
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
