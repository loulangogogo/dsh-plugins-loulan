/**
 * @fileoverview 「MCP」标签页的 HTTP 端点。
 *
 * 单一 prefix 路由按 url.pathname 分派：GET /mounts 读取清单、POST /refresh 刷新、
 * POST /add 上传添加。所有响应均为 JSON 且禁止缓存；请求体上限由 MAX_UPLOAD_BYTES 约束。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ADD_ROUTE_PATH, MAX_UPLOAD_BYTES, MOUNTS_ROUTE_PATH, REFRESH_ROUTE_PATH } from './contract.js'
import type { ActionResult, MountsRuntime } from './mounts.js'
import { isRecord } from './parse.js'

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

/**
 * 读取请求体文本。
 *
 * @param req - Node 请求
 * @param limit - 字节上限；超出即放弃并返回 null
 * @returns 请求体 UTF-8 文本；超限或读取出错时为 null
 */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        finish(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => finish(null))
  })
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
    return sendJson(res, 200, runtime.read(sessionId))
  }

  if (url.pathname === REFRESH_ROUTE_PATH) {
    if (req.method !== 'POST') return sendEmpty(res, 405)
    return sendResult(res, await runtime.refresh(sessionId))
  }

  if (url.pathname === ADD_ROUTE_PATH) {
    if (req.method !== 'POST') return sendEmpty(res, 405)
    const body = await readBody(req, MAX_UPLOAD_BYTES)
    if (body === null) return sendJson(res, 413, { error: '请求体过大' })
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      return sendJson(res, 400, { error: '请求体不是合法 JSON' })
    }
    const payload = isRecord(parsed) ? parsed : {}
    const bodySessionId = typeof payload.sessionId === 'string' ? payload.sessionId : null
    return sendResult(res, await runtime.addUpload(bodySessionId, payload.name, payload.content))
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
