/**
 * @fileoverview dsh-loulan-mcp 插件入口 —— 生命周期编排。
 *
 * - 启动时：挂载 .dsh 根目录的 .mcp.json（全局共享，不询问）。
 * - agent 生命周期监听（创建时发现工作区 .mcp.json 即自动挂载、销毁时清理）
 *   封装在 approval.ts 的注册方法中，由 apply() 统一调用；
 *   原「首个对话回合审批询问后挂载」已停用，见 approval.ts 中的注释。
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型副作用：把 ctx.webServer 声明合并到 Context 上（供下方 ctx.inject(['webServer']) 使用）。
import type {} from '@deepseek-ai/dsh-host-webserver'
import { name, Config } from './config.js'
import { findMcpJson, dshHome } from './discover.js'
import { mountFile, buildMountPayload, type MountedServer } from './mount.js'
import { MOUNTS_ROUTE_PATH } from './contract.js'
import { createMountRegistry } from './registry.js'
import { createMountsHandler } from './http.js'
import { registerAgentCreated, registerAgentDisposed } from './approval.js'

export { name, Config }

/** 依赖：仅工具注册表（枚举工具名）为必需；Web 服务器在 apply 内按可选依赖注入。 */
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
 * 2. 可选注册只读端点（客户端按会话拉取已加载服务；仅在提供 webServer 的 profile 生效）；
 * 3. 注册 agent 生命周期监听（创建时发现工作区 .mcp.json 即自动挂载，不再审批询问）。
 *
 * @param ctx - 插件上下文
 * @param config - 插件配置（cwd 指定 .dsh 根目录）
 */
export async function apply(ctx: Context, config: Config) {
  // 1. 启动时：挂载全局 .dsh 根 .mcp.json，并拿到 rootFile（工作区去重）与明细（通知一并列出）。
  const { rootFile, mounts } = await mountGlobalRoot(ctx, config)

  // 2. 可选：仅提供 webServer 的 profile（Web）才注册只读端点；
  //    缺失时挂载照常，只是没有「MCP」标签页的数据来源。
  const registry = createMountRegistry()
  const global = buildMountPayload(mounts, []).global
  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () => scope.webServer.register({
        kind: 'prefix',
        path: MOUNTS_ROUTE_PATH,
        handler: createMountsHandler(registry, global),
      }),
      'dsh-loulan-mcp: mounts route',
    )
  })

  // 3. 注册 agent 生命周期监听：创建时自动挂载工作区 .mcp.json 并写入注册表、销毁时清理。
  registerAgentCreated(ctx, rootFile, mounts, registry)
  registerAgentDisposed(ctx, registry)

  // 【已停用】首个对话回合的审批询问（工作区 .mcp.json 现为自动挂载，不再询问）。
  // 如需恢复「询问后挂载」模式：取消下行注释，并在上方 import 中补回 registerAgentRequest，
  // 同时按 approval.ts 中 registerAgentRequest 注释块的恢复步骤还原相关实现。
  // registerAgentRequest(ctx)
}
