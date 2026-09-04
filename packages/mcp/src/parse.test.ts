import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isRecord, asStringArray, asStringRecord, readMcpServers } from './parse.js'

test('isRecord 仅接受普通对象', () => {
  assert.equal(isRecord({}), true)
  assert.equal(isRecord(null), false)
  assert.equal(isRecord([]), false)
})

test('asStringArray 过滤非字符串元素', () => {
  assert.deepEqual(asStringArray(['a', 1, null, 'b']), ['a', 'b'])
  assert.deepEqual(asStringArray('x'), [])
})

test('asStringRecord 仅保留字符串值', () => {
  assert.deepEqual(asStringRecord({ a: '1', b: 2, c: true }), { a: '1' })
  assert.deepEqual(asStringRecord(null), {})
})

test('readMcpServers 正常解析 mcpServers', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    assert.deepEqual(await readMcpServers(file), { a: { command: 'x' } })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readMcpServers 缺失 mcpServers 返回空对象', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({}))
    assert.deepEqual(await readMcpServers(file), {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('readMcpServers 畸形 JSON 抛错', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, '{bad json')
    await assert.rejects(() => readMcpServers(file))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
