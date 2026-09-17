/**
 * @fileoverview 「MCP」视图的样式（一次性注入 <style>）。
 *
 * 本插件的客户端 bundle 由自建 esbuild 脚本产出，不经 harness 的 CSS Modules 管线，
 * 因此这里以模板字符串承载样式并做一次性注入（与 harness preset 的
 * styleInjectionModule 同法）。类名统一带 `dsh-mcp-` 前缀，避免全局冲突。
 *
 * 颜色一律使用语义 token：浅色主题下 `--dsw-alias-bg-layer-1/2/3` 与页面底色同值，
 * 卡片表面必须用 `--dsw-specific-tip`（两种主题下均为抬升表面，见 TodoPanel 的用法）。
 */

/** 样式表标记：用于幂等注入与排查。 */
const STYLE_PLUGIN_ID = 'dsh-loulan-mcp'

/** 视图样式。 */
const CSS = `
.dsh-mcp-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 28px;
  /* 页边距：百分比 padding 以包含块宽度为基准，四边均为整体宽度的 1% */
  padding: 1%;
}

.dsh-mcp-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.dsh-mcp-group-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 12px;
  min-width: 0;
}

.dsh-mcp-group-title {
  font-size: 13px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.dsh-mcp-group-source {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dsh-mcp-source-label {
  margin-right: 6px;
  color: var(--dsw-alias-label-caption);
}

.dsh-mcp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dsh-mcp-server {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  padding: 10px 12px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-specific-tip);
}

.dsh-mcp-server-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.dsh-mcp-server-name {
  min-width: 0;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
  overflow-wrap: anywhere;
}

.dsh-mcp-transport {
  flex: none;
  padding: 1px 6px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
}

.dsh-mcp-transport-stdio {
  color: var(--dsw-alias-state-business-primary);
}

.dsh-mcp-transport-http {
  color: var(--dsw-alias-state-success-primary);
}

.dsh-mcp-tools {
  min-width: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
  overflow-wrap: anywhere;
}

.dsh-mcp-empty {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
`

/**
 * 把视图样式注入文档（幂等；无 document 时静默跳过）。
 */
export function ensureMcpStyles(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector(`style[data-plugin="${STYLE_PLUGIN_ID}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = STYLE_PLUGIN_ID
  tag.textContent = CSS
  document.head.appendChild(tag)
}
