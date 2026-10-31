/** Enforce real import boundaries, including type imports and dynamic imports. */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import ts from 'typescript'
const root = resolve('src')
for (const dir of ['app', 'tui', 'dsh-adapter']) assert.ok(existsSync(join(root, dir)), `Missing architecture module: ${dir}`)
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [])
}
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
      if (name.startsWith('@deepseek-ai/')) assert.ok(path.startsWith('dsh-adapter/'), `${path}: official import ${name}`)
      if (name.startsWith('.')) {
        const target = relative(root, resolve(dirname(file), name)).replaceAll('\\', '/')
        if (!path.startsWith('dsh-adapter/') && !['index.ts', 'oauth.ts'].includes(path)) assert.ok(!target.startsWith('dsh-adapter/'), `${path}: depends on adapter implementation ${name}`)
        if (path.startsWith('app/')) assert.ok(!/^(tui|ink|native-ts)\//.test(target), `${path}: depends on terminal UI ${name}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
console.log('Architecture boundaries passed: dsh-adapter → app ← tui')
