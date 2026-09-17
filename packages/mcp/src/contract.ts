/**
 * @fileoverview 「MCP」会话标签页的数据契约。
 *
 * 数据由 Host 的进程内注册表经只读 HTTP 端点提供（见 http.ts）：不写入会话
 * 日志、不进入模型上下文。类型供 Host 与浏览器半侧共享；MOUNTS_ROUTE_PATH
 * 为 Host 注册与客户端拉取共用的路由常量。
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

/** 挂载清单载荷。 */
export interface McpMountedData {
  global: McpMountGroup
  workspace: McpMountGroup
}

/** 挂载清单只读端点的路径（Host 注册，客户端拉取）。 */
export const MOUNTS_ROUTE_PATH = '/dsh-loulan-mcp/mounts'
