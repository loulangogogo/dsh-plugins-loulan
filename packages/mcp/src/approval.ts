/**
 * @fileoverview 工作区 .mcp.json 的自动挂载。
 *
 * - agent 创建时（agent/created）发现工作区 .mcp.json（与全局 .dsh 根命中同一
 *   文件则跳过），即自动挂载到该 agent，无需用户询问；agent 销毁时随
 *   agent.ctx 作用域自动卸载。
 * - 原「首个对话回合经 ApprovalService 审批后挂载」的询问实现已停用：
 *   registerAgentRequest 以注释形式整体保留在下方；askForApproval 与决定状态
 *   Map 保留导出，供既有测试与日后恢复询问模式使用。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// 仅引入 dsh-agent 的事件类型声明（agent/created、agent/disposed、agent/request），确保 ctx.on 类型推断。
import type {} from '@deepseek-ai/dsh-agent'
import { findMcpJson } from './discover.js'
import { agentToken } from './server-name.js'
import { mountFile, type MountedHandle } from './mount.js'
import type { MountsRuntime } from './mounts.js'

/** 单个 agent 的挂载决定状态。 */
export type AgentDecision = 'pending' | 'approved' | 'rejected'

/** 待挂载的工作区信息（仅记录 .mcp.json 路径，服务列表在首个 turn 读取）。 */
export interface PendingWork {
  /** .mcp.json 绝对路径。 */
  file: string
}

// 进程内记住每个 agent 的决定与待挂载信息（本次运行期间生效）。
// 注意：自动挂载后生产流程不再写入这两个 Map（registerAgentCreated 已不再登记
// pending），仅 registerAgentDisposed 兜底清理；保留导出供既有测试与日后恢复
// 询问模式使用。
const decisions = new Map<string, AgentDecision>()
const pendingWorks = new Map<string, PendingWork>()

/** 读取某 agent 的当前决定；未决定返回 undefined。 */
export function decisionFor(agentId: string): AgentDecision | undefined {
  return decisions.get(agentId)
}

/** 记录某 agent 的决定。 */
export function setDecision(agentId: string, decision: AgentDecision): void {
  decisions.set(agentId, decision)
}

/** 清除某 agent 的决定（agent 销毁时）。 */
export function clearDecision(agentId: string): void {
  decisions.delete(agentId)
}

/** 读取某 agent 的待挂载信息；无则返回 undefined。 */
export function pendingOf(agentId: string): PendingWork | undefined {
  return pendingWorks.get(agentId)
}

/** 记录某 agent 的待挂载信息。 */
export function setPending(agentId: string, work: PendingWork): void {
  pendingWorks.set(agentId, work)
}

/** 清除某 agent 的待挂载信息。 */
export function clearPending(agentId: string): void {
  pendingWorks.delete(agentId)
}

/** 审批请求使用的合成 toolName（说明这是"挂载 MCP 服务"而非一个具体工具）。 */
const APPROVAL_TOOL_NAME = 'dsh-loulan-mcp:mount'

/**
 * 【已停用】在 open turn 内征求用户是否挂载工作区的 MCP 服务。
 *
 * 自动挂载后不再被调用（registerAgentRequest 的询问流程已注释停用）。
 * 本函数保留导出（含既有单测引用），供日后恢复「询问后挂载」模式时使用。
 *
 * @param ctx - 插件上下文，用于读取审批服务（ctx.get('approval')）
 * @param agent - 发起请求的 agent（审批 UI 路由与审计的目标）
 * @param file - 待挂载的 .mcp.json 路径（用于日志）
 * @param servers - 解析出的 mcpServers 映射（用于列出待挂载服务）
 * @returns 'approved'（同意，调用方应挂载）或 'rejected'（拒绝/取消/无审批通道，不挂载）
 */
export async function askForApproval(
  ctx: Context,
  agent: Agent,
  file: string,
  servers: Record<string, unknown>,
): Promise<AgentDecision> {
  const approval = ctx.get('approval')
  if (approval === undefined) {
    console.warn(`[dsh-loulan-mcp] 无审批服务(approval)，fail-closed：不挂载 ${file}`)
    return 'rejected'
  }
  const list = Object.keys(servers).map((n) => `- ${n}`).join('\n')
  const reason = `工作区发现以下 MCP 服务，是否挂载？\n${list}`
  try {
    const outcome = await approval.request({ agent, toolName: APPROVAL_TOOL_NAME, reason })
    return outcome === 'allowed-once' ? 'approved' : 'rejected'
  } catch (error) {
    console.error(`[dsh-loulan-mcp] 审批失败，不挂载 ${file}:`, error)
    return 'rejected'
  }
}

/**
 * 挂载工作区 .mcp.json 并写入运行时记录。
 *
 * 全程静默：不向会话日志追加事件、不产生通知卡片；运行时记录供 HTTP 端点读取。
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
  mount: (ctx: Context, file: string, suffix?: string) => Promise<MountedHandle[]> = mountFile,
): Promise<void> {
  const handles = file === undefined ? [] : await mount(agent.ctx, file, agentToken(agent.id))
  runtime.track(agent, file, handles)
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
    if (cwd === undefined) return
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
 * 注册 agent/disposed 监听：清除该 agent 的决定、待挂载信息与运行时记录。
 *
 * @param ctx - 插件上下文
 * @param runtime - 挂载运行时
 */
export function registerAgentDisposed(ctx: Context, runtime: MountsRuntime): void {
  ctx.on('agent/disposed', ({ agent }) => {
    clearDecision(agent.id)
    clearPending(agent.id)
    runtime.forget(agent.id)
  })
}

/**
 * 【已停用】注册 agent/request 监听：首个对话回合经审批后挂载。
 *
 * 自动挂载后工作区 .mcp.json 已在 agent 创建时挂载（见 registerAgentCreated），
 * 不再需要审批询问，故本函数整体注释停用；下方逐行保留原实现，供日后恢复
 * 「询问后挂载」模式。恢复步骤：
 *   1. 取消本注释块，并在 registerAgentCreated 中恢复「登记待决定」的旧逻辑
 *      （decisionFor/setDecision/setPending）；
 *   2. 在文件头部 import 中补回 readMcpServers；
 *   3. 在 index.ts 中取消 registerAgentRequest 的 import 与调用注释。
 *
 * export function registerAgentRequest(ctx: Context): void {
 *   ctx.on('agent/request', ({ agent }, next) => {
 *     const work = pendingOf(agent.id)
 *     if (decisionFor(agent.id) !== 'pending' || work === undefined) return next()
 *     // 同步清除 pending（标记"询问中"），防止 agent/request 重入导致重复询问/重复挂载。
 *     clearPending(agent.id)
 *     return (async () => {
 *       // 在此处（首个 turn）异步读取服务列表，避免在 agent/created 阶段异步造成的竞态。
 *       let servers: Record<string, unknown>
 *       try {
 *         servers = await readMcpServers(work.file)
 *       } catch (error) {
 *         console.error(`[dsh-loulan-mcp] 解析 ${work.file} 失败，不挂载:`, error)
 *         setDecision(agent.id, 'rejected')
 *         return next()
 *       }
 *       if (Object.keys(servers).length === 0) {
 *         console.log(`[dsh-loulan-mcp] ${work.file} 无 MCP 服务，跳过`)
 *         setDecision(agent.id, 'rejected')
 *         return next()
 *       }
 *       const decision = await askForApproval(ctx, agent, work.file, servers)
 *       setDecision(agent.id, decision)
 *       if (decision === 'approved') {
 *         console.log(`[dsh-loulan-mcp] 已同意，挂载 ${work.file}`)
 *         void mountFile(agent.ctx, work.file, agentToken(agent.id))
 *       } else {
 *         console.log(`[dsh-loulan-mcp] 未同意，跳过挂载 ${work.file}`)
 *       }
 *       return next()
 *     })()
 *   })
 * }
 */
