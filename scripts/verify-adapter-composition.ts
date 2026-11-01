/** Structural guards for module command ownership and narrow adapter ports. */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import ts from 'typescript'

const sourceRoot = resolve('src')
const roots = new Set(['dsh-adapter/channel/core/compose.ts', 'dsh-adapter/channel/composition.ts'])
const runtimeConsumers = new Set([...roots, 'dsh-adapter/channel.ts', 'dsh-adapter/workbench-bindings.ts'])
const removedCommands = new Set(['RuntimeCommands', 'ChannelActionDelegates', 'createChannelActionReadiness', 'createChannelActionMethods', 'installChannelActions', 'channelCommands', 'bindChannelCommands'])
const modules = ['activity', 'composer', 'sessions', 'settings', 'transcript', 'workbench']

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? sources(join(directory, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(directory, entry.name)] : [])
}
function property(node: ts.Node): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteral(node.argumentExpression)) return node.argumentExpression.text
  return undefined
}
function receiver(node: ts.Node): ts.Expression | undefined {
  return ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ? node.expression : undefined
}
function hasCommandReceiver(node: ts.Node): boolean {
  return property(node) === 'commands' || (receiver(node) !== undefined && hasCommandReceiver(receiver(node)!))
}
function violations(path: string, text: string): string[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const errors: string[] = []
  const reject = (node: ts.Node, reason: string): void => {
    errors.push(`${path}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${reason}`)
  }
  function visit(node: ts.Node): void {
    if (ts.isIdentifier(node) && removedCommands.has(node.text)) reject(node, `removed aggregate command API ${node.text}`)
    if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === 'ActivityRuntime' && path.startsWith('dsh-adapter/channel/') && !roots.has(path)) reject(node, 'activity specialists must consume only their semantic target')
    let specifier: ts.Node | undefined
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) specifier = node.moduleSpecifier
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) specifier = node.argument.literal
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) specifier = node.arguments[0]
    if (specifier && ts.isStringLiteral(specifier)) {
      const target = specifier.text
      if (target.endsWith('/module-runtime.js') && !runtimeConsumers.has(path)) reject(node, 'specialists must receive narrow reads and semantic actions')
      if (target.endsWith('/core/compose.js') && !roots.has(path) && path !== 'dsh-adapter/channel.ts') reject(node, 'core composition is private to wiring roots')
    }
    if (ts.isCallExpression(node)) {
      const method = property(node.expression)
      const owner = receiver(node.expression)
      if ((method === 'patch' || method === 'update') && owner && property(owner) === 'ingress') reject(node, 'generic ingress writes cross module ownership')
      if (method === 'assign' && owner && ts.isIdentifier(owner) && owner.text === 'Object' && node.arguments[0] && hasCommandReceiver(node.arguments[0])) reject(node, 'commands must be constructed by their module')
    }
    if (ts.isBinaryExpression(node) && ts.isAssignmentOperator(node.operatorToken.kind) && hasCommandReceiver(node.left)) reject(node, 'commands cannot be replaced outside their owner')
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'ingress' && ts.isObjectLiteralExpression(node.initializer)) {
      for (const member of node.initializer.properties) {
        if (member.name && ['patch', 'update'].includes(member.name.getText(source))) reject(member, 'module ingress must expose semantic operations')
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return errors
}

// Invalid examples exercise the AST visitors; whitespace, strings and comments do not determine policy.
assert(violations('dsh-adapter/channel/example.ts', "import type { ModuleOwners } from '../module-runtime.js'").some(error => error.includes('narrow reads')))
assert(violations('dsh-adapter/channel/example.ts', "import type { ActivityRuntime as Host } from '../../modules/activity/index.js'").some(error => error.includes('semantic target')))
for (const source of [
  "export type { ModuleOwners } from '../module-runtime.js'",
  "type Host = import('../module-runtime.js').ModuleOwners",
  "const runtime = await import('../module-runtime.js')",
]) assert(violations('dsh-adapter/channel/example.ts', source).some(error => error.includes('narrow reads')))
for (const source of [
  "export type { CoreChannel } from './core/compose.js'",
  "type Host = import('./core/compose.js').CoreChannel",
  "const core = await import('./core/compose.js')",
]) assert(violations('dsh-adapter/channel/example.ts', source).some(error => error.includes('private to wiring')))
assert(violations('modules/composer/model/example.ts', "target ['ingress'] ['patch'] ({ pending: [] })").some(error => error.includes('generic ingress')))
assert(violations('dsh-adapter/channel/example.ts', 'activity.commands.jobControl = next').some(error => error.includes('replaced')))
assert(violations('modules/composer/model/example.ts', 'return { ingress: { update: owned.update } }').some(error => error.includes('semantic operations')))
assert.deepEqual(violations('dsh-adapter/channel/example.ts', '// RuntimeCommands\nconst note = "channel.ingress.patch({})"'), [])

const failures = sources(sourceRoot).flatMap(file => violations(relative(sourceRoot, file).replaceAll('\\', '/'), readFileSync(file, 'utf8')))
assert.deepEqual(failures, [], failures.join('\n'))
for (const module of modules) {
  const path = `modules/${module}/model/module.ts`
  const source = ts.createSourceFile(path, readFileSync(join(sourceRoot, path), 'utf8'), ts.ScriptTarget.Latest, true)
  let constructsLifetime = false
  let constructsCommands = false
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'createCommandLifetime') constructsLifetime = true
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'commands' && node.initializer && ts.isCallExpression(node.initializer)
      && property(node.initializer.expression) === 'freeze' && node.initializer.arguments[0] && ts.isObjectLiteralExpression(node.initializer.arguments[0])) constructsCommands = true
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert(constructsLifetime, `${path}: module must own connection, activation and disposal`)
  assert(constructsCommands, `${path}: module must construct explicit immutable commands`)
}
console.log('Adapter composition passed: owned commands, semantic ingress and narrow specialist ports')
