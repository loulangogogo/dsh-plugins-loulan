/**
 * 插件 3：hello —— 注册斜杠命令 /hello，输出「你好」。
 *
 * 通过 @deepseek-ai/dsh-commands 的命令注册表注册一个全局命令：
 * 用户在聊天框输入 /hello 后，命令处理器直接返回成功结果，
 * 由聊天界面渲染「你好」，不经过模型、不改变对话行为。
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'

export const name = 'hello'
/** 声明依赖 commands 服务，保证 apply 执行时 ctx.commands 已可用。 */
export const inject = ['commands']

/**
 * 注册全局 /hello 命令。
 * @param ctx - 插件上下文，携带命令注册表服务（ctx.commands）。
 */
export function apply(ctx: Context): void {
  ctx.commands.register({
    name: 'hello',
    description: '输出「你好」',
    handler: (): CommandResult => ({ kind: 'success', text: '你好' }),
  })
}
