# dsh-plugins-loulan

一个 **DeepSeek Harness（DSH）多插件开发项目**（pnpm monorepo）。目前包含两个插件：

| 插件 | 目录 | 作用 |
|---|---|---|
| `loulan-mcp` | [packages/mcp](packages/mcp) | 自动读取项目下的 `.mcp.json`，把其中的 MCP server 挂载进 DSH |
| `hello` | [packages/hello](packages/hello) | 注册斜杠命令 `/hello`，在聊天界面输出「你好」 |

---

## 目录结构

```text
dsh-plugins-loulan/
├── cordis.yml              # patch overlay：把两个插件插入到 DSH 组合中
├── package.json            # workspace 根
├── pnpm-workspace.yaml
├── tsconfig.json
├── .mcp.json.example       # MCP 配置示例（改名为 .mcp.json 使用）
├── scripts/
│   ├── link-dsh.sh         # 软链 harness 的 @deepseek-ai/* 包
│   └── dev.sh              # 一键以本 overlay 启动 DSH Web UI
└── packages/
    ├── mcp/                # 插件 1
    └── hello/              # 插件 2
```

## 插件是什么

在 DSH 中，插件就是一个导出 `apply(ctx, config)` 函数的 TypeScript 模块。框架
加载时调用 `apply`，传入一个 `ctx`（上下文对象）；插件通过 `ctx` 注册事件
监听、工具、服务等能力，卸载时自动清理。

## 环境准备

1. 需要一份可运行的 DeepSeek Harness checkout（本项目默认假设它在
   `~/.dsh/deepseek-harness`）。
2. Node ≥ 23.6（推荐 ≥ 24；本项目按 Node 26 开发），带原生 TypeScript 类型擦除。

## 安装与链接

```sh
# 1. （可选）安装 TypeScript / @types/node，用于本地类型检查
pnpm install

# 2. 把 harness 里的 @deepseek-ai/* 包软链到本项目，使插件能 import 它们
pnpm link:dsh -- ~/.dsh/deepseek-harness
# 或者
DSH_HARNESS=~/.dsh/deepseek-harness pnpm link:dsh
```

> `pnpm install` 会重建 `node_modules` 并清掉手动软链，所以每次 `pnpm install`
> 之后都要重新跑一遍 `pnpm link:dsh`。

## 运行

```sh
# 以本项目的 cordis.yml 作为 patch overlay 启动 DSH Web UI（默认端口 3080）
pnpm dev

# 等价于
cd ~/.dsh/deepseek-harness && pnpm dsh web --patch "$PWD/cordis.yml"
```

启动后打开 <http://127.0.0.1:3080>。

---

## 插件 1：loulan-mcp

按生命周期分离加载：

- **启动时**：从 `.dsh` 根目录（`cwd`，默认 `$DSH_HOME` 或 `~/.dsh`）向上查找
  `.mcp.json`，挂载到全局（所有 agent 共享）。
- **agent 创建时**：从该 agent 的工作区（`session.header.cwd`）向上查找
  `.mcp.json`，挂载到该 agent（只对该工作区的对话可见，agent 销毁自动卸载）。

每个 `.mcp.json` 的 `mcpServers` 条目挂载为一个 `@deepseek-ai/dsh-mcp-client` 实例：

| .mcp.json 条目 | 映射到 |
|---|---|
| 含 `command` | `transport: stdio` |
| 含 `url`（或 `type` 为 http/sse/streamable-http） | `transport: streamable-http` |

工具以 `mcp__<serverName>__<tool>` 的形式暴露给模型。

### 示例 .mcp.json

复制 [.mcp.json.example](.mcp.json.example) 为工作目录下的 `.mcp.json`：

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

### 配置

```yaml
- id: loulan-mcp
  name: /绝对/路径/packages/mcp/src/index.ts
  config:
    cwd: /path/to/.dsh           # .dsh 根目录（启动时全局加载），默认 $DSH_HOME / ~/.dsh；工作区随 agent 动态加载，无需配置
```

## 插件 2：hello

通过 `@deepseek-ai/dsh-commands` 的命令注册表注册全局斜杠命令 `/hello`。在聊天框
输入 `/hello` 后，命令处理器返回 `{ kind: 'success', text: '你好' }`，由聊天界面直接
渲染「你好」；不经过模型，也不改变对话行为。

- 固定输出「你好」，无配置项、无参数解析。
- `inject: ['commands']` 声明对命令注册表服务的依赖。

```yaml
- id: hello
  name: /绝对/路径/packages/hello/src/index.ts
```

## 注意

- `cordis.yml` 里的 `name` **必须是绝对路径**：loader 用 profile 目录（而非本
  文件所在目录）解析模块。项目被移动后需同步更新其中各插件的绝对路径。
- 插件源码使用可擦除的 TypeScript 语法（仅类型注解 / `interface` / `import type`），
  依赖 Node 原生类型擦除直接运行，无需构建步骤。
- 本项目 `@deepseek-ai/*` 依赖来自 harness checkout 的软链，不属于 npm registry；
  分发时请改用 bundle 打包方式（`dsh.bundle` + `dsh plugin add`）。
