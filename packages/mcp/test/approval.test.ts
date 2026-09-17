import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  decisionFor,
  setDecision,
  clearDecision,
  pendingOf,
  setPending,
  clearPending,
  askForApproval,
} from '../src/approval.js'
import { mountAndRecord } from '../src/approval.js'
import { createMountRegistry } from '../src/registry.js'
import type { MountedServer } from '../src/mount.js'

type Ctx = Parameters<typeof askForApproval>[0]
type Agt = Parameters<typeof askForApproval>[1]

test('decisionFor/setDecision/clearDecision 状态机', () => {
  setDecision('a1', 'pending')
  assert.equal(decisionFor('a1'), 'pending')
  setDecision('a1', 'approved')
  assert.equal(decisionFor('a1'), 'approved')
  clearDecision('a1')
  assert.equal(decisionFor('a1'), undefined)
})

test('pendingOf/setPending/clearPending 状态机', () => {
  setPending('a1', { file: '/x/.mcp.json' })
  assert.deepEqual(pendingOf('a1'), { file: '/x/.mcp.json' })
  clearPending('a1')
  assert.equal(pendingOf('a1'), undefined)
})

test('askForApproval 无审批服务 fail-closed 返回 rejected', async () => {
  const ctx = { get: () => undefined } as unknown as Ctx
  const agent = { id: 'a1' } as unknown as Agt
  const d = await askForApproval(ctx, agent, '/x/.mcp.json', { postgres: {} })
  assert.equal(d, 'rejected')
})

test('askForApproval allowed-once 返回 approved', async () => {
  const ctx = { get: () => ({ request: async () => 'allowed-once' }) } as unknown as Ctx
  const agent = { id: 'a1' } as unknown as Agt
  const d = await askForApproval(ctx, agent, '/x/.mcp.json', { postgres: {} })
  assert.equal(d, 'approved')
})

test('askForApproval rejected 返回 rejected', async () => {
  const ctx = { get: () => ({ request: async () => 'rejected' }) } as unknown as Ctx
  const d = await askForApproval(ctx, { id: 'a1' } as unknown as Agt, '/x/.mcp.json', { postgres: {} })
  assert.equal(d, 'rejected')
})

test('askForApproval request 抛错返回 rejected', async () => {
  const ctx = { get: () => ({ request: async () => { throw new Error('boom') } }) } as unknown as Ctx
  const d = await askForApproval(ctx, { id: 'a1' } as unknown as Agt, '/x/.mcp.json', { postgres: {} })
  assert.equal(d, 'rejected')
})

test('mountAndRecord 写注册表并在会话空时输出通知卡片', async () => {
  const appends: unknown[] = []
  const registry = createMountRegistry()
  const agent = {
    id: 'a1',
    ctx: {},
    session: {
      surface: { nodes: [] },
      append: (type: unknown, data: unknown) => { appends.push([type, data]) },
    },
  } as unknown as Parameters<typeof mountAndRecord>[0]
  const work: MountedServer[] = [{ serverName: 'memory', rawName: 'memory', transport: 'stdio', file: '/x/.mcp.json', tools: ['t1'] }]
  await mountAndRecord(agent, '/x/.mcp.json', [], registry, async () => work)
  assert.ok(registry.get('a1') !== undefined)
  assert.equal(appends.length, 2)
  assert.equal((appends[0] as unknown[])[0], 'command/run')
  assert.equal((appends[1] as unknown[])[0], 'command/done')
})

test('mountAndRecord 会话已有消息时仍写注册表但不输出卡片', async () => {
  const appends: unknown[] = []
  const registry = createMountRegistry()
  const agent = {
    id: 'a1',
    ctx: {},
    session: {
      surface: { nodes: [1] },
      append: (type: unknown, data: unknown) => { appends.push([type, data]) },
    },
  } as unknown as Parameters<typeof mountAndRecord>[0]
  await mountAndRecord(agent, '/x/.mcp.json', [], registry, async () => [
    { serverName: 'memory', rawName: 'memory', transport: 'stdio', file: '/x/.mcp.json', tools: ['t1'] },
  ])
  assert.ok(registry.get('a1') !== undefined)
  assert.equal(appends.length, 0)
})

test('mountAndRecord 无工作区文件但全局非空时写注册表', async () => {
  const registry = createMountRegistry()
  const agent = {
    id: 'a1',
    ctx: {},
    session: { surface: { nodes: [] }, append: () => {} },
  } as unknown as Parameters<typeof mountAndRecord>[0]
  const global: MountedServer[] = [
    { serverName: 'g', rawName: 'g', transport: 'stdio', file: '/home/me/.dsh/.mcp.json', tools: [] },
  ]
  await mountAndRecord(agent, undefined, global, registry, async () => {
    throw new Error('不应调用挂载：无工作区文件')
  })
  const recorded = registry.get('a1')
  assert.equal(recorded?.global.servers.length, 1)
  assert.equal(recorded?.workspace.servers.length, 0)
})

test('mountAndRecord 全局与工作区皆空时不写注册表', async () => {
  const registry = createMountRegistry()
  const agent = {
    id: 'a1',
    ctx: {},
    session: { surface: { nodes: [] }, append: () => {} },
  } as unknown as Parameters<typeof mountAndRecord>[0]
  await mountAndRecord(agent, undefined, [], registry, async () => [])
  assert.equal(registry.get('a1'), undefined)
})
