import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { MAX_UPLOAD_BYTES } from '../src/contract.js'
import type { Disposable, MountedHandle, MountedServer } from '../src/mount.js'
import { createMountsRuntime, planGlobalRefresh } from '../src/mounts.js'
import { agentToken } from '../src/server-name.js'

/** 假 fiber 记录：映射后的配置与是否已释放。 */
interface FakeFiber {
  config: { serverName?: string; cwd?: string }
  disposed: boolean
}

/**
 * 构造 ctx 桩。
 *
 * ctx.plugin 返回非 thenable 的假 fiber（allSettled 视作已启动），
 * ctx.tools.schemas 返回空工具表，ctx.agents.list 由用例控制。
 *
 * @param agents - ctx.agents.list() 返回的 agent 列表
 * @returns ctx 桩与假 fiber 记录
 */
function fakeCtx(agents: Array<{ status: string }> = []) {
  const fibers: FakeFiber[] = []
  const ctx = {
    agents: { list: () => agents },
    tools: { schemas: () => [] },
    plugin: (_plugin: unknown, config: FakeFiber['config']) => {
      const fiber: FakeFiber = { config, disposed: false }
      fibers.push(fiber)
      return { dispose: () => { fiber.disposed = true; return Promise.resolve() } }
    },
  }
  return { ctx: ctx as unknown as Context, fibers }
}

/**
 * 构造 agent 桩。
 *
 * @param ctx - agent 作用域上下文（手动挂载的宿主）
 * @param id - 会话 id
 * @param cwd - 会话工作区目录
 * @returns agent 桩
 */
function fakeAgent(ctx: Context, id = 's1', cwd: string | undefined = '/proj'): Agent {
  return {
    id,
    ctx,
    status: 'idle',
    session: { header: { cwd }, surface: { nodes: [] }, append: () => {} },
  } as unknown as Agent
}

/**
 * 便捷构造一个 MountedHandle 桩。
 *
 * @param over - 覆盖的明细字段
 * @param fiber - 自定义句柄（用于观察 dispose）
 * @returns 挂载句柄桩
 */
function handle(over: Partial<MountedServer> = {}, fiber?: Disposable): MountedHandle {
  const mounted: MountedServer = {
    serverName: 'memory',
    rawName: 'memory',
    transport: 'stdio',
    file: '/proj/.mcp.json',
    tools: [],
    ...over,
  }
  return { mounted, fiber: fiber ?? { dispose: () => {} }, configKey: `key:${mounted.serverName}` }
}

test('planGlobalRefresh 分出保留/新增/变更/删除四类', () => {
  const plan = planGlobalRefresh(
    new Map([['keep', 'k'], ['change', 'old'], ['gone', 'g']]),
    new Map([['keep', 'k'], ['change', 'new'], ['fresh', 'f']]),
  )
  assert.deepEqual(plan, { keep: ['keep'], mount: ['fresh'], remount: ['change'], dispose: ['gone'] })
})

test('planGlobalRefresh 新配置为空时全部卸载', () => {
  assert.deepEqual(planGlobalRefresh(new Map([['a', '1']]), new Map()), {
    keep: [],
    mount: [],
    remount: [],
    dispose: ['a'],
  })
})

test('runtime 未跟踪会话只返回全局分组', () => {
  const { ctx } = fakeCtx()
  const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => undefined })
  runtime.seedGlobal([handle({ serverName: 'g', rawName: 'g', file: '/home/me/.dsh/.mcp.json' })])

  const data = runtime.read(null)
  assert.equal(data.global.servers[0]?.name, 'g')
  assert.deepEqual(data.workspace.servers, [])
  assert.deepEqual(data.manual.servers, [])
  assert.equal(runtime.globalGroup().servers[0]?.name, 'g')
  assert.equal(runtime.globalServers()[0]?.serverName, 'g')
})

test('runtime track 后 read 给出该会话三组载荷，forget 后清空', () => {
  const { ctx } = fakeCtx()
  const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => undefined })
  runtime.track(fakeAgent(ctx), '/proj/.mcp.json', [handle()])

  const data = runtime.read('s1')
  assert.equal(data.workspace.file, '/proj/.mcp.json')
  assert.equal(data.workspace.servers[0]?.name, 'memory')
  assert.deepEqual(data.manual.servers, [])
  assert.deepEqual(runtime.read('other').workspace.servers, [])

  runtime.forget('s1')
  assert.deepEqual(runtime.read('s1').workspace.servers, [])
})

test('runtime 存在运行中会话时 409 且不动 fiber', async () => {
  const { ctx, fibers } = fakeCtx([{ status: 'running' }])
  const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => undefined })
  runtime.track(fakeAgent(ctx), undefined, [])
  assert.equal(runtime.isBusy(), true)

  assert.deepEqual(await runtime.refresh('s1'), { ok: false, code: 409, message: '有会话正在运行，请稍后再刷新' })
  const added = await runtime.addUpload('s1', 'extra.json', '{"mcpServers":{"extra":{"command":"uvx"}}}')
  assert.deepEqual(added, { ok: false, code: 409, message: '有会话正在运行，请稍后再添加' })
  assert.equal(fibers.length, 0)
})

test('runtime refresh 对缺失/未跟踪会话返回 400', async () => {
  const { ctx } = fakeCtx()
  const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => undefined })
  for (const sessionId of [null, '', 'nope']) {
    const result = await runtime.refresh(sessionId)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 400)
  }
})

test('runtime addUpload 校验失败一律 400 且不挂载', async () => {
  const { ctx, fibers } = fakeCtx()
  const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => undefined })
  runtime.track(fakeAgent(ctx), undefined, [])

  const valid = '{"mcpServers":{"extra":{"command":"uvx"}}}'
  const cases: Array<[unknown, unknown]> = [
    ['', valid],
    ['a.json', 42],
    ['a.json', 'x'.repeat(MAX_UPLOAD_BYTES + 1)],
    ['a.json', '{bad json'],
    ['a.json', '{"mcpServers":{}}'],
    ['a.json', '{}'],
  ]
  for (const [name, content] of cases) {
    const result = await runtime.addUpload('s1', name, content)
    assert.equal(result.ok, false, `name=${String(name)} content=${String(content).slice(0, 12)}`)
    if (!result.ok) assert.equal(result.code, 400)
  }
  for (const sessionId of [null, '', 'nope']) {
    const result = await runtime.addUpload(sessionId, 'a.json', valid)
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 400)
  }
  assert.equal(fibers.length, 0)
})

test('runtime refresh 全局增量：保留未变、重挂变更、卸载删除', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    const { ctx, fibers } = fakeCtx()
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => file })
    runtime.track(fakeAgent(ctx), undefined, [])

    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.deepEqual(fibers.map(f => f.config.serverName), ['a'])

    // 新增 b 且 a 的命令变更：只释放变更项的旧 fiber，再挂 b 与新 a。
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'y' }, b: { command: 'z' } } }))
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers[0]?.disposed, true)
    assert.deepEqual(fibers.filter(f => !f.disposed).map(f => f.config.serverName).sort(), ['a', 'b'])

    // 配置未变：不新增也不释放任何 fiber。
    const count = fibers.length
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers.length, count)

    // 删除 b：只释放 b，a 保留。
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'y' } } }))
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers.length, count)
    assert.deepEqual(fibers.filter(f => !f.disposed).map(f => f.config.serverName), ['a'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runtime refresh 全局文件缺失或解析失败时保留现存挂载', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    let path: string | undefined = file
    const { ctx, fibers } = fakeCtx()
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => path })
    runtime.track(fakeAgent(ctx), undefined, [])
    assert.equal((await runtime.refresh('s1')).ok, true)

    path = undefined
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers.length, 1)
    assert.equal(fibers.filter(f => !f.disposed).length, 1)

    path = file
    writeFileSync(file, '{bad json')
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers.length, 1)
    assert.equal(fibers.filter(f => !f.disposed).length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runtime refresh 只重挂本会话的工作区与手动句柄', async () => {
  const { ctx, fibers } = fakeCtx()
  const disposed: string[] = []
  const runtime = createMountsRuntime({
    ctx,
    resolveGlobalFile: () => undefined,
    mount: async (_ctx, file) => [
      handle({ serverName: 'work', rawName: 'work', file }, { dispose: () => { disposed.push('workspace:new') } }),
    ],
  })
  const agent = fakeAgent(ctx)
  runtime.track(agent, '/proj/.mcp.json', [
    handle({ serverName: 'work', rawName: 'work' }, { dispose: () => { disposed.push('workspace:old') } }),
  ])

  const added = await runtime.addUpload('s1', 'extra.json', '{"mcpServers":{"extra":{"command":"uvx"}}}')
  assert.equal(added.ok, true)
  if (added.ok) {
    assert.equal(added.data.manual.file, 'extra.json')
    assert.equal(added.data.manual.servers[0]?.name, 'extra')
  }
  const manual = fibers[0]
  assert.equal(manual?.config.serverName, `extra_${agentToken('s1')}u`)
  assert.equal(manual?.config.cwd, '/proj')

  const refreshed = await runtime.refresh('s1')
  assert.equal(refreshed.ok, true)
  if (refreshed.ok) {
    assert.equal(refreshed.data.workspace.servers[0]?.name, 'work')
    assert.equal(refreshed.data.manual.servers[0]?.name, 'extra')
  }
  assert.deepEqual(disposed, ['workspace:old'])
  assert.equal(manual?.disposed, true)
  assert.equal(fibers.filter(f => f.config.serverName === manual?.config.serverName).length, 2)
})
