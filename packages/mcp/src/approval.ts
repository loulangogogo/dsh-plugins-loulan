/**
 * @fileoverview 工作区 MCP 挂载前的用户审批。
 *
 * 在 agent 的首个对话 turn 调用 DSH 的 ApprovalService 征求用户同意：
 * 同意则挂载，拒绝/取消/不可用则不挂载。同一 agent 只询问一次，本次运行期间记住。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

/** 单个 agent 的挂载决定状态。 */
export type AgentDecision = 'pending' | 'approved' | 'rejected'

/** 待挂载的工作区信息（仅记录 .mcp.json 路径，服务列表在首个 turn 读取）。 */
export interface PendingWork {
  /** .mcp.json 绝对路径。 */
  file: string
}

// 进程内记住每个 agent 的决定与待挂载信息（本次运行期间生效）。
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
 * 在 open turn 内征求用户是否挂载工作区的 MCP 服务。
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
