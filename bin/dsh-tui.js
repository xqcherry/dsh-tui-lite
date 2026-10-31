#!/usr/bin/env node
import { launch } from '../lib/types/dsh-adapter/launcher.js'

try {
  process.exitCode = await launch()
} catch (error) {
  process.stderr.write(`dsh-tui: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
