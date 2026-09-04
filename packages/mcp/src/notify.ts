/**
 * @fileoverview 会话内「已挂载 MCP 服务」通知:文案组装与输出。
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { MountedServer } from './mount.js'

/**
 * 把单个挂载明细格式化为一行清单。
 *
 * @param server - 单个成功挂载的 server 明细
 * @returns 形如「- memory (stdio):a、b」的一行文案(展示原始服务名 rawName)
 */
export function formatServer(server: MountedServer): string {
  const tools = server.tools.length > 0 ? server.tools.join('、') : '（工具列表暂不可用）'
  return `- ${server.rawName} (${server.transport}):${tools}`
}

/**
 * 组装完整通知文案。
 *
 * 仅当工作区有成功挂载的服务时才提示(返回 undefined 表示不提示);
 * 有工作区服务时,全局共享服务一并列出。
 *
 * @param globalMounts - 全局 .dsh 根已挂载的服务明细
 * @param workMounts - 工作区已挂载的服务明细
 * @returns 多行通知文案;工作区无服务时返回 undefined
 */
export function buildMountNotice(globalMounts: MountedServer[], workMounts: MountedServer[]): string | undefined {
  if (workMounts.length === 0) return undefined
  const lines: string[] = [`本工作区已自动挂载以下 MCP 服务(来源:${workMounts[0].file}):`]
  for (const item of workMounts) lines.push(formatServer(item))
  if (globalMounts.length > 0) {
    lines.push('')
    lines.push(`另共享全局服务(来源:${globalMounts[0].file}):`)
    for (const item of globalMounts) lines.push(formatServer(item))
  }
  return lines.join('\n')
}

/**
 * 把通知文案作为 sourced 用户消息，立即唤醒 agent 输出（加载完成即播报）。
 *
 * 消息以 <system-reminder> 包裹并标记为 notice 形式，引导模型把它当作
 * 系统通知、无需回应；前端会渲染成通知注记而非普通对话气泡。
 *
 * @param agent - 目标 agent
 * @param text - 通知文案（服务清单）
 * @param summary - 一行摘要，供前端折叠显示
 */
export function announceMountNotice(agent: Agent, text: string, summary: string): void {
  const content = [
    '<system-reminder>',
    text,
    '此通知仅用于告知当前已加载的 MCP 服务，无需回应。',
    '</system-reminder>',
  ].join('\n')
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: content }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-loulan-mcp',
      form: 'notice',
      summary,
    },
  }))
}
