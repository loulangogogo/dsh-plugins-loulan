/**
 * @fileoverview .mcp.json 与 DSH home 目录发现工具。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 查找 start 目录下的 .mcp.json。
 *
 * 只检查起始目录本身，不向上递归父目录。
 *
 * @param start - 起始目录（绝对或相对路径均可，内部会 resolve）
 * @returns start 目录下 .mcp.json 的绝对路径；不存在则返回 undefined
 */
export function findMcpJson(start: string): string | undefined {
  const candidate = join(resolve(start), '.mcp.json')
  return existsSync(candidate) ? candidate : undefined
}

/**
 * 确定 DSH home 目录。
 *
 * 优先使用环境变量 $DSH_HOME，缺省时回退到 ~/.dsh。
 *
 * @returns DSH home 目录路径（如 /Users/<name>/.dsh）
 */
export function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}
