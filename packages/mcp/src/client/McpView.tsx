/**
 * @fileoverview 「MCP」会话视图：顶部工具条（刷新 / 添加）+ 按分组展示已加载的 MCP 服务。
 */
import { useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { McpMountGroup, McpTransport } from '../contract.js'
import type { McpSnapshot, MountControlResult } from './mcp-source.js'
import { toolsText } from './mcp-source.js'
import { NS } from './locales.js'

/** 注册侧注入面：按会话绑定的快照钩子与两个控制动作。 */
export interface McpViewInjected {
  hooks: {
    /** 绑定为 useMcp 的当前会话快照源。 */
    mcp: ObservableSnapshot<McpSnapshot>
  }
  /** 刷新：全局增量重挂 + 本会话重挂。 */
  refresh: () => Promise<MountControlResult>
  /** 添加：上传 .mcp.json 内容并挂到当前会话。 */
  addUpload: (file: { name: string; content: string }) => Promise<MountControlResult>
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
 * 工具条始终可见（空态下也能添加）；分组顺序为本工作区 → 手动添加 → 全局共享。
 *
 * @param props - 视图 props（含 useMcp 钩子、翻译函数 t 与两个控制动作）
 * @returns 工具条与分组清单（或空态）
 */
export function McpView({ useMcp, t, refresh, addUpload }: McpViewProps) {
  const snapshot = useMcp(value => value)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * 执行一次控制动作：置忙、清错，失败时写入本地化文案（附端点原因）。
   *
   * @param failed - 该动作失败的本地化前缀
   * @param action - 实际动作
   */
  const run = (failed: string, action: () => Promise<MountControlResult>): void => {
    setPending(true)
    setError(null)
    void action().then(
      (result) => {
        setPending(false)
        if (result.ok) return
        setError(result.message === undefined ? failed : `${failed}：${result.message}`)
      },
      (reason: unknown) => {
        setPending(false)
        const detail = reason instanceof Error ? reason.message : String(reason)
        setError(`${failed}：${detail}`)
      },
    )
  }

  /**
   * 选择文件后读取文本并上传。
   *
   * @param event - file input 的 change 事件
   */
  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    // 清空 value，保证连续选择同一文件时 change 仍会触发。
    event.target.value = ''
    if (file === undefined) return
    run(t('error.addFailed'), () => file.text().then(content => addUpload({ name: file.name, content })))
  }

  const toolsUnavailable = t('tools.unavailable')
  const toolsSeparator = t('tools.separator')
  return (
    <div className="dsh-mcp-root">
      <div className="dsh-mcp-toolbar">
        <button
          type="button"
          className="dsh-mcp-button"
          disabled={pending}
          onClick={() => { run(t('error.refreshFailed'), refresh) }}
        >
          {t('toolbar.refresh')}
        </button>
        <label className="dsh-mcp-button">
          {t('toolbar.add')}
          <input
            className="dsh-mcp-file"
            type="file"
            accept=".json,application/json"
            disabled={pending}
            onChange={onPick}
          />
        </label>
        {pending ? <span className="dsh-mcp-status">{t('toolbar.busy')}</span> : null}
        {error === null ? null : <span className="dsh-mcp-error">{error}</span>}
      </div>
      {snapshot === null
        || (snapshot.workspace.servers.length === 0
          && snapshot.manual.servers.length === 0
          && snapshot.global.servers.length === 0)
        ? <div className="dsh-mcp-empty">{t('empty')}</div>
        : (
          <>
            {renderGroup(t('group.workspace'), snapshot.workspace, t('source'), toolsUnavailable, toolsSeparator)}
            {renderGroup(t('group.manual'), snapshot.manual, t('source'), toolsUnavailable, toolsSeparator)}
            {renderGroup(t('group.global'), snapshot.global, t('source'), toolsUnavailable, toolsSeparator)}
          </>
        )}
    </div>
  )
}
