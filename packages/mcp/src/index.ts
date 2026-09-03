/**
 * @fileoverview loulan-mcp 插件 —— 自动应用 .mcp.json 引入 MCP server。
 *
 * 按生命周期分离加载：
 *   - 启动时：从 .dsh 根目录（config.cwd，默认 $DSH_HOME 或 ~/.dsh）向上查找
 *     .mcp.json，挂载到全局 ctx（所有 agent 共享）；
 *   - agent 创建时：从该 agent 的 session.header.cwd（工作区根目录）向上查找
 *     .mcp.json，挂载到 agent.ctx（只对该工作区的 agent 可见，销毁时自动卸载）。
 *
 * 挂载规则（见 mapServer）：
 *   - 有 command 的条目 → stdio 传输；
 *   - 有 url（或 type 为 http/sse/streamable-http）的条目 → streamable-http 传输。
 * 工具以 mcp__<serverName>__<tool> 的形式暴露给模型。
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
// 仅引入 dsh-agent 的事件类型声明（agent/created），不引入运行时代码。
import type {} from '@deepseek-ai/dsh-agent'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** 插件名，须与 cordis.yml 中的 id 对应。 */
export const name = 'loulan-mcp'

/**
 * 插件配置。
 *
 * 工作区部分无需配置：随 agent 的 session.header.cwd 动态发现。
 */
export interface Config {
  /** .dsh 根目录（启动时全局加载 .mcp.json 的起点）；默认 $DSH_HOME 或 ~/.dsh。 */
  cwd: string
}

/** 配置 Schema：cwd 默认空串，空串时回退到 $DSH_HOME / ~/.dsh。 */
export const Config: Schema<Config> = Schema.object({
  cwd: Schema.string().default(''),
})

/** serverName 命名约束，与 mcp-client 保持一致（字母/数字/下划线/短横线，1-32 位）。 */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** mcp-client 默认的单次工具调用超时（毫秒）：60 秒。 */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/**
 * 判断一个值是否为普通对象（非 null、非数组）。
 *
 * 用于对 .mcp.json 解析结果做防御式校验，避免把数组/null 误当作配置对象。
 *
 * @param value - 待判断的任意值
 * @returns 值为普通对象时返回 true，否则 false
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 从任意值中提取字符串数组，过滤掉非字符串元素。
 *
 * 用于解析 .mcp.json 中 stdio 条目的 args 字段（可能缺失或含非字符串）。
 *
 * @param value - 待解析的任意值（期望是数组）
 * @returns 仅含字符串元素的数组；非数组或无法解析时返回空数组
 */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * 从任意值中提取字符串键值对，过滤掉非字符串值。
 *
 * 用于解析 .mcp.json 中 stdio 条目的 env、http 条目的 headers 字段。
 *
 * @param value - 待解析的任意值（期望是对象）
 * @returns 仅含字符串值的键值对对象；非对象或无法解析时返回空对象
 */
function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  // 只保留值为字符串的键值对，其余类型直接丢弃（防御式解析）。
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item
  }
  return result
}

/**
 * 从 start 目录开始向上逐级查找最近的 .mcp.json。
 *
 * 典型场景：从工作区根目录或 .dsh 根目录向上，找到项目级/全局的 .mcp.json。
 *
 * @param start - 起始目录（绝对或相对路径均可，内部会 resolve）
 * @returns 找到的 .mcp.json 绝对路径；向上直到文件系统根仍无则返回 undefined
 */
function findMcpJson(start: string): string | undefined {
  let dir = resolve(start)
  const candidate = join(dir, '.mcp.json')
  if (existsSync(candidate)) return candidate
  else return undefined

  // 无限循环逐级向上，直到命中文件或到达根目录（parent === dir）。
  // for (;;) {
  //   const candidate = join(dir, '.mcp.json')
  //   if (existsSync(candidate)) return candidate
  //   const parent = dirname(dir)
  //   // dirname 到达文件系统根后不再变化，据此终止循环。
  //   if (parent === dir) return undefined
  //   dir = parent
  // }
}

/**
 * 确定 DSH home 目录。
 *
 * 优先使用环境变量 $DSH_HOME，缺省时回退到 ~/.dsh。
 *
 * @returns DSH home 目录路径（如 /Users/<name>/.dsh）
 */
function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** mapServer 的返回类型：成功携带 mcp-client 配置，失败携带原因。 */
type Mapped =
  | { ok: true; config: McpClientConfig }
  | { ok: false; reason: string }

/**
 * 把 .mcp.json 的一条 mcpServers 条目映射为 mcp-client 配置。
 *
 * 映射规则：
 *   - 有 command → stdio 传输（本进程拉起子进程）；
 *   - 有 url → streamable-http 传输；
 *   - 两者皆无 → 视为无效条目，返回失败原因。
 *
 * @param serverName - 服务名（须匹配 SERVER_NAME_PATTERN）
 * @param raw - 该条目的原始配置值（期望是对象）
 * @param projectDir - 该 .mcp.json 所在目录，作为 stdio 子进程的默认 cwd
 * @returns 成功时携带 mcp-client 配置；失败时携带原因
 */
function mapServer(serverName: string, raw: unknown, projectDir: string): Mapped {
  // 1. 校验服务名：不合法直接拒绝，避免污染工具命名空间。
  if (!SERVER_NAME_PATTERN.test(serverName)) {
    return { ok: false, reason: `serverName 不合法（需匹配 [A-Za-z0-9_-]{1,32}）: "${serverName}"` }
  }
  // 2. 校验条目结构：必须是普通对象。
  if (!isRecord(raw)) {
    return { ok: false, reason: `配置必须是对象: "${serverName}"` }
  }

  // 3. 提取 command / url 字段（仅字符串形式有效）。
  const command = typeof raw.command === 'string' ? raw.command : undefined
  const url = typeof raw.url === 'string' ? raw.url : undefined

  // 4. stdio：有 command 时按子进程方式拉起。
  if (command) {
    return {
      ok: true,
      config: {
        transport: 'stdio',
        serverName,
        command,
        args: asStringArray(raw.args),
        env: asStringRecord(raw.env),
        // stdio 子进程默认工作目录 = .mcp.json 所在目录，可被条目内 cwd 覆盖。
        cwd: typeof raw.cwd === 'string' ? raw.cwd : projectDir,
        toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
        failOnStartupError: false,
      },
    }
  }

  // 5. streamable-http：有 url 时按远程服务连接。
  if (url) {
    return {
      ok: true,
      config: {
        transport: 'streamable-http',
        serverName,
        url,
        headers: asStringRecord(raw.headers),
        toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
        failOnStartupError: false,
      },
    }
  }

  // 6. 既无 command 也无 url：无法确定传输方式，视为无效条目。
  return { ok: false, reason: `既没有 command（stdio）也没有 url（http），已跳过: "${serverName}"` }
}

/**
 * 把某个 .mcp.json 文件的 mcpServers 挂载到指定 ctx。
 *
 * 解析文件、逐条映射并挂载 mcp-client 实例，最后统一等待所有实例启动。
 * 单个 server 挂载失败不阻断其它 server。
 *
 * @param ctx - 挂载目标：全局 ctx（启动时）或 agent.ctx（工作区，agent 局部）
 * @param file - .mcp.json 文件路径
 */
async function mountFile(ctx: Context, file: string): Promise<void> {
  let doc: unknown
  // 1. 读取并解析 JSON，失败则跳过该文件（不阻断整体）。
  try {
    doc = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    console.error(`[loulan-mcp] 解析 ${file} 失败:`, error)
    return
  }

  console.log(`[loulan-mcp] 应用 ${file}`)
  // 2. 提取 mcpServers（缺失或非对象时视为空）。
  const servers = isRecord(doc) && isRecord(doc.mcpServers) ? doc.mcpServers : {}
  // stdio 子进程的默认 cwd = 该 .mcp.json 所在目录。
  const projectDir = dirname(file)
  const fibers: PromiseLike<unknown>[] = []

  // 3. 逐条映射并挂载，失败的条目仅告警跳过。
  for (const [serverName, raw] of Object.entries(servers)) {
    const mapped = mapServer(serverName, raw, projectDir)
    if (!mapped.ok) {
      console.warn(`[loulan-mcp] ${mapped.reason}`)
      continue
    }
    try {
      // ctx.plugin 返回 fiber，异步完成 mcp-client 的连接与工具发现。
      const fiber = ctx.plugin(mcpClient, mapped.config)
      fibers.push(fiber)
      console.log(`[loulan-mcp] 已挂载 MCP server "${serverName}"`)
    } catch (error) {
      console.error(`[loulan-mcp] 挂载 "${serverName}" 失败:`, error)
    }
  }

  // 4. 统一等待所有挂载结算，报告异步启动失败。
  const settled = await Promise.allSettled(fibers)
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.error('[loulan-mcp] MCP server 启动失败:', result.reason)
    }
  }
}

/**
 * 插件入口：按生命周期分离加载 .mcp.json 中的 MCP server。
 *
 * 1. 启动时（全局）：挂载 .dsh 根目录的 .mcp.json；
 * 2. agent 创建时（工作区，agent 局部）：挂载该 agent 工作区的 .mcp.json。
 *
 * @param ctx - 插件上下文
 * @param config - 插件配置（cwd 指定 .dsh 根目录）
 */
export async function apply(ctx: Context, config: Config) {
  // 起点：.dsh 根目录（启动时全局加载）。
  const rootStart = config.cwd || dshHome()
  const rootFile = findMcpJson(rootStart)

  // 1. 启动时：在全局 ctx 上挂载 .dsh 根目录的 .mcp.json（所有 agent 共享）。
  if (rootFile) {
    await mountFile(ctx, rootFile)
  } else {
    console.log(`[loulan-mcp] 在 ${rootStart} 及其父目录未找到 .mcp.json，跳过全局 MCP 引入`)
  }

  // 2. agent 创建时：在该 agent 的 ctx 上挂载其工作区的 .mcp.json。
  ctx.on('agent/created', ({ agent }) => {
    const cwd = agent.session.header.cwd
    // 调试日志：打印命中的工作区 cwd，便于观察动态加载是否触发。
    console.log(`[loulan-mcp] 尝试为工作区 ${cwd} 挂载 .mcp.json`)
    // session 无 cwd 时无法定位工作区，跳过。
    if (cwd === undefined) return
    const file = findMcpJson(cwd)
    // 与全局 .dsh 根相同则跳过（避免重复挂载）。
    if (file === undefined || file === rootFile) return
    // 异步挂载到 agent.ctx：只对该工作区的 agent 可见。
    void mountFile(agent.ctx, file)
  })
}
