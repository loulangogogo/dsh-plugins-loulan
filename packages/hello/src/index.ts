/**
 * @fileoverview hello 插件 —— 注册斜杠命令 /hello，输出「你好」。
 *
 * 通过 @deepseek-ai/dsh-commands 的命令注册表注册一个全局命令：
 * 用户在聊天框输入 /hello 后，命令处理器直接返回成功结果，
 * 由聊天界面渲染「你好」，不经过模型、不改变对话行为。
 *
 * 该插件为纯命令插件：无配置项、无参数解析、无副作用状态。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'

/** 插件名，须与 cordis.yml 中的 id 对应。 */
export const name = 'hello'
/** 声明依赖 commands 服务，保证 apply 执行时 ctx.commands 已初始化可用。 */
export const inject = ['commands']

/**
 * 注册全局 /hello 命令。
 *
 * 命令处理器同步返回成功结果，不经过模型；返回的 text 由聊天界面直接渲染。
 *
 * @param ctx - 插件上下文，携带命令注册表服务（ctx.commands）
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    // 命令名（不带斜杠），用户输入 /hello 时命中。
    name: 'hello',
    // 斜杠菜单中展示的命令描述。
    description: '输出「你好」',
    // 命令处理器：直接返回成功结果，text 由聊天界面渲染为「你好」。
    handler: (): CommandResult => ({ kind: 'success', text: '你好' }),
  })
}
