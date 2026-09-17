/**
 * @fileoverview 「MCP」会话视图（烟测版：内容写死）。
 *
 * 仅用于验证外部包的浏览器半侧能被 harness 客户端模块系统加载，
 * 后续任务会替换为真实数据渲染。
 */
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * 烟测视图：渲染一行固定文案。
 *
 * @param _props - 会话视图槽位 props（烟测阶段不使用）
 * @returns 固定文案节点
 */
export function McpView(_props: ConvViewProps) {
  return <div>本会话已加载的 MCP 服务（烟测）</div>
}
