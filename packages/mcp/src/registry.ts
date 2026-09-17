/**
 * @fileoverview 会话级「已加载 MCP 服务」进程内注册表。
 *
 * 不写入会话日志：仓库外插件事件无法标记 ignorable，落盘会导致会话日志在重开时被拒读。
 */
import type { McpMountedData } from './contract.js'

/** 会话级挂载清单注册表。 */
export interface MountRegistry {
  /**
   * 记录某会话的挂载清单。
   *
   * @param sessionId - 会话 id
   * @param data - 分组载荷
   */
  set(sessionId: string, data: McpMountedData): void
  /**
   * 读取某会话的挂载清单。
   *
   * @param sessionId - 会话 id
   * @returns 载荷；未记录时返回 undefined
   */
  get(sessionId: string): McpMountedData | undefined
  /**
   * 清除某会话的挂载清单（agent 销毁时）。
   *
   * @param sessionId - 会话 id
   */
  clear(sessionId: string): void
}

/**
 * 创建一个进程内注册表。
 *
 * @returns 注册表实例
 */
export function createMountRegistry(): MountRegistry {
  const entries = new Map<string, McpMountedData>()
  return {
    set: (sessionId, data) => { entries.set(sessionId, data) },
    get: sessionId => entries.get(sessionId),
    clear: sessionId => { entries.delete(sessionId) },
  }
}
