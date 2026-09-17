/**
 * @fileoverview 「MCP」会话视图：视图头部（标题 + 计数 + 刷新/添加）与按分组展示的 MCP 服务。
 */
import { useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { McpMountGroup, McpTransport, UnloadableMountGroup } from '../contract.js'
import type { McpSnapshot, MountControlResult } from './mcp-source.js'
import { toolsText } from './mcp-source.js'
import { NS } from './locales.js'

/** 注册侧注入面：按会话绑定的快照钩子与三个控制动作。 */
export interface McpViewInjected {
  hooks: {
    /** 绑定为 useMcp 的当前会话快照源。 */
    mcp: ObservableSnapshot<McpSnapshot>
  }
  /** 刷新：全局增量重挂 + 本会话重挂。 */
  refresh: () => Promise<MountControlResult>
  /** 添加：上传 .mcp.json 内容并挂到当前会话。 */
  addUpload: (file: { name: string; content: string }) => Promise<MountControlResult>
  /** 卸载某个来源分组；全局共享不在可卸载范围内。 */
  unload: (group: UnloadableMountGroup) => Promise<MountControlResult>
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

/** 工具名默认折行数，与 `.dsh-mcp-tools-clamped` 的 line-clamp 保持一致。 */
const TOOLS_CLAMP_LINES = 2

/** 空分组常量：快照未取得时用作占位，避免逐处判空。 */
const EMPTY_GROUP: McpMountGroup = { servers: [] }

/** 分组渲染所需文案。 */
interface GroupLabels {
  /** 「来源」标签。 */
  source: string
  /** 工具列表不可用文案。 */
  toolsUnavailable: string
  /** 工具名分隔符。 */
  toolsSeparator: string
  /** 展开。 */
  expand: string
  /** 收起。 */
  collapse: string
  /** 卸载。 */
  unload: string
  /** 确认卸载。 */
  unloadConfirm: string
}

/** 刷新图标：线性描边，随文字颜色。 */
function RefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M13.4 8a5.4 5.4 0 1 0-1.6 3.9" />
      <path d="M13.4 3.6v4h-4" />
    </svg>
  )
}

/** 处理中图标：淡底圆环 + 一段高亮弧，配合 `.dsh-mcp-spin` 旋转。 */
function SpinnerIcon() {
  return (
    <svg className="dsh-mcp-spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.4" opacity={0.25} />
      <path d="M13.4 8a5.4 5.4 0 0 0-4-5.2" />
    </svg>
  )
}

/** 添加图标。 */
function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" aria-hidden="true">
      <path d="M8 3.4v9.2M3.4 8h9.2" />
    </svg>
  )
}

/**
 * 分组的卸载按钮：第一次点击进入确认态，第二次才真正卸载；失焦即取消确认。
 *
 * @param props - 文案、禁用状态与确认后的回调
 * @returns 卸载按钮
 */
function UnloadButton({ label, confirmLabel, disabled, onConfirm }: {
  label: string
  confirmLabel: string
  disabled: boolean
  onConfirm: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const text = confirming ? confirmLabel : label
  return (
    <button
      type="button"
      className="dsh-mcp-unload"
      data-confirm={confirming}
      disabled={disabled}
      title={text}
      aria-label={text}
      onBlur={() => { setConfirming(false) }}
      onClick={() => {
        if (!confirming) {
          setConfirming(true)
          return
        }
        setConfirming(false)
        onConfirm()
      }}
    >
      {text}
    </button>
  )
}

/**
 * 一个服务的工具名：默认折到 {@link TOOLS_CLAMP_LINES} 行，真实溢出时才给「展开／收起」。
 *
 * 溢出判定用「未折行时的高度是否超过 N 行」而不是比较 scrollHeight 与 clientHeight：
 * 折行时 `overflow: hidden` 会让两者失真，宽度变化后无法重新判断。
 *
 * @param props - 工具名与分组文案
 * @returns 工具名行
 */
function ToolsRow({ tools, labels }: { tools: readonly string[]; labels: GroupLabels }) {
  const textRef = useRef<HTMLSpanElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useLayoutEffect(() => {
    const node = textRef.current
    if (node === null || typeof ResizeObserver === 'undefined') return
    /** 按行高判断是否超过允许行数。 */
    const measure = (): void => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(node).lineHeight)
      const limit = (Number.isFinite(lineHeight) ? lineHeight : 18) * TOOLS_CLAMP_LINES
      setOverflowing(node.scrollHeight > limit + 1)
    }
    measure()
    // 面板宽度会随侧栏开合变化，需要重新判定。
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => { observer.disconnect() }
  }, [tools, labels.toolsSeparator])

  const text = toolsText(tools, labels.toolsSeparator)
  if (text === null) {
    return (
      <div className="dsh-mcp-tools-row">
        <span className="dsh-mcp-tools">{labels.toolsUnavailable}</span>
      </div>
    )
  }

  const clamped = overflowing && !expanded
  return (
    <div className="dsh-mcp-tools-row">
      <span
        ref={textRef}
        className={clamped ? 'dsh-mcp-tools dsh-mcp-tools-clamped' : 'dsh-mcp-tools'}
      >
        {text}
      </span>
      {overflowing
        ? (
          <button
            type="button"
            className="dsh-mcp-tools-toggle"
            aria-expanded={expanded}
            onClick={() => { setExpanded(value => !value) }}
          >
            {expanded ? labels.collapse : labels.expand}
          </button>
        )
        : null}
    </div>
  )
}

/**
 * 渲染一个来源分组。
 *
 * @param title - 分组标题（已本地化）
 * @param group - 分组数据
 * @param labels - 分组内文案
 * @param pending - 是否有控制动作在进行（进行中禁用卸载）
 * @param onUnload - 卸载回调；缺省表示该分组不可卸载（全局共享）
 * @returns 分组节点；空组返回 null
 */
function renderGroup(
  title: string,
  group: McpMountGroup,
  labels: GroupLabels,
  pending: boolean,
  onUnload?: () => void,
) {
  if (group.servers.length === 0) return null
  return (
    <section className="dsh-mcp-group">
      <div className="dsh-mcp-group-head">
        <span className="dsh-mcp-group-title">{title}</span>
        {group.file === undefined && onUnload === undefined
          ? null
          : (
            <span className="dsh-mcp-group-meta">
              {group.file === undefined
                ? null
                : (
                  // title 承载完整路径：窄容器下文本以省略号收尾，悬停仍可读到全路径。
                  <span className="dsh-mcp-group-source" title={group.file}>
                    <span className="dsh-mcp-source-label">{labels.source}</span>
                    {group.file}
                  </span>
                )}
              {onUnload === undefined
                ? null
                : (
                  <UnloadButton
                    label={labels.unload}
                    confirmLabel={labels.unloadConfirm}
                    disabled={pending}
                    onConfirm={onUnload}
                  />
                )}
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
            <ToolsRow tools={server.tools} labels={labels} />
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * 渲染「MCP」视图。
 *
 * 头部始终可见（空态下也能刷新/添加）；分组顺序为本工作区 → 手动添加 → 全局共享。
 * 前两组可卸载，全局共享不给入口（服务端同样拒绝）。
 *
 * @param props - 视图 props（含 useMcp 钩子、翻译函数 t 与三个控制动作）
 * @returns 视图头部与分组清单（或空态）
 */
export function McpView({ useMcp, t, refresh, addUpload, unload }: McpViewProps) {
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

  const data = snapshot ?? { global: EMPTY_GROUP, workspace: EMPTY_GROUP, manual: EMPTY_GROUP }
  const total = data.workspace.servers.length + data.manual.servers.length + data.global.servers.length
  const labels: GroupLabels = {
    source: t('source'),
    toolsUnavailable: t('tools.unavailable'),
    toolsSeparator: t('tools.separator'),
    expand: t('tools.expand'),
    collapse: t('tools.collapse'),
    unload: t('group.unload'),
    unloadConfirm: t('group.unloadConfirm'),
  }
  const unloadFailed = t('error.unloadFailed')

  return (
    <div className="dsh-mcp-root">
      <div className="dsh-mcp-header">
        <div className="dsh-mcp-heading">
          <span className="dsh-mcp-heading-title">{t('heading')}</span>
          <span className="dsh-mcp-count">{t('heading.count', { count: total })}</span>
        </div>
        <div className="dsh-mcp-actions">
          <button
            type="button"
            className="dsh-mcp-icon-button"
            disabled={pending}
            title={pending ? t('toolbar.busy') : t('toolbar.refresh')}
            aria-label={t('toolbar.refresh')}
            aria-busy={pending}
            onClick={() => { run(t('error.refreshFailed'), refresh) }}
          >
            {pending ? <SpinnerIcon /> : <RefreshIcon />}
          </button>
          <label className="dsh-mcp-icon-button" title={t('toolbar.add')} aria-label={t('toolbar.add')}>
            <PlusIcon />
            <input
              className="dsh-mcp-file"
              type="file"
              accept=".json,application/json"
              disabled={pending}
              onChange={onPick}
            />
          </label>
        </div>
      </div>
      {error === null ? null : <div className="dsh-mcp-error">{error}</div>}
      {total === 0
        ? <div className="dsh-mcp-empty">{t('empty')}</div>
        : (
          <>
            {renderGroup(
              t('group.workspace'),
              data.workspace,
              labels,
              pending,
              () => { run(unloadFailed, () => unload('workspace')) },
            )}
            {renderGroup(
              t('group.manual'),
              data.manual,
              labels,
              pending,
              () => { run(unloadFailed, () => unload('manual')) },
            )}
            {/* 全局共享刻意不给卸载入口：服务端亦拒绝 group=global。 */}
            {renderGroup(t('group.global'), data.global, labels, pending)}
          </>
        )}
    </div>
  )
}
