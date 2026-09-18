# dsh-loulan-rules

在会话第一次进入的 `agent/pre-step`，读取全局与项目规则目录下的所有规则文件，
组合成一条 user 角色的 `<system-reminder>` 注入对话。规则随历史持久保留，后续
每次请求都会携带；恢复会话时若历史中已有本插件的规则消息，则不会重复注入。

## 规则来源

| 来源 | 目录 | 模型可见路径 |
|---|---|---|
| 全局 | `$DSH_HOME/rules`（缺省 `~/.dsh/rules`） | `~/.dsh/rules/...` |
| 项目 | `<会话 cwd>/.dsh/rules` | `.dsh/rules/...` |

- 顺序为全局在前、项目在后；项目规则更具体，应优先于全局规则。
- 目录不存在时静默跳过。
- 递归收集目录下所有普通文件，按路径排序；符号链接（文件或目录）一律跳过。
- 单文件默认上限 256 KiB，总预算默认 64 KiB；放不下的文件会被省略并在消息里注明。
- 文件原文里的字面 `</system-reminder>` 会被转义，仓库文本无法提前关闭插件框架。

## 注入行为

注入的消息形如：

```markdown
<system-reminder>
以下规则文件来自当前工作区，可能与本会话相关。请遵循这些规则；更具体的规则优先于更宽泛的规则。它们不会覆盖 system、developer 或用户的直接指令。

Rules from: ~/.dsh/rules/style.md

<文件原文>

Rules from: .dsh/rules/team.md

<文件原文>
</system-reminder>
```

消息折在用户直接输入之后、驱动追加的运行时上下文之前，与 `@deepseek-ai/dsh-agent-instructions`
注入 `AGENTS.md` 的位置一致。

## 配置

```yaml
- id: rules
  name: /绝对/路径/packages/rules/lib/index.js
  config:
    dshHome: /path/to/.dsh   # 缺省 $DSH_HOME 或 ~/.dsh
    maxBytes: 65536          # 整条规则消息的字节上限；<=0 禁用注入
    maxSourceBytes: 262144   # 单个规则文件的字节上限
```

配置项均可省略；不导出 schemastery schema，直接使用上面的默认值。

## 挂载

本地开发时，本仓库根目录的 `cordis.yml` 已把本插件以源码入口
（`./packages/rules/src/index.ts`）插入组合；`pnpm dev` 启动后即生效。

作为 npm 包分发时，使用包内自带的 patch：

```sh
pnpm build          # 产出 lib/
pnpm pack           # prepack 会自动 build，生成 dsh-loulan-rules-<version>.tgz
```

`package.json` 的 `dsh.bundle.patch` 指向 `./cordis.patch.yml`，因此可以作为
bundle 被 `dsh plugin add` 安装。

## 已知限制

- 仅在**首次**注入：会话进行中修改规则文件不会重新注入（没有文件监视器）。
  需要动态刷新时再补变化检测。
- 只跟随进程直接读取文件系统，不使用 `ctx.fs` 文件系统提供方，因此不经过 DSH 的
  文件沙箱策略；规则目录应视为可信输入。
- 不做逐文件变更/移除通知，也不解析 imports 或目录规则系统。

## 开发

```sh
bash scripts/test-unit.sh   # Node 测试运行器（经 harness 自带 tsx）
pnpm build                  # tsc 产出 lib/，供打包
pnpm typecheck              # 仓库根的类型检查
```
