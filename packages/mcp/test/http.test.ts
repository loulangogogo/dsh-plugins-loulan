import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mountResponse, createMountsHandler } from '../src/http.js'
import { createMountRegistry } from '../src/registry.js'
import type { McpMountGroup, McpMountedData } from '../src/contract.js'

/** 全局分组桩。 */
const globalGroup: McpMountGroup = { file: '/home/me/.dsh/.mcp.json', servers: [{ name: 'g', transport: 'stdio', tools: [] }] }

/** 工作区载荷桩。 */
const work: McpMountedData = {
  global: globalGroup,
  workspace: { file: '/proj/.mcp.json', servers: [{ name: 'memory', transport: 'stdio', tools: ['a'] }] },
}

test('mountResponse 命中会话时返回其完整载荷', () => {
  const registry = createMountRegistry()
  registry.set('s1', work)
  assert.deepEqual(mountResponse('s1', registry, globalGroup), work)
})

test('mountResponse 未命中会话时只返回全局分组', () => {
  const registry = createMountRegistry()
  assert.deepEqual(mountResponse('unknown', registry, globalGroup), {
    global: globalGroup,
    workspace: { servers: [] },
  })
})

test('mountResponse 缺少 sessionId 时只返回全局分组', () => {
  const registry = createMountRegistry()
  assert.deepEqual(mountResponse(null, registry, globalGroup), {
    global: globalGroup,
    workspace: { servers: [] },
  })
})

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

test('handler 对非 GET 返回 405 且无响应体', () => {
  const registry = createMountRegistry()
  const handler = createMountsHandler(registry, globalGroup)
  const res = fakeRes()
  handler({ method: 'POST', url: '/dsh-loulan-mcp/mounts' } as never, res as never)
  assert.equal(res.statusCode, 405)
  assert.equal(res.body, '')
})

test('handler 对跨站 GET 返回 403 且无响应体', () => {
  const registry = createMountRegistry()
  const handler = createMountsHandler(registry, globalGroup)
  const res = fakeRes()
  handler(
    { method: 'GET', url: '/dsh-loulan-mcp/mounts', headers: { 'sec-fetch-site': 'cross-site' } } as never,
    res as never,
  )
  assert.equal(res.statusCode, 403)
  assert.equal(res.body, '')
})

test('handler 返回 JSON、禁止缓存并按 sessionId 取数', () => {
  const registry = createMountRegistry()
  registry.set('s1', work)
  const res = fakeRes()
  createMountsHandler(registry, globalGroup)(
    { method: 'GET', url: '/dsh-loulan-mcp/mounts?sessionId=s1' } as never,
    res as never,
  )
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['content-type'], 'application/json; charset=utf-8')
  assert.equal(res.headers['cache-control'], 'no-store')
  assert.deepEqual(JSON.parse(res.body), work)
})
