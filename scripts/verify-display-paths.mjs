#!/usr/bin/env node
/** Home abbreviations affect display strings, never filesystem targets. */
import './lib/fake-home.mjs'
import assert from 'node:assert/strict'
import { abbreviateHomePath } from '../lib/types/shared/platform/paths.js'

assert.equal(abbreviateHomePath('/home/alice', '/home/alice'), '~')
assert.equal(abbreviateHomePath('/home/alice/rep/project', '/home/alice'), '~/rep/project')
assert.equal(abbreviateHomePath('/home/alice-other/project', '/home/alice'), '/home/alice-other/project')
assert.equal(abbreviateHomePath('/srv/project', '/home/alice'), '/srv/project')
assert.equal(abbreviateHomePath('ssh://server/home/alice/project', '/home/alice'), 'ssh://server/home/alice/project')
assert.equal(abbreviateHomePath('/home/alice/project', ''), '/home/alice/project')
assert.equal(abbreviateHomePath('C:\\Users\\alice\\rep\\project', 'C:\\Users\\alice'), '~/rep/project')
assert.equal(abbreviateHomePath('C:\\Users\\alice-other\\project', 'C:\\Users\\alice'), 'C:\\Users\\alice-other\\project')

console.log('Display paths: home abbreviation, prefix boundaries and remote URI preservation pass')
