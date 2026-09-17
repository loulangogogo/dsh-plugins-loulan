/**
 * @fileoverview 「MCP」会话标签页的数据契约：mcp/mounted 会话事件。
 *
 * 该事件为 log-only（不在 SurfaceEventType 内），可持久化、可回放，
 * 永不进入模型上下文。浏览器半侧 type-only 引用本模块。
 */

/** 支持的传输方式。 */
export type McpTransport = 'stdio' | 'streamable-http'

/** 单个已挂载服务（展示用）。 */
export interface McpServerEntry {
  /** .mcp.json 中的原始服务名（不含 agent 唯一后缀）。 */
  name: string
  /** 传输方式。 */
  transport: McpTransport
  /** 该服务暴露的工具名（已去掉 mcp__<serverName>__ 前缀）；可能为空数组。 */
  tools: string[]
}

/** 一个来源下的服务分组。 */
export interface McpMountGroup {
  /** 来源 .mcp.json 绝对路径；该来源不存在时省略。 */
  file?: string
  servers: McpServerEntry[]
}

/** mcp/mounted 事件载荷。 */
export interface McpMountedData {
  global: McpMountGroup
  workspace: McpMountGroup
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'mcp/mounted': McpMountedData
  }
}
