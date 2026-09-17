/**
 * @fileoverview dsh-loulan-mcp 浏览器半侧入口（烟测版）。
 *
 * 只注册「MCP」标签页，验证 conversation.view 槽位注册链路。
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型副作用：把 conversation.view 槽位声明纳入程序。
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// 类型副作用：把 ctx.slots（ui-renderer 提供的槽位服务）声明纳入程序。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { McpView } from './McpView.js'

/** 只依赖槽位服务。 */
export const inject = ['slots']

/**
 * 注册「MCP」标签页。
 *
 * @param ctx - 客户端插件上下文
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'mcp',
    order: 20,
    label: 'MCP',
  }, McpView))
}
