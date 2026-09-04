/**
 * @fileoverview 会话内「已挂载 MCP 服务」通知：文案组装与输出。
 *
 * 通知的呈现方式是「命令结果卡片」：把文案作为 log-only 的 command/run +
 * command/done 会话事件直接追加到会话日志。log-only 事件永远不会进入模型
 * 可见的 surface（只有 user/assistant/tool 三类事件会上 surface），因此既不
 * 唤醒模型、也绝不出现在模型上下文中；Web 客户端内置把这些事件渲染为一张
 * 立即可见、可持久化的结果卡片（与 /hello 显示「你好」同一通道）。
 *
 * 注意：不得用 agent.followup / steer / inject 发送 user 消息来提示——那些都会
 * 让文案进入模型对话（followup 还会直接唤醒模型开新回合）。
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
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

/** 结果卡片的标题(命令名)。 */
const MOUNT_COMMAND_NAME = 'mcp'

// 实例 token + 自增序号用于生成 commandId。会话日志要求 commandId 全局唯一,
// 实例 token 前缀保证进程重启、在同一会话日志上再次挂载时不会与旧记录重复
// (参照 dsh-commands 的 mintCommandId 约定:instanceToken 前缀防止恢复日志重复)。
const INSTANCE_TOKEN = Math.random().toString(36).slice(2, 10)
let mountSeq = 0

/** command/run 事件的载荷形状(与 dsh-commands 的声明一致)。 */
interface MountCommandRunData {
  commandId: string
  name: string
  source: { kind: 'user' }
}

/** command/done 事件的载荷形状(与 dsh-commands 的声明一致)。 */
interface MountCommandDoneData {
  commandId: string
  kind: 'success'
  text: string
}

/**
 * 在当前会话里以命令结果卡片的形式输出「已挂载 MCP 服务」通知。
 *
 * 通知文案作为 log-only 的 command/run + command/done 事件直接追加到
 * agent.session 日志：不唤醒模型、不进模型上下文，仅用户可见；UI 立即渲染为
 * 一张结果卡片（可点开看多行服务清单），并随会话日志持久化。
 *
 * 这里刻意不 import @deepseek-ai/dsh-commands 的类型：command 生命周期是
 * dsh-commands 声明的 log-only 会话事件，但本插件不想因此引入对 dsh-commands
 * 的依赖，故按相同载荷形状就地书写（Session.append 对 log-only 事件只接受
 * type + data 两个参数）。
 *
 * @param agent - 目标 agent（取其 session 追加事件）
 * @param text - 通知文案（服务清单，多行）
 */
export function announceMountNotice(agent: Agent, text: string): void {
  mountSeq += 1
  const commandId = `mcp-${INSTANCE_TOKEN}-${mountSeq}`
  const append = agent.session.append.bind(agent.session) as (
    type: 'command/run' | 'command/done',
    data: MountCommandRunData | MountCommandDoneData,
  ) => unknown
  append('command/run', {
    commandId,
    name: MOUNT_COMMAND_NAME,
    source: { kind: 'user' },
  } satisfies MountCommandRunData)
  append('command/done', {
    commandId,
    kind: 'success',
    text,
  } satisfies MountCommandDoneData)
}
