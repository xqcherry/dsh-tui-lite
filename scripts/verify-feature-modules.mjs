/** Guard the feature-first source layout and public module boundaries. */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'

for (const name of ['composer', 'transcript', 'sessions', 'settings', 'decisions', 'activity', 'workbench']) {
  for (const entry of ['contracts.ts', 'index.ts']) {
    assert.ok(existsSync(`src/modules/${name}/${entry}`), `${name} must expose ${entry}`)
  }
}
for (const legacy of ['src/app', 'src/tui']) assert.ok(!existsSync(legacy), `Remove migrated implementation: ${legacy}`)
for (const name of ['composer', 'transcript', 'sessions', 'settings', 'activity', 'workbench']) {
  assert.ok(existsSync(`src/modules/${name}/model/module.ts`), `${name} must own its state`)
}
for (const name of ['client', 'client-state', 'mutable-state', 'initial-state', 'ui-policy', 'services', 'ports']) {
  assert.ok(!existsSync(`src/dsh-adapter/runtime/${name}.ts`), `Remove aggregated runtime: ${name}`)
}
console.log('Feature modules own state behind public entries without a legacy aggregate runtime')
