/**
 * @fileoverview 把 .mcp.json 中的 MCP server 挂载到指定 ctx。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { dirname } from 'node:path'
import { readMcpServers } from './parse.js'
import { mapServer } from './server-name.js'

/**
 * 把某个 .mcp.json 文件的 mcpServers 挂载到指定 ctx。
 *
 * 解析文件、逐条映射并挂载 mcp-client 实例，最后统一等待所有实例启动。
 * 单个 server 挂载失败不阻断其它 server。
 *
 * @param ctx - 挂载目标：全局 ctx（启动时）或 agent.ctx（工作区，agent 局部）
 * @param file - .mcp.json 文件路径
 * @param uniqueSuffix - 方案 B：按 agent 派生唯一后缀，透传给 mapServer
 */
export async function mountFile(ctx: Context, file: string, uniqueSuffix?: string): Promise<void> {
  let servers: Record<string, unknown>
  try {
    servers = await readMcpServers(file)
  } catch (error) {
    console.error(`[dsh-loulan-mcp] 解析 ${file} 失败:`, error)
    return
  }

  console.log(`[dsh-loulan-mcp] 应用 ${file}`)
  const projectDir = dirname(file)
  const fibers: PromiseLike<unknown>[] = []

  for (const [serverName, raw] of Object.entries(servers)) {
    const mapped = mapServer(serverName, raw, projectDir, uniqueSuffix)
    if (!mapped.ok) {
      console.warn(`[dsh-loulan-mcp] ${mapped.reason}`)
      continue
    }
    try {
      const fiber = ctx.plugin(mcpClient, mapped.config)
      fibers.push(fiber)
      console.log(`[dsh-loulan-mcp] 已挂载 MCP server "${mapped.config.serverName}"`)
    } catch (error) {
      console.error(`[dsh-loulan-mcp] 挂载 "${mapped.config.serverName}" 失败:`, error)
    }
  }

  const settled = await Promise.allSettled(fibers)
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.error('[dsh-loulan-mcp] MCP server 启动失败:', result.reason)
    }
  }
}
