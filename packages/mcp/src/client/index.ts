/**
 * @fileoverview dsh-loulan-mcp 浏览器半侧入口。
 *
 * 注册「MCP」标签页：按会话拉取 Host 的只读端点并渲染。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
// 类型副作用：把 ctx.locale / ctx.slots / conversation.view 槽位声明纳入程序。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MOUNTS_ROUTE_PATH } from '../contract.js'
import { createMountSource, type McpSnapshot } from './mcp-source.js'
import { McpView } from './McpView.js'
import { en, NS, zh } from './locales.js'

/** 依赖：槽位与 locale。 */
export const inject = ['slots', 'locale']

/**
 * 拉取某会话的挂载清单。
 *
 * @param sessionId - 会话 id
 * @returns 端点响应体（未归一化）
 */
async function fetchMounts(sessionId: string): Promise<unknown> {
  const response = await fetch(`${MOUNTS_ROUTE_PATH}?sessionId=${encodeURIComponent(sessionId)}`, {
    headers: { accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`mounts endpoint responded ${response.status}`)
  return await response.json()
}

/**
 * 注册「MCP」标签页与其数据源。
 *
 * @param ctx - 客户端插件上下文
 */
export function apply(ctx: Context): void {
  const t = ctx.locale.bind(NS)
  const sources = new Map<SessionId, ObservableSnapshot<McpSnapshot>>()
  const sourceFor = (sessionId: SessionId): ObservableSnapshot<McpSnapshot> => {
    let source = sources.get(sessionId)
    if (source === undefined) {
      source = createMountSource(sessionId, fetchMounts)
      sources.set(sessionId, source)
    }
    return source
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-loulan-mcp: dictionaries')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'mcp',
    order: 20,
    locale: NS,
    label: () => t('view.mcp'),
    inject: (sessionId: SessionId) => ({ hooks: { mcp: sourceFor(sessionId) } }),
  }, McpView))
}
