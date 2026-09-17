/**
 * @fileoverview 「MCP」视图的数据源：拉取只读端点并暴露快照（不依赖 React）。
 */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { McpMountedData, McpMountGroup, McpServerEntry } from '../contract.js'

/** 视图快照：端点返回的载荷；null 表示尚未取得。 */
export type McpSnapshot = McpMountedData | null

/**
 * 把工具名列表格式化为一行文案。
 *
 * @param tools - 工具名数组
 * @returns 顿号连接的文案；无工具时返回 null（由组件本地化）
 */
export function toolsText(tools: readonly string[]): string | null {
  return tools.length > 0 ? tools.join('、') : null
}

/** 判断是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 校验并归一化单个服务条目。 */
function normalizeServer(raw: unknown): McpServerEntry | null {
  if (!isRecord(raw)) return null
  const { name, transport, tools } = raw
  if (typeof name !== 'string') return null
  if (transport !== 'stdio' && transport !== 'streamable-http') return null
  if (!Array.isArray(tools) || tools.some(item => typeof item !== 'string')) return null
  return { name, transport, tools: tools as string[] }
}

/** 校验并归一化一个分组。 */
function normalizeGroup(raw: unknown): McpMountGroup | null {
  if (!isRecord(raw)) return null
  if (!Array.isArray(raw.servers)) return null
  const servers: McpServerEntry[] = []
  for (const item of raw.servers) {
    const server = normalizeServer(item)
    if (server === null) return null
    servers.push(server)
  }
  const file = raw.file
  return { ...(typeof file === 'string' ? { file } : {}), servers }
}

/**
 * 防御式归一化端点响应。
 *
 * @param raw - 未知响应体
 * @returns 合法载荷；畸形时返回 null（视图显示空态）
 */
export function normalizeMounts(raw: unknown): McpSnapshot {
  if (!isRecord(raw)) return null
  const global = normalizeGroup(raw.global)
  const workspace = normalizeGroup(raw.workspace)
  return global === null || workspace === null ? null : { global, workspace }
}

/**
 * 创建某会话的挂载快照源：初次订阅时拉取一次并发布，失败保持空态。
 *
 * @param sessionId - 会话 id
 * @param fetchMounts - 拉取函数（默认由 apply 注入的真实 fetch）
 * @returns 可订阅的快照源
 */
export function createMountSource(
  sessionId: string,
  fetchMounts: (sessionId: string) => Promise<unknown>,
): ObservableSnapshot<McpSnapshot> {
  let snapshot: McpSnapshot = null
  let started = false
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      if (!started) {
        started = true
        void fetchMounts(sessionId).then(
          (payload) => {
            const normalized = normalizeMounts(payload)
            if (normalized === null) return
            snapshot = normalized
            for (const notify of listeners) notify()
          },
          () => { /* 保持空态：端点不可达或返回错误 */ },
        )
      }
      return () => { listeners.delete(listener) }
    },
  }
}
