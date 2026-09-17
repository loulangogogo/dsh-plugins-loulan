/**
 * @fileoverview 把 .mcp.json 中的 MCP server 挂载到指定 ctx,并返回挂载明细。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { scopeOf } from '@deepseek-ai/dsh-scope'
// 副作用类型导入:把 ctx.tools 声明合并到 Context 上(工具注册表类型)。
import type {} from '@deepseek-ai/dsh-tools'
import { dirname } from 'node:path'
import type { McpMountGroup, McpMountedData, McpServerEntry, McpTransport } from './contract.js'
import { readMcpServers } from './parse.js'
import { mapServer } from './server-name.js'

/** 单个成功挂载的 MCP server 明细,供通知文案使用。 */
export interface MountedServer {
  /** 实际挂载名(工作区挂载时带 agent 唯一后缀)。 */
  serverName: string
  /** .mcp.json 中的原始服务名(不含 agent 唯一后缀),供通知展示。 */
  rawName: string
  /** 传输方式:stdio 子进程或 streamable-http 远程服务。 */
  transport: McpTransport
  /** 来源 .mcp.json 文件绝对路径。 */
  file: string
  /** 该 server 暴露给模型的工具名(去掉了 mcp__<serverName>__ 前缀)。 */
  tools: string[]
}

/**
 * 可释放的挂载句柄结构子集。
 *
 * ctx.plugin() 返回的 Fiber 恰好满足本结构（dispose 返回 Promise），
 * 但这里只声明卸载所需的最小能力，避免把 cordis 的完整 Fiber 类型带进契约。
 */
export interface Disposable {
  dispose(): unknown
}

/**
 * 一次成功挂载的完整句柄。
 *
 * configKey 为映射后配置的 JSON 指纹，只用于「刷新」时比较新旧配置是否变更；
 * 其中可能含 env / headers 等敏感内容，因此绝不经 HTTP 端点外发。
 */
export interface MountedHandle {
  /** 展示与通知用的挂载明细（tools 在 settleMounts 后填充）。 */
  mounted: MountedServer
  /** 插件纤维句柄：dispose 即卸载该 server。 */
  fiber: Disposable
  /** 映射后配置的 JSON 指纹（仅内存比较用）。 */
  configKey: string
}

/**
 * 把一组已挂载服务映射为展示分组。
 *
 * 来源文件取组内首个条目的 file：同组条目必然来自同一个 .mcp.json。
 *
 * @param mounts - 同一来源下成功挂载的服务明细
 * @returns 分组（空数组时不含 file）
 */
export function toMountGroup(mounts: readonly MountedServer[]): McpMountGroup {
  const file = mounts[0]?.file
  const servers: McpServerEntry[] = mounts.map(mount => ({
    name: mount.rawName,
    transport: mount.transport,
    tools: mount.tools,
  }))
  return { ...(file === undefined ? {} : { file }), servers }
}

/**
 * 取出一组挂载句柄的展示明细。
 *
 * @param handles - 挂载句柄数组
 * @returns 展示明细数组（顺序与入参一致）
 */
export function handlesToServers(handles: readonly MountedHandle[]): MountedServer[] {
  return handles.map(handle => handle.mounted)
}

/**
 * 组装挂载清单载荷（供 /dsh-loulan-mcp/mounts 端点返回）。
 *
 * @param globalMounts - 全局 .dsh 根已挂载的服务明细
 * @param workMounts - 工作区已挂载的服务明细
 * @param manualMounts - 本会话手动添加的服务明细
 * @returns 分全局、工作区、手动添加三组的载荷
 */
export function buildMountPayload(
  globalMounts: readonly MountedServer[],
  workMounts: readonly MountedServer[],
  manualMounts: readonly MountedServer[],
): McpMountedData {
  return {
    global: toMountGroup(globalMounts),
    workspace: toMountGroup(workMounts),
    manual: toMountGroup(manualMounts),
  }
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
 * 把一组 mcpServers 映射并挂载到指定 ctx,立即返回挂载句柄（不等启动完成）。
 *
 * 单个 server 映射或挂载失败不阻断其它 server，也不进入返回结果。
 * 调用方随后应把句柄交给 settleMounts 等待启动并补全工具名。
 *
 * @param ctx - 挂载目标:全局 ctx(启动时)或 agent.ctx(工作区/手动,agent 局部)
 * @param servers - mcpServers 映射（服务名 → 原始配置）
 * @param source - 来源标识（.mcp.json 路径或上传文件名），写入明细的 file 字段
 * @param projectDir - stdio 子进程默认 cwd（.mcp.json 所在目录或会话工作区目录）
 * @param uniqueSuffix - 按 agent 派生唯一后缀,透传给 mapServer
 * @returns 成功挂载的句柄数组（tools 暂为空）
 */
export function mountServers(
  ctx: Context,
  servers: Record<string, unknown>,
  source: string,
  projectDir: string,
  uniqueSuffix?: string,
): MountedHandle[] {
  console.log(`[dsh-loulan-mcp] 应用 ${source}`)
  const handles: MountedHandle[] = []
  for (const [serverName, raw] of Object.entries(servers)) {
    const mapped = mapServer(serverName, raw, projectDir, uniqueSuffix)
    if (!mapped.ok) {
      console.warn(`[dsh-loulan-mcp] ${mapped.reason}`)
      continue
    }
    try {
      const fiber = ctx.plugin(mcpClient, mapped.config)
      handles.push({
        mounted: {
          serverName: mapped.config.serverName,
          rawName: serverName,
          transport: mapped.config.transport,
          file: source,
          tools: [],
        },
        fiber,
        configKey: JSON.stringify(mapped.config),
      })
      console.log(`[dsh-loulan-mcp] 已挂载 MCP server "${mapped.config.serverName}"`)
    } catch (error) {
      console.error(`[dsh-loulan-mcp] 挂载 "${mapped.config.serverName}" 失败:`, error)
    }
  }
  return handles
}

/**
 * 等待一组挂载句柄的 fiber 启动完成，并为成功者枚举工具名。
 *
 * 启动失败的句柄被丢弃（不进入返回值），与「单个失败不阻断其它」的既有语义一致。
 *
 * @param ctx - 挂载目标（用于枚举 ctx.tools 中的工具名）
 * @param handles - mountServers 返回的句柄数组
 * @returns 启动成功的句柄数组（mounted.tools 已填充）
 */
export async function settleMounts(ctx: Context, handles: MountedHandle[]): Promise<MountedHandle[]> {
  const settled = await Promise.allSettled(handles.map(handle => handle.fiber))
  const result: MountedHandle[] = []
  settled.forEach((item, index) => {
    if (item.status === 'rejected') {
      console.error('[dsh-loulan-mcp] MCP server 启动失败:', item.reason)
      return
    }
    const handle = handles[index]
    result.push({
      ...handle,
      mounted: { ...handle.mounted, tools: toolNamesForServer(ctx, handle.mounted.serverName) },
    })
  })
  return result
}

/**
 * 把某个 .mcp.json 文件的 mcpServers 挂载到指定 ctx,返回启动成功的挂载句柄。
 *
 * 解析文件、逐条映射并挂载 mcp-client 实例,统一等待所有实例启动后枚举各 server 工具名。
 * 单个 server 挂载失败不阻断其它 server,也不进入返回结果。
 *
 * @param ctx - 挂载目标:全局 ctx(启动时)或 agent.ctx(工作区,agent 局部)
 * @param file - .mcp.json 文件路径
 * @param uniqueSuffix - 按 agent 派生唯一后缀,透传给 mapServer
 * @returns 成功挂载的句柄数组(含工具名);读文件失败返回空数组
 */
export async function mountFile(ctx: Context, file: string, uniqueSuffix?: string): Promise<MountedHandle[]> {
  let servers: Record<string, unknown>
  try {
    servers = await readMcpServers(file)
  } catch (error) {
    console.error(`[dsh-loulan-mcp] 解析 ${file} 失败:`, error)
    return []
  }
  return settleMounts(ctx, mountServers(ctx, servers, file, dirname(file), uniqueSuffix))
}
