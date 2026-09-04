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
import { mountFile, type MountedServer } from './mount.js'
import { buildMountNotice, announceMountNotice } from './notify.js'

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
 * 挂载工作区 .mcp.json 并在会话尚未开始时输出可见通知。
 *
 * 挂载失败/无成功服务、会话已有消息、或文案为空时不输出。
 * mount 参数可注入桩，便于单测。
 *
 * @param agent - 目标 agent
 * @param file - 工作区 .mcp.json 绝对路径
 * @param globalMounts - 全局 .dsh 根已挂载的服务明细（用于一并列出）
 * @param mount - 挂载实现（默认 mountFile）
 */
export async function mountAndNotify(
  agent: Agent,
  file: string,
  globalMounts: MountedServer[],
  mount: (ctx: Context, file: string, suffix?: string) => Promise<MountedServer[]> = mountFile,
): Promise<void> {
  const work = await mount(agent.ctx, file, agentToken(agent.id))
  if (work.length === 0) return
  // 会话已经开始对话则不再输出（防 resume 重复、防迟到打断）。
  if (agent.session.surface.nodes.length !== 0) return
  const text = buildMountNotice(globalMounts, work)
  if (text === undefined) return
  announceMountNotice(agent, text, `已自动挂载 ${work.length} 个 MCP 服务`)
}

/**
 * 注册 agent/created 监听：探测工作区 .mcp.json，命中即自动挂载（不询问）。
 *
 * 与全局 .dsh 根命中同一文件（rootFile）则跳过，避免重复挂载。
 * 挂载为 fire-and-forget：created 监听器异步失败仅被 harness 告警收纳、
 * 不阻断 agent 创建；agent 销毁时挂载随 agent.ctx 作用域自动卸载，无需在此清理。
 *
 * @param ctx - 插件上下文
 * @param rootFile - 全局 .dsh 根的 .mcp.json 路径（命中则跳过，避免与全局重复）
 * @param globalMounts - 全局 .dsh 根已挂载的服务明细（用于通知一并列出）
 */
export function registerAgentCreated(ctx: Context, rootFile: string | undefined, globalMounts: MountedServer[]): void {
  ctx.on('agent/created', ({ agent }) => {
    const cwd = agent.session.header.cwd
    if (cwd === undefined) return
    const file = findMcpJson(cwd)
    if (file === undefined || file === rootFile) return

    // 当前实现：发现工作区 .mcp.json 即自动挂载，并在会话未开始时注入可见通知。
    console.log(`[dsh-loulan-mcp] 工作区 ${cwd} 发现 .mcp.json，自动挂载`)
    void mountAndNotify(agent, file, globalMounts).catch((error: unknown) => {
      console.error(`[dsh-loulan-mcp] 工作区 ${cwd} 挂载/通知失败:`, error)
    })

    // === 旧实现（登记"待决定"，配合 agent/request 审批询问后挂载），已停用，保留供恢复 ===
    // console.log(`[dsh-loulan-mcp] 尝试为工作区 ${cwd} 挂载 .mcp.json`)
    // if (decisionFor(agent.id) !== undefined) return
    // setDecision(agent.id, 'pending')
    // setPending(agent.id, { file })
    // ============================================================================
  })
}

/**
 * 注册 agent/disposed 监听：清除该 agent 的决定与待挂载信息。
 *
 * @param ctx - 插件上下文
 */
export function registerAgentDisposed(ctx: Context): void {
  ctx.on('agent/disposed', ({ agent }) => {
    clearDecision(agent.id)
    clearPending(agent.id)
  })
}

/**
 * 【已停用】注册 agent/request 监听：首个对话回合经审批后挂载。
 *
 * 自动挂载后工作区 .mcp.json 已在 agent 创建时挂载（见 registerAgentCreated），
 * 不再需要审批询问，故本函数整体注释停用；下方逐行保留原实现，供日后恢复
 * 「询问后挂载」模式。恢复步骤：
 *   1. 取消本注释块，并恢复 registerAgentCreated 函数体中登记的旧逻辑（见其行内注释）；
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
