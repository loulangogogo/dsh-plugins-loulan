/**
 * @fileoverview 「MCP」会话标签页的数据契约。
 *
 * 数据由 Host 的进程内运行时经 HTTP 端点提供（见 http.ts）：不写入会话
 * 日志、不进入模型上下文。类型供 Host 与浏览器半侧共享；路由常量与上传上限
 * 为 Host 注册与客户端调用共用的契约。
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

/** 挂载清单载荷（三组来源）。 */
export interface McpMountedData {
  /** .dsh 根目录的全局共享服务。 */
  global: McpMountGroup
  /** 本会话工作区 .mcp.json 的服务。 */
  workspace: McpMountGroup
  /** 本会话经「添加」上传的手动挂载服务。 */
  manual: McpMountGroup
}

/** 本插件 HTTP 端点的公共前缀（Host 以 prefix 方式注册，客户端据此调用）。 */
export const ROUTE_PREFIX = '/dsh-loulan-mcp'

/** 挂载清单只读端点的路径（Host 注册，客户端拉取）。 */
export const MOUNTS_ROUTE_PATH = `${ROUTE_PREFIX}/mounts`

/** 刷新端点路径（POST：全局增量重挂 + 本会话重挂）。 */
export const REFRESH_ROUTE_PATH = `${ROUTE_PREFIX}/refresh`

/** 添加端点路径（POST：上传 .mcp.json 内容并挂到当前会话）。 */
export const ADD_ROUTE_PATH = `${ROUTE_PREFIX}/add`

/** 卸载端点路径（POST：卸载本会话的一个来源分组；全局共享不可卸载）。 */
export const UNLOAD_ROUTE_PATH = `${ROUTE_PREFIX}/unload`

/** 可卸载的来源分组：全局共享刻意不在其中（只能靠重启改变）。 */
export type UnloadableMountGroup = 'workspace' | 'manual'

/** 上传文件内容的字节上限（256 KiB）：超出即拒绝。 */
export const MAX_UPLOAD_BYTES = 262144
