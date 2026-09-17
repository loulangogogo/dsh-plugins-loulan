import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMountPayload, toMountGroup } from '../src/mount.js'
import type { MountedServer } from '../src/mount.js'

/** 便捷构造一个 MountedServer 桩。 */
const srv = (over: Partial<MountedServer> = {}): MountedServer => ({
  serverName: 'memory',
  rawName: 'memory',
  transport: 'stdio',
  file: '/proj/.mcp.json',
  tools: ['a', 'b'],
  ...over,
})

test('toMountGroup 空数组时无 file', () => {
  assert.deepEqual(toMountGroup([]), { servers: [] })
})

test('toMountGroup 取首个条目的 file 作为来源，并映射为展示条目', () => {
  assert.deepEqual(toMountGroup([srv()]), {
    file: '/proj/.mcp.json',
    servers: [{ name: 'memory', transport: 'stdio', tools: ['a', 'b'] }],
  })
})

test('toMountGroup 展示原始服务名而非挂载名', () => {
  const group = toMountGroup([srv({ serverName: 'memory_3f9c2a81b7d4', rawName: 'memory' })])
  assert.equal(group.servers[0]?.name, 'memory')
})

test('buildMountPayload 分全局、工作区与手动添加三组', () => {
  const data = buildMountPayload(
    [srv({ serverName: 'g', rawName: 'g', file: '/home/me/.dsh/.mcp.json' })],
    [srv()],
    [srv({ serverName: 'extra_abc', rawName: 'extra', transport: 'streamable-http', file: 'extra.json' })],
  )
  assert.equal(data.global.file, '/home/me/.dsh/.mcp.json')
  assert.equal(data.global.servers[0]?.name, 'g')
  assert.equal(data.workspace.file, '/proj/.mcp.json')
  assert.equal(data.workspace.servers[0]?.name, 'memory')
  assert.equal(data.manual.file, 'extra.json')
  assert.equal(data.manual.servers[0]?.name, 'extra')
})

test('buildMountPayload 三组皆空时返回空组', () => {
  assert.deepEqual(buildMountPayload([], [], []), {
    global: { servers: [] },
    workspace: { servers: [] },
    manual: { servers: [] },
  })
})
