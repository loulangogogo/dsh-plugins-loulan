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

test('announceMountNotice 追加 log-only 命令事件而非模型消息', () => {
  const appends: Array<[string, unknown]> = []
  const agent = {
    session: {
      append: (type: string, data: unknown) => { appends.push([type, data]) },
    },
  } as unknown as Parameters<typeof announceMountNotice>[0]
  announceMountNotice(agent, '本工作区已自动挂载以下 MCP 服务:')

  // 成对追加 command/run + command/done,共两条 log-only 事件。
  assert.equal(appends.length, 2)
  assert.equal(appends[0]?.[0], 'command/run')
  assert.equal(appends[1]?.[0], 'command/done')

  const run = appends[0]?.[1] as { commandId?: string; name?: string; source?: unknown }
  const done = appends[1]?.[1] as { commandId?: string; kind?: string; text?: string }
  assert.equal(run.name, 'mcp')
  assert.deepEqual(run.source, { kind: 'user' })
  // run/done 用同一 commandId 配对,commandId 非空。
  assert.ok(run.commandId !== undefined && run.commandId.length > 0)
  assert.equal(run.commandId, done.commandId)
  assert.equal(done.kind, 'success')
  assert.equal(done.text, '本工作区已自动挂载以下 MCP 服务:')
  // 不调用任何 agent 消息通道(followup/steer/inject 都会进模型)。
  assert.equal('followup' in agent, false)
  assert.equal('inject' in agent, false)
})
