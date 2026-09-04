import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findMcpJson } from '../src/discover.js'

test('findMcpJson 命中存在文件、未命中返回 undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    writeFileSync(join(dir, '.mcp.json'), '{}')
    assert.equal(findMcpJson(dir), join(dir, '.mcp.json'))
    assert.equal(findMcpJson(join(dir, 'nope')), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
