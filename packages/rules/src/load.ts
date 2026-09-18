/**
 * @fileoverview 规则目录发现与读取：递归收集普通文件（跳过符号链接）、
 * 按路径排序，并应用单文件上限与总预算。
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { renderRules, type RuleFile } from './render.js'

/** 一个规则目录：绝对路径 + 模型可见前缀。 */
export interface RuleDirRef {
  absoluteDir: string
  displayDir: string
}

/** 读取选项。 */
export interface LoadRulesOptions {
  /** 整条规则消息的 UTF-8 字节上限。 */
  maxBytes: number
  /** 单个规则文件的 UTF-8 字节上限。 */
  maxSourceBytes: number
  signal?: AbortSignal
}

/** 读取结果。 */
export interface LoadedRules {
  /** 保留的文件，顺序为目录顺序 + 路径排序。 */
  files: RuleFile[]
  /** 因超出单文件上限或总预算而未保留的模型可见路径。 */
  omitted: string[]
}

/**
 * 递归收集目录下的普通文件。
 *
 * 符号链接（文件或目录）一律跳过，既避免环路也让规则集保持确定性。
 *
 * @param dir - 起始目录。
 * @returns 按绝对路径排序的文件列表；目录不存在或不可读时返回空数组。
 */
export async function collectRuleFiles(dir: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (current: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) await walk(absolute)
      else if (entry.isFile()) found.push(absolute)
    }
  }
  await walk(dir)
  return found.sort()
}

/** 把绝对路径转成模型可见路径。 */
function displayPathOf(dir: RuleDirRef, absolute: string): string {
  return `${dir.displayDir}/${relative(dir.absoluteDir, absolute).split(sep).join('/')}`
}

/** 读取并保存单个候选文件；超限或读取失败时返回 undefined。 */
async function readCandidate(
  absolute: string,
  displayPath: string,
  maxSourceBytes: number,
): Promise<RuleFile | undefined> {
  try {
    const info = await stat(absolute)
    if (info.size > maxSourceBytes) return undefined
    const content = await readFile(absolute, 'utf8')
    if (Buffer.byteLength(content, 'utf8') > maxSourceBytes) return undefined
    return { absolutePath: absolute, displayPath, content }
  } catch {
    return undefined
  }
}

/**
 * 依次读取多个规则目录，并保证最终渲染结果不超过 maxBytes。
 *
 * 放不下的文件会被记入 omitted 并跳过，后续更小的文件仍可注入。
 *
 * @param dirs - 规则目录列表，顺序即优先级（全局在前、项目在后）。
 * @param options - 预算与取消信号。
 * @returns 保留的文件与被省略的路径。
 */
export async function loadRules(
  dirs: readonly RuleDirRef[],
  options: LoadRulesOptions,
): Promise<LoadedRules> {
  const files: RuleFile[] = []
  const omitted: string[] = []
  for (const dir of dirs) {
    options.signal?.throwIfAborted()
    for (const absolute of await collectRuleFiles(dir.absoluteDir)) {
      options.signal?.throwIfAborted()
      const displayPath = displayPathOf(dir, absolute)
      const candidate = await readCandidate(absolute, displayPath, options.maxSourceBytes)
      if (candidate === undefined) {
        omitted.push(displayPath)
        continue
      }
      if (Buffer.byteLength(renderRules([...files, candidate], omitted), 'utf8') > options.maxBytes) {
        omitted.push(displayPath)
        continue
      }
      files.push(candidate)
    }
  }
  // 省略说明本身也占字节，收尾时再丢掉放不下的文件，保证最终文本不超预算。
  while (files.length > 0 && Buffer.byteLength(renderRules(files, omitted), 'utf8') > options.maxBytes) {
    const dropped = files.pop()
    if (dropped === undefined) break
    omitted.push(dropped.displayPath)
  }
  return { files, omitted }
}
