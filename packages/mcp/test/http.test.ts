import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ADD_ROUTE_PATH, MAX_UPLOAD_BYTES, MOUNTS_ROUTE_PATH, REFRESH_ROUTE_PATH } from '../src/contract.js'
import { createMountsHandler } from '../src/http.js'
import type { McpMountedData } from '../src/contract.js'
import type { ActionResult, MountsRuntime } from '../src/mounts.js'

/** 全局分组桩。 */
const globalGroup = { file: '/home/me/.dsh/.mcp.json', servers: [{ name: 'g', transport: 'stdio' as const, tools: [] }] }

/** 该会话的完整载荷桩（三组）。 */
const work: McpMountedData = {
  global: globalGroup,
  workspace: { file: '/proj/.mcp.json', servers: [{ name: 'memory', transport: 'stdio', tools: ['a'] }] },
  manual: { file: 'extra.json', servers: [{ name: 'extra', transport: 'streamable-http', tools: [] }] },
}

/** 未跟踪会话的载荷桩。 */
const globalOnly: McpMountedData = { global: globalGroup, workspace: { servers: [] }, manual: { servers: [] } }

/**
 * 构造 runtime 桩：记录动作入参，动作结果可注入。
 *
 * @param options - 覆盖 refresh / addUpload 的返回值
 * @returns 运行时桩与调用记录
 */
function fakeRuntime(options: { refresh?: ActionResult; add?: ActionResult } = {}) {
  const calls = { refresh: [] as Array<string | null>, add: [] as Array<[string | null, unknown, unknown]> }
  const runtime: MountsRuntime = {
    seedGlobal: () => {},
    globalGroup: () => globalGroup,
    globalServers: () => [],
    track: () => {},
    forget: () => {},
    read: sessionId => (sessionId === 's1' ? work : globalOnly),
    isBusy: () => false,
    refresh: async (sessionId) => {
      calls.refresh.push(sessionId)
      return options.refresh ?? { ok: true, data: work }
    },
    addUpload: async (sessionId, name, content) => {
      calls.add.push([sessionId, name, content])
      return options.add ?? { ok: true, data: work }
    },
  }
  return { runtime, calls }
}

/** 构造一个最小的 ServerResponse 桩。 */
function fakeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '' as string,
    setHeader(name: string, value: string) { this.headers[name] = value },
    end(chunk?: string) { if (chunk !== undefined) this.body = chunk },
  }
}

/**
 * 构造 IncomingMessage 桩：登记监听器时同步喂入请求体。
 *
 * @param options - 方法、URL、请求头、请求体与是否模拟流读取错误
 * @returns 请求桩
 */
function fakeReq(options: {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  error?: boolean
}) {
  return {
    method: options.method,
    url: options.url,
    headers: options.headers ?? {},
    on(event: string, listener: (chunk?: Buffer) => void) {
      if (event === 'data' && options.body !== undefined) listener(Buffer.from(options.body, 'utf8'))
      if (event === 'end' && options.error !== true) listener()
      if (event === 'error' && options.error === true) listener()
      return this
    },
  }
}

/** 让本轮微任务跑完（异步分派需要）。 */
const tick = () => new Promise(resolve => setTimeout(resolve, 0))

test('GET /mounts 返回该会话 JSON 载荷并禁止缓存', async () => {
  const { runtime } = fakeRuntime()
  const res = fakeRes()
  createMountsHandler(runtime)(fakeReq({ method: 'GET', url: `${MOUNTS_ROUTE_PATH}?sessionId=s1` }) as never, res as never)
  await tick()
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(JSON.parse(res.body), work)
})

test('GET /mounts 未跟踪会话或缺少 sessionId 时只返回全局分组', async () => {
  const { runtime } = fakeRuntime()
  for (const url of [`${MOUNTS_ROUTE_PATH}?sessionId=unknown`, MOUNTS_ROUTE_PATH]) {
    const res = fakeRes()
    createMountsHandler(runtime)(fakeReq({ method: 'GET', url }) as never, res as never)
    await tick()
    assert.deepEqual(JSON.parse(res.body), globalOnly)
  }
})

test('POST /refresh 成功返回新载荷并带上 sessionId', async () => {
  const { runtime, calls } = fakeRuntime()
  const res = fakeRes()
  createMountsHandler(runtime)(fakeReq({ method: 'POST', url: `${REFRESH_ROUTE_PATH}?sessionId=s1` }) as never, res as never)
  await tick()
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(JSON.parse(res.body), work)
  assert.deepEqual(calls.refresh, ['s1'])
})

test('POST /refresh 从请求体取 sessionId（真实客户端以 body 传参）', async () => {
  const { runtime, calls } = fakeRuntime()
  const res = fakeRes()
  const body = JSON.stringify({ sessionId: 's1' })
  createMountsHandler(runtime)(fakeReq({ method: 'POST', url: REFRESH_ROUTE_PATH, body }) as never, res as never)
  await tick()
  assert.equal(res.statusCode, 200)
  assert.deepEqual(calls.refresh, ['s1'])
})

test('POST /refresh 遇空闲保护把 409 与 error 文案写回', async () => {
  const { runtime } = fakeRuntime({ refresh: { ok: false, code: 409, message: '有会话正在运行，请稍后再刷新' } })
  const res = fakeRes()
  createMountsHandler(runtime)(fakeReq({ method: 'POST', url: REFRESH_ROUTE_PATH }) as never, res as never)
  await tick()
  assert.equal(res.statusCode, 409)
  assert.deepEqual(JSON.parse(res.body), { error: '有会话正在运行，请稍后再刷新' })
})

test('POST /add 解析请求体并把 sessionId/name/content 交给运行时', async () => {
  const { runtime, calls } = fakeRuntime()
  const res = fakeRes()
  const body = JSON.stringify({ sessionId: 's1', name: 'extra.json', content: '{"mcpServers":{}}' })
  createMountsHandler(runtime)(fakeReq({ method: 'POST', url: ADD_ROUTE_PATH, body }) as never, res as never)
  await tick()
  assert.equal(res.statusCode, 200)
  assert.deepEqual(JSON.parse(res.body), work)
  assert.deepEqual(calls.add, [['s1', 'extra.json', '{"mcpServers":{}}']])
})

test('POST /add 运行时校验失败用其 400 与 error 文案', async () => {
  const { runtime } = fakeRuntime({ add: { ok: false, code: 400, message: '文件名不能为空' } })
  const res = fakeRes()
  const body = JSON.stringify({ sessionId: 's1', name: '', content: '{}' })
  createMountsHandler(runtime)(fakeReq({ method: 'POST', url: ADD_ROUTE_PATH, body }) as never, res as never)
  await tick()
  assert.equal(res.statusCode, 400)
  assert.deepEqual(JSON.parse(res.body), { error: '文件名不能为空' })
})

test('POST /add 请求体不是合法 JSON 时 400', async () => {
  const { runtime, calls } = fakeRuntime()
  const res = fakeRes()
  createMountsHandler(runtime)(fakeReq({ method: 'POST', url: ADD_ROUTE_PATH, body: '{bad' }) as never, res as never)
  await tick()
  assert.equal(res.statusCode, 400)
  assert.equal(calls.add.length, 0)
})

test('POST /add 请求体超上限时 413 且不调用运行时', async () => {
  const { runtime, calls } = fakeRuntime()
  const res = fakeRes()
  // 读取上限 = 内容上限 + 65536 余量，故需构造超过该上限的请求体。
  const body = JSON.stringify({ sessionId: 's1', name: 'x.json', content: 'x'.repeat(MAX_UPLOAD_BYTES + 65536 + 1) })
  createMountsHandler(runtime)(fakeReq({ method: 'POST', url: ADD_ROUTE_PATH, body }) as never, res as never)
  await tick()
  assert.equal(res.statusCode, 413)
  assert.equal(calls.add.length, 0)
})

test('POST /add 内容恰好达上限时不再误判 413', async () => {
  const { runtime, calls } = fakeRuntime()
  const res = fakeRes()
  const content = 'x'.repeat(MAX_UPLOAD_BYTES)
  const body = JSON.stringify({ sessionId: 's1', name: 'x.json', content })
  createMountsHandler(runtime)(fakeReq({ method: 'POST', url: ADD_ROUTE_PATH, body }) as never, res as never)
  await tick()
  assert.equal(res.statusCode, 200)
  assert.deepEqual(calls.add, [['s1', 'x.json', content]])
})

test('POST /add 请求体读取出错时 400 而非 413', async () => {
  const { runtime, calls } = fakeRuntime()
  const res = fakeRes()
  createMountsHandler(runtime)(fakeReq({ method: 'POST', url: ADD_ROUTE_PATH, error: true }) as never, res as never)
  await tick()
  assert.equal(res.statusCode, 400)
  assert.equal(calls.add.length, 0)
})

test('handler 对跨站请求返回 403 且无响应体', async () => {
  const { runtime } = fakeRuntime()
  const res = fakeRes()
  createMountsHandler(runtime)(
    fakeReq({ method: 'GET', url: MOUNTS_ROUTE_PATH, headers: { 'sec-fetch-site': 'cross-site' } }) as never,
    res as never,
  )
  await tick()
  assert.equal(res.statusCode, 403)
  assert.equal(res.body, '')
})

test('handler 对未知路径返回 404 且无响应体', async () => {
  const { runtime } = fakeRuntime()
  const res = fakeRes()
  createMountsHandler(runtime)(fakeReq({ method: 'GET', url: '/dsh-loulan-mcp/nope' }) as never, res as never)
  await tick()
  assert.equal(res.statusCode, 404)
  assert.equal(res.body, '')
})

test('handler 对方法不匹配返回 405 且无响应体', async () => {
  const { runtime } = fakeRuntime()
  const cases = [
    { method: 'POST', url: MOUNTS_ROUTE_PATH },
    { method: 'GET', url: REFRESH_ROUTE_PATH },
    { method: 'GET', url: ADD_ROUTE_PATH },
  ]
  for (const item of cases) {
    const res = fakeRes()
    createMountsHandler(runtime)(fakeReq(item) as never, res as never)
    await tick()
    assert.equal(res.statusCode, 405)
    assert.equal(res.body, '')
  }
})
