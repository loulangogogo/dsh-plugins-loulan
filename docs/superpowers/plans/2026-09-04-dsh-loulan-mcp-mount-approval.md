# dsh-loulan-mcp 挂载前审批 + 按业务拆分文件 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让工作区 `.mcp.json` 的 MCP 服务在**挂载前**征求用户同意（同意挂载、拒绝不挂载，每次新建 agent 都询问），并把当前集中在 `src/index.ts` 的插件代码按业务功能拆分文件。

**Architecture:** 插件在 `agent/created` 时探测工作区 `.mcp.json`，记为"待决定"（不挂载）；在该 agent 的首个 `agent/request`（满足 open-turn）时调用 DSH `ApprovalService` 征求用户同意，同意后按方案 B 的唯一 `serverName` 挂载。全局 `.dsh` 根 `.mcp.json` 不询问、仍自动挂载。源码按职责拆成 `config / discover / parse / server-name / mount / approval / index` 七个文件。

**Tech Stack:** TypeScript（Node 26 原生类型擦除）、Cordis Context、`@deepseek-ai/dsh-mcp-client`、`@deepseek-ai/dsh-user-approval`、`node --test`。

## Global Constraints

- 插件名：`dsh-loulan-mcp`；`name` / `Config` / `apply` 由入口 `index.ts` 导出。
- 相对导入统一用 `.js` 扩展名（`moduleResolution: NodeNext`，构建产物需保留 `.js` 后缀）。
- `serverName` 必须匹配 `[A-Za-z0-9_-]{1,32}`（`SERVER_NAME_PATTERN`）。
- `serverName` 上限 32 位；唯一后缀由 `agentToken(agentId)`（SHA‑1 前 12 位 hex）生成。
- 全局根 `.mcp.json`：不带后缀、不询问、自动挂载。
- 无审批服务时 fail-closed（不挂载并告警）。
- 所有中文注释。

---

## File Structure

```
packages/mcp/src/
├── index.ts        # 入口：name/Config/apply；生命周期编排（探测→首turn审批→挂载）
├── config.ts       # Config 接口 + Schema
├── discover.ts     # findMcpJson、dshHome
├── parse.ts        # isRecord、asStringArray、asStringRecord、readMcpServers
├── server-name.ts  # SERVER_NAME_PATTERN、DEFAULT_TOOL_CALL_TIMEOUT_MS、Mapped、agentToken、suffixedServerName、mapServer
├── mount.ts        # mountFile(ctx, file, uniqueSuffix?)
└── approval.ts     # AgentDecision、decisions/pending 状态、askForApproval
```

文件间依赖（无环）：
`parse.ts` ← `server-name.ts` ← `mount.ts`；`parse.ts` ← `index.ts`；`discover.ts` ← `index.ts`；`mount.ts`/`approval.ts` ← `index.ts`；`config.ts` ← `index.ts`。

---

## Task 1: 拆分 config.ts

**Files:**
- Create: `packages/mcp/src/config.ts`
- Modify: `packages/mcp/src/index.ts`（删除其中的 `name` / `Config` 接口 / `Config` Schema，改为 re-export）

**Interfaces:**
- Produces: `export const name: 'dsh-loulan-mcp'`、`export interface Config { cwd: string }`、`export const Config: Schema<Config>`。

- [ ] **Step 1: 新建 `packages/mcp/src/config.ts`**

```ts
/**
 * @fileoverview dsh-loulan-mcp 插件配置。
 *
 * 工作区部分无需配置：随 agent 的 session.header.cwd 动态发现。
 */
import Schema from '@deepseek-ai/schemastery'

/** 插件名，须与 cordis.yml 中的 id 对应。 */
export const name = 'dsh-loulan-mcp'

/**
 * 插件配置。
 *
 * 工作区部分无需配置：随 agent 的 session.header.cwd 动态发现。
 */
export interface Config {
  /** .dsh 根目录（启动时全局加载 .mcp.json 的起点）；默认 $DSH_HOME 或 ~/.dsh。 */
  cwd: string
}

/** 配置 Schema：cwd 默认空串，空串时回退到 $DSH_HOME / ~/.dsh。 */
export const Config: Schema<Config> = Schema.object({
  cwd: Schema.string().default(''),
})
```

- [ ] **Step 2: 暂不修改 `index.ts`**

本任务只新建 `config.ts`；`index.ts` 保持原样（仍自带 `name`/`Config`），在 **Task 7** 才统一改为从 `config.ts` 导入并 re-export，避免中间 typecheck 断裂。`config.ts` 定义将作为 Task 7 的消费源。

- [ ] **Step 3: 提交（只 commit config.ts）**

```bash
git add packages/mcp/src/config.ts
git commit -m "refactor(mcp): 拆分插件配置到 config.ts"
```

---

## Task 2: 拆分 discover.ts

**Files:**
- Create: `packages/mcp/src/discover.ts`
- Modify: `packages/mcp/src/index.ts`（改用 `findMcpJson`/`dshHome`）

**Interfaces:**
- Produces: `findMcpJson(start: string): string | undefined`、`dshHome(): string`。
- Consumes: 无（仅 `node:fs`/`node:os`/`node:path`）。

- [ ] **Step 1: 新建 `packages/mcp/src/discover.ts`**

```ts
/**
 * @fileoverview .mcp.json 与 DSH home 目录发现工具。
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * 查找 start 目录下的 .mcp.json。
 *
 * 只检查起始目录本身，不向上递归父目录。
 *
 * @param start - 起始目录（绝对或相对路径均可，内部会 resolve）
 * @returns start 目录下 .mcp.json 的绝对路径；不存在则返回 undefined
 */
export function findMcpJson(start: string): string | undefined {
  const candidate = join(resolve(start), '.mcp.json')
  return existsSync(candidate) ? candidate : undefined
}

/**
 * 确定 DSH home 目录。
 *
 * 优先使用环境变量 $DSH_HOME，缺省时回退到 ~/.dsh。
 *
 * @returns DSH home 目录路径（如 /Users/<name>/.dsh）
 */
export function dshHome(): string {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/mcp/src/discover.ts
git commit -m "refactor(mcp): 拆分 .mcp.json 发现到 discover.ts"
```

---

## Task 3: 拆分 parse.ts

**Files:**
- Create: `packages/mcp/src/parse.ts`
- Modify: `packages/mcp/src/index.ts`（改用 `readMcpServers`/`isRecord` 等）

**Interfaces:**
- Produces: `isRecord(value: unknown): value is Record<string, unknown>`、`asStringArray(value: unknown): string[]`、`asStringRecord(value: unknown): Record<string, string>`、`readMcpServers(file: string): Promise<Record<string, unknown>>`（读取/解析失败时 throw）。

- [ ] **Step 1: 新建 `packages/mcp/src/parse.ts`**

```ts
/**
 * @fileoverview .mcp.json 解析与防御式类型校验工具。
 */
import { readFile } from 'node:fs/promises'

/**
 * 判断一个值是否为普通对象（非 null、非数组）。
 *
 * 用于对 .mcp.json 解析结果做防御式校验，避免把数组/null 误当作配置对象。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 从任意值中提取字符串数组，过滤掉非字符串元素。
 *
 * 用于解析 .mcp.json 中 stdio 条目的 args 字段（可能缺失或含非字符串）。
 */
export function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/**
 * 从任意值中提取字符串键值对，过滤掉非字符串值。
 *
 * 用于解析 .mcp.json 中 stdio 条目的 env、http 条目的 headers 字段。
 */
export function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string') result[key] = item
  }
  return result
}

/**
 * 读取并解析 .mcp.json，返回其中的 mcpServers（缺失或非对象时视为空对象）。
 *
 * 读取/JSON 解析失败时抛错，由调用方捕获处理。
 *
 * @param file - .mcp.json 文件路径
 * @returns mcpServers 映射；文件无 mcpServers 或结构不正确时返回空对象
 */
export async function readMcpServers(file: string): Promise<Record<string, unknown>> {
  const doc: unknown = JSON.parse(await readFile(file, 'utf8'))
  return isRecord(doc) && isRecord(doc.mcpServers) ? doc.mcpServers : {}
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/mcp/src/parse.ts
git commit -m "refactor(mcp): 拆分解析与防御校验到 parse.ts"
```

---

## Task 4: 拆分 server-name.ts

**Files:**
- Create: `packages/mcp/src/server-name.ts`
- Modify: `packages/mcp/src/index.ts`（改用 `mapServer`/`agentToken` 等）

**Interfaces:**
- Produces: `SERVER_NAME_PATTERN`、`DEFAULT_TOOL_CALL_TIMEOUT_MS`、`type Mapped`、`agentToken(agentId: string): string`、`suffixedServerName(base: string, suffix: string): string`、`mapServer(serverName, raw, projectDir, uniqueSuffix?): Mapped`。
- Consumes: `parse.ts` 的 `isRecord`/`asStringArray`/`asStringRecord`。

- [ ] **Step 1: 新建 `packages/mcp/src/server-name.ts`**

```ts
/**
 * @fileoverview MCP serverName 命名与 .mcp.json 条目映射。
 */
import { createHash } from 'node:crypto'
import type { Config as McpClientConfig } from '@deepseek-ai/dsh-mcp-client'
import { isRecord, asStringArray, asStringRecord } from './parse.js'

/** serverName 命名约束，与 mcp-client 保持一致（字母/数字/下划线/短横线，1-32 位）。 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** mcp-client 默认的单次工具调用超时（毫秒）：60 秒。 */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/** mapServer 的返回类型：成功携带 mcp-client 配置，失败携带原因。 */
export type Mapped =
  | { ok: true; config: McpClientConfig }
  | { ok: false; reason: string }

/**
 * 从 agent/session id 派生一个短、安全、唯一的后缀 token。
 *
 * 对 agent id 做 SHA-1 并取前 12 位十六进制，字符集恒为 [0-9a-f]，
 * 满足 SERVER_NAME_PATTERN，长度足够短，能被 serverName 上限 32 位容纳。
 *
 * @param agentId - agent（或 session）id
 * @returns 12 位十六进制短 token
 */
export function agentToken(agentId: string): string {
  return createHash('sha1').update(agentId).digest('hex').slice(0, 12)
}

/**
 * 给 serverName 追加唯一后缀，并确保总长不超过 mcp-client 约束的 32 位。
 * 超过上限时截断原 base，保留后缀。
 *
 * @param base - .mcp.json 中的原始 serverName
 * @param suffix - 由 agentToken 生成的唯一后缀（无下划线）
 * @returns 拼接后的 serverName（形如 postgres_<token>）
 */
export function suffixedServerName(base: string, suffix: string): string {
  const withSep = `_${suffix}`
  const baseMax = 32 - withSep.length
  const basePart = base.length > baseMax ? base.slice(0, baseMax) : base
  return `${basePart}${withSep}`
}

/**
 * 把 .mcp.json 的一条 mcpServers 条目映射为 mcp-client 配置。
 *
 * 映射规则：有 command → stdio；有 url → streamable-http；两者皆无 → 无效条目。
 *
 * @param serverName - 服务名（须匹配 SERVER_NAME_PATTERN）
 * @param raw - 该条目的原始配置值（期望是对象）
 * @param projectDir - 该 .mcp.json 所在目录，作为 stdio 子进程的默认 cwd
 * @param uniqueSuffix - 方案 B：按 agent 派生唯一后缀，避免同工作区多会话重复挂载冲突
 * @returns 成功时携带 mcp-client 配置；失败时携带原因
 */
export function mapServer(
  serverName: string,
  raw: unknown,
  projectDir: string,
  uniqueSuffix?: string,
): Mapped {
  const mountedName = uniqueSuffix ? suffixedServerName(serverName, uniqueSuffix) : serverName
  if (!SERVER_NAME_PATTERN.test(mountedName)) {
    return { ok: false, reason: `serverName 不合法（需匹配 [A-Za-z0-9_-]{1,32}）: "${mountedName}"` }
  }
  if (!isRecord(raw)) {
    return { ok: false, reason: `配置必须是对象: "${serverName}"` }
  }

  const command = typeof raw.command === 'string' ? raw.command : undefined
  const url = typeof raw.url === 'string' ? raw.url : undefined

  if (command) {
    return {
      ok: true,
      config: {
        transport: 'stdio',
        serverName: mountedName,
        command,
        args: asStringArray(raw.args),
        env: asStringRecord(raw.env),
        cwd: typeof raw.cwd === 'string' ? raw.cwd : projectDir,
        toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
        failOnStartupError: false,
      },
    }
  }

  if (url) {
    return {
      ok: true,
      config: {
        transport: 'streamable-http',
        serverName: mountedName,
        url,
        headers: asStringRecord(raw.headers),
        toolCallTimeoutMs: DEFAULT_TOOL_CALL_TIMEOUT_MS,
        failOnStartupError: false,
      },
    }
  }

  return { ok: false, reason: `既没有 command（stdio）也没有 url（http），已跳过: "${serverName}"` }
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/mcp/src/server-name.ts
git commit -m "refactor(mcp): 拆分 serverName 生成与映射到 server-name.ts"
```

---

## Task 5: 拆分 mount.ts

**Files:**
- Create: `packages/mcp/src/mount.ts`
- Modify: `packages/mcp/src/index.ts`（改用 `mountFile`）

**Interfaces:**
- Produces: `mountFile(ctx: Context, file: string, uniqueSuffix?: string): Promise<void>`。
- Consumes: `parse.ts` 的 `readMcpServers`、`server-name.ts` 的 `mapServer`、`@deepseek-ai/dsh-mcp-client`。

- [ ] **Step 1: 新建 `packages/mcp/src/mount.ts`**

```ts
/**
 * @fileoverview 把 .mcp.json 中的 MCP server 挂载到指定 ctx。
 */
import type { Context } from '@deepseek-ai/cordis'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { dirname } from 'node:path'
import { readMcpServers } from './parse.js'
import { mapServer } from './server-name.js'

/**
 * 把某个 .mcp.json 文件的 mcpServers 挂载到指定 ctx。
 *
 * 解析文件、逐条映射并挂载 mcp-client 实例，最后统一等待所有实例启动。
 * 单个 server 挂载失败不阻断其它 server。
 *
 * @param ctx - 挂载目标：全局 ctx（启动时）或 agent.ctx（工作区，agent 局部）
 * @param file - .mcp.json 文件路径
 * @param uniqueSuffix - 方案 B：按 agent 派生唯一后缀，透传给 mapServer
 */
export async function mountFile(ctx: Context, file: string, uniqueSuffix?: string): Promise<void> {
  let servers: Record<string, unknown>
  try {
    servers = await readMcpServers(file)
  } catch (error) {
    console.error(`[dsh-loulan-mcp] 解析 ${file} 失败:`, error)
    return
  }

  console.log(`[dsh-loulan-mcp] 应用 ${file}`)
  const projectDir = dirname(file)
  const fibers: PromiseLike<unknown>[] = []

  for (const [serverName, raw] of Object.entries(servers)) {
    const mapped = mapServer(serverName, raw, projectDir, uniqueSuffix)
    if (!mapped.ok) {
      console.warn(`[dsh-loulan-mcp] ${mapped.reason}`)
      continue
    }
    try {
      const fiber = ctx.plugin(mcpClient, mapped.config)
      fibers.push(fiber)
      console.log(`[dsh-loulan-mcp] 已挂载 MCP server "${mapped.config.serverName}"`)
    } catch (error) {
      console.error(`[dsh-loulan-mcp] 挂载 "${mapped.config.serverName}" 失败:`, error)
    }
  }

  const settled = await Promise.allSettled(fibers)
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.error('[dsh-loulan-mcp] MCP server 启动失败:', result.reason)
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/mcp/src/mount.ts
git commit -m "refactor(mcp): 拆分挂载逻辑到 mount.ts"
```

---

## Task 6: 新建 approval.ts（审批特性）

**Files:**
- Create: `packages/mcp/src/approval.ts`

**Interfaces:**
- Produces: `type AgentDecision = 'pending' | 'approved' | 'rejected'`、`interface PendingWork { file: string; servers: Record<string, unknown> }`、`decisionFor(id)`、`setDecision(id, d)`、`clearDecision(id)`、`pendingOf(id)`、`setPending(id, work)`、`clearPending(id)`、`askForApproval(ctx, agent, work): Promise<AgentDecision>`。
- Consumes: `@deepseek-ai/dsh-user-approval` 的 `ApprovalService`、`@deepseek-ai/dsh-agent` 的 `Agent`。

- [ ] **Step 1: 新建 `packages/mcp/src/approval.ts`**

```ts
/**
 * @fileoverview 工作区 MCP 挂载前的用户审批。
 *
 * 在 agent 的首个对话 turn 调用 DSH 的 ApprovalService 征求用户同意：
 * 同意则挂载，拒绝/取消/不可用则不挂载。同一 agent 只询问一次，本次运行期间记住。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalService } from '@deepseek-ai/dsh-user-approval'

/** 单个 agent 的挂载决定状态。 */
export type AgentDecision = 'pending' | 'approved' | 'rejected'

/** 待挂载的工作区信息。 */
export interface PendingWork {
  /** .mcp.json 绝对路径。 */
  file: string
  /** 解析出的 mcpServers 映射（用于列出待挂载服务）。 */
  servers: Record<string, unknown>
}

// 进程内记住每个 agent 的决定与待挂载信息（本次运行期间生效）。
const decisions = new Map<string, AgentDecision>()
const pendingWorks = new Map<string, PendingWork>()

/** 读取某 agent 的当前决定；未决定返回 undefined。 */
export function decisionFor(agentId: string): AgentDecision | undefined {
  return decisions.get(agentId)
}

/** 记录某 agent 的决定。 */
export function setDecision(agentId: string, decision: AgentDecision): void {
  decisions.set(agentId, decision)
}

/** 清除某 agent 的决定（agent 销毁时）。 */
export function clearDecision(agentId: string): void {
  decisions.delete(agentId)
}

/** 读取某 agent 的待挂载信息；无则返回 undefined。 */
export function pendingOf(agentId: string): PendingWork | undefined {
  return pendingWorks.get(agentId)
}

/** 记录某 agent 的待挂载信息。 */
export function setPending(agentId: string, work: PendingWork): void {
  pendingWorks.set(agentId, work)
}

/** 清除某 agent 的待挂载信息。 */
export function clearPending(agentId: string): void {
  pendingWorks.delete(agentId)
}

/** 审批请求使用的合成 toolName（说明这是"挂载 MCP 服务"而非一个具体工具）。 */
const APPROVAL_TOOL_NAME = 'dsh-loulan-mcp:mount'

/**
 * 在 open turn 内征求用户是否挂载工作区的 MCP 服务。
 *
 * @param ctx - 插件上下文，用于读取审批服务（ctx.get('approval')）
 * @param agent - 发起请求的 agent（审批 UI 路由与审计的目标）
 * @param work - 待挂载的工作区信息（file + 服务列表）
 * @returns 'approved'（同意，调用方应挂载）或 'rejected'（拒绝/取消/无审批通道，不挂载）
 */
export async function askForApproval(
  ctx: Context,
  agent: Agent,
  work: PendingWork,
): Promise<AgentDecision> {
  const approval = ctx.get<ApprovalService>('approval')
  if (approval === undefined) {
    console.warn(`[dsh-loulan-mcp] 无审批服务(approval)，fail-closed：不挂载 ${work.file}`)
    return 'rejected'
  }
  const list = Object.keys(work.servers).map((n) => `- ${n}`).join('\n')
  const reason = `工作区发现以下 MCP 服务，是否挂载？\n${list}`
  try {
    const outcome = await approval.request({ agent, toolName: APPROVAL_TOOL_NAME, reason })
    return outcome === 'allowed-once' ? 'approved' : 'rejected'
  } catch (error) {
    console.error(`[dsh-loulan-mcp] 审批失败，不挂载 ${work.file}:`, error)
    return 'rejected'
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add packages/mcp/src/approval.ts
git commit -m "feat(mcp): 新增挂载前审批模块"
```

---

## Task 7: 重写 index.ts（编排 + 接入审批）

**Files:**
- Modify: `packages/mcp/src/index.ts`（整体替换为编排版）

**Interfaces:**
- Produces: `export { name, Config }`、`export type { Config }`、`export async function apply(ctx, config): Promise<void>`。
- Consumes: `discover`、`parse`、`server-name`、`mount`、`approval` 各模块。

- [ ] **Step 1: 重写 `packages/mcp/src/index.ts`**

```ts
/**
 * @fileoverview dsh-loulan-mcp 插件入口 —— 生命周期编排。
 *
 * - 启动时：挂载 .dsh 根目录的 .mcp.json（全局共享，不询问）。
 * - agent 创建时：探测工作区 .mcp.json，若存在则标记"待决定"，不立即挂载；
 *   在该 agent 的首个对话 turn（agent/request）用 ApprovalService 征求同意，
 *   同意后按方案 B 的唯一 serverName 挂载；拒绝/取消/不可用则不挂载。
 */
import type { Context } from '@deepseek-ai/cordis'
// 仅引入 dsh-agent 的事件类型声明（agent/created、agent/request、agent/disposed），不引入运行时代码。
import type {} from '@deepseek-ai/dsh-agent'
import { name, Config } from './config.js'
import { findMcpJson, dshHome } from './discover.js'
import { readMcpServers } from './parse.js'
import { agentToken } from './server-name.js'
import { mountFile } from './mount.js'
import {
  decisionFor,
  setDecision,
  clearDecision,
  pendingOf,
  setPending,
  clearPending,
  askForApproval,
} from './approval.js'

export { name, Config }
export type { Config }

/**
 * 插件入口：按生命周期分离加载 .mcp.json 中的 MCP server。
 *
 * @param ctx - 插件上下文
 * @param config - 插件配置（cwd 指定 .dsh 根目录）
 */
export async function apply(ctx: Context, config: Config) {
  // 起点：.dsh 根目录（启动时全局加载）。
  const rootStart = config.cwd || dshHome()
  const rootFile = findMcpJson(rootStart)

  // 1. 启动时：在全局 ctx 上挂载 .dsh 根目录的 .mcp.json（所有 agent 共享，不询问）。
  if (rootFile) {
    await mountFile(ctx, rootFile)
  } else {
    console.log(`[dsh-loulan-mcp] 在 ${rootStart} 及其父目录未找到 .mcp.json，跳过全局 MCP 引入`)
  }

  // 2. agent 创建时：探测工作区 .mcp.json，标记待决定（不立即挂载）。
  ctx.on('agent/created', ({ agent }) => {
    const cwd = agent.session.header.cwd
    console.log(`[dsh-loulan-mcp] 尝试为工作区 ${cwd} 挂载 .mcp.json`)
    if (cwd === undefined) return
    const file = findMcpJson(cwd)
    if (file === undefined || file === rootFile) return
    void queuePending(agent.id, file)
  })

  // 3. agent 销毁时：清除其决定与待挂载信息。
  ctx.on('agent/disposed', ({ agent }) => {
    clearDecision(agent.id)
    clearPending(agent.id)
  })

  // 4. 首个对话 turn（agent/request 瀑布点，open turn）：对该 agent 征求挂载同意。
  ctx.on('agent/request', ({ agent }, next) => {
    const work = pendingOf(agent.id)
    if (decisionFor(agent.id) !== 'pending' || work === undefined) return next()
    return (async () => {
      const decision = await askForApproval(ctx, agent, work)
      setDecision(agent.id, decision)
      clearPending(agent.id)
      if (decision === 'approved') {
        console.log(`[dsh-loulan-mcp] 已同意，挂载 ${work.file}`)
        void mountFile(agent.ctx, work.file, agentToken(agent.id))
      } else {
        console.log(`[dsh-loulan-mcp] 未同意，跳过挂载 ${work.file}`)
      }
      return next()
    })()
  })
}

/**
 * 探测到工作区 .mcp.json 后：解析并标记该 agent 为"待决定"（不挂载）。
 *
 * 解析失败或服务列表为空时不询问、不挂载。
 */
async function queuePending(agentId: string, file: string): Promise<void> {
  let servers: Record<string, unknown>
  try {
    servers = await readMcpServers(file)
  } catch (error) {
    console.error(`[dsh-loulan-mcp] 解析 ${file} 失败，跳过:`, error)
    return
  }
  if (Object.keys(servers).length === 0) return
  setDecision(agentId, 'pending')
  setPending(agentId, { file, servers })
}
```

> 说明：`agent/request` 为瀑布事件，处理器形参为 `(payload, next)`；`agent` 类型来自 `@deepseek-ai/dsh-agent` 的事件增强（入口已 `import type {} from '@deepseek-ai/dsh-agent'`）。

- [ ] **Step 2: 校验**

```bash
cd /Users/loulan/Documents/Program/TS/dsh-plugins-loulan
pnpm typecheck
pnpm --filter dsh-loulan-mcp build
```
预期：typecheck 与 build 均通过；`packages/mcp/lib/` 生成拆分后的编译产物。

- [ ] **Step 3: 提交**

```bash
git add packages/mcp/src/index.ts
git commit -m "feat(mcp): 工作区挂载前审批 + 按业务拆分源码"
```

---

## Task 8: 补充单元测试

**Files:**
- Create: `packages/mcp/src/server-name.test.ts`
- Create: `packages/mcp/src/parse.test.ts`
- Create: `packages/mcp/src/discover.test.ts`

**Interfaces:**
- 测试纯函数：`agentToken`/`suffixedServerName`/`mapServer`、`isRecord`/`asStringArray`/`asStringRecord`/`readMcpServers`、`findMcpJson`。
- 运行方式：`node --test`（Node 26 原生类型擦除，直接跑 `.ts`）。

- [ ] **Step 1: 新建 `packages/mcp/src/server-name.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentToken, suffixedServerName, SERVER_NAME_PATTERN } from './server-name.js'

test('agentToken 生成 12 位十六进制且对相同输入稳定', () => {
  const t = agentToken('agent-abc')
  assert.match(t, /^[0-9a-f]{12}$/)
  assert.equal(agentToken('agent-abc'), t)
})

test('suffixedServerName 保持在 32 位以内且符合字符集', () => {
  const name = suffixedServerName('postgres', 'abcdef123456')
  assert.ok(SERVER_NAME_PATTERN.test(name))
  assert.ok(name.length <= 32)
})

test('suffixedServerName 对超长 base 截断以容纳后缀', () => {
  const name = suffixedServerName('mcp-server-with-a-very-long-name-xyz', 'abcdef123456')
  assert.ok(SERVER_NAME_PATTERN.test(name))
  assert.equal(name.length, 32)
})
```

- [ ] **Step 2: 新建 `packages/mcp/src/parse.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRecord, asStringArray, asStringRecord } from './parse.js'

test('isRecord 仅接受普通对象', () => {
  assert.equal(isRecord({}), true)
  assert.equal(isRecord(null), false)
  assert.equal(isRecord([]), false)
})

test('asStringArray 过滤非字符串元素', () => {
  assert.deepEqual(asStringArray(['a', 1, null, 'b']), ['a', 'b'])
  assert.deepEqual(asStringArray('x'), [])
})

test('asStringRecord 仅保留字符串值', () => {
  assert.deepEqual(asStringRecord({ a: '1', b: 2, c: true }), { a: '1' })
  assert.deepEqual(asStringRecord(null), {})
})
```

- [ ] **Step 3: 新建 `packages/mcp/src/discover.test.ts`**

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findMcpJson } from './discover.js'

test('findMcpJson 命中存在文件、未命中返回 undefined', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-mcp-'))
  try {
    writeFileSync(join(dir, '.mcp.json'), '{}')
    assert.equal(findMcpJson(dir), join(dir, '.mcp.json'))
    assert.equal(findMcpJson(join(dir, 'nope')), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 4: 运行测试**

```bash
cd /Users/loulan/Documents/Program/TS/dsh-plugins-loulan/packages/mcp
node --test src/server-name.test.ts src/parse.test.ts src/discover.test.ts
```
预期：全部 PASS。

- [ ] **Step 5: 提交**

```bash
cd /Users/loulan/Documents/Program/TS/dsh-plugins-loulan
git add packages/mcp/src/*.test.ts
git commit -m "test(mcp): 为纯逻辑模块补单元测试"
```

---

## Task 9: 集成验证

- [ ] **Step 1: 用测试脚本启动并验证审批**

```bash
cd /Users/loulan/Documents/Program/TS/dsh-plugins-loulan
pnpm test-mcp
# 打开 http://127.0.0.1:13080 → 进入 test02 工作区 → 发送一条消息
```

预期：
- 首个对话 turn 出现审批（列明 `postgres`、`Machine-API`）。
- 点同意 → 该会话 MCP 工具可用；同工作区**再新建**会话会**再次**询问。
- 拒绝 → 工具不可用、不挂载。
- `test02` 无 `.mcp.json` 的工作区不询问。
- 全局 `.dsh` 根 `.mcp.json` 仍自动挂载、不询问。

- [ ] **Step 2: 提交（如无代码改动则跳过）**

---

## Self-Review

- **Spec coverage：** 行为（每次新建 agent 询问、无全局记忆、无 `.mcp.json` 不询问、全局根不询问）→ Task 7；文件拆分 → Task 1–7；fail-closed → approval.ts；唯一 serverName → server-name.ts 保留方案 B。覆盖完整。
- **Placeholder scan：** 无 TBD/TODO；每步含完整代码与命令。
- **Type consistency：** `agentToken`/`suffixedServerName`/`mapServer`/`mountFile`/`askForApproval`/`decisionFor`/`setDecision`/`pendingOf`/`setPending`/`clearDecision`/`clearPending`/`readMcpServers` 签名在各任务间一致；`.js` 扩展名导入一致；相对导入指向确认存在的模块。
- **注意点：** `agent/request` 未验证 `import type {} from '@deepseek-ai/dsh-agent'` 是否已提供 `agent` 类型；Task 7 Step 1 已加提示，若缺失则补该导入。
