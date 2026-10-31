import { marked, type Token, type Tokens } from 'marked'
import React from 'react'
import type { TextDecoration } from '../ink/styles.js'
import { Box, Text, useTheme } from './primitives.js'
import { getCliHighlightPromise, type CliHighlight } from './text/cliHighlight.js'
import { appendBlockText, configureMarked, formatToken, stripPromptXMLTags } from './text/markdown.js'
import { getTheme } from './theme.js'
import { CodeBlockFrame } from './CodeBlockFrame.js'
import { MarkdownTable } from './MarkdownTable.js'

/** Markdown text, syntax-highlighted code fences and width-aware tables. */

type Props = {
  children: string
  /** 为 true 时全部文本内容以 dim 样式呈现 */
  dimColor?: boolean
  /** 为 false 时跳过 token 缓存（流式尾部的内容逐帧变化，缓存必然失效） */
  cacheTokens?: boolean

}

/**
 * Hang decoration for the ANSI text runs: a terminal-wrapped continuation
 * lines up under its line's quote rails, list marker or indentation
 * instead of falling back to column 0. One shared object, because the
 * style diff and the measure/paint caches compare it by reference.
 */
const HANG_DECORATION: TextDecoration = { hang: true }

// ---- token 缓存 ----
//
// marked.lexer 在组件重挂载时是最贵的开销；消息内容不可变，相同文本
// 必然产出相同 token，因此以原文为 key 缓存。
//
// 容量控制不能只看条数：Token 的 raw/text 字段是输入字符串的切片，
// 会钉住整段输入常驻内存；流式渲染时输入逐帧增长，若只按条数限流，
// LRU 会保留大量接近最终形态的快照（1MB 消息 ≈ 500 条 × 1MB ≈
// 500MB）。这里用字符预算限制保留量，超长内容干脆不缓存（重挂载时
// 重跑 lexer，极少发生且远比常驻便宜）。
const TOKEN_CACHE_CAPACITY = 200
const TOKEN_CACHE_CHAR_BUDGET = 200_000
const TOKEN_CACHE_MAX_SOURCE_LENGTH = 20_000
const TEXT_BLOCK_BUDGET = 8192
const tokenCache = new Map<string, Token[]>()
let tokenCacheChars = 0

// Only skip the lexer when the full source has no Markdown markers.
const MD_SYNTAX_MARKERS = /[#*`|[>\-_~$\\]|\n\n|^\d+\. |\n\d+\. /

function looksLikePlainText(s: string): boolean {
  return !MD_SYNTAX_MARKERS.test(s)
}

function lexWithCache(content: string, allowCache: boolean): Token[] {
  // 快速路径：纯文本直接合成单个段落 token，不触碰 lexer。
  if (looksLikePlainText(content)) {
    return [
      {
        type: 'paragraph',
        raw: content,
        text: content,
        tokens: [{ type: 'text', raw: content, text: content }],
      },
    ]
  }
  if (!allowCache) return marked.lexer(content)

  // 直接用内容字符串做 key：V8 在字符串头缓存哈希，首次插入后 Map
  // 查找无需再算哈希，也比 sha256 少一次摘要分配与碰撞风险。
  const hit = tokenCache.get(content)
  if (hit) {
    tokenCache.delete(content) // 提升为最近使用
    tokenCache.set(content, hit)
    return hit
  }

  const tokens = marked.lexer(content)
  if (content.length > TOKEN_CACHE_MAX_SOURCE_LENGTH) return tokens

  // Evict oldest entries (Map preserves insertion order) until both the
  // count and char budgets fit. The previous full clear() nuked the whole
  // cache every time a long session crossed 200 blocks — every subsequent
  // row remount then re-ran the lexer (scroll-through-a-long-session
  // stutter); evicting only what the newcomer displaces keeps the working
  // set warm.
  while (
    tokenCache.size >= TOKEN_CACHE_CAPACITY ||
    tokenCacheChars + content.length > TOKEN_CACHE_CHAR_BUDGET
  ) {
    const oldest = tokenCache.keys().next().value
    if (oldest === undefined) break
    tokenCache.delete(oldest)
    tokenCacheChars -= oldest.length
  }
  tokenCache.set(content, tokens)
  tokenCacheChars += content.length
  return tokens
}

/**
 * Tokens that render as their own layout node (a width-aware component)
 * instead of joining the ANSI text run. StreamingMarkdown consults the same
 * predicate: a standalone node has a fixed one-row gap to its neighbours
 * rather than the newline-derived spacing of text blocks. Top-level
 * fenced code is one too (CodeBlockFrame).
 */
export function isStandaloneToken(token: Token): boolean {
  return token.type === 'table' || token.type === 'code'
}

/**
 * Tables and fences render independently; other blocks share ANSI text runs.
 */
function renderTokensToNodes(
  tokens: Token[],
  highlight: CliHighlight | null,
  dimColor: boolean,
): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let ansiText = ''
  let textParts: string[] = []

  const flushAnsiText = (): void => {
    if (!ansiText && textParts.length === 0) return
    if (textParts.length === 0) {
      nodes.push(<Text key={nodes.length} dimColor={dimColor} decoration={HANG_DECORATION}>{ansiText.trim()}</Text>)
    } else {
      textParts.push(ansiText)
      let first = 0
      let last = textParts.length - 1
      while (first < last && textParts[first]!.trimStart() === '') first++
      while (last > first && textParts[last]!.trimEnd() === '') last--
      textParts[first] = textParts[first]!.trimStart()
      textParts[last] = textParts[last]!.trimEnd()
      // Each internal boundary replaces exactly one source newline with a
      // column-child boundary. Only the whole text span trims outer space.
      nodes.push(
        <Box key={nodes.length} flexDirection="column">
          {textParts.slice(first, last + 1).map((part, index) => (
            <Text key={index} dimColor={dimColor} decoration={HANG_DECORATION}>{index + first < last ? part.slice(0, -1) : part}</Text>
          ))}
        </Box>,
      )
    }
    ansiText = ''
    textParts = []
  }

  for (const token of tokens) {
    if (token.type === 'table') {
      flushAnsiText()
      nodes.push(
        <MarkdownTable
          key={nodes.length}
          token={token as Tokens.Table}
          highlight={highlight}
        />,
      )
    } else if (token.type === 'code') {
      // Top-level fences get a frame; nested fences use the ANSI formatter.
      flushAnsiText()
      nodes.push(
        <CodeBlockFrame key={nodes.length} token={token as Tokens.Code} highlight={highlight} dimColor={dimColor} />,
      )
    } else {
      // appendBlockText inserts the row break after the (newline-free) hr
      // divider when the next block does not open its own line.
      ansiText = appendBlockText(ansiText, formatToken(token, 0, null, null, highlight))
      // A top-level token boundary keeps inline formatting and code fences
      // intact while letting the painter cull finished offscreen text blocks.
      if (ansiText.length >= TEXT_BLOCK_BUDGET && ansiText.endsWith('\n')) {
        textParts.push(ansiText)
        ansiText = ''
      }
    }
  }

  flushAnsiText()
  return nodes
}

/**
 * 混合渲染 Markdown 内容：表格用带边框的 flexbox 组件，其余内容由
 * formatToken 生成 ANSI 字符串放入 Text。高亮对象异步就绪后自动刷新。
 *
 * memo by content: finished transcript blocks render with the SAME string
 * identity for the whole session (StreamingMarkdown keeps its stable prefix
 * identity-stable precisely to hit this); without the memo every parent
 * re-render re-ran the full token→ANSI→yoga pipeline for every settled
 * block — the dominant long-output stall (string-width via wrap-ansi, 60%+
 * of CPU in streaming profiles).
 */
function MarkdownImpl({ children, dimColor = false, cacheTokens = true }: Props): React.ReactNode {
  const [highlight, setHighlight] = React.useState<CliHighlight | null>(null)
  // 渲染结果把主题色烤进 ANSI（链接 accent、行内代码 permission、列表点…）。
  // 消费主题上下文让这个 memo 组件在换主题时也重渲染（context 更新绕过
  // React.memo）；memo 依赖取**调色板身份**而非名字——`auto` 明暗翻转时名字
  // 不变但色板换了，只按名字会漏。
  const [themeName] = useTheme()
  const palette = getTheme(themeName)

  React.useEffect(() => {
    let mounted = true
    void getCliHighlightPromise().then((loaded) => {
      if (mounted) setHighlight(loaded)
    })
    return () => {
      mounted = false
    }
  }, [])

  configureMarked()

  const renderedNodes = React.useMemo(() => {
    const source = stripPromptXMLTags(children)
    return renderTokensToNodes(
      lexWithCache(source, cacheTokens),
      highlight,
      dimColor,
    )
  }, [children, dimColor, highlight, cacheTokens, palette])

  return (
    <Box flexDirection="column" gap={1}>
      {renderedNodes}
    </Box>
  )
}

/**
 * Memoized Markdown: skips the whole token→ANSI→layout pipeline when the
 * content string is the same reference (see MarkdownImpl's doc comment).
 */
export const Markdown = React.memo(
  MarkdownImpl,
  (prev, next) =>
    prev.children === next.children &&
    prev.dimColor === next.dimColor &&
    prev.cacheTokens === next.cacheTokens,
)
