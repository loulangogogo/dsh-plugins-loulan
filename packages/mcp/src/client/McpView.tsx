/**
 * @fileoverview 「MCP」会话视图：按分组展示本会话已加载的 MCP 服务。
 */
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { McpMountGroup, McpTransport } from '../contract.js'
import type { McpSnapshot } from './mcp-source.js'
import { toolsText } from './mcp-source.js'
import { NS } from './locales.js'

/** 注册侧注入面：一个按会话绑定的快照钩子。 */
export interface McpViewInjected {
  hooks: {
    /** 绑定为 useMcp 的当前会话快照源。 */
    mcp: ObservableSnapshot<McpSnapshot>
  }
}

/** 视图组件 props。 */
export type McpViewProps =
  ConvViewProps
  & PropsLocale<typeof NS>
  & InjectFace<McpViewInjected>

/** 传输方式对应的 pill 样式类：全页唯一的彩色元素。 */
const TRANSPORT_CLASS: Record<McpTransport, string> = {
  'stdio': 'dsh-mcp-transport-stdio',
  'streamable-http': 'dsh-mcp-transport-http',
}

/**
 * 渲染一个来源分组。
 *
 * @param title - 分组标题（已本地化）
 * @param group - 分组数据
 * @param sourceLabel - 「来源」标签（已本地化）
 * @param toolsUnavailable - 工具不可用文案（已本地化）
 * @param toolsSeparator - 工具名分隔符（已本地化）
 * @returns 分组节点；空组返回 null
 */
function renderGroup(
  title: string,
  group: McpMountGroup,
  sourceLabel: string,
  toolsUnavailable: string,
  toolsSeparator: string,
) {
  if (group.servers.length === 0) return null
  return (
    <section className="dsh-mcp-group">
      <div className="dsh-mcp-group-head">
        <span className="dsh-mcp-group-title">{title}</span>
        {group.file === undefined
          ? null
          : (
            <span className="dsh-mcp-group-source">
              <span className="dsh-mcp-source-label">{sourceLabel}</span>
              {group.file}
            </span>
          )}
      </div>
      <ul className="dsh-mcp-list">
        {group.servers.map(server => (
          <li className="dsh-mcp-server" key={server.name}>
            <div className="dsh-mcp-server-head">
              <span className="dsh-mcp-server-name">{server.name}</span>
              <span className={`dsh-mcp-transport ${TRANSPORT_CLASS[server.transport]}`}>
                {server.transport}
              </span>
            </div>
            <span className="dsh-mcp-tools">
              {toolsText(server.tools, toolsSeparator) ?? toolsUnavailable}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 渲染「MCP」视图。
 *
 * @param props - 视图 props（含 useMcp 钩子与翻译函数 t）
 * @returns 分组清单或空态
 */
export function McpView({ useMcp, t }: McpViewProps) {
  const snapshot = useMcp(value => value)
  // 尚未取得快照，或两组服务皆空时，都显示空态文案
  if (snapshot === null
    || (snapshot.workspace.servers.length === 0 && snapshot.global.servers.length === 0)) {
    return <div className="dsh-mcp-root dsh-mcp-empty">{t('empty')}</div>
  }
  const toolsUnavailable = t('tools.unavailable')
  const toolsSeparator = t('tools.separator')
  return (
    <div className="dsh-mcp-root">
      {renderGroup(t('group.workspace'), snapshot.workspace, t('source'), toolsUnavailable, toolsSeparator)}
      {renderGroup(t('group.global'), snapshot.global, t('source'), toolsUnavailable, toolsSeparator)}
    </div>
  )
}
