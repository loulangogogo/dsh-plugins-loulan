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
 * ctx.plugin 返回假 fiber（非 thenable 时 allSettled 视作已启动；fail 集合内的名字返回
 * rejected thenable 以模拟启动失败），ctx.tools.schemas 返回空工具表，ctx.agents.list 由用例控制。
 *
 * ctx 桩**始终**模拟 cordis 的 ReflectService 守卫：本插件未在 inject 中声明 `agents`，
 * 因此任何对 `ctx.agents` 的访问都会抛错——空闲保护必须走注入的 `listAgents`。
 *
 * @param options - events 记录挂载/释放顺序；fail 模拟启动失败；failDispose 模拟释放抛错
 * @returns ctx 桩与假 fiber 记录
 */
function fakeCtx(
  options: { events?: string[]; fail?: ReadonlySet<string>; failDispose?: ReadonlySet<string> } = {},
) {
  const fibers: FakeFiber[] = []
  const ctx = {
    tools: { schemas: () => [] },
    plugin: (_plugin: unknown, config: FakeFiber['config']) => {
      const name = String(config.serverName)
      const fiber: FakeFiber = { config, disposed: false }
      fibers.push(fiber)
      options.events?.push(`mount:${name}`)
      const handle = {
        dispose: () => {
          options.events?.push(`dispose:${name}`)
          if (options.failDispose?.has(name)) throw new Error('释放失败')
          fiber.disposed = true
          return Promise.resolve()
        },
      }
      if (options.fail?.has(name)) {
        return {
          ...handle,
          then: (_resolve: unknown, reject: (reason: unknown) => void) => reject(new Error('启动失败')),
        }
      }
      return handle
    },
  }
  // 模拟 cordis：访问未声明 inject 的服务属性直接抛错。
  Object.defineProperty(ctx, 'agents', {
    get() { throw new Error('cannot get property "agents" without inject') },
  })
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
 * @param failed - 是否标记为启动失败
 * @returns 挂载句柄桩
 */
function handle(over: Partial<MountedServer> = {}, fiber?: Disposable, failed = false): MountedHandle {
  const mounted: MountedServer = {
    serverName: 'memory',
    rawName: 'memory',
    transport: 'stdio',
    file: '/proj/.mcp.json',
    tools: [],
    ...over,
  }
  return { mounted, fiber: fiber ?? { dispose: () => {} }, configKey: `key:${mounted.serverName}`, failed }
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
  const agents = [{ status: 'running' }]
  const { ctx, fibers } = fakeCtx()
  const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => undefined, listAgents: () => agents })
  runtime.track(fakeAgent(ctx), undefined, [])
  assert.equal(runtime.isBusy(), true)

  assert.deepEqual(await runtime.refresh('s1'), { ok: false, code: 409, message: '有会话正在运行，请稍后再刷新' })
  const added = await runtime.addUpload('s1', 'extra.json', '{"mcpServers":{"extra":{"command":"uvx"}}}')
  assert.deepEqual(added, { ok: false, code: 409, message: '有会话正在运行，请稍后再添加' })
  // 忙 + 非法内容：仍判 409，不退化为 400。
  assert.deepEqual(await runtime.addUpload('s1', '', '{bad'), {
    ok: false,
    code: 409,
    message: '有会话正在运行，请稍后再添加',
  })
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

test('runtime refresh 全局文件缺失时卸载全部全局服务，重新出现时挂回', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    let path: string | undefined = file
    const { ctx, fibers } = fakeCtx()
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => path })
    runtime.track(fakeAgent(ctx), undefined, [])
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers.length, 1)

    // 文件消失视为配置清空：释放全部全局句柄，视图载荷同步清空。
    path = undefined
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers[0]?.disposed, true)
    assert.deepEqual(runtime.globalGroup().servers, [])
    assert.deepEqual(runtime.read('s1').global.servers, [])

    // 文件重新出现：按新内容挂回（含新增的 b）。
    path = file
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' }, b: { command: 'y' } } }))
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.deepEqual(
      fibers.filter(f => !f.disposed).map(f => f.config.serverName).sort(),
      ['a', 'b'],
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runtime refresh 全局文件解析失败时保留现存挂载', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    const { ctx, fibers } = fakeCtx()
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => file })
    runtime.track(fakeAgent(ctx), undefined, [])
    assert.equal((await runtime.refresh('s1')).ok, true)

    // 半截文件（编辑中）不得清空全局挂载。
    writeFileSync(file, '{bad json')
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers.length, 1)
    assert.equal(fibers.filter(f => !f.disposed).length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('syncGlobal 不依赖会话即可挂载全局服务（GET 拉取路径）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    const { ctx, fibers } = fakeCtx()
    // 刻意不 track 任何会话：标签页拉取清单时可能尚未登记该会话。
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => file })

    await runtime.syncGlobal()
    assert.deepEqual(fibers.map(f => f.config.serverName), ['a'])
    assert.equal(runtime.read(null).global.servers[0]?.name, 'a')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('syncGlobal 全局配置未变时不重挂', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    const { ctx, fibers } = fakeCtx()
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => file })

    await runtime.syncGlobal()
    const count = fibers.length
    await runtime.syncGlobal()
    assert.equal(fibers.length, count)
    assert.equal(fibers[0]?.disposed, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('syncGlobal 并发调用只挂载/释放一次', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    const events: string[] = []
    const { ctx, fibers } = fakeCtx({ events })
    let path: string | undefined = file
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => path })

    // 并发首次同步：只挂载一次。
    await Promise.all([runtime.syncGlobal(), runtime.syncGlobal()])
    assert.deepEqual(events, ['mount:a'])

    // 文件消失后并发同步：同一批句柄只释放一次。
    events.length = 0
    path = undefined
    await Promise.all([runtime.syncGlobal(), runtime.syncGlobal()])
    assert.deepEqual(events, ['dispose:a'])
    assert.equal(fibers.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('syncGlobal 忙时不动 fiber（含文件缺失时不卸载）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    const agents: Array<{ status: string }> = []
    const { ctx, fibers } = fakeCtx()
    let disposed = false
    let path: string | undefined = undefined
    const runtime = createMountsRuntime({
      ctx,
      resolveGlobalFile: () => path,
      listAgents: () => agents,
    })
    runtime.seedGlobal([handle({ serverName: 'g', rawName: 'g' }, { dispose: () => { disposed = true } })])

    agents.push({ status: 'running' })
    // 文件已出现且有新内容：忙时不得挂载。
    path = file
    await runtime.syncGlobal()
    assert.equal(fibers.length, 0)
    // 文件缺失：忙时也不得卸载既有全局挂载。
    path = undefined
    await runtime.syncGlobal()
    assert.equal(disposed, false)
    assert.equal(runtime.read(null).global.servers[0]?.name, 'g')
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

test('启动失败的全局服务仍登记句柄：配置未变时不重复挂载且不出现在分组里', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { bad: { command: 'x' } } }))
    const { ctx, fibers } = fakeCtx({ fail: new Set(['bad']) })
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => file })
    runtime.track(fakeAgent(ctx), undefined, [])

    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers.length, 1)
    assert.deepEqual(runtime.globalGroup().servers, [])

    // 配置未变：失败句柄仍在挂载表中，不得重复挂载同名 fiber。
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('释放失败的全局服务本轮不再重挂并记录日志', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  const logged: string[] = []
  const originalError = console.error
  const originalWarn = console.warn
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  console.warn = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    const { ctx, fibers } = fakeCtx({ failDispose: new Set(['a']) })
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => file })
    runtime.track(fakeAgent(ctx), undefined, [])
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers.length, 1)

    // 配置变更触发 remount：旧 fiber 释放失败，本轮不得以同名重新挂载。
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'y' } } }))
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(fibers.length, 1)
    assert.ok(logged.some(line => line.includes('释放 MCP server "a" 失败')))
    assert.ok(logged.some(line => line.includes('释放失败，本轮跳过重挂')))
  } finally {
    console.error = originalError
    console.warn = originalWarn
    rmSync(dir, { recursive: true, force: true })
  }
})

test('同一名字的 dispose 发生在 mount 之前', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    const events: string[] = []
    const { ctx } = fakeCtx({ events })
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => file })
    runtime.track(fakeAgent(ctx), undefined, [])
    assert.equal((await runtime.refresh('s1')).ok, true)

    // 配置变更触发 remount：事件顺序必须是先释放旧 fiber，再挂新 fiber。
    events.length = 0
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'y' } } }))
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.deepEqual(events, ['dispose:a', 'mount:a'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('运行时不读取 ctx.agents（cordis 对未 inject 的服务访问会抛错）', () => {
  const { ctx } = fakeCtx()
  const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => undefined, listAgents: () => [] })
  // 空闲保护改由注入的 listAgents 提供，绝不能触碰 ctx.agents（fakeCtx 的 getter 会抛错）。
  assert.equal(runtime.isBusy(), false)
})

test('unload 拒绝全局共享与未知目标，且不释放任何 fiber', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    const { ctx, fibers } = fakeCtx()
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => undefined })
    runtime.track(fakeAgent(ctx), file, [])
    await runtime.refresh('s1')
    assert.equal(fibers.length, 1)

    // 全局共享是硬拒绝：即使直接调端点也卸不掉。
    assert.deepEqual(await runtime.unload('s1', 'global'), {
      ok: false,
      code: 400,
      message: '全局共享服务不可卸载',
    })
    assert.equal((await runtime.unload('s1', 'nope')).code, 400)
    assert.equal(fibers[0]?.disposed, false)
    assert.equal(runtime.read('s1').workspace.servers.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unload 工作区是临时停用：刷新会重新读取并挂回', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    const file = join(dir, '.mcp.json')
    writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'x' } } }))
    const events: string[] = []
    const { ctx } = fakeCtx({ events })
    const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => undefined })
    runtime.track(fakeAgent(ctx), file, [])
    await runtime.refresh('s1')
    assert.equal(runtime.read('s1').workspace.servers.length, 1)

    // 工作区挂载名带 agent 唯一后缀，事件里也是这个名字。
    const mountedName = `a_${agentToken('s1')}`
    assert.equal((await runtime.unload('s1', 'workspace')).ok, true)
    assert.deepEqual(runtime.read('s1').workspace.servers, [])
    assert.ok(events.includes(`dispose:${mountedName}`))

    // 临时停用：来源仍在，刷新重新读取该文件并挂回。
    events.length = 0
    assert.equal((await runtime.refresh('s1')).ok, true)
    assert.equal(runtime.read('s1').workspace.servers.length, 1)
    assert.ok(events.includes(`mount:${mountedName}`))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('unload 手动添加会连上传内容一起清掉，刷新不再带回', async () => {
  const { ctx, fibers } = fakeCtx()
  const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => undefined })
  runtime.track(fakeAgent(ctx, 's1', '/proj'), undefined, [])
  const added = await runtime.addUpload('s1', 'extra.json', '{"mcpServers":{"u":{"command":"x"}}}')
  assert.equal(added.ok, true)
  assert.equal(runtime.read('s1').manual.servers.length, 1)
  assert.equal(fibers.length, 1)

  assert.equal((await runtime.unload('s1', 'manual')).ok, true)
  assert.deepEqual(runtime.read('s1').manual.servers, [])
  assert.equal(fibers[0]?.disposed, true)

  // 上传内容已丢弃，刷新不会把手动服务带回来。
  assert.equal((await runtime.refresh('s1')).ok, true)
  assert.deepEqual(runtime.read('s1').manual.servers, [])
  assert.equal(fibers.length, 1)
})

test('unload 对未跟踪会话 400、对运行中会话 409 且不释放', async () => {
  const untracked = createMountsRuntime({ ctx: fakeCtx().ctx, resolveGlobalFile: () => undefined })
  assert.deepEqual(await untracked.unload('nope', 'workspace'), {
    ok: false,
    code: 400,
    message: '会话未加载 MCP 服务，无法卸载',
  })

  const agents = [{ status: 'running' }]
  const { ctx, fibers } = fakeCtx()
  const busy = createMountsRuntime({ ctx, resolveGlobalFile: () => undefined, listAgents: () => agents })
  busy.track(fakeAgent(ctx), undefined, [])
  assert.deepEqual(await busy.unload('s1', 'workspace'), {
    ok: false,
    code: 409,
    message: '有会话正在运行，请稍后再卸载',
  })
  assert.equal(fibers.length, 0)
})
