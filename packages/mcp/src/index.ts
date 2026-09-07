/**
 * @fileoverview dsh-loulan-mcp 插件入口 —— 生命周期编排。
 *
 * - 启动时：挂载 .dsh 根目录的 .mcp.json（全局共享，不询问）。
 * - agent 生命周期监听（创建时发现工作区 .mcp.json 即自动挂载、销毁时清理）
 *   封装在 approval.ts 的注册方法中，由 apply() 统一调用；
 *   原「首个对话回合审批询问后挂载」已停用，见 approval.ts 中的注释。
 */
import type { Context } from '@deepseek-ai/cordis'
import { name, Config } from './config.js'
import { findMcpJson, dshHome } from './discover.js'
import { mountFile, type MountedServer } from './mount.js'
import { registerAgentCreated, registerAgentDisposed } from './approval.js'

export { name, Config }

/** 声明对工具注册表服务（tools）的依赖：挂载完成后需访问 ctx.tools 枚举各 server 的工具名。 */
export const inject = ['tools']

/**
 * 挂载 .dsh 根目录的全局 .mcp.json（所有 agent 共享，不询问）。
 *
 * @param ctx - 插件上下文
 * @param config - 插件配置（cwd 指定 .dsh 根目录）
 * @returns 命中的全局 .mcp.json 绝对路径与已挂载明细；未命中时 rootFile 为 undefined、mounts 为空数组
 */
async function mountGlobalRoot(ctx: Context, config: Config): Promise<{ rootFile: string | undefined; mounts: MountedServer[] }> {
  const rootStart = config.cwd || dshHome()
  const rootFile = findMcpJson(rootStart)
  const mounts = rootFile ? await mountFile(ctx, rootFile) : []
  return { rootFile, mounts }
}

/**
 * 插件入口：按生命周期分离加载 .mcp.json 中的 MCP server。
 *
 * 1. 挂载全局 .dsh 根 .mcp.json；
 * 2. 注册 agent 生命周期监听（创建时发现工作区 .mcp.json 即自动挂载，不再审批询问）。
 *
 * @param ctx - 插件上下文
 * @param config - 插件配置（cwd 指定 .dsh 根目录）
 */
export async function apply(ctx: Context, config: Config) {
  // 1. 启动时：挂载全局 .dsh 根 .mcp.json，并拿到 rootFile（工作区去重）与明细（通知一并列出）。
  const { rootFile, mounts } = await mountGlobalRoot(ctx, config)

  // 2. 注册 agent 生命周期监听：创建时自动挂载工作区 .mcp.json、销毁时清理。
  registerAgentCreated(ctx, rootFile, mounts)
  registerAgentDisposed(ctx)

  // 【已停用】首个对话回合的审批询问（工作区 .mcp.json 现为自动挂载，不再询问）。
  // 如需恢复「询问后挂载」模式：取消下行注释，并在上方 import 中补回 registerAgentRequest，
  // 同时按 approval.ts 中 registerAgentRequest 注释块的恢复步骤还原相关实现。
  // registerAgentRequest(ctx)
}
