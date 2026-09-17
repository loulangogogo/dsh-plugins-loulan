/**
 * @fileoverview 「MCP」视图的本地化词典。
 *
 * 命名空间声明与键集同处一文件：任何要写 `TranslateNS<'dsh-loulan-mcp'>`
 * 或 `PropsLocale<'dsh-loulan-mcp'>` 的模块只需加载本文件。
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** 「MCP」视图的标签、空态与分组文案。 */
    'dsh-loulan-mcp': McpKey
  }
}

/** 本插件拥有的 locale 命名空间。 */
export const NS = 'dsh-loulan-mcp'

/** 简体中文词典（键集为准）。 */
export const zh = {
  'view.mcp': 'MCP',
  'empty': '本会话未加载 MCP 服务',
  'group.workspace': '本工作区',
  'group.global': '全局共享',
  'source': '来源',
  'tools.unavailable': '工具列表暂不可用',
} as const

/** 词典键。 */
export type McpKey = keyof typeof zh

/** 英文词典，按键集完整对齐中文。 */
export const en: Record<McpKey, string> = {
  'view.mcp': 'MCP',
  'empty': 'No MCP servers loaded in this session',
  'group.workspace': 'This workspace',
  'group.global': 'Shared globally',
  'source': 'Source',
  'tools.unavailable': 'Tool list unavailable',
}
