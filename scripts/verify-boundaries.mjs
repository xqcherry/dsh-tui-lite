/** Enforce feature entries, platform leaves and official package isolation. */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve('src')
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [])
}
const moduleOf = path => path.match(/^modules\/([^/]+)\//)?.[1]
const edges = new Map()
const failures = []
for (const file of files(root)) {
  const path = relative(root, file).replaceAll('\\', '/')
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  function visit(node) {
    let specifier
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifier = node.moduleSpecifier
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0]
    if (specifier && ts.isStringLiteral(specifier)) {
      const name = specifier.text
      const reject = reason => failures.push(`${path}: ${reason}: ${name}`)
      if (name.startsWith('@deepseek-ai/') && !path.startsWith('dsh-adapter/')) reject('official imports belong to dsh-adapter')
      if (path.includes('/model/') && (name === 'react' || name.startsWith('react/'))) reject('feature models must not depend on React')
      if (name.startsWith('.')) {
        const target = relative(root, resolve(dirname(file), name)).replaceAll('\\', '/')
        const from = moduleOf(path)
        const to = moduleOf(target)
        if (!path.startsWith('dsh-adapter/') && !['index.ts', 'oauth.ts'].includes(path) && target.startsWith('dsh-adapter/')) reject('adapter internals are private')
        if (path.startsWith('shared/') && /^(modules|ui|terminal|ink|native-ts)\//.test(target)) reject('shared infrastructure is a leaf')
        if (path.startsWith('ui/') && /^(modules|dsh-adapter)\//.test(target)) reject('shared UI must not depend on features')
        if (path.startsWith('terminal/') && /^(modules|ui|dsh-adapter)\//.test(target)) reject('terminal must not depend on business UI')
        if (path.includes('/model/') && /^(ui|terminal|ink|native-ts)\//.test(target)) reject('feature model depends on rendering')
        if (path.includes('/model/') && from === to && target.includes('/ui/')) reject('feature model depends on its UI')
        if (to && from !== to && !/\/(index|contracts)\.js$/.test(target)) reject('cross-module access must use public entries')
        if (from && to && from !== to) {
          const dependencies = edges.get(from) ?? new Set()
          dependencies.add(to)
          edges.set(from, dependencies)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
function checkCycles(module, chain = []) {
  assert.ok(!chain.includes(module), `Feature dependency cycle: ${[...chain, module].join(' → ')}`)
  for (const next of edges.get(module) ?? []) checkCycles(next, [...chain, module])
}
assert.equal(failures.length, 0, failures.join('\n'))
for (const module of edges.keys()) checkCycles(module)
console.log('Feature boundaries passed: public entries, acyclic modules, pure models and isolated dsh imports')
