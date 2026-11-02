import type { LocalCommand } from '../../../shared/commands.js'
import { localizedDescription } from '../../../shared/commands.js'
import { t } from '../../../shared/i18n.js'
import { primaryComboString } from '../../../shared/platform/keymap.js'
import type { ChatMenuItem } from './chat-commands.js'

/** Help supplies content/actions to the same menu host as other commands. */
export function createHelpMenu({ readCommands, openMenu, fillCommand }: {
  readCommands(): readonly LocalCommand[]
  openMenu(title: string, items: readonly ChatMenuItem[]): void
  fillCommand(name: string): void
}): () => void {
  const back = (): ChatMenuItem => ({ label: 'Back', run: openHelp })
  const openCommands = (): void => {
    openMenu('/help · Commands', [
      back(),
      ...readCommands().filter(command => !command.skill).map(command => ({
        label: `/${command.name} — ${localizedDescription(command)}`,
        run: () => fillCommand(command.name),
      })),
    ])
  }
  const openShortcuts = (): void => {
    const shortcuts = [
      t('help-for-commands'),
      t('help-this-help'),
      t('help-verbose-output', { key: primaryComboString('transcript') }),
      t('help-search-history', { key: primaryComboString('history') }),
      t('help-open-editor', { key: primaryComboString('editor') }),
      `${primaryComboString('paste')} paste`,
      `${primaryComboString('undo')} undo draft edit`,
      t('help-interrupt'),
      t('help-exit'),
      t('help-clear-input'),
      t('help-history-nav'),
      t('help-move-cursor'),
      'ctrl+←/→ word jump',
      'shift+enter newline',
      'shift+tab permission mode',
      'tab queue while working',
    ]
    openMenu('/help · Keyboard shortcuts', [back(), ...shortcuts.map(label => ({ label }))])
  }
  function openHelp(): void {
    openMenu('/help', [
      { label: 'Commands', run: openCommands },
      { label: 'Keyboard shortcuts', run: openShortcuts },
    ])
  }
  return openHelp
}
