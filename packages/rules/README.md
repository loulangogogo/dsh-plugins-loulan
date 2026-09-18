# dsh-loulan-rules

[English](README.en.md) | 中文

> **把散落在 `.dsh/rules` 里的规则文件，变成每次对话都随身携带的规则上下文。**

`dsh-loulan-rules` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的规则注入插件：

- **全局**：读取 `$DSH_HOME/rules`（缺省 `~/.dsh/rules`），所有项目共享；
- **项目**：读取会话工作目录下的 `<cwd>/.dsh/rules`，跟着项目走；
- **首次进入时注入**：在第一次 `agent/pre-step` 把所有规则组合成一条 user 角色的 `<system-reminder>`，随会话历史持久保留。

它**不是** `AGENTS.md` 的替代品，而是一个「可按主题拆分、可全局/项目分层」的规则目录加载器；两者可以同时启用。

## 30 秒速览

| | |
|---|---|
| **零配置** | 把规则文件放进 `~/.dsh/rules` 或 `<项目>/.dsh/rules` 即可，不用改任何配置 |
| **分层** | 全局在前、项目在后；项目规则更具体，应优先于全局 |
| **持久** | 注入的是一条普通 `user/message` 事件，随历史保留，后续每次请求都会携带 |
| **幂等** | 恢复会话、插件热重载都不会重复注入；可见历史里已有本插件的规则消息就跳过 |
| **有界** | 单文件默认上限 256 KiB，整条消息默认 64 KiB；放不下的文件整个省略并在消息里注明 |
| **转义** | 规则原文里的字面 `</system-reminder>` 会被转义，仓库文本无法提前关闭插件框架 |

**兼容性**：依赖 DSH 运行时提供的 `@deepseek-ai/cordis`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-llm`（见 `package.json` 的 `peerDependencies`）；插件不感知客户端界面，任何 profile 都可用。

## 目录

- [1. 它解决什么问题](#1-它解决什么问题)
- [2. 核心能力](#2-核心能力)
- [3. 安装](#3-安装)
- [4. 使用](#4-使用)
- [5. 配置](#5-配置)
- [6. 工作原理](#6-工作原理)
- [7. 约束与已知限制](#7-约束与已知限制)
- [8. 常见问题](#8-常见问题)
- [9. 开发与发布](#9-开发与发布)
- [10. 设计记录](#10-设计记录)

---

## 1. 它解决什么问题

DSH 原生已支持 `AGENTS.md`/`CLAUDE.md`（由 `@deepseek-ai/dsh-agent-instructions` 加载）：一个用户全局文件，加上从项目根到会话 cwd 每一级目录里的固定候选名。它覆盖了大多数场景。本插件解决的是另一类偏好：

- 想把规则**按主题拆成多个文件**，而不是每级目录只放一个 `AGENTS.md`；
- 想用**一个专门的规则目录**收纳规则，不必散落在业务目录里，也不必占用 `AGENTS.md` 这个通用名字；
- 想要**一次全量注入**的简单与确定，不需要逐 scope 的增量对账与变更通知。

它刻意保持简单：**没有文件监视器、不做逐文件变更通知、不解析 imports 或目录规则系统**。规则在会话第一次进入时读一次，之后随历史生效；两者可以同时启用。

| 维度 | `AGENTS.md`（内置） | `dsh-loulan-rules` |
|---|---|---|
| 命名与位置 | 每级目录的固定候选名（`AGENTS.md`/`CLAUDE.md` + `.local` 叠加） | 固定目录 `~/.dsh/rules`、`<cwd>/.dsh/rules`，文件名随意 |
| 覆盖范围 | 用户全局一个文件 + 项目目录链 | 两个目录的**全部普通文件**（递归） |
| 变更跟踪 | 随文件系统 touch 动态刷新、逐 scope 对账 | 不做，只在首次注入 |
| 压缩后 | 逐 scope 自愈补回 | 整份自动补回 |
| 共同点 | 都是低权威 user 上下文；都转义 `</system-reminder>`；都有字节预算 | 同左 |

## 2. 核心能力

| 能力 | 说明 |
|---|---|
| 双来源 | 全局 `$DSH_HOME/rules` 与项目 `<cwd>/.dsh/rules`，可同时生效 |
| 确定性顺序 | 全局在前、项目在后；目录内按绝对路径排序，结果稳定可复现 |
| 递归收集 | 递归读取子目录；符号链接（文件或目录）一律跳过，避免环路 |
| 有界读取 | 单文件超过 `maxSourceBytes` 直接省略；不截断、不半截注入 |
| 有界渲染 | 整条消息不超过 `maxBytes`；放不下的文件记为省略并在消息里列出路径 |
| 会话内单次 | 同一会话正常进行时只注入一次；恢复会话/热重载不重复；被 compaction 遮蔽后会在下一次 pre-step 自动补回 |
| 幂等去重 | 可见历史或本轮已领取消息里已有本插件规则消息就跳过 |
| 关闭开关 | `maxBytes` 设为 `<=0` 或非有限值时完全禁用注入 |

## 3. 安装

### 3.1 从 profile 安装（包发布后）

```sh
dsh plugin --profile web add dsh-loulan-rules
```

该命令把包装进 profile 目录，并因为包声明了 `dsh.bundle.patch` 而自动加入 `dsh.profile.bundles`；装完重启 DSH 生效。可用 `dsh --profile web --dump-config` 查看是否出现对应的 patch 层。

### 3.2 从源码本地接入（当前开发方式）

前提：一份可运行的 DSH checkout（默认 `~/.dsh/deepseek-harness`）、Node ≥ 23.6。

```sh
pnpm install

# 把 harness 里的 @deepseek-ai/* 包软链进来，使源码能像 monorepo 内插件那样 import
pnpm link:dsh                                # 读 DSH_HARNESS，缺省 ~/.dsh/deepseek-harness
pnpm link:dsh -- /path/to/deepseek-harness   # 或显式指定 harness 路径

# 以本仓库的 cordis.yml 作为 patch overlay 启动 Web UI（固定端口 13080）
pnpm dev
```

仓库根的 `cordis.yml` 已经把 `packages/rules` 以源码入口 `./packages/rules/src/index.ts` 接进 overlay，`pnpm dev` 会自动带上它。

> `pnpm install` 会重建 `node_modules` 并可能为 peer 依赖装出第二份 `@deepseek-ai/*`，**之后需要删掉 `packages/rules/node_modules` 并重跑一次 `pnpm link:dsh`**（详见[常见问题](#pnpm-install-后-ide-出现大量红标)）。

### 3.3 确认是否生效

1. 新建一个会话（或在尚未注入过的会话里）发一条消息；
2. 该会话的请求历史里应出现一条 `<system-reminder>`，其中包含 `Rules from: ~/.dsh/rules/...` 与 `Rules from: .dsh/rules/...` 段落；
3. 若一条都没有，见[常见问题](#为什么一条规则都没有注入)。

## 4. 使用

### 4.1 写规则文件

全局规则放 `~/.dsh/rules/`，项目规则放 `<会话工作目录>/.dsh/rules/`：

```text
~/.dsh/rules/
├── All.md          # 所有项目通用的行为准则
└── Code.md         # 通用编码规范

<项目>/.dsh/rules/
├── Team.md         # 本项目的协作约定
└── Python.md       # 本项目 Python 相关要求
```

文件内容是自由文本（Markdown 即可），会按原文注入，不做任何摘要或改写。

### 4.2 查找与排序

- 两个目录都**递归**收集所有普通文件；
- 目录不存在、无文件、或读取失败时静默跳过，不影响会话；
- 目录内按绝对路径排序；
- **符号链接（文件与目录）一律跳过**——既避免环路，也让规则集保持确定性。

### 4.3 注入时机与位置

| 项 | 行为 |
|---|---|
| 时机 | 会话第一次进入的 `agent/pre-step`；空的首批进入（不会发起请求）保持原样 |
| 位置 | 折在**用户直接输入之后**、驱动追加的运行时上下文之前 |
| 作用域 | 每个会话独立；规则随该会话的历史持久保留 |
| 重复 | 可见历史或本轮已领取消息里已有本插件规则消息就跳过（恢复会话不重复） |
| 变更 | **不监听**运行中的文件变化；改了规则需新开会话才生效 |

### 4.4 注入形态

整条消息由固定的前言、可选的省略说明，以及每个文件一个 `Rules from:` 段落组成：

```markdown
<system-reminder>
From this point forward, please treat the content I provide next as the **persistent behavioral rules for this conversation**.
…（固定前言，约 1.5 KB，完整文本见 src/render.ts 的 INTRO）

**The following content defines the rules you must continue to follow:**

Rules from: ~/.dsh/rules/All.md

<文件原文>

Rules from: .dsh/rules/Team.md

<文件原文>
</system-reminder>
```

前言是**固定的**，它的字节数也计入 `maxBytes`。因此把 `maxBytes` 调到比前言还小时，所有规则文件都会因放不下而被省略。

### 4.5 预算与省略

| 情况 | 行为 |
|---|---|
| 单文件 > `maxSourceBytes` | 该文件整个省略，记入省略说明 |
| 加入某文件后整条消息 > `maxBytes` | 该文件整个省略，继续尝试后续更小的文件 |
| 收尾时省略说明本身撑破预算 | 从尾部继续丢弃文件，保证最终文本 `<= maxBytes` |
| 全部被省略 | 不注入任何消息（不会产生空的 `<system-reminder>`） |

省略的文件会以「（已省略超出预算或过大的规则文件：…）」的形式列在消息开头。

## 5. 配置

| 字段 | 说明 | 默认 |
|---|---|---|
| `dshHome` | DSH home 目录（全局规则位于其下的 `rules/`） | `$DSH_HOME` 或 `~/.dsh` |
| `maxBytes` | 整条规则消息的 UTF-8 字节上限；`<=0` 或非有限值禁用注入 | `65536`（64 KiB） |
| `maxSourceBytes` | 单个规则文件的 UTF-8 字节上限，超过则省略 | `262144`（256 KiB） |

配置项均可省略；插件不导出 schemastery schema，直接使用上面的默认值。在 profile 的 `cordis.patch.yml` 中覆盖：

```yaml
- id: rules
  name: dsh-loulan-rules
  config:
    dshHome: /path/to/.dsh
    maxBytes: 65536
    maxSourceBytes: 262144
```

## 6. 工作原理

```text
~/.dsh/rules/*                    <会话 cwd>/.dsh/rules/*
        │                                    │
        └──────────────────┬─────────────────┘
                           ▼
           第一次进入的 agent/pre-step
           递归收集（按路径排序、跳过符号链接）
                           ▼
           预算裁剪（单文件 256 KiB / 总 64 KiB）
                           ▼
           渲染 <system-reminder>（转义闭合标签）
                           ▼
   折入本次请求批次：用户直接输入之后、运行时上下文之前
                           ▼
             持久 user/message → 随历史进入每次请求
```

**去重**：插件的规则消息来源为 `{ kind: 'plugin', plugin: 'rules', form: 'instructions' }`。注入前扫描已领取消息与会话可见历史，只要存在本插件的规则消息就跳过，因此恢复会话、插件热重载都不会重复。

**读取方式**：直接用 `node:fs` 读取文件，**不使用 `ctx.fs` 文件系统提供方**，因此不经过 DSH 的文件沙箱策略——规则目录应视为可信输入。

**转义**：正文里所有字面 `</system-reminder>` 都会被替换为 `<\/system-reminder>`，规则内容无法提前关闭插件控制的框架。

## 7. 约束与已知限制

| 限制 | 说明 |
|---|---|
| 文件变更不重注入 | 会话进行中修改规则文件不会重新注入（没有文件监视器）；需新开会话 |
| 不逐文件通知 | 不产生 `Updated/Removed instructions` 之类的增量消息，只整体注入一次 |
| 不走文件沙箱 | 使用 `node:fs` 直接读取，不经过 `ctx.fs` 策略；规则目录必须可信 |
| 不解析高级语义 | 不解析 imports、`.claude/rules/`、目录规则系统等 |
| 跳过符号链接 | 文件与目录符号链接都不跟随，避免环路 |
| 不做内容截断 | 超限的文件整个省略，不会注入半截内容 |
| 前言固定 | 前言约 1.5 KB 且计入 `maxBytes`；预算过小时会一条规则都进不去 |
| 信任边界 | 规则文本属低权威 user 上下文，不覆盖 system/developer/用户直接指令；但无法消除提示词注入 |

## 8. 常见问题

### 为什么一条规则都没有注入

按顺序排查：

1. **目录与文件**：`~/.dsh/rules` 或 `<cwd>/.dsh/rules` 是否存在、里面有普通文件？
2. **预算是否太小**：固定前言约 1.5 KB，`maxBytes` 小于它时所有文件都放不下。默认 64 KiB 不会遇到。
3. **单文件是否过大**：超过 `maxSourceBytes`（默认 256 KiB）的文件会被整个省略。
4. **是否已经注入过**：同一会话正常进行时只注入一次；历史里已有本插件规则消息（且未被压缩移除）就不会重复。

### 改了规则文件，为什么这次对话没变化

本插件没有 watcher，也不做运行中变化检测。规则只在会话第一次进入时读取；要让改动生效，请新开一个会话。

### 规则里写 `</system-reminder>` 会怎样

会被转义为 `<\/system-reminder>`，不会提前闭合插件的框架，也不会让后续文本逃逸成系统指令。

### 和 `AGENTS.md` 插件会冲突吗

不会。两者各自在自己的 `agent/pre-step` 里把内容折入请求批次，互不感知、可同时启用。经验上：把「跨项目长期规则」放 `~/.dsh/rules`，「仓库级说明」继续用 `AGENTS.md`，分工更清楚。

### `pnpm install` 后 IDE 出现大量红标

根因是同一份 `@deepseek-ai/*` 出现了两个实例：仓库根 `node_modules/@deepseek-ai/*` 是 `pnpm link:dsh` 建的 harness 软链，而 `packages/rules/node_modules/@deepseek-ai/*` 是 pnpm 为 `peerDependencies` 自动装入的 registry 副本。品牌类型（如 `MessageId`）在两份声明间不兼容，于是 TypeScript 报出 `UserMessage | UserMessage` 之类的错误。

处理：删掉 `packages/rules/node_modules`，再跑一次 `pnpm link:dsh`，让解析回落到 harness 软链。

> DSH 生成的 profile 配置是 `nodeLinker: hoisted` + `autoInstallPeers: false`，peer 不会被自动安装，所以真实 profile 安装不会出现这个重复；问题只在开发仓库（`autoInstallPeers` 默认 `true`）。想从根上消除，可在仓库根 `pnpm-workspace.yaml` 加 `autoInstallPeers: false`。

### 规则会不会被压缩掉

会。注入的是一条普通 `user/message`，可能被 compaction 遮蔽。但去重依赖的是「可见历史里是否还有本插件的规则消息」，被遮蔽后就检测不到，因此**下一次 `agent/pre-step` 会自动重新注入一份完整的当前规则**（与 `@deepseek-ai/dsh-agent-instructions` 的压缩自愈行为一致）。

## 9. 开发与发布

### 目录结构

```text
packages/rules/
├── src/
│   ├── index.ts        # 插件入口：pre-step 钩子、去重、折入批次
│   ├── load.ts         # 规则目录递归发现、读取、单文件上限与总预算
│   ├── render.ts       # 渲染 <system-reminder>、固定前言、闭合标签转义
│   └── config.ts       # 配置默认值与 DSH home 解析
├── test/               # node:test 单元测试（经 harness 自带 tsx 运行）
├── scripts/
│   └── test-unit.sh    # 测试入口
├── cordis.patch.yml    # 打包分发用的挂载 patch（id: rules）
└── tsconfig.build.json # 构建到 lib/
```

### 常用命令

```sh
bash scripts/test-unit.sh   # 单元测试（node:test + tsx）
pnpm build                  # tsc 产出 lib/
pnpm pack                   # prepack 自动 build，生成 dsh-loulan-rules-<version>.tgz
```

### 产物与发布约定

- **`lib/` 不入库**，由构建生成；`package.json` 的 `files` 包含 `lib` 与 `cordis.patch.yml`。
- `package.json` 的 `dsh.bundle.patch` 指向 `./cordis.patch.yml`，因此可作为 bundle 被 `dsh plugin add` 安装。
- `prepack` 已自动触发 `build`。
- 发布到 npm 后，用户执行 `dsh plugin --profile <name> add dsh-loulan-rules`；也可直接交付 `pnpm pack` 出来的 tarball。
- ⚠️ **删除某个 `src/` 模块后先清理 `lib/`**：`tsc` 不会删除输出目录里的旧产物，残留模块会被一起发布；构建前 `rm -rf lib` 最省心。

### 依赖声明约定

`@deepseek-ai/cordis`、`@deepseek-ai/dsh-agent`、`@deepseek-ai/dsh-llm` 由 DSH 运行时提供，因此声明为 `peerDependencies`，**不要放进 `dependencies`**——后者会装入第二份副本，运行时与类型都会出问题。

## 10. 设计记录

本插件是 DSH 原生工作区指令加载器 `@deepseek-ai/dsh-agent-instructions` 的轻量变体，思路与取舍可参考：

| 资料 | 内容 |
|---|---|
| [deepseek-harness 仓库](https://github.com/deepseek-ai/deepseek-harness) | DSH 主仓库 |
| `packages/context/agent-instructions`（harness 内） | `AGENTS.md`/`CLAUDE.md` 加载器：候选文件、项目根发现、预算渲染、动态刷新与压缩自愈 |
| `.agents/notes/archived/feature/2026-06-24-workspace-context.md`（harness 内） | 工作区上下文的设计决策记录，含「为何不用系统提示词章节」等取舍 |

与 `dsh-agent-instructions` 的差异：本插件只做「目录内所有文件 + 会话内单次 + 整条预算」，不跟踪逐文件变更、不跟随符号链接；压缩后靠「可见历史里已没有规则消息」自动补回整份，而不是按 scope 做增量对账。
