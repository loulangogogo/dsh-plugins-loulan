/**
 * @fileoverview dsh-loulan-mcp 插件入口 —— 生命周期编排。
 *
 * - 启动时：挂载 .dsh 根目录的 .mcp.json（全局共享，不询问），句柄交给运行时。
 * - 端点：以 prefix 路由暴露读取（GET /mounts）、刷新（POST /refresh）、
 *   添加（POST /add）三个动作。
 * - agent 生命周期监听（创建时发现工作区 .mcp.json 即自动挂载、销毁时清理）
 *   封装在 approval.ts 的注册方法中，由 apply() 统一调用；
 *   原「首个对话回合审批询问后挂载」已停用，见 approval.ts 中的注释。
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型副作用：把 ctx.webServer 声明合并到 Context 上（供下方 ctx.inject(['webServer']) 使用）。
import type {} from '@deepseek-ai/dsh-host-webserver'
import { name, Config } from './config.js'
import { findMcpJson, dshHome } from './discover.js'
import { mountFile } from './mount.js'
import { ROUTE_PREFIX } from './contract.js'
import { createMountsRuntime } from './mounts.js'
import { createMountsHandler } from './http.js'
import { registerAgentCreated, registerAgentDisposed } from './approval.js'

export { name, Config }

/** 依赖：仅工具注册表（枚举工具名）为必需；Web 服务器在 apply 内按可选依赖注入。 */
export const inject = ['tools']

/**
 * 插件入口：加载 .mcp.json 中的 MCP server，并注册标签页端点与 agent 生命周期监听。
 *
 * 1. 挂载全局 .dsh 根 .mcp.json 并把句柄交给运行时；
 * 2. 可选注册 prefix 端点（仅在提供 webServer 的 profile 生效）；
 * 3. 注册 agent 生命周期监听（创建时发现工作区 .mcp.json 即自动挂载，不再审批询问）。
 *
 * @param ctx - 插件上下文
 * @param config - 插件配置（cwd 指定 .dsh 根目录）
 */
export async function apply(ctx: Context, config: Config) {
  // 0. 空闲保护需要枚举存活 agent；`agents` 是**可选**依赖：本插件未在 inject 中声明它，
  //    直接读 ctx.agents 会被 cordis 拒绝，故经 ctx.inject 拿到服务后缓存取值函数。
  let listAgents: () => readonly { readonly status: string }[] = () => []
  ctx.inject(['agents'], (scope) => {
    listAgents = () => scope.agents.list()
    scope.effect(() => () => { listAgents = () => [] }, 'dsh-loulan-mcp: agents probe')
  })

  // 1. 同步阶段：确定全局根、建运行时，并**先**订阅生命周期与端点。
  //    全局挂载会 await MCP 子进程启动（stdio 服务握手，可能数秒）；若放在订阅之前，
  //    这段时间内创建的 agent 会漏掉 agent/created 而永不登记（其刷新/添加随即报错）。
  const rootStart = config.cwd || dshHome()
  const runtime = createMountsRuntime({ ctx, resolveGlobalFile: () => findMcpJson(rootStart), listAgents })
  const rootFile = findMcpJson(rootStart)
  registerAgentCreated(ctx, rootFile, runtime)
  registerAgentDisposed(ctx, runtime)

  // 2. 可选：仅提供 webServer 的 profile（Web）才注册端点；
  //    缺失时挂载照常，只是没有「MCP」标签页的数据来源。
  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () => scope.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: createMountsHandler(runtime),
      }),
      'dsh-loulan-mcp: mounts route',
    )
  })

  // 3. 最后才挂全局 .dsh 根 .mcp.json：载荷读取时现算，全局晚挂上不影响已登记的会话。
  const handles = rootFile ? await mountFile(ctx, rootFile) : []
  runtime.seedGlobal(handles)

  // 【已停用】首个对话回合的审批询问（工作区 .mcp.json 现为自动挂载，不再询问）。
  // 如需恢复「询问后挂载」模式：取消下行注释，并在上方 import 中补回 registerAgentRequest，
  // 同时按 approval.ts 中 registerAgentRequest 注释块的恢复步骤还原相关实现。
  // registerAgentRequest(ctx)
}
