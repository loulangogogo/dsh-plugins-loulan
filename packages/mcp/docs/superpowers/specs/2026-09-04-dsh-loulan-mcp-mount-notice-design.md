# dsh-loulan-mcp：会话内展示已挂载 MCP 服务（设计）

日期：2026-09-04
状态：已确认（待实现）

## 1. 背景与目标

`dsh-loulan-mcp` 会自动读取 `.mcp.json`（`.dsh` 根目录 + 工作区）并挂载其中的 MCP server，
但当前仅向 host 控制台打印日志，Web GUI 用户无法感知「已加载了哪些 MCP 服务」；MCP 工具
只在被模型实际调用时才以工具卡片形式出现在聊天流中，未调用即不可见。

本设计的目标：**工作区挂载了 MCP 服务时，在该 agent 会话里自动出现一条用户可见的消息**，
列出已挂载的服务（服务名 + 来源 `.mcp.json` 路径 + 工具列表），同时进入模型上下文，
不唤醒 agent、不额外消耗模型回合。

## 2. 已确认的产品取舍

| 维度 | 决定 |
|---|---|
| 展示形态 | 会话内自动出现一条可见消息 |
| 消息语义 | 会话可见 + 进入模型上下文（sourced user 消息） |
| 内容粒度 | 服务名 + 来源（`.mcp.json` 路径）+ 工具列表 |
| 提示范围 | 仅当工作区有独立服务时提示；有工作区服务则全局共享服务一并列出；无工作区服务则不提示 |

## 3. 平台机制（已核实）

- `Agent.inject(message: UserMessage)` 的官方语义：「Queue model-facing context for the next
  pre-step **without waking** the driver」。空闲 agent 不会因此唤醒，消息随下一次
  `followup`/`steer` 进入模型上下文。
- 该消息作为 user 消息持久化到会话日志，由前端渲染在聊天流中。
- `@deepseek-ai/dsh-user-approval` 在策略切换时用同一模式注入 sourced user 消息，证明这是
  后端插件向会话注入可见消息的官方通道：

```ts
agent.inject(createUserMessage({
  content: [{ type: 'text', text: '…' }],
  source: { kind: 'plugin', plugin: 'dsh-loulan-mcp' },
}))
```

- mcp-client 将工具以 `mcp__<serverName>__<rawName>` 注册到 `ctx.tools`；`ctx.plugin(mcpClient, config)`
  返回的 fiber settle 即表示连接与工具同步完成，此后可从 `ctx.tools` 按前缀枚举该 server 的工具名。

## 4. 组件与数据流

改动小而聚焦：新增 1 个文件，微调 2 个现有文件。

| 文件 | 改动 |
|---|---|
| `src/mount.ts` | `mountFile` 返回值由 `Promise<void>` 改为 `Promise<MountedServer[]>`，返回挂载结果明细（`serverName`、`transport`、来源文件、从 `ctx.tools` 按 `mcp__<serverName>__` 前缀枚举到的工具名数组）。全局启动与工作区两处调用共用。 |
| `src/notify.ts`（新增） | ① 纯函数 `buildMountNotice(global, work) => string \| undefined`：`work` 为空返回 `undefined`（不提示）；否则拼接全局 + 工作区两组文案。② `injectMountNotice(agent, text)`：包 `createUserMessage` 并 `agent.inject`。 |
| `src/index.ts` | 启动时 `mountGlobalRoot` 保留挂载结果并传给生命周期注册；`registerAgentCreated` 增加参数以接收全局挂载结果。 |
| `src/approval.ts` | `registerAgentCreated`：工作区挂载完成后（`await`），用 `buildMountNotice` 生成文案 → `injectMountNotice`；保持 fire-and-forget（失败只告警、不阻断 agent 创建）。 |

### 数据流

```
agent/created
  → 发现工作区 .mcp.json（与全局 rootFile 相同则跳过）
  → mountFile（await，等待全部 server settle，此时工具已同步注册到 ctx.tools）
  → 枚举各 server 工具名（mcp__<serverName>__ 前缀）
  → buildMountNotice(全局结果, 工作区结果)
  → 若文案非 undefined 且会话「未开始对话」→ injectMountNotice
```

## 5. 文案格式

示例（两条为一条消息）：

```
本工作区已自动挂载以下 MCP 服务（来源：/Users/me/proj/.mcp.json）：
- memory (stdio)：memory_create_entities、memory_read_graph
- remote-api (streamable-http)：get_orders

另共享全局服务（来源：/Users/me/.dsh/.mcp.json）：
- postgres (stdio)：query、schema
```

## 6. 边界与错误处理

- 某 server 挂载失败 → 该条不进清单；若工作区最终成功项为 0 → 不提示。
- 工具枚举失败（个别 server 握手不全）→ 该 server 仍列出，工具名标注「（工具列表暂不可用）」。
- 无工作区服务（即使有全局服务）→ 不提示。
- 全局服务挂载失败 → 按第 2 节规则，随工作区提示一并列出的全局清单省略失败项。

### 防重复 / 防迟到打断

- 注入前检查该会话日志**尚无任何用户消息**（即「未开始对话」）。
- 效果：全新会话启动即提示；重启 resume 的老会话（已有历史）自动跳过，不重复注入；
  若用户在挂载完成前抢先说话（小竞态窗口），放弃本次提示，不做「迟到的插入」打断进行中的对话。

## 7. 测试与范围

- `src/notify.ts` 纯函数单测（`buildMountNotice` 分支：无工作区 → undefined、只有工作区、
  工作区 + 全局、含工具 / 缺工具），沿用 `node:test` 风格。
- `approval.test.ts` 补桩测：挂载成功且会话空时调用 `agent.inject`。
- 不回归：现有 20 个用例保持通过；`mountFile` 返回类型变更同步调整既有调用。

### 非目标（YAGNI，本次不做）

- 不新增配置开关（如需「关闭提示」可日后加一行 `config.notify`）。
- 不新增依赖、不改动其它模块。
- 不做前端 UI 扩展（`ui-slots` 属浏览器 bundle，超出本后端插件范围）。
