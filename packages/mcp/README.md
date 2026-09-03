# dsh-loulan-mcp

自动读取 `.mcp.json` 并按需挂载 MCP server 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）插件。

## 特性

- **按生命周期分离加载**：`.dsh` 根目录的全局配置在 DSH 启动时加载，工作区配置随 agent 动态加载。
- **两种传输**：支持 stdio（本地子进程）与 streamable-http（远程服务）。
- **自动命名**：MCP 工具以 `mcp__<serverName>__<tool>` 的形式暴露给模型。

## 安装

发布到 npm 后，通过 `dsh plugin` 安装：

```sh
dsh plugin --profile web add dsh-loulan-mcp
```

## 加载时机

| 来源 | 时机 | 作用域 |
|---|---|---|
| `.dsh` 根目录（`~/.dsh`）的 `.mcp.json` | DSH 启动时 | 全局（所有 agent 共享） |
| 工作区根目录（`session.header.cwd`）的 `.mcp.json` | 打开该工作区的对话（agent 创建）时 | 仅该 agent（该工作区的对话） |

工作区的 MCP 随对应 agent 销毁自动卸载；切换工作区不会卸载之前工作区的 MCP——各工作区独立、可并存。

## 配置

| 字段 | 说明 | 默认 |
|---|---|---|
| `cwd` | `.dsh` 根目录（启动时全局加载 `.mcp.json` 的起点） | `$DSH_HOME` 或 `~/.dsh` |

工作区部分无需配置，随 agent 的 `session.header.cwd` 自动发现。

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

- **serverName 约束**：须匹配 `[A-Za-z0-9_-]{1,32}`。
- **去重**：工作区与 `.dsh` 根命中同一个 `.mcp.json` 文件时，跳过工作区挂载（避免重复）。
- **超时**：单次工具调用默认 60 秒。
- **依赖版本**：本插件依赖 `@deepseek-ai/dsh-mcp-client`，其版本须与 DSH 运行时一致，否则可能出现两份 mcp-client 导致工具注册冲突。

## 常见问题

### MCP server 启动报 `ModuleNotFoundError: No module named 'mcp.server.fastmcp'`

这是 mcp 2.x 破坏性改版导致的：某些 Python MCP server（如 `postgres-mcp`）仍使用 v1 的 `FastMCP` API，但 `uvx` 解析到了 mcp 2.x。修法是在 `uvx` 前加 `--with "mcp<2"` 锁定 v1：

```json
{
  "command": "uvx",
  "args": ["--with", "mcp<2", "postgres-mcp", "--access-mode=restricted"]
}
```
