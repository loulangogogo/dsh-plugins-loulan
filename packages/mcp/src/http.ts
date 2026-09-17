/**
 * @fileoverview 「MCP」标签页的 HTTP 端点。
 *
 * 单一 prefix 路由按 url.pathname 分派：GET /mounts 读取清单、POST /refresh 刷新、
 * POST /add 上传添加、POST /unload 卸载某个来源分组。所有响应均为 JSON 且禁止缓存；
 * 请求体读取上限在内容上限之上预留 JSON 外壳与转义开销，内容本身的字节上限仍由
 * MAX_UPLOAD_BYTES 约束。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ADD_ROUTE_PATH, MAX_UPLOAD_BYTES, MOUNTS_ROUTE_PATH, REFRESH_ROUTE_PATH, UNLOAD_ROUTE_PATH } from './contract.js'
import type { ActionResult, MountsRuntime } from './mounts.js'
import { isRecord } from './parse.js'

/**
 * 请求体读取上限在 MAX_UPLOAD_BYTES 之上预留的余量（64 KiB）。
 *
 * 请求体还含 JSON 外壳（sessionId / name 字段）与 content 的转义开销，按内容上限直接
 * 截断会把合法的临界文件误判为 413；真正的内容上限仍由 addUpload 内的字节校验负责。
 */
const BODY_OVERHEAD_BYTES = 65536

/**
 * 判断请求是否来自同源页面。
 *
 * 浏览器同源请求带 `sec-fetch-site: same-origin`，直接地址栏访问为 `none`；
 * 非浏览器客户端（如 curl）不带该头，按放行处理。
 *
 * @param req - Node 请求
 * @returns 是否为可接受的调用方
 */
function isSameOriginRequest(req: IncomingMessage): boolean {
  const site = req.headers?.['sec-fetch-site']
  if (typeof site !== 'string') return true
  return site === 'same-origin' || site === 'none'
}

/**
 * 写入 JSON 响应（统一 content-type 与 no-store）。
 *
 * @param res - Node 响应
 * @param status - HTTP 状态码
 * @param payload - 待序列化的响应体
 */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * 写入无响应体的状态码（跨站 403、未知路径 404、方法不匹配 405）。
 *
 * @param res - Node 响应
 * @param status - HTTP 状态码
 */
function sendEmpty(res: ServerResponse, status: number): void {
  res.statusCode = status
  res.end()
}

/**
 * 按动作结果写响应：成功 200 + 载荷，失败用其结果自带的 status 码 + `{ error }`。
 *
 * @param res - Node 响应
 * @param result - 运行时动作结果
 */
function sendResult(res: ServerResponse, result: ActionResult): void {
  if (result.ok) sendJson(res, 200, result.data)
  else sendJson(res, result.code, { error: result.message })
}

/** readBody 的结果：成功携带正文；失败携带应回写的 HTTP 状态码与文案。 */
type BodyResult =
  | { ok: true; body: string }
  | { ok: false; status: number; message: string }

/**
 * 读取请求体文本。
 *
 * 超限与流读取错误区分对待：超限为 413（请求体过大），流错误为 400（请求体读取失败）。
 *
 * @param req - Node 请求
 * @param limit - 字节上限；超出即放弃并返回 413
 * @returns 读取结果（成功正文，或带状态码的失败）
 */
function readBody(req: IncomingMessage, limit: number): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const finish = (value: BodyResult): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        finish({ ok: false, status: 413, message: '请求体过大' })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish({ ok: true, body: Buffer.concat(chunks).toString('utf8') }))
    req.on('error', () => finish({ ok: false, status: 400, message: '请求体读取失败' }))
  })
}

/**
 * 读取并解析**可选**的 JSON 请求体。
 *
 * 请求体缺失、超限或不是合法 JSON 时返回空对象，由调用方按缺省字段处理
 * （用于 /refresh 这类以 body 传参、但允许省略的端点）。
 *
 * @param req - Node 请求
 * @returns 解析出的普通对象；不可用时为空对象
 */
async function readOptionalJsonRecord(req: IncomingMessage): Promise<Record<string, unknown>> {
  const read = await readBody(req, MAX_UPLOAD_BYTES + BODY_OVERHEAD_BYTES)
  if (!read.ok) return {}
  try {
    const parsed: unknown = JSON.parse(read.body)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 按路径与方法分派请求。
 *
 * @param req - Node 请求
 * @param res - Node 响应
 * @param runtime - 挂载运行时
 */
async function dispatch(req: IncomingMessage, res: ServerResponse, runtime: MountsRuntime): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const sessionId = url.searchParams.get('sessionId')

  if (url.pathname === MOUNTS_ROUTE_PATH) {
    if (req.method !== 'GET') return sendEmpty(res, 405)
    // 读取前先同步全局配置的磁盘现状（文件变更增量重挂、文件消失则卸载全局服务）；
    // 内容未变时内部只比对指纹，不重挂。同步失败不影响这次读取：照旧返回内存快照。
    try {
      await runtime.syncGlobal()
    } catch (error) {
      console.error('[dsh-loulan-mcp] 同步全局 MCP 配置失败:', error)
    }
    return sendJson(res, 200, runtime.read(sessionId))
  }

  if (url.pathname === REFRESH_ROUTE_PATH) {
    if (req.method !== 'POST') return sendEmpty(res, 405)
    // 客户端把 sessionId 放在 POST body；查询串写法仍兼容。
    const body = await readOptionalJsonRecord(req)
    const id = typeof body.sessionId === 'string' ? body.sessionId : sessionId
    return sendResult(res, await runtime.refresh(id))
  }

  if (url.pathname === ADD_ROUTE_PATH) {
    if (req.method !== 'POST') return sendEmpty(res, 405)
    // 读取上限 = 内容上限 + 外壳余量；content 本身的字节上限在 addUpload 内校验。
    const read = await readBody(req, MAX_UPLOAD_BYTES + BODY_OVERHEAD_BYTES)
    if (!read.ok) return sendJson(res, read.status, { error: read.message })
    let parsed: unknown
    try {
      parsed = JSON.parse(read.body)
    } catch {
      return sendJson(res, 400, { error: '请求体不是合法 JSON' })
    }
    const payload = isRecord(parsed) ? parsed : {}
    const bodySessionId = typeof payload.sessionId === 'string' ? payload.sessionId : sessionId
    return sendResult(res, await runtime.addUpload(bodySessionId, payload.name, payload.content))
  }

  if (url.pathname === UNLOAD_ROUTE_PATH) {
    if (req.method !== 'POST') return sendEmpty(res, 405)
    // 卸载只需要 sessionId 与目标分组，请求体很小，按可选体读取（查询串写法兼容）。
    const body = await readOptionalJsonRecord(req)
    const id = typeof body.sessionId === 'string' ? body.sessionId : sessionId
    return sendResult(res, await runtime.unload(id, body.group))
  }

  return sendEmpty(res, 404)
}

/**
 * 创建端点处理器：同源校验最早，其后按路径分派。
 *
 * @param runtime - 挂载运行时
 * @returns Node HTTP 处理器
 */
export function createMountsHandler(runtime: MountsRuntime): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (!isSameOriginRequest(req)) {
      sendEmpty(res, 403)
      return
    }
    void dispatch(req, res, runtime).catch((error: unknown) => {
      console.error('[dsh-loulan-mcp] 端点处理失败:', error)
      if (!res.headersSent) sendJson(res, 500, { error: '内部错误' })
    })
  }
}
