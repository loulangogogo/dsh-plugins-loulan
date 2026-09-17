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
import type { MountedHandle, MountedServer } from '../src/mount.js'
import type { ActionResult, MountsRuntime } from '../src/mounts.js'

type Ctx = Parameters<typeof askForApproval>[0]
type Agt = Parameters<typeof askForApproval>[1]

/** 便捷构造一个 MountedServer 桩。 */
const srv = (over: Partial<MountedServer> = {}): MountedServer => ({
  serverName: 'memory',
  rawName: 'memory',
  transport: 'stdio',
  file: '/x/.mcp.json',
  tools: ['t1'],
  ...over,
})

/** 便捷构造一个 MountedHandle 桩。 */
const handle = (over: Partial<MountedServer> = {}): MountedHandle => ({
  mounted: srv(over),
  fiber: { dispose: () => {} },
  configKey: 'key',
})

/**
 * 构造 runtime 桩：只实现本文件用到的能力，其余返回空值。
 *
 * @param over - 需要覆盖的成员（如记录 track 调用）
 * @returns 运行时桩
 */
function fakeRuntime(over: Partial<MountsRuntime> = {}): MountsRuntime {
  const empty: ActionResult = { ok: false, code: 400, message: '桩' }
  return {
    seedGlobal: () => {},
    globalGroup: () => ({ servers: [] }),
    globalServers: () => [],
    track: () => {},
    forget: () => {},
    read: () => ({ global: { servers: [] }, workspace: { servers: [] }, manual: { servers: [] } }),
    isBusy: () => false,
    refresh: async () => empty,
    addUpload: async () => empty,
    ...over,
  }
}

/**
 * 构造 agent 桩：收集 session.append 事件。
 *
 * @param appends - 事件收集数组
 * @param nodes - surface.nodes（非空表示会话已有消息）
 * @returns agent 桩
 */
function fakeAgent(appends: unknown[], nodes: unknown[] = []) {
  return {
    id: 'a1',
    ctx: {},
    session: {
      surface: { nodes },
      append: (type: unknown, data: unknown) => { appends.push([type, data]) },
    },
  } as unknown as Parameters<typeof mountAndRecord>[0]
}

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

test('mountAndRecord 记录句柄并在会话空时输出通知卡片（含全局服务）', async () => {
  const appends: unknown[] = []
  const tracked: Array<{ file: string | undefined; handles: MountedHandle[] }> = []
  const runtime = fakeRuntime({
    track: (_agent, file, handles) => { tracked.push({ file, handles }) },
    globalServers: () => [srv({ serverName: 'g', rawName: 'g', file: '/home/me/.dsh/.mcp.json', tools: [] })],
  })
  const work = [handle()]
  await mountAndRecord(fakeAgent(appends), '/x/.mcp.json', runtime, async () => work)

  assert.equal(tracked.length, 1)
  assert.equal(tracked[0]?.file, '/x/.mcp.json')
  assert.deepEqual(tracked[0]?.handles, work)
  assert.equal(appends.length, 2)
  assert.equal((appends[0] as unknown[])[0], 'command/run')
  assert.equal((appends[1] as unknown[])[0], 'command/done')
  // 通知文案含全局服务，说明卡片读的是 runtime.globalServers()。
  const done = (appends[1] as unknown[])[1] as { text: string }
  assert.ok(done.text.includes('另共享全局服务'))
})

test('mountAndRecord 会话已有消息时仍记录但不输出卡片', async () => {
  const appends: unknown[] = []
  const tracked: Array<MountedHandle[]> = []
  const runtime = fakeRuntime({ track: (_agent, _file, handles) => { tracked.push(handles) } })
  await mountAndRecord(fakeAgent(appends, [1]), '/x/.mcp.json', runtime, async () => [handle()])

  assert.equal(tracked.length, 1)
  assert.equal(tracked[0]?.length, 1)
  assert.equal(appends.length, 0)
})

test('mountAndRecord 无工作区文件时记录空句柄且不挂载、不提示', async () => {
  const appends: unknown[] = []
  const tracked: Array<{ file: string | undefined; handles: MountedHandle[] }> = []
  const runtime = fakeRuntime({ track: (_agent, file, handles) => { tracked.push({ file, handles }) } })
  await mountAndRecord(fakeAgent(appends), undefined, runtime, async () => {
    throw new Error('不应调用挂载：无工作区文件')
  })

  assert.equal(tracked.length, 1)
  assert.equal(tracked[0]?.file, undefined)
  assert.equal(tracked[0]?.handles.length, 0)
  assert.equal(appends.length, 0)
})

test('mountAndRecord 挂载结果为空时不输出卡片', async () => {
  const appends: unknown[] = []
  const runtime = fakeRuntime()
  await mountAndRecord(fakeAgent(appends), '/x/.mcp.json', runtime, async () => [])
  assert.equal(appends.length, 0)
})
