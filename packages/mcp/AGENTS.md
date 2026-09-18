# AGENTS.md

This file provides guidance to the AI agent when working with code in this repository.

## 项目概览

`dsh-loulan-mcp` 是 pnpm monorepo `dsh-plugins-loulan` 中的一个包，为 DeepSeek Harness（DSH）提供 MCP 挂载能力。仓库根在上一级目录（同级还有 `hello`、`rules` 两个插件包）。

## 环境与依赖

- Node ≥ 23.6，依赖原生 TypeScript 类型擦除。
- `@deepseek-ai/*` **不是 npm registry 依赖**，而是由 `pnpm link:dsh` 软链到 harness checkout（默认 `~/.dsh/deepseek-harness`，可用 `DSH_HARNESS` 覆盖）。
- **`pnpm install` 会重建 `node_modules` 并清掉软链，之后必须重跑 `pnpm link:dsh`。**
- harness checkout 是外部只读依赖，不要修改其中的任何文件。

## 常用命令

会话 cwd 是 `packages/mcp`；根级命令要么 `cd ..`，要么用 `--filter`。

| 命令 | 作用 |
|---|---|
| `pnpm --filter dsh-loulan-mcp test` | 单元测试 |
| `pnpm --filter dsh-loulan-mcp build` | Host `tsc` + 客户端类型检查 + esbuild 打包 `lib/client.js` |
| `pnpm dev`（根目录） | 启动 DSH Web UI，**端口 13080** |
| `pnpm test-mcp`（根目录） | ⚠️ 名字像测试，实际是「先 build 再启动 Web UI」，不是单元测试 |

- 测试**不能**直接用 `node --test`：源码用 NodeNext 风格的 `.js` 相对导入，而 Node 原生类型擦除不会把 `.js` 解析到 `.ts`；`scripts/test-unit.sh` 复用 harness 自带的 tsx 来跑。
- 验证插件已挂载：`curl -s http://127.0.0.1:13080/dsh-loulan-mcp/mounts`
- 两套 tsconfig：`tsconfig.build.json`（Host，排除 `src/client`，emit 到 `lib/`）与 `tsconfig.client.json`（客户端，`noEmit`，含 `src/client` 与 `src/contract.ts`）。

## 构建陷阱

- **删除 `src/` 模块后先 `rm -rf lib` 再 build**：`tsc` 不清理输出目录，残留产物会被一起发布。
- 声明了 `dsh.client` 就必须同时有 `lib/client.js`：只声明不构建会让 Web 启动时报聚合错误。改完客户端代码需重建并刷新页面。
- 根 `cordis.yml` 的 `name` 用**绝对路径**（loader 按 profile 目录解析）；包内 `cordis.patch.yml` 用**相对路径**（按 patch 文件自身解析）。项目移动后需同步根文件中的绝对路径。
- 新增客户端外部依赖时，要加进 `scripts/build-client.mjs` 的 `PLATFORM_MODULES`，否则会被打进 bundle。
- `@deepseek-ai/dsh-mcp-client` 版本必须与 DSH 运行时一致；版本错配会出现两份 mcp-client，导致工具注册冲突。
- `lib/` 不入库（`.gitignore` 已忽略），由构建生成。

## 代码风格（与 TS 默认不同）

- `verbatimModuleSyntax: true`：类型导入必须写 `import type`，不能与值导入混写。
- `strict: true` + `moduleResolution: NodeNext`；源码相对导入一律带 `.js` 后缀（实际指向 `.ts` 源文件）。
- Host 源码只用可擦除的 TS 语法（类型注解 / `interface` / `import type`），靠 Node 原生擦除直接运行；只有浏览器半侧需要构建。
- 注释、文档、提交信息一律使用**中文**。文件头用 `@fileoverview`，函数级 JSDoc 说明用途、参数与返回值。
- 客户端样式内联在 `src/client/styles.ts` 的模板字符串（由 `ensureMcpStyles()` 注入），类名带 `dsh-mcp-` 前缀，颜色只用语义 token（`--dsw-alias-*` / `--dsw-specific-*`）；不要引入 CSS Modules 或硬编码颜色。

## 架构约束

- 所有展示信息只走插件内存注册表与 HTTP 端点，**不进模型上下文、不写会话日志**——这是刻意设计，改动时不要破坏。
- 工作区 `.mcp.json` 只在 `session.header.cwd` 本身查找，**不向上递归父目录**。

## 提交规范

Conventional Commits + 中文描述，scope 用包名，例如 `feat(mcp): ...`、`refactor(mcp): ...`、`remove(example): ...`。
