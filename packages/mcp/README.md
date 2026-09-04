# dsh-loulan-mcp

自动读取 `.mcp.json` 并在征得用户同意后挂载 MCP server 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件。

## 特性

- **双来源、不同策略**：
  - `.dsh` 根目录（`~/.dsh`）的全局 `.mcp.json`：DSH 启动时**自动挂载**，所有 agent 共享，**不询问**；
  - 工作区（`session.header.cwd`）的 `.mcp.json`：agent 创建时发现，**首个对话回合征求用户同意后才挂载**。
- **挂载前审批**：插件把待挂载的 MCP 服务列给用户确认；同意才挂载，拒绝/取消/不可用则不挂载。**每次新建 agent 都会独立询问一次**（无全局记忆）；没有 `.mcp.json` 的工作区不询问。
- **两种传输**：stdio（本地子进程）与 streamable-http（远程服务）。
- **多会话互不冲突**：工作区挂载时按 agent 生成唯一 `serverName`（工具形如 `mcp__<serverName>__<agentToken>__<tool>`），同一工作区并发多个会话时各自独立、互不冲突。
- **fail-closed**：无审批服务时，工作区 MCP 不会挂载并给出告警。

## 安装

发布到 npm 后，通过 `dsh plugin` 安装：

```sh
dsh plugin --profile web add dsh-loulan-mcp
```

## 挂载前审批（工作区）

工作区 `.mcp.json` 里的 MCP 服务**不会自动挂载**，需要用户确认：

1. **agent 创建时**：插件在工作区发现 `.mcp.json`（且与全局根文件不同），标记该 agent 为"待决定"，**不立即挂载**；
2. **首个对话回合**（模型开始工作前）：插件弹出审批，列明将挂载的 MCP 服务（如 `postgres`、`Machine-API`）；
3. **同意** → 挂载（为该 agent 生成带唯一后缀的 `serverName`）；**拒绝 / 取消 / 无审批通道** → 不挂载；
4. 同一 agent 只询问一次（决定在该 agent 生命周期内记住）；但**每次新建 agent 都会再次询问**，不做全局记忆。

> 无 `.mcp.json` 的工作区不询问、不挂载；全局 `.dsh` 根 `.mcp.json` 不询问、启动即自动挂载。

## 加载时机

| 来源 | 时机 | 作用域 |
|---|---|---|
| `.dsh` 根目录（`~/.dsh`）的 `.mcp.json` | DSH 启动时 | 全局（所有 agent 共享，自动挂载、不询问） |
| 工作区根目录（`session.header.cwd`）的 `.mcp.json` | agent 创建时发现；**首个对话回合经用户同意后**挂载 | 仅该 agent（挂载带唯一后缀） |

## 配置

| 字段 | 说明 | 默认 |
|---|---|---|
| `cwd` | `.dsh` 根目录（启动时全局加载 `.mcp.json` 的起点） | `$DSH_HOME` 或 `~/.dsh` |

工作区部分无需配置，随 agent 的 `session.header.cwd` 自动发现；挂载前审批为默认行为，无需开关。

如需覆盖默认值，在 profile 的 `cordis.patch.yml` 中配置：

```yaml
- id: dsh-loulan-mcp
  name: dsh-loulan-mcp
  config:
    cwd: /path/to/.dsh
```

## .mcp.json 格式

插件查找指定目录下的 `.mcp.json`（只查该目录本身，不向上递归父目录），解析其中的 `mcpServers`：

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "remote-api": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

条目映射规则：

| 条目 | 传输 | 说明 |
|---|---|---|
| 含 `command` | `stdio` | 本进程拉起子进程；`args`/`env`/`cwd` 可选，默认 `cwd` 为 `.mcp.json` 所在目录 |
| 含 `url`（或 `type` 为 http/sse/streamable-http） | `streamable-http` | 连接远程 MCP 服务；`headers` 可选 |
| 两者皆无 | — | 该条目被跳过并告警 |

## 约束与注意

- **serverName 约束**：须匹配 `[A-Za-z0-9_-]{1,32}`；工作区挂载会追加 agent 唯一后缀（形如 `postgres_<token>`）。
- **工作区挂载需审批**：同一 agent 只询问一次；新建 agent 会再次询问（无全局记忆）。审批请求的 `toolName` 为合成占位名 `dsh-loulan-mcp:mount`，`reason` 里列出待挂载服务。
- **fail-closed**：无审批服务或审批失败时，工作区 MCP 不挂载并告警。
- **去重**：工作区与 `.dsh` 根命中同一个 `.mcp.json` 文件时，跳过工作区挂载（避免重复）。
- **超时**：单次工具调用默认 60 秒。
- **依赖版本**：本插件依赖 `@deepseek-ai/dsh-mcp-client`，其版本须与 DSH 运行时一致，否则可能出现两份 mcp-client 导致工具注册冲突。

## 开发与测试

- 源码按业务功能拆分于 `packages/mcp/src/`：`index.ts`（编排）、`config.ts`、`discover.ts`、`parse.ts`、`server-name.ts`、`mount.ts`、`approval.ts`。
- 单元测试位于 `packages/mcp/test/`，用 `node:test` + `tsx` 运行：
  ```sh
  pnpm --filter dsh-loulan-mcp test
  ```
  （`tsx` 复用 harness 自带的运行器，见 `packages/mcp/scripts/test-unit.sh`。）
- 构建：`pnpm --filter dsh-loulan-mcp build`，产物输出到 `lib/`。
- 发布：`package.json` 的 `files` 包含整个 `lib/` 目录与 `cordis.patch.yml`，确保拆分的全部模块随包发布。

## 常见问题

### MCP server 启动报 `ModuleNotFoundError: No module named 'mcp.server.fastmcp'`

这是 mcp 2.x 破坏性改版导致的：某些 Python MCP server（如 `postgres-mcp`）仍使用 v1 的 `FastMCP` API，但 `uvx` 解析到了 mcp 2.x。修法是在 `uvx` 前加 `--with "mcp<2"` 锁定 v1：

```json
{
  "command": "uvx",
  "args": ["--with", "mcp<2", "postgres-mcp", "--access-mode=restricted"]
}
```
