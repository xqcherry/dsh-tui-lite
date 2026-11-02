/** Compact transcript regression: settled shell/job cards, grouped runs. */
import assert from 'node:assert/strict'
import React from 'react'
import { renderToScreen } from '../src/ink/render-to-screen.js'
import { cellAt } from '../src/ink/screen.js'
import { TerminalSizeContext } from '../src/ink/components/TerminalSizeContext.js'
import { AssistantToolUseMessage } from '../src/modules/transcript/ui/AssistantToolUseMessage.js'
import { ToolGroupHeader } from '../src/modules/transcript/ui/ToolGroupHeader.js'
import { MessageList } from '../src/modules/transcript/ui/MessageList.js'
import { JobCard } from '../src/modules/activity/ui/JobCard.js'
import { groupToolRuns } from '../src/modules/transcript/model/tool-groups.js'
import type { ChatRow, ToolRow } from '../src/shared/protocol/transcript.js'

function screenLines(element: React.ReactElement, width = 80): string[] {
  const screen = renderToScreen(
    <TerminalSizeContext.Provider value={{ columns: width, rows: 40 }}>{element}</TerminalSizeContext.Provider>,
    width,
  )
  return Array.from({ length: screen.height }, (_, row) =>
    Array.from({ length: width }, (_, column) => cellAt(screen.screen, column, row)?.char ?? '').join('').trimEnd(),
  )
}

function bashTool(status: ToolRow['status'], output = 'line one\nline two\nline three\nline four'): ToolRow {
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

// A settled shell card is one header row; the body stays behind expand.
{
  const lines = screenLines(
    <AssistantToolUseMessage tool={bashTool('ok')} marginTopOnTurn={false} verbose={false} isExpanded={false} />,
  )
  const text = lines.join('\n')
  assert(text.includes('Bash') && text.includes('echo hi'), text)
  assert(!text.includes('line one'), `settled output must stay hidden:\n${text}`)
  assert(text.includes('+4 lines'), `hidden-volume chip is the only body hint:\n${text}`)
  assert.equal(lines.length, 1, `settled shell card must be one line:\n${text}`)
}

// Click / Ctrl+O restores the full body.
{
  const text = screenLines(
    <AssistantToolUseMessage tool={bashTool('ok')} marginTopOnTurn={false} verbose isExpanded />,
  ).join('\n')
  assert(text.includes('line one') && text.includes('line four'), text)
}

// Failures never collapse: the error stays visible without a click.
{
  const tool = bashTool('error')
  tool.errorText = 'boom\nstack'
  const text = screenLines(
    <AssistantToolUseMessage tool={tool} marginTopOnTurn={false} verbose={false} isExpanded={false} />,
  ).join('\n')
  assert(text.includes('boom') && text.includes('stack'), text)
}

// A settled job card drops command and output; expanding restores both.
function job(status: 'completed' | 'running'): React.ReactElement {
  return (
    <JobCard
      job={{
        id: 'j1',
        kind: 'bash',
        label: 'sleep 1; echo hi',
        status,
        startedAt: 0,
        ...(status === 'running' ? {} : { finishedAt: 2000 }),
        outputLines: [{ text: 'job output tail' }],
      }}
      marginTopOnTurn={false}
      expanded={false}
    />
  )
}
{
  const settledText = screenLines(job('completed')).join('\n')
  assert(settledText.includes('job: j1'), settledText)
  assert(!settledText.includes('sleep 1') && !settledText.includes('job output tail'), settledText)
  const expandedText = screenLines(
    <JobCard
      job={{
        id: 'j1', kind: 'bash', label: 'sleep 1; echo hi', status: 'completed',
        startedAt: 0, finishedAt: 2000, outputLines: [{ text: 'job output tail' }],
      }}
      marginTopOnTurn={false}
      expanded
    />,
  ).join('\n')
  assert(expandedText.includes('sleep 1') && expandedText.includes('job output tail'), expandedText)
  const runningText = screenLines(job('running')).join('\n')
  assert(runningText.includes('job output tail'), runningText)
  assert(!runningText.includes('sleep 1'), `live job keeps only its output tail:\n${runningText}`)
}

// Grouping: settled runs of ≥3 fold, live/short/mixed runs do not.
function row(id: number, name: string, status: ToolRow['status'] = 'ok'): ChatRow {
  return {
    id,
    kind: 'tool',
    text: '',
    tool: { callId: `c${id}`, name, argsText: '{}', status, startedAt: id, durationMs: 10 },
  }
}

{
  const rows = [row(1, 'bash'), row(2, 'bash', 'error'), row(3, 'bash'), row(4, 'read'), row(5, 'bash'), row(6, 'bash')]
  const grouped = groupToolRuns(rows, false, new Set())
  const head = grouped.rows[0]!
  assert.equal(head.toolGroup?.head, true)
  assert.equal(head.toolGroup?.count, 3)
  assert.equal(head.toolGroup?.folded, true)
  assert.equal(head.toolGroup?.failed, 1, 'failure count stays visible in the summary')
  assert.deepEqual([...grouped.folded], [2, 3], 'folded members are removed before virtualization')
  assert.equal(grouped.rows[4]!.toolGroup, undefined, 'a pair stays card by card')

  const expanded = groupToolRuns(rows, false, new Set([1]))
  assert.equal(expanded.rows[0]!.toolGroup?.folded, false)
  assert.equal(expanded.folded.size, 0, 'clicking the summary reopens the run')

  const live = groupToolRuns([row(7, 'bash'), row(8, 'bash', 'running'), row(9, 'bash')], false, new Set())
  assert.equal(live.rows[0]!.toolGroup, undefined, 'live runs keep their cards')
  assert.equal(live.folded.size, 0)

  const mixed = groupToolRuns([row(10, 'bash'), row(11, 'job_output'), row(12, 'bash')], false, new Set())
  assert.equal(mixed.rows[0]!.toolGroup, undefined, 'different tools never share a run')
}

// Summary line: name, count, red failure count and the expand hint.
{
  const text = screenLines(
    <ToolGroupHeader
      group={{ head: true, last: true, count: 3, folded: true, failed: 1, name: 'bash', startedAt: 0, endedAt: 2000 }}
      onToggle={() => {}}
    />,
  ).join('\n')
  assert(text.includes('Bash ×3'), text)
  assert(text.includes('1 failed'), text)
  assert(text.includes('click to expand'), text)
}

// MessageList integration: the grouping pass removes settled members before
// virtualization and leaves exactly one summary row.
{
  const rows = [row(20, 'bash'), row(21, 'bash'), row(22, 'bash'), row(23, 'bash')]
  const text = screenLines(
    <MessageList
      rows={rows}
      expanded={false}
      expandedRows={new Set()}
      selectedId={null}
      onToggleRow={() => {}}
      model="m"
      showAll
      onToggleAll={() => {}}
      thinkingVisible={false}
    />,
  ).join('\n')
  assert(text.includes('Bash ×4'), text)
  assert(!text.includes('Bash({})') && !text.includes('Bash({'), `folded members must not paint:\n${text}`)
}

// Narrow TTY: the compact card and summary must stay inside 40 columns.
{
  const card = screenLines(
    <AssistantToolUseMessage tool={bashTool('ok', 'only one')} marginTopOnTurn={false} verbose={false} isExpanded={false} />,
    40,
  )
  assert(card.join('\n').includes('+1 line'), card.join('\n'))
  assert(card.every(line => line.length <= 40), card.join('\n'))
  const summary = screenLines(
    <ToolGroupHeader
      group={{ head: true, last: true, count: 3, folded: true, failed: 1, name: 'bash', startedAt: 0, endedAt: 2000 }}
      onToggle={() => {}}
    />,
    40,
  )
  assert(summary.every(line => line.length <= 40), summary.join('\n'))
}

console.log('Compact transcript passed: settled cards collapse, failures stay visible, tool runs fold')
