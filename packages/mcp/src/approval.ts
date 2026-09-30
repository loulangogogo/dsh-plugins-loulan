/**
 * @fileoverview 工作区 .mcp.json 的自动挂载。
 *
 * - agent 创建时（agent/created）发现工作区 .mcp.json（与全局 .dsh 根命中同一
 *   文件则跳过），即自动挂载到该 agent，无需用户询问；agent 销毁时随
 *   agent.ctx 作用域自动卸载。
 * - 挂载全程静默：不向会话日志追加事件、不产生通知卡片。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// 仅引入 dsh-agent 的事件类型声明（agent/created、agent/disposed），确保 ctx.on 类型推断。
import type {} from '@deepseek-ai/dsh-agent'
import { findMcpJson } from './discover.js'
import { agentToken } from './server-name.js'
import { mountFile, type MountedHandle } from './mount.js'
import type { McpSkippedEntry } from './contract.js'
import type { MountsRuntime } from './mounts.js'

/**
 * 挂载工作区 .mcp.json 并写入运行时记录。
 *
 * 全程静默：不向会话日志追加事件、不产生通知卡片；运行时记录供 HTTP 端点读取。
 * 挂载期间在运行时标记「正在挂载」，让标签页能把这段时间与「该会话未激活」区分开。
 *
 * @param agent - 目标 agent
 * @param file - 工作区 .mcp.json 绝对路径；无则为 undefined
 * @param runtime - 挂载运行时（记录句柄）
 * @param mount - 挂载实现（默认 mountFile），可注入桩
 */
export async function mountAndRecord(
  agent: Agent,
  file: string | undefined,
  runtime: MountsRuntime,
  mount: (
    ctx: Context,
    file: string,
    suffix?: string,
    exclude?: ReadonlySet<string>,
    skipped?: McpSkippedEntry[],
  ) => Promise<MountedHandle[]> = mountFile,
): Promise<void> {
  runtime.setMounting(agent.id, true)
  try {
    const skipped: McpSkippedEntry[] = []
    const handles = file === undefined ? [] : await mount(agent.ctx, file, agentToken(agent.id), undefined, skipped)
    runtime.track(agent, file, handles, skipped)
  } finally {
    runtime.setMounting(agent.id, false)
  }
}

/**
 * 注册 agent/created 监听：探测工作区 .mcp.json，**一律登记**该会话并挂载命中项。
 *
 * 即使工作区没有 .mcp.json、此刻也没有任何全局服务，也必须留下会话记录：
 * 载荷在读取时现算，登记时为空不影响后续显示；反之若跳过登记，该会话的
 * 刷新/添加会一律报「会话未加载 MCP 服务」（且切走再切回也不会自愈）。
 *
 * @param ctx - 插件上下文
 * @param rootFile - 全局 .dsh 根的 .mcp.json 路径（命中则跳过工作区挂载）
 * @param runtime - 挂载运行时
 */
export function registerAgentCreated(
  ctx: Context,
  rootFile: string | undefined,
  runtime: MountsRuntime,
): void {
  ctx.on('agent/created', ({ agent }) => {
    const cwd = agent.session.header.cwd
    // agent/created 是 serial 事件，监听器类型为 `undefined | Promise<undefined>`，故显式返回 undefined。
    if (cwd === undefined) return undefined
    const file = findMcpJson(cwd)
    const workFile = file === undefined || file === rootFile ? undefined : file
    if (workFile !== undefined) {
      console.log(`[dsh-loulan-mcp] 工作区 ${cwd} 发现 .mcp.json，自动挂载`)
    }
    void mountAndRecord(agent, workFile, runtime).catch((error: unknown) => {
      console.error(`[dsh-loulan-mcp] 工作区 ${cwd} 挂载/记录失败:`, error)
    })
  })
}

/**
 * 注册 agent/disposed 监听：清除该 agent 的运行时记录。
 *
 * @param ctx - 插件上下文
 * @param runtime - 挂载运行时
 */
export function registerAgentDisposed(ctx: Context, runtime: MountsRuntime): void {
  ctx.on('agent/disposed', ({ agent }) => {
    runtime.forget(agent.id)
  })
}
