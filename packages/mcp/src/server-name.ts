/**
 * @fileoverview MCP serverName 命名与 .mcp.json 条目映射。
 */
import { createHash } from 'node:crypto'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import { isRecord, asStringArray, asStringRecord } from './parse.js'

/** serverName 命名约束，与 mcp-client 保持一致（字母/数字/下划线/短横线，1-32 位）。 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** mcp-client 默认的单次工具调用超时（毫秒）：60 秒。 */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** mapServer 的返回类型：成功携带 mcp-client 配置，失败携带原因。 */
export type Mapped =
  | { ok: true; config: McpClientConfig }
  | { ok: false; reason: string }

/**
 * 从 agent/session id 派生一个短、安全、唯一的后缀 token。
 *
 * 对 agent id 做 SHA-1 并取前 12 位十六进制，字符集恒为 [0-9a-f]，
 * 满足 SERVER_NAME_PATTERN，长度足够短，能被 serverName 上限 32 位容纳。
 *
 * @param agentId - agent（或 session）id
 * @returns 12 位十六进制短 token
 */
export function agentToken(agentId: string): string {
  return createHash('sha1').update(agentId).digest('hex').slice(0, 12)
}

/**
 * 给 serverName 追加唯一后缀，并确保总长不超过 mcp-client 约束的 32 位。
 * 超过上限时截断原 base，保留后缀。
 *
 * @param base - .mcp.json 中的原始 serverName
 * @param suffix - 由 agentToken 生成的唯一后缀（无下划线）
 * @returns 拼接后的 serverName（形如 postgres_<token>）
 */
export function suffixedServerName(base: string, suffix: string): string {
  const withSep = `_${suffix}`
  const baseMax = 32 - withSep.length
  const basePart = base.length > baseMax ? base.slice(0, baseMax) : base
  return `${basePart}${withSep}`
}

/**
 * 把 .mcp.json 的一条 mcpServers 条目映射为 mcp-client 配置。
 *
 * 映射规则：有 command → stdio；有 url → streamable-http；两者皆无 → 无效条目。
 *
 * @param serverName - 服务名（须匹配 SERVER_NAME_PATTERN）
 * @param raw - 该条目的原始配置值（期望是对象）
 * @param projectDir - 该 .mcp.json 所在目录，作为 stdio 子进程的默认 cwd
 * @param uniqueSuffix - 方案 B：按 agent 派生唯一后缀，避免同工作区多会话重复挂载冲突
 * @returns 成功时携带 mcp-client 配置；失败时携带原因
 */
export function mapServer(
  serverName: string,
  raw: unknown,
  projectDir: string,
  uniqueSuffix?: string,
): Mapped {
  const mountedName = uniqueSuffix ? suffixedServerName(serverName, uniqueSuffix) : serverName
  if (!SERVER_NAME_PATTERN.test(mountedName)) {
    return { ok: false, reason: `serverName 不合法（需匹配 [A-Za-z0-9_-]{1,32}）: "${mountedName}"` }
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
        serverName: mountedName,
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
        serverName: mountedName,
        url,
        headers: asStringRecord(raw.headers),
        toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
        failOnStartupError: false,
      },
    }
  }

  return { ok: false, reason: `既没有 command（stdio）也没有 url（http），已跳过: "${serverName}"` }
}
