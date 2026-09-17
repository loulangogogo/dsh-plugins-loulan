import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMountRegistry } from '../src/registry.js'
import type { McpMountedData } from '../src/contract.js'

/** 一份最小载荷。 */
const data: McpMountedData = {
  global: { servers: [] },
  workspace: { file: '/x/.mcp.json', servers: [{ name: 'memory', transport: 'stdio', tools: ['a'] }] },
}

test('registry set/get/clear', () => {
  const registry = createMountRegistry()
  assert.equal(registry.get('s1'), undefined)
  registry.set('s1', data)
  assert.deepEqual(registry.get('s1'), data)
  registry.clear('s1')
  assert.equal(registry.get('s1'), undefined)
})

test('registry 不同会话互不影响', () => {
  const registry = createMountRegistry()
  registry.set('s1', data)
  assert.equal(registry.get('s2'), undefined)
})
