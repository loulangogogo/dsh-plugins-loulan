/**
 * @fileoverview dsh-loulan-mcp 浏览器半侧入口。
 *
 * 注册「MCP」标签页：按会话拉取 Host 端点并渲染，并暴露刷新/添加上传两个控制动作。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// 类型副作用：把 ctx.locale / ctx.slots / conversation.view 槽位声明纳入程序。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  ADD_ROUTE_PATH, MOUNTS_ROUTE_PATH, REFRESH_ROUTE_PATH, UNLOAD_ROUTE_PATH,
  type UnloadableMountGroup,
} from '../contract.js'
import { createMountControl, type MountControl } from './mcp-source.js'
import { McpView } from './McpView.js'
import { en, NS, zh } from './locales.js'
import { ensureMcpStyles } from './styles.js'

/** 依赖：槽位与 locale。 */
export const inject = ['slots', 'locale']

/**
 * 读取失败响应体里的 error 文案。
 *
 * @param response - fetch 响应
 * @param fallback - 响应体不可解析时的兜底文案
 * @returns 可展示的失败原因
 */
async function readError(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null)
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const message = (body as Record<string, unknown>).error
    if (typeof message === 'string') return message
  }
  return fallback
}

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
 * POST 一个 JSON 请求体并返回响应体；非 2xx 时以端点文案抛错。
 *
 * @param path - 端点路径
 * @param body - 请求体（JSON 序列化）
 * @returns 端点响应体（未归一化）
 */
async function postJson(path: string, body: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await readError(response, `${path} responded ${response.status}`))
  return await response.json()
}

/**
 * 注册「MCP」标签页与其数据源/控制面。
 *
 * @param ctx - 客户端插件上下文
 */
export function apply(ctx: Context): void {
  ensureMcpStyles()
  const t = ctx.locale.bind(NS)
  const controls = new Map<SessionId, MountControl>()
  const controlFor = (sessionId: SessionId): MountControl => {
    let control = controls.get(sessionId)
    if (control === undefined) {
      control = createMountControl(sessionId, {
        fetchMounts,
        refresh: id => postJson(REFRESH_ROUTE_PATH, { sessionId: id }),
        add: (id, name, content) => postJson(ADD_ROUTE_PATH, { sessionId: id, name, content }),
        unload: (id, group) => postJson(UNLOAD_ROUTE_PATH, { sessionId: id, group }),
      })
      controls.set(sessionId, control)
    }
    return control
  }

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-loulan-mcp: dictionaries')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'mcp',
    order: 20,
    locale: NS,
    label: () => t('view.mcp'),
    inject: (sessionId: SessionId) => {
      const control = controlFor(sessionId)
      return {
        hooks: { mcp: control.source },
        refresh: () => control.refresh(),
        addUpload: (file: { name: string; content: string }) => control.addUpload(file),
        unload: (group: UnloadableMountGroup) => control.unload(group),
      }
    },
  }, McpView))
}
