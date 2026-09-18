/**
 * @fileoverview rules 插件配置解析：DSH home、总预算与单文件上限。
 */

import { homedir } from 'node:os'
import { join } from 'node:path'

/** 插件配置（全部可选，缺省见 {@link resolveConfig}）。 */
export interface RulesConfig {
  /** DSH home 目录；缺省依次取 $DSH_HOME、~/.dsh。 */
  dshHome?: string
  /** 整条规则消息的 UTF-8 字节上限；<=0 或非有限值禁用注入。 */
  maxBytes?: number
  /** 单个规则文件的 UTF-8 字节上限，超过则省略该文件。 */
  maxSourceBytes?: number
}

/** 总预算默认值：64 KiB。 */
export const DEFAULT_MAX_BYTES = 65536
/** 单文件上限默认值：256 KiB。 */
export const DEFAULT_MAX_SOURCE_BYTES = 262144

/** 解析后的插件配置。 */
export interface ResolvedRulesConfig {
  dshHome: string
  maxBytes: number
  maxSourceBytes: number
}

/**
 * 解析配置默认值与 DSH home 目录。
 *
 * @param config - 用户在 cordis.yml 中提供的可选配置。
 * @returns 带默认值的完整配置。
 */
export function resolveConfig(config: RulesConfig = {}): ResolvedRulesConfig {
  return {
    dshHome: config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    maxBytes: config.maxBytes ?? DEFAULT_MAX_BYTES,
    maxSourceBytes: config.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES,
  }
}

/**
 * 计算全局规则目录的模型可见前缀。
 *
 * 默认 home 显示为 `~/.dsh/rules`；显式配置的 home 显示为绝对路径。
 *
 * @param dshHome - 解析后的 DSH home 目录。
 * @returns 用于提示词中 `Rules from:` 的目录前缀。
 */
export function globalDisplayDir(dshHome: string): string {
  return dshHome === join(homedir(), '.dsh') ? '~/.dsh/rules' : join(dshHome, 'rules')
}
