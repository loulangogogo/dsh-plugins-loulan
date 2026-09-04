/**
 * @fileoverview 把 .mcp.json 中的 MCP server 挂载到指定 ctx,并返回挂载明细。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { scopeOf } from '@deepseek-ai/dsh-scope'
// 副作用类型导入:把 ctx.tools 声明合并到 Context 上(工具注册表类型)。
import type {} from '@deepseek-ai/dsh-tools'
import { dirname } from 'node:path'
import { readMcpServers } from './parse.js'
import { mapServer } from './server-name.js'

/** 单个成功挂载的 MCP server 明细,供通知文案使用。 */
export interface MountedServer {
  /** 实际挂载名(工作区挂载时带 agent 唯一后缀)。 */
  serverName: string
  /** .mcp.json 中的原始服务名(不含 agent 唯一后缀),供通知展示。 */
  rawName: string
  /** 传输方式:stdio 子进程或 streamable-http 远程服务。 */
  transport: 'stdio' | 'streamable-http'
  /** 来源 .mcp.json 文件绝对路径。 */
  file: string
  /** 该 server 暴露给模型的工具名(去掉了 mcp__<serverName>__ 前缀)。 */
  tools: string[]
}

/**
 * 枚举某 server 已注册到 ctx.tools 的工具名。
 *
 * mcp-client 以 mcp__<serverName>__<rawName> 注册工具,且 serverName 最长 32 位,
 * 前缀在 64 位截断预算内一定完整保留,故可安全按前缀过滤;去掉前缀后即为展示用工具名。
 *
 * @param ctx - 挂载目标(全局 ctx 或 agent.ctx)
 * @param serverName - 实际挂载名
 * @returns 工具名数组;枚举失败(注册表异常)返回空数组
 */
function toolNamesForServer(ctx: Context, serverName: string): string[] {
  const prefix = `mcp__${serverName}__`
  try {
    return ctx.tools
      .schemas(scopeOf(ctx))
      .map((schema) => schema.name)
      .filter((name) => name.startsWith(prefix))
      .map((name) => name.slice(prefix.length))
  } catch (error) {
    console.warn(`[dsh-loulan-mcp] 枚举 "${serverName}" 工具失败:`, error)
    return []
  }
}

/**
 * 把某个 .mcp.json 文件的 mcpServers 挂载到指定 ctx,返回成功挂载的明细。
 *
 * 解析文件、逐条映射并挂载 mcp-client 实例,统一等待所有实例启动后枚举各 server 工具名。
 * 单个 server 挂载失败不阻断其它 server,也不进入返回结果。
 *
 * @param ctx - 挂载目标:全局 ctx(启动时)或 agent.ctx(工作区,agent 局部)
 * @param file - .mcp.json 文件路径
 * @param uniqueSuffix - 按 agent 派生唯一后缀,透传给 mapServer
 * @returns 成功挂载的 server 明细数组(含工具名)
 */
export async function mountFile(ctx: Context, file: string, uniqueSuffix?: string): Promise<MountedServer[]> {
  let servers: Record<string, unknown>
  try {
    servers = await readMcpServers(file)
  } catch (error) {
    console.error(`[dsh-loulan-mcp] 解析 ${file} 失败:`, error)
    return []
  }

  console.log(`[dsh-loulan-mcp] 应用 ${file}`)
  const projectDir = dirname(file)
  const fibers: { promise: PromiseLike<unknown>; serverName: string; rawName: string; transport: MountedServer['transport'] }[] = []

  for (const [serverName, raw] of Object.entries(servers)) {
    const mapped = mapServer(serverName, raw, projectDir, uniqueSuffix)
    if (!mapped.ok) {
      console.warn(`[dsh-loulan-mcp] ${mapped.reason}`)
      continue
    }
    try {
      const promise = ctx.plugin(mcpClient, mapped.config)
      fibers.push({ promise, serverName: mapped.config.serverName, rawName: serverName, transport: mapped.config.transport })
      console.log(`[dsh-loulan-mcp] 已挂载 MCP server "${mapped.config.serverName}"`)
    } catch (error) {
      console.error(`[dsh-loulan-mcp] 挂载 "${mapped.config.serverName}" 失败:`, error)
    }
  }

  const settled = await Promise.allSettled(fibers.map((f) => f.promise))
  const result: MountedServer[] = []
  settled.forEach((item, index) => {
    if (item.status === 'rejected') {
      console.error('[dsh-loulan-mcp] MCP server 启动失败:', item.reason)
      return
    }
    const { serverName, rawName, transport } = fibers[index]
    result.push({ serverName, rawName, transport, file, tools: toolNamesForServer(ctx, serverName) })
  })
  return result
}
