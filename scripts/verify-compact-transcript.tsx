/** OpenCode-style transcript: compact tool rows, block bodies, tail window. */
import assert from 'node:assert/strict'
import React from 'react'
import { renderToScreen } from '../src/ink/render-to-screen.js'
import { cellAt } from '../src/ink/screen.js'
import { TerminalSizeContext } from '../src/ink/components/TerminalSizeContext.js'
import { ToolEntryView } from '../src/modules/transcript/ui/ToolEntryView.js'
import { MessageList } from '../src/modules/transcript/ui/MessageList.js'
import { toolEntryOf, subagentEntryOf } from '../src/modules/transcript/model/tool-entry.js'
import type { ChatRow, ToolRow } from '../src/shared/protocol/transcript.js'
import type { SubagentRow } from '../src/shared/protocol/subagents.js'

function screenLines(element: React.ReactElement, width = 80): string[] {
  const screen = renderToScreen(
    <TerminalSizeContext.Provider value={{ columns: width, rows: 40 }}>{element}</TerminalSizeContext.Provider>,
    width,
  )
  return Array.from({ length: screen.height }, (_, row) =>
    Array.from({ length: width }, (_, column) => cellAt(screen.screen, column, row)?.char ?? '').join('').trimEnd(),
  )
}

function entryText(tool: ToolRow, expanded = false, width = 80): string {
  const entry = toolEntryOf(tool, { expanded })
  return screenLines(
    <ToolEntryView entry={entry} expanded={expanded} marginTop={false} onToggle={() => {}} />,
    width,
  ).join('\n')
}

function bash(status: ToolRow['status'], output = 'line one\nline two\nline three'): ToolRow {
  return {
    callId: `bash-${status}`,
    name: 'bash',
    argsText: '{"command":"echo hi"}',
    status,
    startedAt: 1000,
    durationMs: 1200,
    callView: { card: 'terminal', title: 'echo hi' },
    ...(status === 'running' ? {} : { resultView: { card: 'terminal', output }, resultText: output }),
  }
}

function readTool(): ToolRow {
  return {
    callId: 'read-1',
    name: 'read_file',
    argsText: '{"path":"docs/guide.md","offset":0,"limit":20}',
    status: 'ok',
    startedAt: 1000,
    durationMs: 20,
  }
}

// Read is a single activity line; its file body stays out of the transcript.
{
  const text = entryText(readTool())
  assert(text.includes('Read docs/guide.md'), text)
  assert(!text.includes('line one'), 'read must not dump a body')
  assert.equal(text.split('\n').filter(Boolean).length, 1, `read must stay one line:\n${text}`)
}

// Narrow terminals keep the activity line and block body readable.
{
  const narrowRead = entryText(readTool(), false, 40)
  assert(narrowRead.includes('Read'), narrowRead)
  const narrowBash = entryText(bash('ok'), false, 40)
  assert(narrowBash.includes('$ echo hi'), narrowBash)
  assert(narrowBash.includes('line one'), narrowBash)
}

// Shell is a block: command plus its output tail.
{
  const text = entryText(bash('ok'))
  assert(text.includes('$ echo hi'), text)
  assert(text.includes('line one') && text.includes('line three'), text)
}

// Running shell keeps the command but no fake result body.
{
  const text = entryText(bash('running'))
  assert(text.includes('$ echo hi'), text)
  assert(!text.includes('line one'), text)
}

// Failures show the first error line without a click; expansion reveals all.
{
  const tool = bash('error')
  tool.errorText = 'boom\nstack line'
  const collapsed = entryText(tool)
  assert(collapsed.includes('boom'), collapsed)
  assert(!collapsed.includes('stack line'), collapsed)
  const expanded = entryText(tool, true)
  assert(expanded.includes('boom') && expanded.includes('stack line'), expanded)
}

// Generic tools stay one line until expanded.
{
  const tool: ToolRow = {
    callId: 'generic-1',
    name: 'legacy_tool',
    argsText: '{"query":"ok"}',
    status: 'ok',
    startedAt: 1000,
    durationMs: 5,
    resultText: 'legacy result line',
  }
  const collapsed = entryText(tool)
  assert(collapsed.includes('Legacy_tool'), collapsed)
  assert(!collapsed.includes('legacy result line'), collapsed)
  const expanded = entryText(tool, true)
  assert(expanded.includes('legacy result line'), expanded)
}

// Write/edit use a left-bordered body with code/diff tones.
{
  const tool: ToolRow = {
    callId: 'edit-1',
    name: 'edit',
    argsText: '{"path":"src/a.ts"}',
    status: 'ok',
    startedAt: 1000,
    durationMs: 10,
    resultView: {
      card: 'diff',
      title: 'src/a.ts',
      diffs: [{ path: 'src/a.ts', oldText: 'old', newText: 'new' }],
    },
  }
  const text = entryText(tool)
  assert(text.includes('Edit src/a.ts'), text)
  assert(text.includes('- old') && text.includes('+ new'), text)
}

// Subagent rows are one activity line, not a card.
{
  const subagent: SubagentRow = {
    agentId: 'a1', description: 'Inspect tests', provider: 'p', model: 'm', status: 'running',
    startedAt: Date.now() - 1500, outputLines: ['working'], toolCalls: [], tokens: { total: 12 },
  }
  const subText = screenLines(
    <ToolEntryView entry={subagentEntryOf(subagent)} expanded={false} marginTop={false} onToggle={() => {}} />,
  ).join('\n')
  assert(subText.includes('Subagent: Inspect tests'), subText)
}

// Replayed reasoning (no duration) stays out of the default flow; Ctrl+O
// brings the historical Thought rows back.
{
  const rows: ChatRow[] = [
    { id: 1, kind: 'user', text: 'history' },
    { id: 2, kind: 'reasoning', text: 'old thought without a timer' },
    { id: 3, kind: 'assistant', text: 'old answer' },
    { id: 4, kind: 'reasoning', text: 'live thought', streaming: true },
  ]
  const collapsed = screenLines(
    <MessageList rows={rows} expanded={false} expandedRows={new Set()} selectedId={null} onToggleRow={() => {}} model="deepseek" thinkingVisible />,
  ).join('\n')
  assert(!collapsed.includes('old thought'), collapsed)
  assert(collapsed.includes('live thought') || collapsed.includes('Thinking'), collapsed)
  const opened = screenLines(
    <MessageList rows={rows} expanded expandedRows={new Set()} selectedId={null} onToggleRow={() => {}} model="deepseek" thinkingVisible />,
  ).join('\n')
  assert(opened.includes('Thought') && opened.includes('Thinking'), opened)
}

// MessageList integration: tools and text share the same left activity rail.
{
  const rows: ChatRow[] = [
    { id: 1, kind: 'user', text: 'Please inspect' },
    { id: 2, kind: 'assistant', text: 'Sure.' },
    { id: 3, kind: 'tool', text: '', tool: readTool() },
  ]
  const text = screenLines(
    <MessageList
      rows={rows}
      expanded={false}
      expandedRows={new Set()}
      selectedId={null}
      onToggleRow={() => {}}
      model="deepseek-chat"
      thinkingVisible
    />,
  ).join('\n')
  assert(text.includes('Please inspect'), text)
  assert(text.includes('Sure.'), text)
  assert(text.includes('Read docs/guide.md'), text)
  assert(!text.includes('line one'), 'tool body must stay folded in the list')
}
console.log('PASS: compact transcript renders OpenCode-style tool rows')
