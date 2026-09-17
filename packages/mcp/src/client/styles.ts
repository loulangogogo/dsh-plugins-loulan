/**
 * @fileoverview 「MCP」视图的样式（一次性注入 <style>）。
 *
 * 本插件的客户端 bundle 由自建 esbuild 脚本产出，不经 harness 的 CSS Modules 管线，
 * 因此这里以模板字符串承载样式并做一次性注入（与 harness preset 的
 * styleInjectionModule 同法）。类名统一带 `dsh-mcp-` 前缀，避免全局冲突。
 *
 * 颜色一律使用语义 token：浅色主题下 `--dsw-alias-bg-layer-1/2/3` 与页面底色同值，
 * 卡片表面必须用 `--dsw-specific-tip`（两种主题下均为抬升表面，见 TodoPanel 的用法）。
 *
 * 版式来自 example/mcp.html 里定稿的三个选择：
 * - 顶部用「视图头部」：标题 + 计数在左，图标操作在右（默认无边框，hover/聚焦才浮出）；
 * - 工具名默认折到 2 行，真实溢出时由组件给出「展开／收起」；
 * - 服务行保留有底色卡片。
 */

/** 样式表标记：用于幂等注入与排查。 */
const STYLE_PLUGIN_ID = 'dsh-loulan-mcp'

/** 视图样式。 */
const CSS = `
.dsh-mcp-root {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  /* 页边距：百分比 padding 以包含块宽度为基准，四边均为整体宽度的 1% */
  padding: 1%;
}

/* 视图头部：左侧标题 + 计数，右侧图标操作 */
.dsh-mcp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
}

.dsh-mcp-heading {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.dsh-mcp-heading-title {
  font-size: 13px;
  line-height: 24px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}

.dsh-mcp-count {
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-label-caption);
  font-variant-numeric: tabular-nums;
}

.dsh-mcp-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}

/* 图标按钮：默认无边框、无底色；仅 hover / 聚焦时浮出，减少视觉重量 */
.dsh-mcp-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}

.dsh-mcp-icon-button:hover:not(:disabled) {
  background: var(--dsw-specific-tip);
  color: var(--dsw-alias-label-primary);
}

.dsh-mcp-icon-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

.dsh-mcp-icon-button:disabled {
  color: var(--dsw-alias-label-caption);
  cursor: default;
}

.dsh-mcp-icon-button svg {
  width: 15px;
  height: 15px;
}

/* 处理中：刷新图标转圈（尊重 prefers-reduced-motion，改为慢速） */
@keyframes dsh-mcp-spin {
  to { transform: rotate(360deg); }
}

.dsh-mcp-spin {
  animation: dsh-mcp-spin 0.9s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-mcp-spin { animation-duration: 3s; }
}

/* 文件选择器只作为「添加」入口的隐藏实现：点击图标按钮即打开系统选文件对话框 */
.dsh-mcp-file {
  display: none;
}

.dsh-mcp-error {
  min-width: 0;
  font-size: 12px;
  line-height: 20px;
  color: var(--dsw-alias-state-error-primary);
  overflow-wrap: anywhere;
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

/* 分组标题右侧：来源路径 + 卸载按钮（min-width:0 让长路径继续省略号收尾） */
.dsh-mcp-group-meta {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

/* 卸载：红色垃圾桶图标按钮（无文字）；破坏性操作由 Modal 二次确认 */
.dsh-mcp-unload {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-state-error-primary);
  cursor: pointer;
}

.dsh-mcp-unload:hover:not(:disabled) {
  background: var(--dsw-specific-tip);
}

.dsh-mcp-unload:disabled {
  color: var(--dsw-alias-label-caption);
  cursor: default;
}

.dsh-mcp-unload:focus-visible {
  outline: 2px solid var(--dsw-alias-state-error-primary);
  outline-offset: 1px;
}

.dsh-mcp-unload svg {
  width: 15px;
  height: 15px;
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

/* 工具名一行容器：文字在左，「展开／收起」贴右下角 */
.dsh-mcp-tools-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
}

/* 折到 2 行；仅在真实溢出时由组件挂上（不足 2 行不会被裁切） */
.dsh-mcp-tools-clamped {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
}

.dsh-mcp-tools-toggle {
  flex: none;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  cursor: pointer;
}

.dsh-mcp-tools-toggle:hover {
  color: var(--dsw-alias-label-secondary);
}

.dsh-mcp-tools-toggle:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
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
