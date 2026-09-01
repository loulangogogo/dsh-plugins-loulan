/**
 * 插件 2：mcp-json —— 自动应用项目下的 .mcp.json 引入 MCP server。
 *
 * 从 cwd（可配置）向上查找最近的 .mcp.json，解析其中的 mcpServers，并逐个
 * 挂载 @deepseek-ai/dsh-mcp-client 实例：
 *   - 有 command 的条目 → stdio 传输；
 *   - 有 url（或 type 为 http/sse/streamable-http）的条目 → streamable-http 传输。
 * 工具以 mcp__<serverName>__<tool> 的形式暴露给模型。
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const name = 'mcp-json'

export interface Config {
  /** 查找 .mcp.json 的起始目录；默认 process.cwd()（即 DSH 的工作目录）。 */
  cwd: string
}

export const Config: Schema<Config> = Schema.object({
  cwd: Schema.string().default(''),
})

/** 与 mcp-client 相同的 serverName 约束。 */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** mcp-client 的默认单次工具调用超时。 */
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item
  }
  return result
}

/** 从 start 开始向上查找最近的 .mcp.json。 */
function findMcpJson(start: string): string | undefined {
  let dir = resolve(start)
  for (;;) {
    const candidate = join(dir, '.mcp.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

type Mapped =
  | { ok: true; config: McpClientConfig }
  | { ok: false; reason: string }

/** 把一条 .mcp.json 的 mcpServers 条目映射为 mcp-client 配置。 */
function mapServer(serverName: string, raw: unknown, projectDir: string): Mapped {
  if (!SERVER_NAME_PATTERN.test(serverName)) {
    return { ok: false, reason: `serverName 不合法（需匹配 [A-Za-z0-9_-]{1,32}）: "${serverName}"` }
  }
  if (!isRecord(raw)) {
    return { ok: false, reason: `配置必须是对象: "${serverName}"` }
  }

  const command = typeof raw.command === 'string' ? raw.command : undefined
  const url = typeof raw.url === 'string' ? raw.url : undefined

  if (command) {
    return {
      ok: true,
      config: {
        transport: 'stdio',
        serverName,
        command,
        args: asStringArray(raw.args),
        env: asStringRecord(raw.env),
        cwd: typeof raw.cwd === 'string' ? raw.cwd : projectDir,
        toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
        failOnStartupError: false,
      },
    }
  }

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

  return { ok: false, reason: `既没有 command（stdio）也没有 url（http），已跳过: "${serverName}"` }
}

export async function apply(ctx: Context, config: Config) {
  const startDir = config.cwd || process.cwd()
  const file = findMcpJson(startDir)
  if (!file) {
    console.log(`[mcp-json] 在 ${startDir} 及其父目录未找到 .mcp.json，跳过 MCP 引入`)
    return
  }

  let doc: unknown
  try {
    doc = JSON.parse(await readFile(file, 'utf8'))
  } catch (error) {
    console.error(`[mcp-json] 解析 ${file} 失败:`, error)
    return
  }

  console.log(`[mcp-json] 应用 ${file}`)
  const servers = isRecord(doc) && isRecord(doc.mcpServers) ? doc.mcpServers : {}
  const projectDir = dirname(file)
  const fibers: PromiseLike<unknown>[] = []

  for (const [serverName, raw] of Object.entries(servers)) {
    const mapped = mapServer(serverName, raw, projectDir)
    if (!mapped.ok) {
      console.warn(`[mcp-json] ${mapped.reason}`)
      continue
    }
    try {
      const fiber = ctx.plugin(mcpClient, mapped.config)
      fibers.push(fiber)
      console.log(`[mcp-json] 已挂载 MCP server "${serverName}"`)
    } catch (error) {
      console.error(`[mcp-json] 挂载 "${serverName}" 失败:`, error)
    }
  }

  const settled = await Promise.allSettled(fibers)
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.error('[mcp-json] MCP server 启动失败:', result.reason)
    }
  }
}
