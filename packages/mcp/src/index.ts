/**
 * @fileoverview dsh-loulan-mcp 插件入口 —— 生命周期编排。
 *
 * - 启动时：挂载 .dsh 根目录的 .mcp.json（全局共享，不询问）。
 * - agent 创建时：探测工作区 .mcp.json，若存在则同步标记"待决定"，不立即挂载；
 *   在该 agent 的首个对话 turn（agent/request）读取服务列表并征求同意，
 *   同意后按方案 B 的唯一 serverName 挂载；拒绝/取消/不可用则不挂载。
 */
import type { Context } from '@deepseek-ai/cordis'
// 仅引入 dsh-agent 的事件类型声明（agent/created、agent/request、agent/disposed），不引入运行时代码。
import type {} from '@deepseek-ai/dsh-agent'
import { name, Config } from './config.js'
import { findMcpJson, dshHome } from './discover.js'
import { readMcpServers } from './parse.js'
import { agentToken } from './server-name.js'
import { mountFile } from './mount.js'
import {
  decisionFor,
  setDecision,
  clearDecision,
  pendingOf,
  setPending,
  clearPending,
  askForApproval,
} from './approval.js'

export { name, Config }

/**
 * 插件入口：按生命周期分离加载 .mcp.json 中的 MCP server。
 *
 * @param ctx - 插件上下文
 * @param config - 插件配置（cwd 指定 .dsh 根目录）
 */
export async function apply(ctx: Context, config: Config) {
  // 起点：.dsh 根目录（启动时全局加载）。
  const rootStart = config.cwd || dshHome()
  const rootFile = findMcpJson(rootStart)

  // 1. 启动时：在全局 ctx 上挂载 .dsh 根目录的 .mcp.json（所有 agent 共享，不询问）。
  if (rootFile) {
    await mountFile(ctx, rootFile)
  } else {
    console.log(`[dsh-loulan-mcp] 在 ${rootStart} 及其父目录未找到 .mcp.json，跳过全局 MCP 引入`)
  }

  // 2. agent 创建时：探测工作区 .mcp.json，同步标记"待决定"（不立即挂载、不读取内容）。
  ctx.on('agent/created', ({ agent }) => {
    const cwd = agent.session.header.cwd
    console.log(`[dsh-loulan-mcp] 尝试为工作区 ${cwd} 挂载 .mcp.json`)
    if (cwd === undefined) return
    const file = findMcpJson(cwd)
    if (file === undefined || file === rootFile) return
    // 同步登记，消除 agent/created 与首个 agent/request 之间的竞态窗口。
    setDecision(agent.id, 'pending')
    setPending(agent.id, { file })
  })

  // 3. agent 销毁时：清除其决定与待挂载信息。
  ctx.on('agent/disposed', ({ agent }) => {
    clearDecision(agent.id)
    clearPending(agent.id)
  })

  // 4. 首个对话 turn（agent/request 瀑布点，open turn）：读取服务列表并征求挂载同意。
  ctx.on('agent/request', ({ agent }, next) => {
    const work = pendingOf(agent.id)
    if (decisionFor(agent.id) !== 'pending' || work === undefined) return next()
    return (async () => {
      // 在此处（首个 turn）异步读取服务列表，避免在 agent/created 阶段异步造成的竞态。
      let servers: Record<string, unknown>
      try {
        servers = await readMcpServers(work.file)
      } catch (error) {
        console.error(`[dsh-loulan-mcp] 解析 ${work.file} 失败，不挂载:`, error)
        setDecision(agent.id, 'rejected')
        clearPending(agent.id)
        return next()
      }
      if (Object.keys(servers).length === 0) {
        console.log(`[dsh-loulan-mcp] ${work.file} 无 MCP 服务，跳过`)
        setDecision(agent.id, 'rejected')
        clearPending(agent.id)
        return next()
      }
      const decision = await askForApproval(ctx, agent, work.file, servers)
      setDecision(agent.id, decision)
      clearPending(agent.id)
      if (decision === 'approved') {
        console.log(`[dsh-loulan-mcp] 已同意，挂载 ${work.file}`)
        void mountFile(agent.ctx, work.file, agentToken(agent.id))
      } else {
        console.log(`[dsh-loulan-mcp] 未同意，跳过挂载 ${work.file}`)
      }
      return next()
    })()
  })
}
