/**
 * @fileoverview dsh-loulan-mcp 插件配置。
 *
 * 工作区部分无需配置：随 agent 的 session.header.cwd 动态发现。
 */
import Schema from '@deepseek-ai/schemastery'

/** 插件名，须与 cordis.yml 中的 id 对应。 */
export const name = 'dsh-loulan-mcp'

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
