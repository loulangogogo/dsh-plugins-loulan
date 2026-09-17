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
  'heading': 'MCP 服务',
  'heading.count': '{count} 个',
  'toolbar.refresh': '刷新',
  'toolbar.add': '添加 .mcp.json',
  'toolbar.busy': '处理中…',
  'group.workspace': '本工作区',
  'group.manual': '手动添加',
  'group.global': '全局共享',
  'source': '来源',
  'tools.unavailable': '工具列表暂不可用',
  'tools.separator': '、',
  'tools.expand': '展开',
  'tools.collapse': '收起',
  'error.refreshFailed': '刷新失败',
  'error.addFailed': '添加失败',
} as const

/** 词典键。 */
export type McpKey = keyof typeof zh

/** 英文词典，按键集完整对齐中文。 */
export const en: Record<McpKey, string> = {
  'view.mcp': 'MCP',
  'empty': 'No MCP servers loaded in this session',
  'heading': 'MCP servers',
  'heading.count': '{count} loaded',
  'toolbar.refresh': 'Refresh',
  'toolbar.add': 'Add .mcp.json',
  'toolbar.busy': 'Working…',
  'group.workspace': 'This workspace',
  'group.manual': 'Manually added',
  'group.global': 'Shared globally',
  'source': 'Source',
  'tools.unavailable': 'Tool list unavailable',
  'tools.separator': ', ',
  'tools.expand': 'Expand',
  'tools.collapse': 'Collapse',
  'error.refreshFailed': 'Refresh failed',
  'error.addFailed': 'Add failed',
}
