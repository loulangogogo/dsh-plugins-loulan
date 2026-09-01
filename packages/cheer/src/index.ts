/**
 * 插件 1：cheer —— 每次 AI 对话都输出「加油」。
 *
 * 监听 agent-loop 的 `agent/turn-stopping` 事件：每个对话轮次（turn）即将
 * 关闭时触发一次。这是纯观察插件：不注入服务、不改变行为，只做副作用输出。
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
// 仅做类型引入：把 dsh-agent 声明合并的 `agent/turn-stopping` 事件类型带进来。
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'cheer'

export interface Config {
  /** 每个 AI 对话轮次结束时输出的鼓励语。 */
  message: string
}

export const Config: Schema<Config> = Schema.object({
  message: Schema.string().default('加油'),
})

export function apply(ctx: Context, config: Config) {
  console.log(`[cheer] 已加载：每个 AI 对话结束将输出「${config.message}」`)

  ctx.on('agent/turn-stopping', ({ turn }) => {
    console.log(`[cheer] ${config.message} (turn ${turn})`)
  })
}
