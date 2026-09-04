/**
 * @fileoverview .mcp.json 解析与防御式类型校验工具。
 */
import { readFile } from 'node:fs/promises'

/**
 * 判断一个值是否为普通对象（非 null、非数组）。
 *
 * 用于对 .mcp.json 解析结果做防御式校验，避免把数组/null 误当作配置对象。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 从任意值中提取字符串数组，过滤掉非字符串元素。
 *
 * 用于解析 .mcp.json 中 stdio 条目的 args 字段（可能缺失或含非字符串）。
 */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * 从任意值中提取字符串键值对，过滤掉非字符串值。
 *
 * 用于解析 .mcp.json 中 stdio 条目的 env、http 条目的 headers 字段。
 */
export function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item
  }
  return result
}

/**
 * 读取并解析 .mcp.json，返回其中的 mcpServers（缺失或非对象时视为空对象）。
 *
 * 读取/JSON 解析失败时抛错，由调用方捕获处理。
 *
 * @param file - .mcp.json 文件路径
 * @returns mcpServers 映射；文件无 mcpServers 或结构不正确时返回空对象
 */
export async function readMcpServers(file: string): Promise<Record<string, unknown>> {
  const doc: unknown = JSON.parse(await readFile(file, 'utf8'))
  return isRecord(doc) && isRecord(doc.mcpServers) ? doc.mcpServers : {}
}
