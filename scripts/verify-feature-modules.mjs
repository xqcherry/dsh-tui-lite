/** Guard the feature-first source layout and public module boundaries. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

for (const name of ['composer', 'transcript', 'sessions', 'settings', 'decisions', 'activity', 'workbench']) {
  for (const entry of ['contracts.ts', 'index.ts']) {
    assert.ok(existsSync(`src/modules/${name}/${entry}`), `${name} must expose ${entry}`)
  }
}
for (const legacy of ['src/app', 'src/tui']) assert.ok(!existsSync(legacy), `Remove migrated implementation: ${legacy}`)
console.log('Feature modules expose explicit contracts and entries without legacy implementation trees')
