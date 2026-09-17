import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMountSource, normalizeMounts, toolsText } from '../src/client/mcp-source.js'

/** 合法载荷桩。 */
const raw = {
  global: { servers: [] },
  workspace: { file: '/proj/.mcp.json', servers: [{ name: 'memory', transport: 'stdio', tools: ['a'] }] },
}

test('toolsText 有工具用顿号，无工具返回 null', () => {
  assert.equal(toolsText(['a', 'b']), 'a、b')
  assert.equal(toolsText([]), null)
})

test('normalizeMounts 接受合法载荷', () => {
  assert.deepEqual(normalizeMounts(raw), raw)
})

test('normalizeMounts 拒绝畸形载荷', () => {
  assert.equal(normalizeMounts(null), null)
  assert.equal(normalizeMounts({}), null)
  assert.equal(normalizeMounts({ global: { servers: [] }, workspace: { servers: [{ name: 1 }] } }), null)
})

test('数据源初次订阅拉取并发布', async () => {
  const source = createMountSource('s1', async () => raw)
  assert.equal(source.getSnapshot(), null)
  const seen: unknown[] = []
  const unsubscribe = source.subscribe(() => { seen.push(source.getSnapshot()) })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(source.getSnapshot(), raw)
  assert.equal(seen.length, 1)
  unsubscribe()
})

test('数据源拉取失败保持空态且不抛', async () => {
  const source = createMountSource('s1', async () => { throw new Error('boom') })
  source.subscribe(() => {})
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(source.getSnapshot(), null)
})
