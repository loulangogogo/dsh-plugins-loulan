import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMountControl, normalizeMounts, toolsText } from '../src/client/mcp-source.js'

/** 合法载荷桩（三组）。 */
const raw = {
  global: { servers: [] },
  workspace: { file: '/proj/.mcp.json', servers: [{ name: 'memory', transport: 'stdio', tools: ['a'] }] },
  manual: { file: 'extra.json', servers: [{ name: 'extra', transport: 'streamable-http', tools: [] }] },
}

/** 只带全局分组的载荷桩。 */
const globalOnly = { global: { servers: [{ name: 'g', transport: 'stdio', tools: [] }] }, workspace: { servers: [] }, manual: { servers: [] } }

/** 让本轮微任务跑完。 */
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

/**
 * 构造控制面依赖桩。
 *
 * @param over - 覆盖拉取/刷新/添加的实现
 * @returns io 桩与调用记录
 */
function fakeIo(over: {
  fetchMounts?: () => Promise<unknown>
  refresh?: () => Promise<unknown>
  add?: (sessionId: string, name: string, content: string) => Promise<unknown>
} = {}) {
  const calls = { add: [] as Array<[string, string, string]> }
  return {
    calls,
    io: {
      fetchMounts: over.fetchMounts ?? (async () => raw),
      refresh: over.refresh ?? (async () => raw),
      add: async (sessionId: string, name: string, content: string) => {
        calls.add.push([sessionId, name, content])
        return over.add === undefined ? raw : await over.add(sessionId, name, content)
      },
    },
  }
}

test('toolsText 用给定分隔符连接，无工具返回 null', () => {
  assert.equal(toolsText(['a', 'b'], '、'), 'a、b')
  assert.equal(toolsText(['a', 'b'], ', '), 'a, b')
  assert.equal(toolsText([], '、'), null)
})

test('normalizeMounts 接受合法载荷', () => {
  assert.deepEqual(normalizeMounts(raw), raw)
})

test('normalizeMounts 缺 manual 时按空组兼容', () => {
  const legacy = { global: { servers: [] }, workspace: { servers: [] } }
  assert.deepEqual(normalizeMounts(legacy), { global: { servers: [] }, workspace: { servers: [] }, manual: { servers: [] } })
})

test('normalizeMounts 拒绝畸形载荷', () => {
  assert.equal(normalizeMounts(null), null)
  assert.equal(normalizeMounts({}), null)
  assert.equal(normalizeMounts({ global: { servers: [] }, workspace: { servers: [{ name: 1 }] }, manual: { servers: [] } }), null)
  assert.equal(normalizeMounts({ global: { servers: [] }, workspace: { servers: [] }, manual: 'x' }), null)
})

test('数据源初次订阅拉取并发布', async () => {
  const control = createMountControl('s1', fakeIo().io)
  assert.equal(control.source.getSnapshot(), null)
  const seen: unknown[] = []
  const unsubscribe = control.source.subscribe(() => { seen.push(control.source.getSnapshot()) })
  await tick()
  assert.deepEqual(control.source.getSnapshot(), raw)
  assert.equal(seen.length, 1)
  unsubscribe()
})

test('数据源拉取失败保持空态且不抛', async () => {
  const control = createMountControl('s1', fakeIo({ fetchMounts: async () => { throw new Error('boom') } }).io)
  control.source.subscribe(() => {})
  await tick()
  assert.equal(control.source.getSnapshot(), null)
})

test('数据源拉取失败后可重试', async () => {
  let calls = 0
  const control = createMountControl('s1', fakeIo({
    fetchMounts: async () => {
      calls += 1
      if (calls === 1) throw new Error('boom')
      return raw
    },
  }).io)
  control.source.subscribe(() => {})
  await tick()
  assert.equal(control.source.getSnapshot(), null)
  control.source.subscribe(() => {})
  await tick()
  assert.equal(calls, 2)
  assert.deepEqual(control.source.getSnapshot(), raw)
})

test('数据源工作区与手动皆空但全局非空时可重拉', async () => {
  let calls = 0
  const control = createMountControl('s1', fakeIo({
    fetchMounts: async () => {
      calls += 1
      return calls === 1 ? globalOnly : raw
    },
  }).io)
  control.source.subscribe(() => {})
  await tick()
  assert.deepEqual(control.source.getSnapshot(), globalOnly)
  control.source.subscribe(() => {})
  await tick()
  assert.equal(calls, 2)
  assert.deepEqual(control.source.getSnapshot(), raw)
})

test('refresh 成功用响应更新快照并通知订阅者', async () => {
  const updated = { ...raw, manual: { file: 'extra.json', servers: [{ name: 'extra2', transport: 'stdio', tools: [] }] } }
  let payload: unknown = raw
  const { io } = fakeIo({ refresh: async () => payload })
  const control = createMountControl('s1', io)
  const seen: unknown[] = []
  control.source.subscribe(() => { seen.push(control.source.getSnapshot()) })
  await tick()
  assert.deepEqual(control.source.getSnapshot(), raw)

  payload = updated
  assert.deepEqual(await control.refresh(), { ok: true })
  assert.deepEqual(control.source.getSnapshot(), updated)
  assert.equal(seen.length, 2)
})

test('refresh 失败返回 message 且快照不变', async () => {
  const { io } = fakeIo({ refresh: async () => { throw new Error('有会话正在运行，请稍后再刷新') } })
  const control = createMountControl('s1', io)
  control.source.subscribe(() => {})
  await tick()
  assert.deepEqual(await control.refresh(), { ok: false, message: '有会话正在运行，请稍后再刷新' })
  assert.deepEqual(control.source.getSnapshot(), raw)
})

test('addUpload 成功传给端点并更新快照', async () => {
  const updated = { ...raw, manual: { file: 'extra.json', servers: [{ name: 'extra2', transport: 'stdio', tools: [] }] } }
  const { io, calls } = fakeIo({ add: async () => updated })
  const control = createMountControl('s1', io)
  assert.deepEqual(await control.addUpload({ name: 'extra.json', content: '{"mcpServers":{}}' }), { ok: true })
  assert.deepEqual(calls.add, [['s1', 'extra.json', '{"mcpServers":{}}']])
  assert.deepEqual(control.source.getSnapshot(), updated)
})

test('addUpload 失败返回 message 且快照不变', async () => {
  const { io } = fakeIo({ add: async () => { throw new Error('文件不是合法 JSON') } })
  const control = createMountControl('s1', io)
  control.source.subscribe(() => {})
  await tick()
  assert.deepEqual(await control.addUpload({ name: 'a.json', content: '{bad' }), { ok: false, message: '文件不是合法 JSON' })
  assert.deepEqual(control.source.getSnapshot(), raw)
})

test('动作响应畸形时视为失败且快照不变', async () => {
  const { io } = fakeIo({ refresh: async () => ({ nope: true }) })
  const control = createMountControl('s1', io)
  control.source.subscribe(() => {})
  await tick()
  assert.deepEqual(await control.refresh(), { ok: false })
  assert.deepEqual(control.source.getSnapshot(), raw)
})
