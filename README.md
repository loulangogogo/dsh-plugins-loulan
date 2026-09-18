# dsh-plugins-loulan

一个 **DeepSeek Harness（DSH）多插件开发项目**（pnpm monorepo）。目前包含三个插件：

| 插件（包名） | 目录 | 作用                                                                     |
|---|---|------------------------------------------------------------------------|
| `dsh-loulan-mcp` | [packages/mcp](packages/mcp) | 自动读取项目里的 `.mcp.json`，把其中的 MCP server 挂载进 DSH；Web profile 下额外提供「MCP」标签页 |
| `dsh-plugin-hello` | [packages/hello](packages/hello) | 注册斜杠命令 `/hello`，在聊天界面输出「你好」（测试插件）                                      |
| `dsh-loulan-rules` | [packages/rules](packages/rules) | 读取全局 `~/.dsh/rules` 与项目 `.dsh/rules` 下的规则文件并注入会话                       |

每个插件的完整说明（核心能力、配置、约束、常见问题、设计记录）见其自带文档，本文件只做项目级索引：

- [packages/mcp/README.md](packages/mcp/README.md)、[packages/mcp/AGENTS.md](packages/mcp/AGENTS.md)（该包的 AI 协作指导）
- [packages/hello/README.md](packages/hello/README.md)
- [packages/rules/README.md](packages/rules/README.md)

---

## 目录结构

```text
dsh-plugins-loulan/
├── cordis.yml              # patch overlay：把三个插件以源码入口插入 DSH 组合
├── package.json            # workspace 根：dev / link:dsh / test-mcp / test-rules / typecheck
├── pnpm-workspace.yaml
├── tsconfig.json           # 全仓库类型检查（排除浏览器半侧）
├── .mcp.json.example       # MCP 配置示例（改名为 .mcp.json 使用）
├── scripts/
│   ├── dsh.env             # 统一环境配置：DSH_HARNESS（默认 ~/.dsh/deepseek-harness）
│   ├── link-dsh.sh         # 软链 harness 的 @deepseek-ai/* 包
│   ├── dev.sh              # 以本 overlay 启动 DSH Web UI（端口 13080）
│   ├── test-mcp.sh         # 只加载 mcp 插件启动 Web UI（端口 13080，先 build）
│   └── test-rules.sh       # 只加载 rules 插件启动 Web UI（端口 13081，先 build）
└── packages/
    ├── mcp/                # 插件 1：dsh-loulan-mcp
    ├── hello/              # 插件 2：dsh-plugin-hello
    └── rules/              # 插件 3：dsh-loulan-rules
```

## 插件是什么

在 DSH 中，插件就是一个导出 `apply(ctx, config)` 函数的 TypeScript 模块。框架
加载时调用 `apply`，传入一个 `ctx`（上下文对象）；插件通过 `ctx` 注册事件
监听、工具、服务等能力，卸载时自动清理。

## 环境准备

1. 需要一份可运行的 DeepSeek Harness checkout（本项目默认假设它在
   `~/.dsh/deepseek-harness`，可用 `DSH_HARNESS` 覆盖，见 `scripts/dsh.env`）。
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

| 命令 | 作用 |
|---|---|
| `pnpm dev` | 以根 `cordis.yml` 启动 Web UI，三个插件都用源码入口，端口 **13080** |
| `pnpm test-mcp` | 先 build `dsh-loulan-mcp`，再以 `packages/mcp/cordis.patch.yml` 单独启动 Web UI（端口 13080） |
| `pnpm test-rules` | 先 build `dsh-loulan-rules`，再以 `packages/rules/cordis.patch.yml` 单独启动 Web UI（端口 13081） |
| `pnpm typecheck` | 用根 `tsconfig.json` 做全仓库类型检查（不含各包浏览器半侧） |

> ⚠️ `test-mcp` / `test-rules` 名字像单元测试，**实际是「先构建、再启动 Web UI」**；
> 真正的单元测试在各包内，用 `pnpm --filter <包名> test`。

启动后打开 <http://127.0.0.1:13080>（`pnpm test-rules` 是 13081）。`pnpm dev` 等价于：

```sh
cd ~/.dsh/deepseek-harness
pnpm dsh web --patch /绝对/路径/dsh-plugins-loulan/cordis.yml --port 13080
```

---

## 插件 1：dsh-loulan-mcp

按生命周期分离加载：

- **启动时**：从 `.dsh` 根目录（`cwd`，默认 `$DSH_HOME` 或 `~/.dsh`）读取
  `.mcp.json`，挂载到全局（所有 agent 共享）。
- **agent 创建/恢复时**：从该 agent 的工作区（`session.header.cwd`）读取
  `.mcp.json`，挂载到该会话（只对该工作区的对话可见，agent 销毁自动卸载）。

**查找规则：只在起始目录本身查找 `.mcp.json`，不向上递归父目录。**

每个 `.mcp.json` 的 `mcpServers` 条目挂载为一个 `@deepseek-ai/dsh-mcp-client` 实例：

| .mcp.json 条目 | 映射到 |
|---|---|
| 含字符串 `command` | `transport: stdio`（`args` / `env` / `cwd` 可选） |
| 含字符串 `url` | `transport: streamable-http`（`headers` 可选） |
| 两者都有 | 按 `command` 处理（stdio 优先） |
| 两者皆无 | 跳过该条目并打印告警 |
| `type` 字段 | 当前不参与判断，写了不影响结果 |

工具以 `mcp__<serverName>__<tool>` 的形式暴露给模型；工作区挂载会为 `serverName`
拼上会话唯一后缀（如 `postgres_9f2c1a7b3d5e`），同一工作区的多个会话互不冲突。

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

### 「MCP」标签页与 HTTP 端点

Web profile（提供 `webServer` 的 profile）下，视图区新增与「对话」「轨迹」同级的
**「MCP」标签页**，按「本工作区 / 手动添加 / 全局共享」三组列出服务名、传输方式与
工具名，并支持刷新、添加、卸载。Host 半侧注册的端点：

| 端点 | 作用 |
|---|---|
| `GET /dsh-loulan-mcp/mounts?sessionId=…` | 读取三组清单（读取前先与磁盘上的全局配置对齐） |
| `POST /dsh-loulan-mcp/refresh` | 全局增量重挂 + 本会话重挂 |
| `POST /dsh-loulan-mcp/add` | 上传 `.mcp.json` 并挂到当前会话（上限 256 KiB） |
| `POST /dsh-loulan-mcp/unload` | 卸载本会话的一个来源分组（全局共享一律 `400`） |

三个写端点在有 agent 处于 `running` 时返回 `409`（空闲保护）。展示信息只走插件内存
注册表与 HTTP 端点，**不写会话日志、不进模型上下文**。

### 配置

```yaml
- id: dsh-loulan-mcp
  name: /绝对/路径/packages/mcp/src/index.ts
  config:
    cwd: /path/to/.dsh           # .dsh 根目录（启动时全局加载），默认 $DSH_HOME / ~/.dsh；工作区随 agent 动态加载，无需配置
```

### 开发与发布

```sh
pnpm --filter dsh-loulan-mcp test     # 单元测试（node:test + harness 自带 tsx）
pnpm --filter dsh-loulan-mcp build    # Host tsc + 客户端类型检查 + esbuild 打包 lib/client.js
pnpm --filter dsh-loulan-mcp release  # 登录并发布到 npm
```

本插件同时包含 Host 与浏览器两半：`package.json` 声明了 `dsh.client`，因此
**必须存在构建产物 `lib/client.js`**，只声明不构建会让 Web 启动时报聚合错误；
改动客户端代码后需重新 build 并刷新页面。

## 插件 2：hello [测试插件]

通过 `@deepseek-ai/dsh-commands` 的命令注册表注册全局斜杠命令 `/hello`。在聊天框
输入 `/hello` 后，命令处理器返回 `{ kind: 'success', text: '你好' }`，由聊天界面直接
渲染「你好」；不经过模型，也不改变对话行为。

- 固定输出「你好」，无配置项、无参数解析。
- `inject: ['commands']` 声明对命令注册表服务的依赖。

```yaml
- id: hello
  name: /绝对/路径/packages/hello/src/index.ts
```

发布为 bundle 后可直接安装（`package.json` 的 `dsh.bundle.patch` 指向包内
[cordis.patch.yml](packages/hello/cordis.patch.yml)）：

```sh
dsh plugin --profile <profile> add dsh-plugin-hello
```

开发与发布：

```sh
pnpm --filter dsh-plugin-hello test     # 单元测试（node:test + harness 自带 tsx）
pnpm --filter dsh-plugin-hello build    # tsc 产出 lib/
pnpm --filter dsh-plugin-hello pack     # prepack 自动 build，生成 tarball
pnpm --filter dsh-plugin-hello release  # 登录并发布到 npm
```

> 插件入口是编译产物 `lib/index.js`：DSH 从 profile 的 `node_modules` 加载插件，而
> Node 拒绝对 `node_modules` 下的 `.ts` 源码擦除类型
> （`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`），因此分发必须用编译后的 JS。

## 插件 3：rules

在会话第一次进入的 `agent/pre-step`，读取规则目录下的所有规则文件并注入对话：

- **全局**：`$DSH_HOME/rules`（缺省 `~/.dsh/rules`）。
- **项目**：会话工作目录下的 `<cwd>/.dsh/rules`。

递归读取普通文件（跳过符号链接），全局在前、项目在后，组合成一条 user 角色的
`<system-reminder>` 折入请求批次（紧随用户直接输入之后）。规则随历史持久保留，
恢复会话时不会重复注入；被 compaction 遮蔽后会在下一次 pre-step 自动补回。单文件
默认上限 256 KiB、总预算 64 KiB，超出的文件会被整份省略并在消息中注明。

```yaml
- id: rules
  name: /绝对/路径/packages/rules/src/index.ts
  config:
    dshHome: /path/to/.dsh   # 缺省 $DSH_HOME 或 ~/.dsh
    maxBytes: 65536          # 整条规则消息字节上限；<=0 禁用注入
    maxSourceBytes: 262144   # 单个规则文件字节上限，超过则整份省略
```

发布为 bundle 后可直接安装（包内 [cordis.patch.yml](packages/rules/cordis.patch.yml)）：

```sh
dsh plugin --profile <profile> add dsh-loulan-rules
```

开发与发布：

```sh
pnpm --filter dsh-loulan-rules test     # 单元测试（node:test + harness 自带 tsx）
pnpm --filter dsh-loulan-rules build    # tsc 产出 lib/
pnpm --filter dsh-loulan-rules pack     # prepack 自动 build，生成 tarball
pnpm --filter dsh-loulan-rules release  # 登录并发布到 npm
```

## 注意

- **patch overlay 的 `name` 用相对路径**（根 `cordis.yml` 如 `./packages/hello/src/index.ts`）：
  loader 按 **patch 文件自身所在目录**解析，所以整个项目可以整体移动，无需改路径；
  只有把插件目录挪到相对本文件的新位置时才需要同步修改。包内 `cordis.patch.yml`
  同理用 `./lib/index.js`，因此发布为 bundle 后也能解析到自身产物。
- 以源码接入（根 `cordis.yml` + `pnpm dev`）时，Host 侧源码使用可擦除的 TypeScript
  语法（仅类型注解 / `interface` / `import type`），依赖 Node 原生类型擦除直接运行，
  无需构建；**发布为 bundle 安装、以及 mcp 的浏览器半侧则需要先 `build`**。
- 本项目 `@deepseek-ai/*` 依赖来自 harness checkout 的软链，不属于 npm registry；
  分发时请改用 bundle 打包方式（`dsh.bundle` + `dsh plugin add`）。
