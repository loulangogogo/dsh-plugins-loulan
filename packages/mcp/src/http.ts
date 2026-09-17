/**
 * @fileoverview 只读的「已加载 MCP 服务」HTTP 端点。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { McpMountGroup, McpMountedData } from './contract.js'
import type { MountRegistry } from './registry.js'

/** 未命中会话时的空工作区分组。 */
const EMPTY_WORKSPACE: McpMountGroup = { servers: [] }

/**
 * 组装某会话的挂载清单响应体。
 *
 * 未记录该会话时只返回全局分组，工作区为空组（视图形如「本会话未加载」）。
 *
 * @param sessionId - 查询的会话 id；缺失为 null
 * @param registry - 进程内注册表
 * @param global - apply 时确定的全局分组
 * @returns 分组载荷
 */
export function mountResponse(
  sessionId: string | null,
  registry: MountRegistry,
  global: McpMountGroup,
): McpMountedData {
  const recorded = sessionId === null ? undefined : registry.get(sessionId)
  return recorded ?? { global, workspace: EMPTY_WORKSPACE }
}

/**
 * 创建端点处理器：仅接受 GET，返回 JSON，禁止缓存。
 *
 * @param registry - 进程内注册表
 * @param global - apply 时确定的全局分组
 * @returns Node HTTP 处理器
 */
export function createMountsHandler(
  registry: MountRegistry,
  global: McpMountGroup,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.method !== 'GET') {
      res.statusCode = 405
      res.end()
      return
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const body = JSON.stringify(mountResponse(url.searchParams.get('sessionId'), registry, global))
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(body)
  }
}
