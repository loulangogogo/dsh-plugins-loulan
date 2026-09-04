# dsh-loulan-mcp

自动读取 `.mcp.json` 并挂载 MCP server 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件。

## 特性

- **双来源、不同策略**：
  - `.dsh` 根目录（`~/.dsh`）的全局 `.mcp.json`：DSH 启动时**自动挂载**，所有 agent 共享；
  - 工作区（`session.header.cwd`）的 `.mcp.json`：**agent 创建时发现即自动挂载**，仅对该 agent 的对话可见，agent 销毁自动卸载。
- **自动挂载、无需审批**：工作区命中 `.mcp.json` 即在 agent 创建时挂载，不征求用户同意；没有 `.mcp.json` 的工作区不挂载。
- **两种传输**：stdio（本地子进程）与 streamable-http（远程服务）。
- **多会话互不冲突**：工作区挂载时按 agent 生成唯一 `serverName`（工具形如 `mcp__<serverName>__<agentToken>__<tool>`），同一工作区并发多个会话时各自独立、互不冲突。

## 安装

发布到 npm 后，通过 `dsh plugin` 安装：

```sh
dsh plugin --profile web add dsh-loulan-mcp
```

## 工作区自动挂载

工作区 `.mcp.json` 里的 MCP 服务在 **agent 创建时发现即自动挂载**，无需用户确认：

1. **agent 创建时**：插件在工作区发现 `.mcp.json`（且与全局根文件不同），立即自动挂载到该 agent；
2. 挂载为该 agent 生成带唯一后缀的 `serverName`；**agent 销毁时随 `agent.ctx` 作用域自动卸载**。

> 无 `.mcp.json` 的工作区不挂载；全局 `.dsh` 根 `.mcp.json` 启动时即自动挂载。
> 原「首个对话回合征求用户同意后挂载」的审批实现已停用，代码以注释形式保留在 `src/approval.ts`
> （`askForApproval` 与 `registerAgentRequest`），如需恢复询问模式可按其中注释指引还原。

## 加载时机

| 来源 | 时机 | 作用域 |
|---|---|---|
| `.dsh` 根目录（`~/.dsh`）的 `.mcp.json` | DSH 启动时 | 全局（所有 agent 共享，自动挂载） |
| 工作区根目录（`session.header.cwd`）的 `.mcp.json` | agent 创建时发现即自动挂载 | 仅该 agent（挂载带唯一后缀） |

## 配置

| 字段 | 说明 | 默认 |
|---|---|---|
| `cwd` | `.dsh` 根目录（启动时全局加载 `.mcp.json` 的起点） | `$DSH_HOME` 或 `~/.dsh` |

工作区部分无需配置，随 agent 的 `session.header.cwd` 自动发现并自动挂载，无需开关。

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
- **自动挂载**：工作区 `.mcp.json` 在 agent 创建时发现即挂载，不征求同意；原审批实现注释保留于 `src/approval.ts`。
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
