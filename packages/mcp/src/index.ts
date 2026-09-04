/**
 * @fileoverview dsh-loulan-mcp 插件入口 —— 生命周期编排。
 *
 * - 启动时：挂载 .dsh 根目录的 .mcp.json（全局共享，不询问）。
 * - agent 生命周期监听（创建时探测、销毁时清理、首个对话回合审批挂载）
 *   封装在 approval.ts 的注册方法中，由 apply() 统一调用。
 */
import type { Context } from '@deepseek-ai/cordis'
import { name, Config } from './config.js'
import { findMcpJson, dshHome } from './discover.js'
import { mountFile } from './mount.js'
import { registerAgentCreated, registerAgentDisposed, registerAgentRequest } from './approval.js'

export { name, Config }

/**
 * 挂载 .dsh 根目录的全局 .mcp.json（所有 agent 共享，不询问）。
 *
 * @param ctx - 插件上下文
 * @param config - 插件配置（cwd 指定 .dsh 根目录）
 * @returns 命中的全局 .mcp.json 绝对路径；不存在返回 undefined（供工作区监听去重跳过）
 */
async function mountGlobalRoot(ctx: Context, config: Config): Promise<string | undefined> {
  const rootStart = config.cwd || dshHome()
  const rootFile = findMcpJson(rootStart)
  if (rootFile) {
    await mountFile(ctx, rootFile)
  }
  return rootFile
}

/**
 * 插件入口：按生命周期分离加载 .mcp.json 中的 MCP server。
 *
 * 1. 挂载全局 .dsh 根 .mcp.json；
 * 2. 注册 agent 生命周期监听（工作区探测 → 审批 → 挂载）。
 *
 * @param ctx - 插件上下文
 * @param config - 插件配置（cwd 指定 .dsh 根目录）
 */
export async function apply(ctx: Context, config: Config) {
  // 1. 启动时：挂载全局 .dsh 根 .mcp.json，并拿到 rootFile 供工作区去重。
  const rootFile = await mountGlobalRoot(ctx, config)

  // 2. 注册 agent 生命周期监听（创建/销毁/请求审批挂载）。
  registerAgentCreated(ctx, rootFile)
  registerAgentDisposed(ctx)
  registerAgentRequest(ctx)
}
