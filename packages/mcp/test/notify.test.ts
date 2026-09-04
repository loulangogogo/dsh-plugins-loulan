import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMountNotice, formatServer, announceMountNotice } from '../src/notify.js'
import type { MountedServer } from '../src/mount.js'

/** 便捷构造一个 MountedServer 桩。 */
const server = (over: Partial<MountedServer> = {}): MountedServer => ({
  serverName: 'memory',
  rawName: 'memory',
  transport: 'stdio',
  file: '/proj/.mcp.json',
  tools: ['a', 'b'],
  ...over,
})

test('buildMountNotice 无工作区服务返回 undefined', () => {
  assert.equal(buildMountNotice([], []), undefined)
})

test('buildMountNotice 仅工作区服务', () => {
  const text = buildMountNotice([], [server()])
  assert.ok(text?.includes('memory (stdio)'))
  assert.ok(text?.includes('a、b'))
  assert.ok(text?.includes('/proj/.mcp.json'))
  assert.ok(!text?.includes('全局'))
})

test('buildMountNotice 工作区+全局分两组', () => {
  const text = buildMountNotice(
    [server({ serverName: 'postgres', rawName: 'postgres', file: '/home/me/.dsh/.mcp.json' })],
    [server()],
  )
  assert.ok(text?.includes('另共享全局服务'))
  assert.ok(text?.includes('postgres'))
})

test('formatServer 展示原始服务名而非挂载名', () => {
  const s = server({ serverName: 'memory_3f9c2a81b7d4', rawName: 'memory' })
  assert.ok(formatServer(s).startsWith('- memory (stdio)'))
  assert.ok(!formatServer(s).includes('memory_3f9c2a81b7d4'))
})

test('formatServer 工具为空显示暂不可用', () => {
  assert.ok(formatServer(server({ tools: [] })).includes('工具列表暂不可用'))
})

test('announceMountNotice 调用 agent.followup', () => {
  let followed: unknown
  const agent = { followup: (m: unknown): void => { followed = m } }
  announceMountNotice(agent as Parameters<typeof announceMountNotice>[0], 'hi', '已挂载 1 个')
  assert.ok(followed !== undefined)
})
